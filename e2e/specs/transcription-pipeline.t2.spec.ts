import { test, expect } from '../fixtures/electron';
import { startMockOllama } from '../fixtures/mock-ollama';
import { makeWav } from '../fixtures/make-wav';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * T2 — real-backend transcription pipeline smoke (@pipeline). Drives a synthetic
 * WAV through the app's streaming pipeline (process-streaming) and asserts it
 * runs end to end: HEARTBEAT markers observed on the debug-log channel, a
 * summary written into the temp dir, and the real user-data dir untouched.
 *
 * Plumbing + HEARTBEAT only — never asserts transcript text (a sine WAV is
 * non-speech, so Parakeet returns an empty transcript; the pipeline still
 * completes and writes the summary). This is the one genuinely Mac-divergent
 * path (parakeet-mlx), so it needs the Parakeet model present — CI installs it
 * (cached); a dev machine without it skips. Tagged @pipeline so CI can run it in
 * its own model-bearing job and keep the org-lock T2 model-free.
 */

// Engine: parakeet locally (the Mac-divergent path), whisper in CI. GitHub-hosted
// macOS runners have no Metal GPU, so parakeet-mlx can't load there — whisper.cpp
// (CPU) exercises the same process-streaming plumbing + HEARTBEAT. Set via env so
// the spec is unchanged either way.
const ENGINE: 'parakeet' | 'whisper' =
  process.env.STENOAI_E2E_ENGINE === 'whisper' ? 'whisper' : 'parakeet';
const WHISPER_MODEL = 'small'; // smallest registered model (466 MB)

// The preload surface the renderer sees (app/preload.js), narrowed to what this
// spec drives. e2e/ lives outside renderer/, so window.stenoai isn't ambiently
// typed here — declare just the slice we use rather than reaching for `any`.
type StenoWindow = Window & {
  stenoai: {
    parakeetModels: { status: () => Promise<{ installed?: boolean }> };
    whisperModels: {
      list: () => Promise<{ supported_models?: Record<string, { installed?: boolean }> }>;
      set: (name: string) => Promise<unknown>;
    };
    transcriptionEngine: { set: (engine: string) => Promise<unknown> };
    recording: { processSystemAudio: (p: string, name: string) => Promise<{ success?: boolean }> };
    on: { debugLog: (cb: (line: unknown) => void) => void };
  };
  __hb?: string[];
};

test('@pipeline synthetic WAV runs the full pipeline: HEARTBEAT + summary, real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  // The pipeline (model load + transcribe + summarise) can outlast Playwright's
  // 30 s default, especially on a cold CI runner — give it room above the
  // file-poll timeout below.
  test.setTimeout(180_000);

  // Mock Ollama on the hardcoded 11434 so summarisation never reaches a real
  // LLM. Kill any stray real Ollama first; the successful bind then proves the
  // port is ours (plan risk 2). The app probes /api/tags and skips its own
  // `ollama serve` on the mock's 200.
  killOllama();
  const ollama = await startMockOllama();

  const realDirBefore = fileSig(realUserDataDir());

  try {
    const { page } = await launchApp();

    // Select the engine in the per-test config (the backend reads it at process
    // time). For whisper, also pin the small model so we don't need the larger
    // default.
    await page.evaluate((e) => (window as StenoWindow).stenoai.transcriptionEngine.set(e), ENGINE);
    if (ENGINE === 'whisper') {
      await page.evaluate((m) => (window as StenoWindow).stenoai.whisperModels.set(m), WHISPER_MODEL);
    }

    // Models aren't bundled — they download on use. Without the active engine's
    // model transcription can't run, and this is a pipeline smoke, not a
    // model-download test — skip loudly rather than hang/fail. CI installs the
    // model before this spec.
    const modelReady =
      ENGINE === 'whisper'
        ? await page.evaluate(
            async (m) =>
              !!(await (window as StenoWindow).stenoai.whisperModels.list())?.supported_models?.[m]
                ?.installed,
            WHISPER_MODEL,
          )
        : await page.evaluate(
            async () =>
              (await (window as StenoWindow).stenoai.parakeetModels.status())?.installed === true,
          );
    if (!modelReady) {
      // eslint-disable-next-line no-console
      console.warn(`[t2:@pipeline] SKIPPED: ${ENGINE} model not installed on this runner.`);
      test.info().annotations.push({ type: 'skip-reason', description: `${ENGINE} model not installed` });
    }
    test.skip(!modelReady, `${ENGINE} model not installed`);

    // Write the WAV into the temp recordings dir — an allowed base dir now that
    // getAllowedBaseDirs() honors getUserDataDir().
    const recordingsDir = path.join(userDataDir, 'recordings');
    mkdirSync(recordingsDir, { recursive: true });
    const wavPath = path.join(recordingsDir, 'pipeline.wav');
    makeWav(wavPath, { seconds: 5 });

    // Collect HEARTBEAT lines forwarded to the renderer's debug-log channel.
    // Subscribe BEFORE driving so the first (immediately-forwarded) beat is seen.
    await page.evaluate(() => {
      const w = window as StenoWindow;
      w.__hb = [];
      w.stenoai.on.debugLog((line: unknown) => {
        if (typeof line === 'string' && line.includes('HEARTBEAT')) w.__hb!.push(line);
      });
    });

    // Drive the real streaming pipeline through the app IPC (enqueues
    // process-streaming on the WAV).
    const queued = await page.evaluate(
      (p) => (window as StenoWindow).stenoai.recording.processSystemAudio(p, 'E2E Pipeline'),
      wavPath,
    );
    expect(queued?.success).toBe(true);

    // Completion: the summary .md lands in the temp output dir. Generous timeout
    // for model load + transcribe + summarise (mock Ollama answers instantly).
    const summaryPath = path.join(userDataDir, 'output', 'pipeline_summary.md');
    await expect
      .poll(() => existsSync(summaryPath), { timeout: 120_000, intervals: [1000] })
      .toBe(true);

    // HEARTBEAT markers were observed during the run.
    const heartbeats = await page.evaluate(() => (window as StenoWindow).__hb ?? []);
    expect(heartbeats.some((l) => l.includes('HEARTBEAT:transcribe'))).toBe(true);

    // Keystone: the real user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await ollama.close();
    // Teardown: the app may have spawned its own `ollama serve` despite the mock
    // (e.g. a probe race); don't let it outlive the test (PR1 follow-up — the
    // workflow only pkills BEFORE launch).
    killOllama();
  }
});

function killOllama(): void {
  try {
    execSync('pkill -f ollama', { stdio: 'ignore' });
  } catch {
    /* nothing matched — fine */
  }
}

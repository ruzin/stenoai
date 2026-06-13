import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { selectEngine, isEngineModelReady, E2E_ENGINE } from '../fixtures/engine';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

/**
 * T2 — honest transcription failure (@pipeline). Undecodable audio must fail
 * HONESTLY: emit transcription_failed (never fake silence) AND preserve the
 * source recording so the user can reprocess (the dishonest-failure regression).
 *
 * Feeds a >1 KB non-audio file through the real pipeline and asserts the
 * TRANSCRIPTION_FAILED signal + a transcription_failed summary + the source
 * preserved. Tagged @pipeline: the transcriber AUTO-DOWNLOADS a missing model,
 * so this must run with a model present (the model-bearing job) — otherwise it
 * would fail on model-absence (and pull ~0.5 GB) instead of on the bad audio.
 * No mock Ollama needed — summarisation is skipped on transcription failure.
 */

type StenoWindow = Window & {
  stenoai: {
    recording: { processSystemAudio: (p: string, name: string) => Promise<{ success?: boolean }> };
    on: { debugLog: (cb: (line: unknown) => void) => void };
  };
  __dl?: string[];
};

test('@pipeline garbage audio fails honestly and preserves the source; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(180_000);
  const realDirBefore = fileSig(realUserDataDir());

  const { page } = await launchApp();
  await selectEngine(page);

  const modelReady = await isEngineModelReady(page);
  if (!modelReady) {
    // eslint-disable-next-line no-console
    console.warn(`[t2:@pipeline] SKIPPED: ${E2E_ENGINE} model not installed on this runner.`);
    test.info().annotations.push({ type: 'skip-reason', description: `${E2E_ENGINE} model not installed` });
  }
  test.skip(!modelReady, `${E2E_ENGINE} model not installed`);

  // Garbage: above the transcriber's 1 KB stub floor but not valid audio, so the
  // decode fails (it won't reach a real transcript).
  const recordingsDir = path.join(userDataDir, 'recordings');
  mkdirSync(recordingsDir, { recursive: true });
  const badPath = path.join(recordingsDir, 'garbage.wav');
  writeFileSync(badPath, Buffer.alloc(4096, 0xff));
  const sizeBefore = statSync(badPath).size;

  await page.evaluate(() => {
    const w = window as StenoWindow;
    w.__dl = [];
    w.stenoai.on.debugLog((line: unknown) => {
      if (typeof line === 'string') w.__dl!.push(line);
    });
  });

  const queued = await page.evaluate(
    (p) => (window as StenoWindow).stenoai.recording.processSystemAudio(p, 'E2E Bad Audio'),
    badPath,
  );
  expect(queued?.success).toBe(true);

  // The honest-failure path completes and writes a marked summary.
  const summaryPath = path.join(userDataDir, 'output', 'garbage_summary.md');
  await expect
    .poll(() => existsSync(summaryPath), { timeout: 120_000, intervals: [1000] })
    .toBe(true);

  // Failure surfaced honestly on the debug-log channel. main.js forwards the
  // raw TRANSCRIPTION_FAILED: protocol line as a humanized message
  // ("Transcription failed (audio preserved): …"), so match on that.
  const lines = await page.evaluate(() => (window as StenoWindow).__dl ?? []);
  expect(lines.some((l) => /transcription failed/i.test(l))).toBe(true);

  // Summary marks the failure (not faked silence).
  expect(readFileSync(summaryPath, 'utf8')).toMatch(/transcription_failed:\s*true/i);

  // Source audio preserved (not deleted), byte-for-byte — the user can reprocess.
  expect(existsSync(badPath)).toBe(true);
  expect(statSync(badPath).size).toBe(sizeBefore);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

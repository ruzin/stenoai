import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { enableDeterministicRecording } from '../fixtures/user-config';

/**
 * T2 — recording lifecycle state machine (highest release risk). Drives the real
 * backend's recording IPC through the preload bridge and asserts the in-memory
 * state machine via get-queue-status: idle -> recording -> paused -> resumed ->
 * stopped, plus the idempotent/guard edges.
 *
 * Deterministic + model-free: enableDeterministicRecording() puts the app in the
 * renderer-driven (system-audio) path with the Whisper engine, so start sets the
 * state machine WITHOUT spawning the Python `record` subprocess, opening a mic,
 * or loading a model (see fixtures/user-config.ts). No @pipeline tag — runs in
 * the fast t2-macos / t2-windows jobs.
 */

type QueueStatus = {
  success: boolean;
  isProcessing: boolean;
  queueSize: number;
  hasRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  sessionName: string | null;
};
type RecResult = { success: boolean; error?: string; sessionName?: string };
type SupportResult = { success: boolean; supported?: boolean };

type StenoWindow = Window & {
  stenoai: {
    recording: {
      start: (name?: string) => Promise<RecResult>;
      stop: () => Promise<RecResult>;
      pause: () => Promise<RecResult>;
      resume: () => Promise<RecResult>;
      getQueue: () => Promise<QueueStatus>;
      getSystemAudioSupport: () => Promise<SupportResult>;
    };
  };
};

const queue = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.recording.getQueue());

test('recording state machine: start -> pause -> resume -> stop is reflected in queue status', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  enableDeterministicRecording(userDataDir);

  const { page } = await launchApp();

  // The renderer-driven (no-subprocess) path needs OS system-audio support
  // (macOS >= 14.4 / Windows >= 10). Without it, start would fall back to the
  // mic subprocess and need a real device — skip LOUDLY rather than emit a
  // misleading failure or silently spawn a recorder. Windows CI (>= 10) always
  // runs this; macOS only skips on a pre-14.4 runner (hosted images are well
  // past that), so the loud annotation surfaces any regression to a no-op skip.
  const support = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.getSystemAudioSupport(),
  );
  if (!support?.supported) {
    // eslint-disable-next-line no-console
    console.warn(
      '[t2] SKIPPED recording lifecycle: system-audio (renderer-driven) path unsupported on this host.',
    );
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'isSystemAudioSupported() false; deterministic record path unavailable',
    });
  }
  test.skip(!support?.supported, 'system-audio path unsupported on this runner');

  // Idle.
  const idle = await queue(page);
  expect(idle.success).toBe(true);
  expect(idle.hasRecording).toBe(false);
  expect(idle.isPaused).toBe(false);
  expect(idle.sessionName).toBeNull();

  // Start -> recording.
  const started = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.start('E2E Lifecycle'),
  );
  expect(started.success).toBe(true);
  const recording = await queue(page);
  expect(recording.hasRecording).toBe(true);
  expect(recording.isPaused).toBe(false);
  expect(recording.sessionName).toBe('E2E Lifecycle');

  // Starting again while recording is rejected (no double recordings).
  const dup = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.start('Second'),
  );
  expect(dup.success).toBe(false);

  // Pause -> paused.
  const paused = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.pause(),
  );
  expect(paused.success).toBe(true);
  await expect.poll(async () => (await queue(page)).isPaused).toBe(true);
  expect((await queue(page)).hasRecording).toBe(true);

  // Resume -> recording.
  const resumed = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.resume(),
  );
  expect(resumed.success).toBe(true);
  await expect.poll(async () => (await queue(page)).isPaused).toBe(false);

  // Stop -> idle.
  const stopped = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.stop(),
  );
  expect(stopped.success).toBe(true);
  await expect.poll(async () => (await queue(page)).hasRecording).toBe(false);
  const finalState = await queue(page);
  expect(finalState.isPaused).toBe(false);
  expect(finalState.sessionName).toBeNull();

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('recording guards: stop is idempotent, pause/resume with no recording is rejected', async ({
  launchApp,
}) => {
  // No enableDeterministicRecording() needed: these edges never call start(), so
  // they branch purely on the idle currentRecordingProcess / systemAudioRecordingActive
  // flags and never read the recording-path config.
  const { page } = await launchApp();

  // Stop with nothing recording is a no-op success (stale-state race), not an error.
  const stop = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.stop(),
  );
  expect(stop.success).toBe(true);
  expect((await queue(page)).hasRecording).toBe(false);

  // Pause / resume with no recording are explicit failures.
  const pause = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.pause(),
  );
  expect(pause.success).toBe(false);
  const resume = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.resume(),
  );
  expect(resume.success).toBe(false);
});

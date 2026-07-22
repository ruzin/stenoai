import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { test, expect } from '../fixtures/electron';

/**
 * T1 — the processing-screen watchdog (issue #343). Stopping a recording
 * navigates to /meetings/processing unconditionally, but a processing job is
 * only queued if the capture produced a file. When a stop produces NO job
 * (Stop hit while getUserMedia was still pending → no blob, or system-audio
 * capture resolved {success:false}), no `processing-complete` ever fires and
 * the screen used to spin forever — the only escape was the Home button.
 *
 * The watchdog (app/renderer/src/routes/Processing.tsx, driven by useRecording's
 * queue signals) detects a genuinely idle-and-empty queue that PERSISTS past the
 * normal stop→enqueue handoff (main waits up to ~8s for the live-transcript
 * sidecar to drain before enqueuing, so a brief idle+empty gap is legitimate),
 * then swaps the spinner for a calm "nothing to process" panel. It must NOT trip
 * during that handoff, nor while a job is actually queued.
 *
 * These specs drive the real state SEQUENCE via a scripted get-queue-status: the
 * mock reads STENOAI_E2E_QUEUE_STATE_PATH each poll (app/e2e-mock-ipc.js), so the
 * spec rewrites that file over time to move through optimistic-processing →
 * idle+empty → (late) enqueue exactly as main does.
 */

// Queue-status shapes the mock merges over its idle defaults.
const PROCESSING = { isProcessing: true, currentJob: 'Watchdog Note', sessionName: 'Watchdog Note' };
const IDLE_EMPTY = { isProcessing: false, queueSize: 0, hasRecording: false };
// A DIFFERENT session — its distinct sessionName is what makes Processing.tsx
// swap activeSession in place (no remount), the case the recovery spec drives.
const PROCESSING_2 = { isProcessing: true, currentJob: 'Second Note', sessionName: 'Second Note' };
// A SAME-name second recording actively recording — status transitions into
// 'recording' with the SAME display name, so activeSession never changes; only
// the name-independent generation bump can recover the screen.
const RECORDING_SAME = { hasRecording: true, isProcessing: false, sessionName: 'Watchdog Note' };

function makeStateFile(initial: object): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'stenoai-queue-'));
  const file = path.join(dir, 'queue.json');
  writeFileSync(file, JSON.stringify(initial), 'utf-8');
  return file;
}

test('idle+empty that persists past the handoff trips the watchdog', async ({ launchApp }) => {
  test.setTimeout(45_000);
  // Start on the optimistic-processing state main writes at stop…
  const stateFile = makeStateFile(PROCESSING);
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_QUEUE_STATE_PATH: stateFile },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });

  // …then the queue settles to idle+empty and STAYS there — the stop produced
  // no job, so nothing is ever enqueued.
  writeFileSync(stateFile, JSON.stringify(IDLE_EMPTY), 'utf-8');

  // The watchdog needs 8 consecutive idle ticks (~12s) plus poll latency, so
  // give the assertion generous room. exact:true pins the heading — the body
  // copy also contains "nothing to process".
  await expect(page.getByText('Nothing to process', { exact: true })).toBeVisible({
    timeout: 22_000,
  });

  // "Try again" stays disabled (no backing job) and the animated header
  // "Processing" chip is gone — nothing is actually processing.
  await expect(page.getByRole('button', { name: 'Try again' })).toBeDisabled();
  await expect(page.getByTestId('processing-chip')).toHaveCount(0);

  rmSync(path.dirname(stateFile), { recursive: true, force: true });
});

test('a new session after "Nothing to process" recovers without a remount', async ({
  launchApp,
}) => {
  test.setTimeout(45_000);
  // Trip the watchdog first (idle+empty past threshold)…
  const stateFile = makeStateFile(PROCESSING);
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_QUEUE_STATE_PATH: stateFile },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });
  writeFileSync(stateFile, JSON.stringify(IDLE_EMPTY), 'utf-8');
  await expect(page.getByText('Nothing to process', { exact: true })).toBeVisible({
    timeout: 22_000,
  });

  // …then the user starts ANOTHER recording on the same (still-mounted) route.
  // Its distinct sessionName swaps activeSession in place; the screen must leave
  // the "Nothing to process" panel and show the spinner for the new session
  // rather than staying stuck.
  writeFileSync(stateFile, JSON.stringify(PROCESSING_2), 'utf-8');
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByText('Analyzing transcript')).toBeVisible();
  await expect(page.getByTestId('processing-chip')).toBeVisible();

  rmSync(path.dirname(stateFile), { recursive: true, force: true });
});

test('a SAME-name new recording after "Nothing to process" recovers', async ({ launchApp }) => {
  test.setTimeout(45_000);
  // Session identity is only a collidable display name, so recovery must not
  // hinge on the name changing. Trip the watchdog, then start a NEW recording
  // reusing the SAME sessionName — activeSession never changes, so only the
  // name-independent status→'recording' generation bump can rescue the screen.
  const stateFile = makeStateFile(PROCESSING);
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_QUEUE_STATE_PATH: stateFile },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });
  writeFileSync(stateFile, JSON.stringify(IDLE_EMPTY), 'utf-8');
  await expect(page.getByText('Nothing to process', { exact: true })).toBeVisible({
    timeout: 22_000,
  });

  // Same-name recording begins (status → 'recording', identical name)…
  writeFileSync(stateFile, JSON.stringify(RECORDING_SAME), 'utf-8');
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByText('Analyzing transcript')).toBeVisible();
  await expect(page.getByTestId('processing-chip')).toBeVisible();

  // …and then it stops into processing (same name) — still recovered, no relapse.
  writeFileSync(stateFile, JSON.stringify(PROCESSING), 'utf-8');
  await page.waitForTimeout(2000);
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Analyzing transcript')).toBeVisible();

  rmSync(path.dirname(stateFile), { recursive: true, force: true });
});

test('a late enqueue during the handoff does NOT trip the watchdog', async ({ launchApp }) => {
  test.setTimeout(45_000);
  // The critical regression guard. Reproduce the NORMAL stop of a real
  // recording: optimistic processing → a legitimate idle+empty handoff gap
  // (main draining the live-transcript sidecar) → the job is finally enqueued.
  const stateFile = makeStateFile(PROCESSING);
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1', STENOAI_E2E_QUEUE_STATE_PATH: stateFile },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });

  // Idle+empty for ~7s (longer than the OLD 4.5s threshold, shorter than the
  // real ~8s drain) — the watchdog must ride this out without giving up.
  writeFileSync(stateFile, JSON.stringify(IDLE_EMPTY), 'utf-8');
  await page.waitForTimeout(7000);
  // The spinner is still up mid-handoff — no premature "nothing to process".
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Analyzing transcript')).toBeVisible();

  // The job is finally enqueued (a real recording's speech is now processing).
  writeFileSync(stateFile, JSON.stringify(PROCESSING), 'utf-8');

  // Well past the point the old 4.5s watchdog would have fired: still no false
  // "nothing to process", spinner intact.
  await page.waitForTimeout(9000);
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Analyzing transcript')).toBeVisible();

  rmSync(path.dirname(stateFile), { recursive: true, force: true });
});

test('an active processing job never trips the watchdog', async ({ launchApp }) => {
  test.setTimeout(45_000);
  // No file seam here — drive the mock's own recording state machine: start
  // then stop parks in isProcessing:true (a genuinely queued job) and
  // useRecording.stopRecording navigates to /meetings/processing.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' },
  });

  await page.evaluate(() => window.stenoai.recording.start('Watchdog Note'));
  const pill = page.getByTestId('transcription-pill');
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: 'Stop recording' }).click();

  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toBe('#/meetings/processing');

  // The normal processing spinner is up…
  await expect(page.getByText('Analyzing transcript')).toBeVisible();

  // …and stays up well past the watchdog window — no false "nothing to process".
  await page.waitForTimeout(15_000);
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Analyzing transcript')).toBeVisible();
});

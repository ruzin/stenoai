import { test, expect } from '../fixtures/electron';

/**
 * T1 — the processing-screen watchdog (issue #343). Stopping a recording
 * navigates to /meetings/processing unconditionally, but a processing job is
 * only queued if the capture produced a file. When a stop produces NO job
 * (Stop hit while getUserMedia was still pending, or system-audio capture
 * returned nothing), no `processing-complete` ever fires and the screen used
 * to spin forever — the only escape was the Home button.
 *
 * The watchdog (app/renderer/src/routes/Processing.tsx, driven by useRecording's
 * queue signals) detects a genuinely idle-and-empty queue with no real
 * processing activity and swaps the spinner for a calm "nothing to process"
 * panel. It must NOT trip while a job is actually queued (isProcessing:true).
 *
 * Mock IPC's default get-queue-status is idle+empty (app/e2e-mock-ipc.js),
 * which is exactly the stuck end-state a no-job stop leaves behind; the stop
 * flow parks in isProcessing:true for the no-false-positive case.
 */

const ENV = { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };

test('idle+empty queue with no processing-complete trips the watchdog', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: ENV });

  // Land on the processing screen the way a no-job stop leaves the user: the
  // queue reports idle+empty (the mock default) and no processing-complete
  // ever fires.
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });

  // The watchdog needs a few consecutive idle ticks (~4.5s) before it fires,
  // so give the assertion room beyond the default 5s expect timeout. exact:true
  // pins the heading — the body copy also contains "nothing to process".
  await expect(page.getByText('Nothing to process', { exact: true })).toBeVisible({
    timeout: 12_000,
  });

  // "Try again" stays disabled — there is no backing job to re-run.
  await expect(page.getByRole('button', { name: 'Try again' })).toBeDisabled();
});

test('an active processing job never trips the watchdog', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: ENV });

  // Start then stop: the mock parks in isProcessing:true (a genuinely queued
  // job) and useRecording.stopRecording navigates to /meetings/processing.
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
  await page.waitForTimeout(7000);
  await expect(page.getByText('Nothing to process', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Analyzing transcript')).toBeVisible();
});

import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC. The coexisting transcription pill dock:
 * starting a recording no longer navigates to a takeover /recording route —
 * the compact pill (components/LiveDock.tsx) docks LEFT of the Ask bar in the
 * primary bottom-dock row (components/PrimaryDock.tsx), the Ask bar renders
 * visible-but-disabled, and (Parakeet) the pill expands into the
 * LiveTranscriptBar panel whose footer owns Pause/Resume + Stop.
 *
 * The recording state machine is the stateful mock in app/e2e-mock-ipc.js
 * (start/pause/resume/stop mutate in-memory state; get-queue-status reflects
 * it), so the renderer's queue poll drives the same status transitions the
 * real backend would. STENOAI_E2E_MOCK_ENGINE=whisper drives the Whisper
 * variant (inline Pause/Resume, no expand).
 */

test('recording coexists: pill docks next to a disabled Ask bar, expands, stops to processing', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    // Report an installed ASR model so the first-run setup gate doesn't
    // redirect to /setup before the spec can reach the Record button.
    env: { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' },
  });

  // Start from the real toolbar button so the spec exercises
  // useRecording.startRecording — the code path that used to navigate.
  await page.locator('.record-btn').click();

  // The pill appears (optimistic status flip) without any navigation.
  const pill = page.getByTestId('transcription-pill');
  await expect(pill).toBeVisible();
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).not.toContain('/recording');
  expect(hash).not.toContain('/meetings/processing');

  // Adjacent row: pill + Ask bar share the primary dock row, and the Ask bar
  // is visible but disabled with the recording hint.
  await expect(page.getByTestId('primary-dock-row')).toBeVisible();
  const askInput = page.getByPlaceholder('Chat available after recording');
  await expect(askInput).toBeVisible();
  await expect(askInput).toBeDisabled();

  // Parakeet collapsed pill = status + expand + Stop; Pause/Resume lives in
  // the expanded panel footer only.
  await expect(pill.getByRole('button', { name: 'Show transcript' })).toBeVisible();
  await expect(pill.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);

  // Collision invariant: the saved-meeting 72-band panels never render for
  // the unsaved recording (no active saved meeting on Home).
  await expect(page.getByTestId('generate-notes-dock-button')).toHaveCount(0);
  await expect(page.locator('[data-transcript-bar]')).toHaveCount(0);

  // Chrome routes (settings): the pill docks ALONE — no disabled composer
  // floating over the Settings page.
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
  await expect(page.getByPlaceholder('Chat available after recording')).toHaveCount(0);

  // Processing route: recording wins the slot (back-to-back notes) — the
  // pill + Stop stay reachable instead of being displaced by ProcessingDock.
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing';
  });
  await expect(page.getByTestId('transcription-pill')).toBeVisible();

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await expect(page.getByTestId('transcription-pill')).toBeVisible();

  // Expand: the live transcript panel replaces the row; its footer owns
  // Pause/Resume + Stop. Collapse returns to the pill.
  await pill.getByRole('button', { name: 'Show transcript' }).click();
  const panel = page.getByTestId('live-transcript-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('primary-dock-row')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Pause recording' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await panel.getByRole('button', { name: 'Minimize transcript' }).click();
  await expect(page.getByTestId('transcription-pill')).toBeVisible();

  // Stop from the pill → the renderer transitions to the processing dock
  // (processing still owns the screen; only recording coexists).
  await page.getByTestId('transcription-pill').getByRole('button', { name: 'Stop recording' }).click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toContain('/meetings/processing');
});

test('whisper variant: compact pill keeps inline pause/resume and has no expand', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_MOCK_ENGINE: 'whisper',
      STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
    },
  });

  await page.locator('.record-btn').click();
  const pill = page.getByTestId('transcription-pill');
  await expect(pill).toBeVisible();

  // No live transcript on Whisper: no expand affordance, but Pause/Resume
  // must stay inline (there is no expanded footer to relocate it into).
  await expect(pill.getByRole('button', { name: 'Show transcript' })).toHaveCount(0);
  const pauseBtn = pill.getByRole('button', { name: 'Pause recording' });
  await expect(pauseBtn).toBeVisible();

  // Pause → the queue poll reflects isPaused and the control flips to Resume.
  await pauseBtn.click();
  const resumeBtn = pill.getByRole('button', { name: 'Resume recording' });
  await expect(resumeBtn).toBeVisible();
  await resumeBtn.click();
  await expect(pill.getByRole('button', { name: 'Pause recording' })).toBeVisible();
});

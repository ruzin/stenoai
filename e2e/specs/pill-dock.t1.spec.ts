import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC. The coexisting transcription pill dock: a
 * BACKGROUND start (hotkey/tray/auto) does not navigate — it docks the compact
 * Granola-style pill (components/LiveDock.tsx: wave + elapsed +
 * expand chevron + stop glyph) docks LEFT of the Ask bar in the primary
 * bottom-dock row (components/PrimaryDock.tsx), the Ask bar renders
 * visible-but-disabled, and (Parakeet) the pill expands into the
 * LiveTranscriptBar panel.
 *
 * There is NO manual pause anywhere — stop ends the segment ("stop is the
 * new pause"; a note can be continued later, appending to it). Resume
 * appears only when the SYSTEM auto-paused (sleep / meeting-app mic drop).
 *
 * The recording state machine is the stateful mock in app/e2e-mock-ipc.js
 * (start/pause/resume/stop mutate in-memory state; get-queue-status reflects
 * it), so the renderer's queue poll drives the same status transitions the
 * real backend would. STENOAI_E2E_MOCK_ENGINE=whisper drives the Whisper
 * variant (no expand).
 */

const PILL_ENV = { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };

/**
 * Start a recording in the BACKGROUND (the IPC directly, as a hotkey/tray/
 * auto-detect trigger does) so the spec tests dock coexistence without the
 * New-note navigation — a background start must stay on the current route and
 * dock the pill there. (The explicit toolbar New-note button navigates to the
 * live-note editor; that's covered separately below.)
 */
async function startInBackground(page: Page) {
  await page.evaluate(() => window.stenoai.recording.start('Test note'));
  const pill = page.getByTestId('transcription-pill');
  await expect(pill).toBeVisible();
  return pill;
}

test('recording coexists: pill docks next to a disabled Ask bar, expands, stops to processing', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: PILL_ENV });

  const pill = await startInBackground(page);

  // A background start does NOT navigate — the pill docks on the current route.
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).not.toContain('/recording');
  expect(hash).not.toContain('/meetings/processing');

  // Adjacent row: pill + Ask bar share the primary dock row, and the Ask bar
  // is visible but disabled with the recording hint.
  await expect(page.getByTestId('primary-dock-row')).toBeVisible();
  const askInput = page.getByPlaceholder('Chat available after recording');
  await expect(askInput).toBeVisible();
  await expect(askInput).toBeDisabled();

  // Compact pill = wave + elapsed + expand + stop glyph. NO pause control —
  // stop is the new pause.
  await expect(pill.getByRole('button', { name: 'Show transcript' })).toBeVisible();
  await expect(pill.getByRole('button', { name: 'Stop recording' })).toBeVisible();
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

  // Expand: the live transcript panel replaces the row; its footer owns Stop
  // (and language) — and has NO pause either. Collapse returns to the pill.
  await pill.getByRole('button', { name: 'Show transcript' }).click();
  const panel = page.getByTestId('live-transcript-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('primary-dock-row')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Minimize transcript' }).click();
  await expect(page.getByTestId('transcription-pill')).toBeVisible();

  // Stop from the pill → the renderer transitions to the processing dock
  // (processing still owns the screen; only recording coexists).
  await page
    .getByTestId('transcription-pill')
    .getByRole('button', { name: 'Stop recording' })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toContain('/meetings/processing');
});

test('New note: the toolbar button starts recording AND opens the live-note editor', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: PILL_ENV });

  // Coexistence means the pill FOLLOWS you, not that you start nowhere: the
  // explicit New-note action lands the user on the live-note editor so they
  // have somewhere to write notes while it records.
  await page.locator('.record-btn').click();
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toContain('/recording');
});

test('auto-pause rescue: Resume appears only when the system paused the recording', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: PILL_ENV });
  const pill = await startInBackground(page);

  // No resume while recording normally.
  await expect(pill.getByRole('button', { name: 'Resume recording' })).toHaveCount(0);

  // Simulate a system auto-pause (sleep / meeting-app mic drop) via the same
  // IPC the auto-pause path calls. The pill must offer Resume so the user is
  // never stranded (there is no manual pause control to undo).
  await page.evaluate(() => window.stenoai.recording.pause());
  const resume = pill.getByRole('button', { name: 'Resume recording' });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(pill.getByRole('button', { name: 'Resume recording' })).toHaveCount(0);
  await expect(pill.getByRole('button', { name: 'Stop recording' })).toBeVisible();
});

test('whisper variant: compact pill has no expand and no pause', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...PILL_ENV, STENOAI_E2E_MOCK_ENGINE: 'whisper' },
  });
  const pill = await startInBackground(page);

  // No live transcript on Whisper: no expand affordance; and no pause —
  // stop-only, like Parakeet.
  await expect(pill.getByRole('button', { name: 'Show transcript' })).toHaveCount(0);
  await expect(pill.getByRole('button', { name: 'Pause recording' })).toHaveCount(0);
  await expect(pill.getByRole('button', { name: 'Stop recording' })).toBeVisible();
});

test('continue-recording: a note detail offers resume-transcription; stale notes offer Regenerate', async ({
  launchApp,
}) => {
  // A summarised note: the dock offers the continue-recording mic while idle.
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...PILL_ENV, STENOAI_E2E_SEED_MEETING: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/epsilon_summary.json';
  });
  const continueBtn = page.getByTestId('continue-recording-button');
  await expect(continueBtn).toBeVisible();

  // Clicking it starts a recording (append target is main-side state): the
  // pill replaces the mic and the Ask bar goes inert.
  await continueBtn.click();
  await expect(page.getByTestId('transcription-pill')).toBeVisible();
  await expect(page.getByTestId('continue-recording-button')).toHaveCount(0);
  await expect(page.getByPlaceholder('Chat available after recording')).toBeDisabled();
});

test('stale note: floating CTA reads Regenerate notes', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { ...PILL_ENV, STENOAI_E2E_SEED_STALE_NOTE: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/stale_summary.md';
  });
  const cta = page.getByTestId('generate-notes-dock-button');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText(/Regenerate notes/);
});

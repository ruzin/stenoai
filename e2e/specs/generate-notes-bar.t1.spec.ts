import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC. The floating "Generate notes" button
 * (GenerateNotesBar) that sits above the Ask bar for a transcript-only note
 * (auto-summarise off, #276 → notes_generated:false). This is the recording-flow
 * surface for #276's on-demand summarise; the note-detail CTA is the other.
 *
 * The gate is the risk: it must show for a transcript-only note and stay hidden
 * for a normal (summarised) one. Seeded via STENOAI_E2E_SEED_PENDING_NOTE /
 * STENOAI_E2E_SEED_MEETING in app/e2e-mock-ipc.js. Component:
 * app/renderer/src/components/GenerateNotesBar.tsx.
 */

async function openMeeting(page: Page, summaryFile: string) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, summaryFile);
}

test('shows the floating Generate notes button for a transcript-only note', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_PENDING_NOTE: '1' },
  });
  await openMeeting(page, 'pending_summary.md');

  // The floating dock CTA appears above the Ask bar.
  const cta = page.getByTestId('generate-notes-dock-button');
  await expect(cta).toBeVisible();
  await expect(cta).toBeEnabled();

  // Clicking drives the note-detail's OWN reprocess (shared bridge): the detail
  // flips to its streaming view and the shared streaming state disables the
  // floating button too — proving the two CTAs are coordinated (no double-fire).
  await cta.click();
  await expect(cta).toBeDisabled();
});

test('hides the floating Generate notes button while a recording is live on THIS note', async ({
  launchApp,
}) => {
  // Resume/continue-recording into a transcript-only note: the transcript is
  // still growing, so the "Generate notes" CTA must disappear until the
  // recording stops (summarising a moving target would strand the CTA once it
  // finishes). Matched by session name — a recording on a DIFFERENT note leaves
  // this one's CTA alone. Regression guard for the resume-leaves-CTA bug.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_PENDING_NOTE: '1', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' },
  });
  await openMeeting(page, 'pending_summary.md');

  const cta = page.getByTestId('generate-notes-dock-button');
  await expect(cta).toBeVisible();

  // Start a recording whose session name matches this note (as resume does,
  // appending to pending_summary.md). The queue poll flips useRecording to
  // 'recording' and the CTA must clear.
  await page.evaluate(() =>
    window.stenoai.recording.start('New note', 'manual', 'pending_summary.md'),
  );
  await expect(cta).toHaveCount(0);

  // Stop → no longer recording this note → the CTA returns.
  await page.evaluate(() => window.stenoai.recording.stop());
  await expect(cta).toBeVisible();
});

test('hides the floating Generate notes button for a normal (summarised) note', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await openMeeting(page, 'epsilon_summary.json');

  // The meeting detail resolved (its transcript action is present)…
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toBeVisible();
  // …but the note has no notes_generated:false marker, so no floating CTA.
  await expect(page.getByTestId('generate-notes-dock-button')).toHaveCount(0);
});

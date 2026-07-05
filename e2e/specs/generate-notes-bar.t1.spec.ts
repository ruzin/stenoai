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
  await expect(page.getByTestId('generate-notes-dock-button')).toBeVisible();

  // Clicking it doesn't error (fires the shared reprocess mutation); the button
  // is a real, enabled control.
  await page.getByTestId('generate-notes-dock-button').click();
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

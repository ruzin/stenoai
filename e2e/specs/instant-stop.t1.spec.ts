import { test, expect } from '../fixtures/electron';

/**
 * T1 — instant stop, renderer behaviour (mock IPC). On stop, main returns the
 * note it wrote from the live transcript; the renderer lands the user ON it
 * (not the /meetings/processing dock), and the note shows a quiet "Finishing
 * up…" affordance while the pipeline upgrades it in the background — NOT the
 * Generate-notes CTA. Seeded via STENOAI_E2E_SEED_PROCESSING_NOTE (a
 * processing:true placeholder) in app/e2e-mock-ipc.js.
 */

const ENV = {
  STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
  STENOAI_E2E_SEED_PROCESSING_NOTE: '1',
};

test('a processing note shows the "finishing up" affordance, not Generate notes', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: ENV });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/processing_summary.md';
  });

  // The quiet inline processing affordance is shown…
  await expect(page.getByTestId('note-processing')).toBeVisible();
  // …and NOT the transcript-only "Generate notes" states (notes are coming).
  await expect(page.getByTestId('no-notes-yet')).toHaveCount(0);
  await expect(page.getByTestId('generate-notes-dock-button')).toHaveCount(0);
  await expect(page.getByTestId('tab-summary-content')).toHaveCount(0);
});

test('stopping navigates straight to the note (no /meetings/processing takeover)', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: ENV });

  // Background start → the pill docks; then Stop from the pill.
  await page.evaluate(() => window.stenoai.recording.start('Instant Note'));
  const pill = page.getByTestId('transcription-pill');
  await expect(pill).toBeVisible();
  await pill.getByRole('button', { name: 'Stop recording' }).click();

  // Instant stop: land on the note, never the processing dock.
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toContain('/meetings/processing_summary.md');
  const hash = await page.evaluate(() => window.location.hash);
  // Guard against a false match: the processing DOCK route is
  // '/meetings/processing' (no note file) — ensure we're on the note.
  expect(hash).not.toMatch(/\/meetings\/processing$/);
  await expect(page.getByTestId('note-processing')).toBeVisible();
});

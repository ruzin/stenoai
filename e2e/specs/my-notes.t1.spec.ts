import { test, expect } from '../fixtures/electron';

/**
 * T1 — the My notes tab (renderer-only, mock IPC). The note detail has a
 * Summary / My notes switcher; My notes is always available even when a
 * summary exists, holds an always-editable notes layer, and autosaves via
 * update-meeting (the mock overlays user_notes so a reload reflects the edit).
 */

test('My notes tab: switch, edit, autosave, and persistence across reload', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/epsilon_summary.json';
  });

  // Detail resolves on the Summary view by default (summary content visible).
  await expect(page.getByTestId('note-view-toggle')).toBeVisible();
  await expect(page.getByTestId('tab-summary')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-summary-content')).toBeVisible();
  await expect(page.getByTestId('my-notes')).toHaveCount(0);

  // Switch to My notes → the editor is available even though a summary exists.
  await page.getByTestId('tab-notes').click();
  const input = page.getByTestId('my-notes-input');
  await expect(input).toBeVisible();
  await expect(page.getByTestId('tab-summary-content')).toHaveCount(0);

  // Type notes → autosave persists (debounced; blur flushes immediately).
  await input.fill('Follow up with Dana about the migration.');
  await input.blur();

  // Reload the detail (navigate away and back): the note comes back from
  // get-meeting with the saved user_notes, and the My notes tab shows a dot.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.evaluate(() => {
    window.location.hash = '#/meetings/epsilon_summary.json';
  });
  await page.getByTestId('tab-notes').click();
  await expect(page.getByTestId('my-notes-input')).toHaveValue(
    'Follow up with Dana about the migration.',
  );
});

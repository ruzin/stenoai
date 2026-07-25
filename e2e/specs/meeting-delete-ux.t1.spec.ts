import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC, no backend. Pins the DELETE INTERACTION itself
 * (#234): a note deletes on ONE click, with no confirm step, and the Undo toast
 * is what makes that safe.
 *
 * Why a UI spec when meeting-undo-delete.t2 already covers the backend
 * contract: that spec drives the preload bridge, so it would stay green even if
 * the button stopped deleting — or if a confirm dialog came back. The risk here
 * is the interaction (a destructive action fires without asking), so it has to
 * be asserted through the real UI. The rule of the flow is one-or-the-other:
 * either you confirm first OR you get an undo, never both (maintainer feedback
 * on #391 — confirm + undo "feels like overkill").
 *
 * Seams (mirrors of the real ones, see app/e2e-mock-ipc.js):
 *  - STENOAI_E2E_SEED_MEETING=1 makes list-meetings/get-meeting return one known
 *    note, so #/meetings/<summary_file> resolves.
 *  - delete-meeting answers with the real {id, deadline} shape, so the Undo
 *    toast appears exactly as it does against main's pendingDelete map.
 */

const SUMMARY_FILE = 'epsilon_summary.json';
const MEETING_NAME = 'Epsilon Planning';

async function openDetail(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByTestId('meeting-detail-title')).toContainText(MEETING_NAME);
}

async function clickDeleteNote(page: Page) {
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Delete note' }).click();
}

test('deleting a note takes one click — no confirm step, Undo is the safety net', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);

  await clickDeleteNote(page);

  // The Undo toast is the proof the delete actually fired on that single click.
  const toast = page.getByRole('status').filter({ hasText: 'Note deleted' });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(MEETING_NAME);

  // No confirm dialog stood between the click and the delete. Asserted by name
  // (the old copy) AND by role, so re-introducing *any* modal here fails.
  await expect(page.getByText('Delete this note?')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Deleting from the detail route navigates home — the note it showed is gone.
  await expect(page).toHaveURL(/#\/$/);
});

test('Undo restores the note and clears the toast', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);

  await clickDeleteNote(page);

  const toast = page.getByRole('status').filter({ hasText: 'Note deleted' });
  await expect(toast).toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).click();

  // Toast clears on a successful undo, and the restored row is back on Home —
  // the note survived a delete that was never confirmed.
  await expect(toast).toHaveCount(0);
  await expect(page.getByText(MEETING_NAME).first()).toBeVisible();
});

test('deleting from the sidebar context menu also skips the confirm step', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });

  // Under mock IPC the app lands on the setup wizard (no model installed), which
  // has no notes list. Go to Home; the one-shot setup gate already fired on
  // launch, so it won't redirect us back.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });

  // Home lists the seeded note; right-click opens the row's context menu.
  const row = page.getByText(MEETING_NAME).first();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });

  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Note deleted' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

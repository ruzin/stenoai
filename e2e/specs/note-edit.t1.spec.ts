import { test, expect } from '../fixtures/electron';
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * T1 - renderer-only, mock IPC, no backend. Covers the note editor's
 * INTERACTION contract (D9), not persistence - the T2 specs
 * (note-editing.t2, note-edit-guard.t2, note-regenerate-guard.t2) already
 * drive the real preload bridge against the real main-process handler and
 * assert the file on disk. What only a T1 can cheaply pin is that the
 * renderer wires the real app shell correctly: the note is read-only until
 * asked otherwise, Cancel never calls the bridge, Save calls it exactly once
 * with only the fields that changed (not a full-document overwrite), and the
 * regenerate guard reacts to `meeting.edited_fields` however it reaches the
 * renderer - a real edit here, not a hand-authored prop, per note-regenerate-
 * guard.t2's own reasoning for testing the whole chain.
 *
 * Seams (mirrors of the real ones, see app/e2e-mock-ipc.js):
 *  - STENOAI_E2E_SEED_MEETING=1 seeds one known meeting with a non-empty
 *    summary (a "Standard" note, editable) and empty key_points/action_items.
 *  - the mock's update-meeting overlays summary/key_points/action_items/
 *    discussion_areas and accumulates edited_fields exactly like
 *    app/note-snapshot.js's markEdited, so the regenerate guard sees the same
 *    shape it would from the real sidecar.
 *  - every update-meeting call is recorded verbatim by the mock itself onto
 *    `global.__stenoaiE2eUpdateMeetingCalls` in the MAIN process, and read back
 *    via ElectronApplication.evaluate. Monkey-patching window.stenoai in the
 *    page was tried first and silently did nothing: contextBridge's exposed
 *    API is read-only from the renderer's world, so a page-side reassignment
 *    of `window.stenoai.meetings.update` is a no-op and the real (wrapped)
 *    function keeps running unobserved - recording inside the mock avoids that
 *    trap entirely.
 */

const SUMMARY_FILE = 'epsilon_summary.json';
const ORIGINAL_SUMMARY = 'The team agreed to ship on Friday; Bob owns the release notes.';
const NEW_SUMMARY = 'The team agreed to ship on Friday, with Bob owning the release notes and QA.';

type UpdateMeetingCall = { summaryFile: string; patch: Record<string, unknown> };

const updateCalls = (app: ElectronApplication): Promise<UpdateMeetingCall[]> =>
  app.evaluate(
    () =>
      (global as unknown as { __stenoaiE2eUpdateMeetingCalls: UpdateMeetingCall[] })
        .__stenoaiE2eUpdateMeetingCalls,
  );

async function openNote(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByRole('button', { name: 'Edit note' })).toBeVisible();
}

test('the note renders read-only until Edit is clicked', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await openNote(page);

  await expect(page.getByTestId('tab-summary-content')).toContainText(ORIGINAL_SUMMARY);
  await expect(page.getByTestId('note-editor')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(page.getByTestId('tab-summary-content')).toHaveCount(0);

  // Nothing typed yet: Save has nothing to send.
  await expect(page.getByRole('button', { name: /^save$/i })).toBeDisabled();
});

test('Cancel discards the typed draft and never calls the bridge', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await openNote(page);

  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Typed but abandoned.');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByTestId('note-editor')).toHaveCount(0);
  await expect(page.getByTestId('tab-summary-content')).toContainText(ORIGINAL_SUMMARY);
  await expect(page.getByTestId('tab-summary-content')).not.toContainText('Typed but abandoned');
  expect(await updateCalls(app)).toHaveLength(0);

  // Re-opening the editor proves nothing was silently persisted: the draft
  // starts fresh from the (unchanged) note, not from the abandoned typing.
  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue(
    ORIGINAL_SUMMARY,
  );
});

test('Save calls the bridge exactly once with only the changed field', async ({ launchApp }) => {
  const { app, page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await openNote(page);

  await page.getByRole('button', { name: 'Edit note' }).click();
  // key_points and action_items are left untouched: SEED_MEETING seeds both
  // empty, so a correct diff sends neither key at all.
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill(NEW_SUMMARY);
  await page.getByRole('button', { name: /^save$/i }).click();

  await expect(page.getByTestId('note-editor')).toHaveCount(0);
  await expect(page.getByTestId('tab-summary-content')).toContainText(NEW_SUMMARY);

  const calls = await updateCalls(app);
  expect(calls).toHaveLength(1);
  expect(calls[0].summaryFile).toBe(SUMMARY_FILE);
  expect(Object.keys(calls[0].patch)).toEqual(['summary']);
  expect(calls[0].patch).toEqual({ summary: NEW_SUMMARY });
});

test('the regenerate confirm appears once the note carries a real edit', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1' },
  });
  await openNote(page);

  // No edit yet: Generate notes rebuilds immediately, no confirm in the way.
  // (Nothing to assert here beyond the dialog's absence below - the point of
  // this spec is what happens once there IS something to lose.)
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill(NEW_SUMMARY);
  await page.getByRole('button', { name: /^save$/i }).click();
  await expect(page.getByTestId('note-editor')).toHaveCount(0);

  // The note now reports an edited field the same way the real sidecar would
  // (see note-regenerate-guard.t2) - clicking Generate notes must gate on it.
  await page.getByRole('button', { name: 'Generate notes' }).click();
  const dialog = page.locator('[data-confirm-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Regenerate notes and replace your edits?');
  await expect(dialog).toContainText('Summary');

  // Backing out keeps the edit - the dialog exists precisely so a click here
  // cannot silently discard it.
  await page.getByRole('button', { name: 'Keep my edits' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('tab-summary-content')).toContainText(NEW_SUMMARY);
});

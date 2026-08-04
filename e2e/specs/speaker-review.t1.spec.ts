import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC, no backend. Drives the real SpeakerReviewPanel
 * (MeetingDetail.tsx) against a seeded diarised meeting + seeded suggestions
 * (STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS=1, see app/e2e-mock-ipc.js). This
 * panel has real interaction risk -- four distinct actions, a popover, a
 * dialog -- so it earns T1 coverage per CLAUDE.md's carve-out, on top of the
 * model-free T2 spec (speaker-naming.t2) that proves the real backend/IPC
 * wire-shape truth.
 */

const SUMMARY_FILE = 'speaker-review-mtg_summary.json';

async function openDetail(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByTestId('speaker-review-panel')).toBeVisible();
}

test('Approve confirms the suggested person for a "confirmed"-tier row', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(row).toContainText('Likely Julian');
  // Identification anchor (channel + first-heard timestamp + duration) --
  // without this, an "Unidentified speaker" row gives a human nothing to
  // go on to figure out who a cluster actually is.
  await expect(row).toContainText('your mic');
  await expect(row).toContainText('first at 02:10');
  await row.getByRole('button', { name: 'Approve' }).click();

  // The row's own label becomes the acknowledgment -- confirmed_by_user
  // (real persisted evidence) always wins over the distance-based
  // "Likely X" text, so there's no separate, potentially-contradictory
  // feedback line to keep in sync with it.
  await expect(row).toContainText('✓ Confirmed as Julian');
  await expect(row).not.toContainText('Likely Julian');
  // Re-approving an already-confirmed cluster is a no-op that would change
  // nothing visible -- the button is hidden rather than inviting a
  // pointless click.
  await expect(row.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('Change picks a different existing person for a "possible"-tier row', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_1');
  await expect(row).toContainText('Might be Christian Weyer');
  await row.getByRole('button', { name: 'Change' }).click();

  // The popover portals outside the row's DOM subtree, so target it at the
  // page level -- there's only one "Julian" entry visible while the popover
  // is open.
  await page.getByRole('button', { name: 'Julian', exact: true }).click();

  await expect(row).toContainText('✓ Confirmed as Julian');
});

test('New person creates and confirms a brand-new profile', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await expect(row).toContainText('Unidentified speaker');
  await row.getByRole('button', { name: 'New person' }).click();

  await page.getByTestId('speaker-new-person-input').fill('Max');
  await page.getByTestId('speaker-new-person-submit').click();

  await expect(row).toContainText('✓ Confirmed as Max');
});

test('New person blocks creating a duplicate of an existing person', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await row.getByRole('button', { name: 'New person' }).click();

  // "Julian" already exists (seeded). Typing it verbatim -- or any
  // case/whitespace variant -- must surface the collision and block
  // Create, rather than silently splitting Julian's evidence across two
  // person_ids.
  await page.getByTestId('speaker-new-person-input').fill('  julian ');
  await expect(page.getByTestId('speaker-new-person-duplicate')).toBeVisible();
  await expect(page.getByTestId('speaker-new-person-submit')).toBeDisabled();

  // A genuinely new name clears the warning and re-enables Create.
  await page.getByTestId('speaker-new-person-input').fill('Someone New');
  await expect(page.getByTestId('speaker-new-person-duplicate')).toHaveCount(0);
  await expect(page.getByTestId('speaker-new-person-submit')).toBeEnabled();
});

test('a person profile can be deleted from the Change popover, unwinding any row confirmed as them', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toContainText('✓ Confirmed as Julian');

  await row.getByRole('button', { name: 'Change' }).click();
  await page.getByTestId('speaker-delete-person-p-julian').click();

  const confirmDialog = page.locator('[data-confirm-dialog]');
  await expect(confirmDialog).toContainText('Delete Julian?');
  await confirmDialog.getByRole('button', { name: 'Delete' }).click();
  await expect(confirmDialog).toHaveCount(0);

  // The deleted person's evidence is gone -- the cluster that was
  // confirmed as them reverts to unidentified, not left pointing at a
  // person that no longer exists.
  await expect(row).toContainText('Unidentified speaker');
  await expect(row).not.toContainText('Julian');

  // And they're gone from the Change list too.
  await row.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('button', { name: 'Julian', exact: true })).toHaveCount(0);
});

test('Keep generic dismisses the row locally, no confirm call needed', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_2');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Keep generic label' }).click();
  await expect(row).toHaveCount(0);
});

test('a cluster with no suggestion and no candidates never renders', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_3')).toHaveCount(0);
});

test('sample_text quotes what the cluster actually said', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(row).toContainText('I think we should ship this on Friday');
});

test('play button fetches and plays a real audio clip, toggling to stop', async ({ launchApp }) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const playButton = page.getByTestId('speaker-play-mic:SPEAKER_0');
  await expect(playButton).toBeVisible();
  await expect(playButton).toHaveAttribute('aria-label', 'Play sample');

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Stop sample');

  await playButton.click();
  await expect(playButton).toHaveAttribute('aria-label', 'Play sample');
});

test('confirmation persists after navigating away and back, unlike the transient feedback line', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  const row = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toContainText('✓ Confirmed as Julian');

  // Navigate away (unmounts SpeakerReviewPanel, destroying all of its local
  // state -- there is no more "feedback" Map to fall back on) and back --
  // a fresh suggest-speakers fetch is the only source of truth left. The
  // label is derived from confirmed_by_user (real persisted evidence), so
  // it must read exactly the same as it did before navigating away, and
  // Approve must still be hidden.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await openDetail(page);

  const rowAfter = page.getByTestId('speaker-row-mic:SPEAKER_0');
  await expect(rowAfter).toContainText('✓ Confirmed as Julian');
  await expect(rowAfter.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('confirming one row disables every OTHER row\'s actions too, not just the one in flight', async ({
  launchApp,
}) => {
  // Real production incident this guards against: SpeakerReviewPanel shares
  // ONE confirm-speaker mutation across the whole panel. An earlier version
  // only disabled the specific row matching the in-flight mutation's
  // variables, leaving every OTHER row's Approve/Change/New person/Keep
  // generic buttons clickable while a confirm was still resolving --
  // letting two confirm-speaker calls (each reading-then-atomically-
  // rewriting the SAME saved transcript) run concurrently.
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1',
      STENOAI_E2E_CONFIRM_SPEAKER_DELAY_MS: '400',
    },
  });
  await openDetail(page);

  const rowA = page.getByTestId('speaker-row-mic:SPEAKER_0');
  const rowB = page.getByTestId('speaker-row-mic:SPEAKER_1');
  await expect(rowB.getByRole('button', { name: 'Change' })).toBeEnabled();

  await rowA.getByRole('button', { name: 'Approve' }).click();

  // rowA's own confirm is now in flight (mock delayed 400ms) -- rowB's
  // actions must ALSO be disabled during this window, not just rowA's.
  await expect(rowB.getByRole('button', { name: 'Change' })).toBeDisabled();
  await expect(rowB.getByRole('button', { name: 'New person' })).toBeDisabled();
  await expect(rowB.getByRole('button', { name: 'Keep generic label' })).toBeDisabled();

  // And once rowA's confirm resolves, rowB's actions become available again.
  await expect(rowA).toContainText('✓ Confirmed as Julian');
  await expect(rowB.getByRole('button', { name: 'Change' })).toBeEnabled();
});

test('a likely-artifact row is hidden by default, reachable via the filtered-rows toggle', async ({
  launchApp,
}) => {
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS: '1' },
  });
  await openDetail(page);

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toHaveCount(0);

  const toggle = page.getByTestId('speaker-toggle-filtered');
  await expect(toggle).toHaveText('Show 1 filtered row');
  await toggle.click();

  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toBeVisible();
  await expect(toggle).toHaveText('Hide filtered rows');

  await toggle.click();
  await expect(page.getByTestId('speaker-row-mic:SPEAKER_4')).toHaveCount(0);
});

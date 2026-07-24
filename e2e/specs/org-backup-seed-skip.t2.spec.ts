import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import path from 'path';

/**
 * T2 — steady-state auto-backup does NOT re-fetch /policy or re-seed.
 *
 * Issue #192: `org-try-auto-backup` used to `await seedOrgAutoBackupDefault()`
 * on EVERY completed-recording backup — a GET /policy round-trip + a
 * `seed-org-auto-backup` subprocess — even after the preference was already
 * stored, where the seed is a no-op write. The fix reads the preference first
 * (get-org-auto-backup now reports `org_auto_backup_preference_set`) and only
 * pays the /policy fetch + seed in the genuinely-unset sign-in window.
 *
 * This drives the real gate against the mock adapter and asserts that once a
 * preference exists (sign-in already seeds it), a backup performs zero extra
 * /policy fetches — guarding the fix against regression. Model-free.
 */

type Result = { success: boolean; error?: string };
type Meeting = { id: string; title?: string };
type AutoBackupResult =
  | { attempted: true; meeting: Meeting; s3_key: string }
  | { attempted: false; reason: string; error?: string };
type StenoWindow = Window & {
  stenoai: {
    org: {
      login: (
        url: string,
        email: string,
        password: string,
      ) => Promise<Result & { signedIn?: boolean }>;
      status: () => Promise<{ signedIn: boolean }>;
      getAutoBackup: () => Promise<
        Result & { org_auto_backup_enabled?: boolean; org_auto_backup_preference_set?: boolean }
      >;
      tryAutoBackup: (payload: unknown) => Promise<AutoBackupResult>;
    };
  };
};

test('steady-state auto-backup skips the /policy fetch + seed once a preference exists', async ({
  launchApp,
  userDataDir,
}) => {
  const adapter = await startMockAdapter();
  try {
    const { app, page } = await launchApp();

    // .org-session needs safeStorage; skip LOUDLY on a headless runner with no
    // usable keyring (mirrors org-backup-failure.t2 — the org path can't
    // persist there).
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    if (!encryptionAvailable) {
      // eslint-disable-next-line no-console
      console.warn('[t2] SKIPPED org-backup-seed-skip: safeStorage unavailable on this runner.');
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'safeStorage unavailable; org session cannot persist',
      });
    }
    test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

    const login = await page.evaluate(
      (url) => (window as StenoWindow).stenoai.org.login(url, 'e2e@example.com', 'hunter2'),
      adapter.url,
    );
    expect(login.success).toBe(true);
    await expect
      .poll(async () =>
        (await page.evaluate(() => (window as StenoWindow).stenoai.org.status())).signedIn,
      )
      .toBe(true);

    // Sign-in seeds the auto-backup default fire-and-forget. Wait until the
    // preference has actually materialised so the backup below is a genuine
    // steady-state read, not the one-time unset window.
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (window as StenoWindow).stenoai.org.getAutoBackup()))
            .org_auto_backup_preference_set,
        // The sign-in seed is fire-and-forget (a /policy fetch + a seed
        // subprocess); on a loaded CI runner it can exceed the default poll
        // window, so give it a generous timeout rather than flaking.
        { timeout: 30_000 },
      )
      .toBe(true);

    // Baseline the /policy count AFTER the sign-in seed has settled.
    const policyFetchesBefore = adapter.policyFetches();

    const summaryFile = path.join(userDataDir, 'output', 'steady-note_summary.json');
    const result = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.tryAutoBackup({
          summaryFile: sf,
          title: 'Steady Note',
          body: '# Steady Note\n\nbody',
          visibility: 'org',
        }),
      summaryFile,
    );

    // The backup itself still works (default policy = auto_share_default true).
    expect(result.attempted).toBe(true);
    expect(adapter.s3Puts()).toBe(1);

    // ...and it did NOT re-fetch /policy: the preference already existed, so
    // the seed was skipped entirely. This is the whole point of issue #192.
    expect(adapter.policyFetches()).toBe(policyFetchesBefore);
  } finally {
    await adapter.close();
  }
});

test('org auto_share_default=false is honored: gate stays fail-closed and nothing uploads', async ({
  launchApp,
  userDataDir,
}) => {
  // The privacy-critical direction: an org whose policy disables auto-share
  // must never have a note auto-backed-up. Sign-in seeds the (false) default
  // into the local preference; the gate must then read disabled and upload
  // nothing — this is the invariant the #192 read-first-then-seed refactor
  // must preserve.
  const adapter = await startMockAdapter({
    policy: { auto_share_default: false, shared_notes_enabled: true },
  });
  try {
    const { app, page } = await launchApp();

    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    if (!encryptionAvailable) {
      // eslint-disable-next-line no-console
      console.warn('[t2] SKIPPED org-backup-seed-skip (policy-false): safeStorage unavailable.');
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'safeStorage unavailable; org session cannot persist',
      });
    }
    test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

    const login = await page.evaluate(
      (url) => (window as StenoWindow).stenoai.org.login(url, 'e2e@example.com', 'hunter2'),
      adapter.url,
    );
    expect(login.success).toBe(true);
    await expect
      .poll(async () =>
        (await page.evaluate(() => (window as StenoWindow).stenoai.org.status())).signedIn,
      )
      .toBe(true);

    // Sign-in seeds the org's false default; wait until it has materialised
    // (return null until preference_set flips true, so the poll doesn't match
    // the pre-seed unset state), then assert the seeded value is disabled.
    await expect
      .poll(
        async () => {
          const ab = await page.evaluate(() =>
            (window as StenoWindow).stenoai.org.getAutoBackup(),
          );
          return ab.org_auto_backup_preference_set === true ? ab.org_auto_backup_enabled : null;
        },
        // Fire-and-forget sign-in seed — generous timeout so a slow CI runner
        // doesn't flake this (see the first test).
        { timeout: 30_000 },
      )
      .toBe(false);

    // Baseline /policy fetches after the sign-in seed has settled, so we can
    // prove the DISABLED path also skips the fetch (not just the enabled path
    // in the first test) — a regression that re-fetched /policy but still read
    // the cached disabled value would pass the fail-closed assertions below yet
    // reintroduce the HTTP call #192 eliminates.
    const policyFetchesBefore = adapter.policyFetches();

    const summaryFile = path.join(userDataDir, 'output', 'policy-false-note_summary.json');
    const result = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.tryAutoBackup({
          summaryFile: sf,
          title: 'Policy False Note',
          body: '# Policy False Note\n\nbody',
          visibility: 'org',
        }),
      summaryFile,
    );

    expect(result.attempted).toBe(false);
    if (!result.attempted) expect(result.reason).toBe('disabled');
    expect(adapter.s3Puts()).toBe(0); // nothing was auto-shared against the policy
    // ...and the disabled path did NOT re-fetch /policy: the stored preference
    // was read first and the seed skipped entirely (the whole point of #192).
    expect(adapter.policyFetches()).toBe(policyFetchesBefore);
  } finally {
    await adapter.close();
  }
});

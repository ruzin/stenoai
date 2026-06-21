import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import path from 'path';

/**
 * T2 — org auto-backup FAILURE is persisted, surfaced, and retryable.
 *
 * The client-reported regression was that a failed S3 backup (e.g. behind a
 * corporate proxy) was silently console.warn'd and left no trace, so notes
 * never reached the org and nobody noticed. This drives the *auto-backup*
 * gateway (org.tryAutoBackup — the path the renderer fires on
 * processing-complete, which org-crud.t2 does NOT cover) against a mock
 * adapter forced to fail the S3 PUT, then asserts:
 *   - the failure is recorded (getBackupState.failed_at/error set, shared:false)
 *     WITHOUT marking the note "attempted" (so retry stays possible),
 *   - the bulk listBackupFailures includes it (drives the list "Not backed up"
 *     chip),
 *   - a subsequent successful share CLEARS the failure and flips shared:true.
 *
 * Model-free; deterministic (the mock PUTs back to itself). Mirrors
 * org-crud.t2's harness + the STENOAI_USER_DATA_DIR isolation keystone.
 */

type Result = { success: boolean; error?: string };
type Meeting = { id: string; title?: string };
type BackupState = Result & {
  shared: boolean;
  meeting_id: string | null;
  failed_at: string | null;
  error: string | null;
};
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
      tryAutoBackup: (payload: unknown) => Promise<AutoBackupResult>;
      shareMeeting: (payload: unknown) => Promise<Result & { meeting?: Meeting }>;
      getBackupState: (summaryFile: string) => Promise<BackupState>;
      listBackupFailures: () => Promise<Result & { failures: string[] }>;
    };
  };
};

test('org auto-backup failure is persisted, listed, and cleared on retry; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  // Start with the S3 PUT failing so the very first auto-backup fails.
  const adapter = await startMockAdapter({ failS3Put: true });
  try {
    const { app, page } = await launchApp();

    // .org-session needs safeStorage; skip LOUDLY on a headless runner with no
    // usable keyring (mirrors org-crud.t2 — the org path can't persist there).
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    if (!encryptionAvailable) {
      // eslint-disable-next-line no-console
      console.warn('[t2] SKIPPED org-backup-failure: safeStorage unavailable on this runner.');
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

    const summaryFile = path.join(userDataDir, 'output', 'flaky-note_summary.json');

    // 1) Auto-backup fires and fails on the S3 PUT.
    const failed = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.tryAutoBackup({
          summaryFile: sf,
          title: 'Flaky Note',
          body: '# Flaky Note\n\nbody',
          visibility: 'org',
        }),
      summaryFile,
    );
    expect(failed.attempted).toBe(false);
    if (!failed.attempted) expect(failed.reason).toBe('upload-failed');
    expect(adapter.s3Puts()).toBe(0); // nothing actually landed

    // 2) The failure is persisted: failed_at + error set, but NOT shared and
    //    NOT marked attempted (so a retry isn't suppressed).
    const stateAfterFail = await page.evaluate(
      (sf) => (window as StenoWindow).stenoai.org.getBackupState(sf),
      summaryFile,
    );
    expect(stateAfterFail.shared).toBe(false);
    expect(stateAfterFail.failed_at).toBeTruthy();
    expect(stateAfterFail.error).toBeTruthy();

    // 3) Bulk list (drives the list "Not backed up" chip) includes it.
    const failuresAfter = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.listBackupFailures(),
    );
    expect(failuresAfter.success).toBe(true);
    expect(failuresAfter.failures).toContain(summaryFile);

    // 4) Heal the adapter and retry via the manual share path.
    adapter.setFailS3Put(false);
    const retry = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.shareMeeting({
          title: 'Flaky Note',
          body: '# Flaky Note\n\nbody',
          summaryFile: sf,
        }),
      summaryFile,
    );
    expect(retry.success).toBe(true);
    expect(adapter.s3Puts()).toBeGreaterThan(0);

    // 5) Success clears the failure and flips shared:true.
    const stateAfterRetry = await page.evaluate(
      (sf) => (window as StenoWindow).stenoai.org.getBackupState(sf),
      summaryFile,
    );
    expect(stateAfterRetry.shared).toBe(true);
    expect(stateAfterRetry.failed_at).toBeNull();
    expect(stateAfterRetry.meeting_id).toBe(retry.meeting!.id);

    // 6) And it's gone from the bulk failures list.
    const failuresCleared = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.listBackupFailures(),
    );
    expect(failuresCleared.failures).not.toContain(summaryFile);

    // Keystone: everything landed in the temp dir; real user-data untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await adapter.close();
  }
});

import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import path from 'path';

/**
 * T2 — org meeting CRUD + share/unshare + AI chat, all against the stateful mock
 * adapter (no real backend, no AWS/S3). Signs in through the real org-login IPC,
 * then exercises the adapter-backed operations and the local backup-state file
 * that makes share/unshare stick. Builds on org-lock-lifecycle.t2 (sign-in) and
 * shared-notes-policy (policy). Deterministic — the adapter echoes/stores in
 * memory and the share upload PUTs back to the mock itself.
 */

type Result = { success: boolean; error?: string };
type Meeting = { id: string; title?: string };
type StenoWindow = Window & {
  stenoai: {
    org: {
      login: (url: string, email: string, password: string) => Promise<Result & { signedIn?: boolean }>;
      status: () => Promise<{ signedIn: boolean }>;
      createMeeting: (payload: unknown) => Promise<Result & { meeting?: Meeting }>;
      listMeetings: () => Promise<Result & { meetings: Meeting[] }>;
      getMeeting: (id: string) => Promise<Result & { meeting?: Meeting }>;
      deleteMeeting: (id: string) => Promise<Result & { id?: string }>;
      shareMeeting: (payload: unknown) => Promise<Result & { meeting?: Meeting }>;
      getBackupState: (
        summaryFile: string,
      ) => Promise<Result & { shared: boolean; meeting_id: string | null }>;
      unshareBySummary: (summaryFile: string) => Promise<Result & { adapter_status?: string }>;
      aiChat: (payload: unknown) => Promise<Result & { answer?: string }>;
    };
  };
};

test('org CRUD + share/unshare + ai-chat round-trip through the adapter; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const adapter = await startMockAdapter();
  try {
    const { app, page } = await launchApp();

    // .org-session is persisted via safeStorage; skip LOUDLY on a headless runner
    // with no usable keyring rather than emit a misleading red (mirrors
    // org-lock-lifecycle.t2).
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    if (!encryptionAvailable) {
      // eslint-disable-next-line no-console
      console.warn('[t2] SKIPPED org-crud: safeStorage unavailable on this runner.');
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'safeStorage unavailable; org session cannot persist',
      });
    }
    test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

    // Sign in through the real org-login IPC (HTTP round-trip to the mock).
    const login = await page.evaluate(
      (url) => (window as StenoWindow).stenoai.org.login(url, 'e2e@example.com', 'hunter2'),
      adapter.url,
    );
    expect(login.success).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.org.status())).signedIn).toBe(true);

    // Create -> list -> get.
    const created = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.createMeeting({ title: 'Alpha Sync' }),
    );
    expect(created.success).toBe(true);
    const id = created.meeting!.id;
    expect(id).toBeTruthy();

    const listed = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.listMeetings(),
    );
    expect(listed.success).toBe(true);
    expect(listed.meetings.map((m) => m.id)).toContain(id);

    const got = await page.evaluate(
      (mid) => (window as StenoWindow).stenoai.org.getMeeting(mid),
      id,
    );
    expect(got.success).toBe(true);
    expect(got.meeting?.title).toBe('Alpha Sync');

    // Delete -> gone from the list.
    const del = await page.evaluate(
      (mid) => (window as StenoWindow).stenoai.org.deleteMeeting(mid),
      id,
    );
    expect(del.success).toBe(true);
    const afterDelete = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.listMeetings(),
    );
    expect(afterDelete.meetings.map((m) => m.id)).not.toContain(id);

    // AI chat through the adapter (deterministic echo).
    const chat = await page.evaluate(() =>
      (window as StenoWindow).stenoai.org.aiChat({ question: 'ping' }),
    );
    expect(chat.success).toBe(true);
    expect(chat.answer).toBe('mock-org-answer: ping');

    // Share -> backup-state records it -> unshare clears it. summaryFile is just
    // the local key the backup-state file is indexed by.
    const summaryFile = path.join(userDataDir, 'output', 'shared-note_summary.json');
    const share = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.shareMeeting({
          title: 'Shared Note',
          body: '# Shared Note\n\nbody',
          summaryFile: sf,
        }),
      summaryFile,
    );
    expect(share.success).toBe(true);
    expect(adapter.s3Puts()).toBeGreaterThan(0); // the markdown PUT landed

    const stateAfterShare = await page.evaluate(
      (sf) => (window as StenoWindow).stenoai.org.getBackupState(sf),
      summaryFile,
    );
    expect(stateAfterShare.shared).toBe(true);
    expect(stateAfterShare.meeting_id).toBe(share.meeting!.id);

    const unshare = await page.evaluate(
      (sf) => (window as StenoWindow).stenoai.org.unshareBySummary(sf),
      summaryFile,
    );
    expect(unshare.success).toBe(true);

    const stateAfterUnshare = await page.evaluate(
      (sf) => (window as StenoWindow).stenoai.org.getBackupState(sf),
      summaryFile,
    );
    expect(stateAfterUnshare.shared).toBe(false);

    // Keystone: org session + backup-state landed in the temp dir; the real
    // user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await adapter.close();
  }
});

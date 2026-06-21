import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import { startMockProxy } from '../fixtures/mock-proxy';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import path from 'path';

/**
 * T2 — the desktop's org/S3 HTTP calls honour the system/session proxy.
 *
 * Regression guard for the corporate-proxy fix: the main process now uses
 * Electron net.fetch (Chromium's network stack) instead of Node's global
 * fetch (undici, which ignores the OS proxy + cert store). We point the
 * Electron default session at a recording forward-proxy, drive an org
 * sign-in + share through the real IPC, and assert the proxy actually SAW
 * the adapter traffic. If anyone reverts to undici fetch, undici bypasses
 * the session proxy → the proxy records nothing → this fails.
 *
 * The mock adapter is loopback HTTP, which Chromium would normally bypass,
 * so we set proxyBypassRules '<-loopback>' to force it through the proxy.
 */

type Result = { success: boolean; error?: string };
type Meeting = { id: string; title?: string };
type StenoWindow = Window & {
  stenoai: {
    org: {
      login: (url: string, email: string, password: string) => Promise<Result & { signedIn?: boolean }>;
      status: () => Promise<{ signedIn: boolean }>;
      shareMeeting: (payload: unknown) => Promise<Result & { meeting?: Meeting }>;
      listMeetings: () => Promise<Result & { meetings: Meeting[] }>;
    };
  };
};

test('org/S3 traffic routes through the system proxy (net.fetch, not undici); real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const adapter = await startMockAdapter();
  const proxy = await startMockProxy();
  try {
    const { app, page } = await launchApp();

    // .org-session needs safeStorage; skip LOUDLY on a headless runner without
    // a usable keyring (mirrors org-crud.t2 / org-backup-failure.t2).
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    if (!encryptionAvailable) {
      // eslint-disable-next-line no-console
      console.warn('[t2] SKIPPED proxy-routing: safeStorage unavailable on this runner.');
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'safeStorage unavailable; org session cannot persist',
      });
    }
    test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

    // Point the default session at the recording proxy. '<-loopback>' removes
    // Chromium's implicit loopback bypass so the loopback adapter goes through
    // it (net.fetch uses the default session).
    await app.evaluate(({ session }, proxyPort) =>
      session.defaultSession.setProxy({
        proxyRules: `http=127.0.0.1:${proxyPort}`,
        proxyBypassRules: '<-loopback>',
      }),
      proxy.port,
    );

    // Sign in (an adapter call) + share (presign + S3 PUT + register) — all
    // org/S3 net.fetch traffic that must now traverse the proxy.
    const login = await page.evaluate(
      (url) => (window as StenoWindow).stenoai.org.login(url, 'e2e@example.com', 'pw'),
      adapter.url,
    );
    expect(login.success).toBe(true);
    await expect
      .poll(async () =>
        (await page.evaluate(() => (window as StenoWindow).stenoai.org.status())).signedIn,
      )
      .toBe(true);

    const summaryFile = path.join(userDataDir, 'output', 'proxied-note_summary.json');
    const share = await page.evaluate(
      (sf) =>
        (window as StenoWindow).stenoai.org.shareMeeting({
          title: 'Proxied Note',
          body: '# Proxied Note\n\nbody',
          summaryFile: sf,
        }),
      summaryFile,
    );
    expect(share.success).toBe(true);
    // The markdown + transcript PUTs in the mock point back at the adapter, so
    // they also count as proxied traffic.
    expect(adapter.s3Puts()).toBeGreaterThan(0);

    // The proxy must have seen the adapter traffic — proof net.fetch honoured
    // the session proxy. (undici would have bypassed it entirely.)
    const proxied = proxy.requests();
    const adapterHost = adapter.url.replace(/^https?:\/\//, '');
    expect(proxied.some((u) => u.includes(adapterHost))).toBe(true);
    expect(proxied.some((u) => u.includes('/auth/login') || u.includes('/meetings') || u.includes('/uploads/presign'))).toBe(true);

    // Keystone: nothing leaked into the real user-data dir.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await proxy.close();
    await adapter.close();
  }
});

import { test, expect } from '../fixtures/electron';
import { startMockAdapter } from '../fixtures/mock-adapter';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

/**
 * T2 — real bundled backend (no mock IPC), real org-login through a mock
 * adapter. This is the keystone proof: a real sign-in persists `.org-session`
 * (via safeStorage, in getUserDataDir()) and triggers the Python config write,
 * and BOTH must land in the per-test temp dir — never the real user-data dir.
 * A test that fails to isolate but passes is worse than no test, so the real
 * dir is asserted byte-for-byte untouched.
 */

// Mirror app/main.js getUserDataDir() / src/config.get_user_data_dir() for the
// production (no-override) location, so we can assert it stays untouched.
function realUserDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'stenoai');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming');
    return path.join(base, 'stenoai');
  }
  const base = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(base, 'stenoai');
}

// Stat signature (exists + mtime + size) so we can prove a file was untouched.
function fileSig(p: string): string {
  if (!existsSync(p)) return 'absent';
  const s = statSync(p);
  return `${s.mtimeMs}:${s.size}`;
}

test('real org sign-in persists session + config into the temp dir, real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realOrgSession = path.join(realUserDataDir(), '.org-session');
  const realConfig = path.join(realUserDataDir(), 'config.json');
  const realOrgSessionBefore = fileSig(realOrgSession);
  const realConfigBefore = fileSig(realConfig);

  const adapter = await startMockAdapter();
  try {
    const { app, page } = await launchApp();

    // safeStorage is required to persist the session. On a headless runner with
    // no usable keyring it is unavailable — skip rather than emit a misleading
    // red (tracked as a CI-hardening follow-up).
    const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
      safeStorage.isEncryptionAvailable(),
    );
    test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

    await page.evaluate(() => {
      window.location.hash = '#/settings?tab=organisation';
    });

    await expect(page.getByTestId('org-sign-in-card')).toBeVisible();
    await page.getByPlaceholder('https://steno-adapter.yourcompany.com').fill(adapter.url);
    await page.getByPlaceholder('you@yourcompany.com').fill('e2e@example.com');
    await page.getByPlaceholder('••••••').fill('hunter2');
    await page.getByRole('button', { name: /sign in with password/i }).click();

    // Real login round-trips the mock adapter, writes the session, and kicks
    // the Python config write — allow generous time for the backend subprocess.
    await expect(page.getByTestId('org-signed-in-card')).toBeVisible({ timeout: 30_000 });

    // Keystone, Electron side: the encrypted session landed in the temp dir.
    const tempOrgSession = path.join(userDataDir, '.org-session');
    await expect
      .poll(() => existsSync(tempOrgSession), { timeout: 10_000 })
      .toBe(true);

    // Keystone, Python side: autoSwitchToAdapterOnSignIn() ran the backend,
    // which wrote config.json into the same temp dir.
    await expect
      .poll(() => existsSync(path.join(userDataDir, 'config.json')), { timeout: 15_000 })
      .toBe(true);

    // The real user-data dir's keystone files are byte-for-byte untouched.
    expect(fileSig(realOrgSession)).toBe(realOrgSessionBefore);
    expect(fileSig(realConfig)).toBe(realConfigBefore);
  } finally {
    await adapter.close();
  }
});

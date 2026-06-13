import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — config-corruption recovery. A corrupt config.json must NOT wipe data: the
 * backend backs the bad file up to config.json.corrupt, runs on in-memory
 * defaults, and writes a fresh valid config on the next save (the org-reset /
 * config-wipe regression that reached users). Model-free, so it runs in the
 * org-lock T2 job (--grep-invert @pipeline).
 *
 * Drives the real app: pre-write a corrupt config into the temp dir before
 * launch, then assert recovery + that the real user dir is untouched.
 */

type StenoWindow = Window & {
  stenoai: {
    ai: {
      getProvider: () => Promise<{ success?: boolean; ai_provider?: string }>;
      setProvider: (p: string) => Promise<{ success?: boolean }>;
    };
  };
};

test('corrupt config is backed up and recovered, not wiped; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // Corrupt the per-test config BEFORE launch (the fixture has already created
  // userDataDir). A torn/invalid JSON body is the realistic corruption.
  const configPath = path.join(userDataDir, 'config.json');
  writeFileSync(configPath, '{ "ai_provider": "local"  <<< torn write');

  // App must start despite the corrupt config (the launch fixture waits on
  // [data-app-ready]).
  const { page } = await launchApp();

  // A config read backs the bad file up and serves in-memory defaults — the app
  // stays functional rather than erroring.
  const provider = await page.evaluate(() => (window as StenoWindow).stenoai.ai.getProvider());
  expect(provider?.success).toBe(true);
  expect(provider?.ai_provider).toBeTruthy();

  // The corrupt file was preserved for debugging (anti-wipe guarantee), not
  // silently discarded.
  await expect
    .poll(() => existsSync(path.join(userDataDir, 'config.json.corrupt')), { timeout: 10_000 })
    .toBe(true);

  // A save (provider write) recovers to a fresh, valid config.json — proving the
  // recover→persist cycle doesn't leave the file corrupt.
  await page.evaluate(() => (window as StenoWindow).stenoai.ai.setProvider('local'));
  await expect
    .poll(
      () => {
        try {
          const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
          return cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg);
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

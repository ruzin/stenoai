import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig } from '../fixtures/user-config';
import { writeFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — calendar auth status + auto-detect-meetings toggle. The status reads are
 * deterministic (a local encrypted token file, NOT a real Google/Outlook API
 * call — that needs live OAuth and is out of scope). Asserts: clean profile is
 * disconnected; a seeded token reads as connected and disconnect clears it; the
 * auto-detect toggle round-trips through config. Also guards the token-path
 * isolation fix (tokens must land in the temp dir, never the real one).
 */

type StatusResult = { success: boolean; connected: boolean; email?: string | null };
type AutoDetect = { success: boolean; auto_detect_meetings_enabled?: boolean };

type StenoWindow = Window & {
  stenoai: {
    calendar: {
      google: { status: () => Promise<StatusResult>; disconnect: () => Promise<{ success: boolean }> };
      outlook: { status: () => Promise<StatusResult> };
    };
    settings: {
      getAutoDetectMeetings: () => Promise<AutoDetect>;
      setAutoDetectMeetings: (v: boolean) => Promise<AutoDetect>;
    };
  };
};

test('clean profile is disconnected; auto-detect-meetings toggle round-trips; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // No tokens seeded -> both providers report disconnected (no network).
  expect(await page.evaluate(() => (window as StenoWindow).stenoai.calendar.google.status())).toEqual({
    success: true,
    connected: false,
    email: null,
  });
  expect(await page.evaluate(() => (window as StenoWindow).stenoai.calendar.outlook.status())).toEqual({
    success: true,
    connected: false,
    email: null,
  });

  // Auto-detect toggle: default on -> set off -> persisted + reflected.
  const before = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.getAutoDetectMeetings(),
  );
  expect(before.auto_detect_meetings_enabled).toBe(true);

  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setAutoDetectMeetings(false));
  await expect
    .poll(() => readUserConfig(userDataDir).auto_detect_meetings_enabled)
    .toBe(false);
  expect(
    (await page.evaluate(() => (window as StenoWindow).stenoai.settings.getAutoDetectMeetings()))
      .auto_detect_meetings_enabled,
  ).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('a seeded Google token reads as connected (in the temp dir) and disconnect clears it', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { app, page } = await launchApp();

  // Seeding needs safeStorage (the token file is encrypted with the same key the
  // app reads with). Skip LOUDLY where it's unavailable rather than emit a red.
  const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable(),
  );
  if (!encryptionAvailable) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED calendar token seed: safeStorage unavailable on this runner.');
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'safeStorage unavailable; cannot seed/encrypt a calendar token',
    });
  }
  test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

  // Encrypt a token with the app's own safeStorage, then write it to the temp
  // dir's .google-tokens. No access_token, so disconnect skips the network
  // revoke and just deletes the file. If the token-path isolation fix regressed,
  // loadGoogleTokens would read the real dir and this would stay disconnected.
  const encBytes = await app.evaluate(({ safeStorage }) =>
    Array.from(safeStorage.encryptString(JSON.stringify({ refresh_token: 'fake-refresh' }))),
  );
  const tokenPath = path.join(userDataDir, '.google-tokens');
  writeFileSync(tokenPath, Buffer.from(encBytes));

  const statusAfterSeed = await page.evaluate(() =>
    (window as StenoWindow).stenoai.calendar.google.status(),
  );
  expect(statusAfterSeed.connected).toBe(true);
  // No `email` in the seeded token (pre-existing connections predating the
  // email-capture change) -> status falls back to null, not a crash.
  expect(statusAfterSeed.email).toBeNull();

  // Disconnect removes the token and reports disconnected again.
  const disc = await page.evaluate(() =>
    (window as StenoWindow).stenoai.calendar.google.disconnect(),
  );
  expect(disc.success).toBe(true);
  await expect.poll(() => existsSync(tokenPath)).toBe(false);
  expect(
    (await page.evaluate(() => (window as StenoWindow).stenoai.calendar.google.status())).connected,
  ).toBe(false);

  // Keystone: the seeded token + disconnect stayed entirely in the temp dir.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('a seeded Google token carrying an email surfaces it via status', async ({
  launchApp,
  userDataDir,
}) => {
  const { app, page } = await launchApp();

  // Seeding needs safeStorage. Skip LOUDLY where it's unavailable rather
  // than emit a silent green — see the sibling test above.
  const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable(),
  );
  if (!encryptionAvailable) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED calendar token seed: safeStorage unavailable on this runner.');
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'safeStorage unavailable; cannot seed/encrypt a calendar token',
    });
  }
  test.skip(!encryptionAvailable, 'safeStorage unavailable on this runner');

  // Mirrors what the app itself writes after decoding the OAuth id_token at
  // connect time (see decodeJwtPayload in main.js) — status reads it back
  // from the local token file with no network call.
  const encBytes = await app.evaluate(({ safeStorage }) =>
    Array.from(
      safeStorage.encryptString(
        JSON.stringify({ refresh_token: 'fake-refresh', email: 'person@example.com' }),
      ),
    ),
  );
  const tokenPath = path.join(userDataDir, '.google-tokens');
  writeFileSync(tokenPath, Buffer.from(encBytes));

  const status = await page.evaluate(() => (window as StenoWindow).stenoai.calendar.google.status());
  expect(status.connected).toBe(true);
  expect(status.email).toBe('person@example.com');
});

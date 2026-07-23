import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig, writeUserConfig } from '../fixtures/user-config';

/**
 * T2 — global record shortcut: the `record_hotkey_enabled` toggle gates the
 * ACTUAL system-wide globalShortcut registration, and the set-record-hotkey
 * IPC live-applies (register/unregister) without a relaunch + persists to
 * config.json. Model-free (no ASR/network), so it runs in the org-lock T2 job.
 *
 * We register a deliberately low-collision accelerator via
 * STENOAI_E2E_RECORD_ACCEL (main.js reads it into RECORD_HOTKEY_ACCEL) so the
 * isRegistered() assertions can't flake on an accelerator the real host
 * already occupies. globalShortcut.isRegistered() is inspected directly in the
 * Electron main process via app.evaluate — the true source of truth for
 * whether the OS-level shortcut is live.
 */

// Low-collision accelerator: Cmd/Ctrl+Alt+Shift+F9 is extremely unlikely to be
// claimed by another app on a CI runner or a dev machine.
const ACCEL = 'CommandOrControl+Alt+Shift+F9';

type StenoWindow = Window & {
  stenoai: {
    settings: {
      getRecordHotkey: () => Promise<{ success: boolean; enabled: boolean; registered: boolean }>;
      setRecordHotkey: (
        v: boolean,
      ) => Promise<{ success: boolean; enabled?: boolean; registered?: boolean }>;
    };
  };
};

const isRegistered = (app: import('@playwright/test').ElectronApplication) =>
  app.evaluate(({ globalShortcut }, accel) => globalShortcut.isRegistered(accel), ACCEL);

test('record_hotkey_enabled gates the real global-shortcut registration; toggle live-applies + persists; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // (a) Pre-seed the toggle OFF before launch — the startup gate must skip
  // registration, so the accelerator is NOT registered.
  writeUserConfig(userDataDir, { record_hotkey_enabled: false });
  const { app, page } = await launchApp({ env: { STENOAI_E2E_RECORD_ACCEL: ACCEL } });

  expect(await isRegistered(app)).toBe(false);
  const seeded = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.getRecordHotkey(),
  );
  expect(seeded.enabled).toBe(false);
  expect(seeded.registered).toBe(false);

  // (b) Toggle ON -> live-registers (no relaunch) + persists true.
  const on = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.setRecordHotkey(true),
  );
  expect(on.success).toBe(true);
  expect(on.registered).toBe(true);
  expect(await isRegistered(app)).toBe(true);
  await expect.poll(() => readUserConfig(userDataDir).record_hotkey_enabled).toBe(true);

  // (c) Toggle OFF -> live-unregisters (never unregisterAll) + persists false.
  const off = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.setRecordHotkey(false),
  );
  expect(off.success).toBe(true);
  expect(off.registered).toBe(false);
  expect(await isRegistered(app)).toBe(false);
  await expect.poll(() => readUserConfig(userDataDir).record_hotkey_enabled).toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

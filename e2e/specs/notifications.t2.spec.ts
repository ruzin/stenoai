import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig } from '../fixtures/user-config';

/**
 * T2 — notifications: get/set toggle persistence + that the toggle GATES the
 * note-ready / silence-auto-stop / system-audio-mic-only notifications. The
 * handlers now return a `shown` flag (the observable design-for-test signal —
 * a native banner isn't inspectable) reflecting whether the
 * notifications_enabled gate let it through. Deterministic + model-free.
 */

type Toggle = { success: boolean; notifications_enabled?: boolean };
type ShowResult = { success: boolean; shown?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    settings: {
      getNotifications: () => Promise<Toggle>;
      setNotifications: (v: boolean) => Promise<Toggle>;
      showSilenceAutoStopNotification: (payload: unknown) => Promise<ShowResult>;
      showNoteReadyNotification: (payload: unknown) => Promise<ShowResult>;
      showSystemAudioMicOnlyNotification: () => Promise<ShowResult>;
    };
  };
};

const showSilence = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.showSilenceAutoStopNotification({
      minutes: 5,
      sessionName: 'E2E',
    }),
  );
const showNote = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.showNoteReadyNotification({
      title: 'E2E note',
      summaryFile: 'e2e-note.json',
    }),
  );
const showMicOnly = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.settings.showSystemAudioMicOnlyNotification());

test('notifications toggle persists and gates the note-ready / silence / mic-only notifications; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Disable -> persisted + all three notifications are gated off (shown:false, no banner).
  const off = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.setNotifications(false),
  );
  expect(off.success).toBe(true);
  await expect.poll(() => readUserConfig(userDataDir).notifications_enabled).toBe(false);
  expect((await page.evaluate(() => (window as StenoWindow).stenoai.settings.getNotifications())).notifications_enabled).toBe(false);

  expect((await showSilence(page)).shown).toBe(false);
  expect((await showNote(page)).shown).toBe(false);
  expect((await showMicOnly(page)).shown).toBe(false);

  // Enable -> persisted + the gate now lets both through (shown is not false;
  // it's true when the native show() succeeds, and on a headless runner where
  // show() can't render we still know the gate passed — the point is it's no
  // longer gated off).
  const on = await page.evaluate(() =>
    (window as StenoWindow).stenoai.settings.setNotifications(true),
  );
  expect(on.success).toBe(true);
  await expect.poll(() => readUserConfig(userDataDir).notifications_enabled).toBe(true);

  expect((await showSilence(page)).shown).not.toBe(false);
  expect((await showNote(page)).shown).not.toBe(false);
  expect((await showMicOnly(page)).shown).not.toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

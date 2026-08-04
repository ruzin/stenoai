import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { enableDeterministicRecording } from '../fixtures/user-config';

/**
 * T2 — pre-meeting notification: it's gated by its own dedicated "Scheduled
 * meetings" toggle (premeeting_notifications_enabled — independent of the
 * "Post meeting notifications" master switch, which now only covers
 * note-ready/silence-auto-stop), and SUPPRESSED for a meeting we're already
 * recording (matched by session name === event title). Uses the
 * `show-premeeting-notification` design-for-test seam, which returns `shown`
 * (the production fire path is the main-side scheduler timer). Model-free.
 */

type ShowResult = { success: boolean; shown?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    settings: {
      setPremeetingNotifications: (v: boolean) => Promise<unknown>;
      showPremeetingNotification: (payload: {
        event: { id: string; title?: string };
      }) => Promise<ShowResult>;
    };
    recording: {
      start: (name?: string) => Promise<{ success: boolean }>;
      stop: () => Promise<{ success: boolean }>;
    };
  };
};

const EVT = { id: 'evt-standup', title: 'Daily standup' };

const showPremeeting = (
  page: import('@playwright/test').Page,
  event: { id: string; title?: string },
) =>
  page.evaluate(
    (e) => (window as StenoWindow).stenoai.settings.showPremeetingNotification({ event: e }),
    event,
  );

test('pre-meeting notification is gated by its own "Scheduled meetings" toggle; real dir untouched', async ({
  launchApp,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Default (on) → the gate lets it through (shown is not false).
  expect((await showPremeeting(page, EVT)).shown).not.toBe(false);

  // Scheduled meetings OFF → pre-meeting notif is gated off too (shown:false).
  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setPremeetingNotifications(false));
  expect((await showPremeeting(page, EVT)).shown).toBe(false);

  // Scheduled meetings ON → gate passes again.
  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setPremeetingNotifications(true));
  expect((await showPremeeting(page, EVT)).shown).not.toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('pre-meeting notification is suppressed for the meeting being recorded (name match)', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  enableDeterministicRecording(userDataDir);
  const { page } = await launchApp();

  // Start a recording NAMED after the meeting (a calendar-started recording is
  // named after its event title). The live recording's session name then equals
  // the reminder's event.title, which is the suppression match. Suppression keys
  // off currentRecordingSessionName — set synchronously by start-recording-ui and
  // cleared only on a real stop — so it's deterministic on every platform (no
  // dependence on real audio capture sustaining active, which a headless Windows
  // runner with no audio device can't do).
  const started = await page.evaluate(
    (name) => (window as StenoWindow).stenoai.recording.start(name),
    EVT.title,
  );
  expect(started.success).toBe(true);

  // The reminder for the meeting we're recording is suppressed (shown:false)...
  await expect.poll(async () => (await showPremeeting(page, EVT)).shown).toBe(false);
  // ...while a DIFFERENT meeting still fires (name mismatch).
  expect((await showPremeeting(page, { id: 'evt-other', title: 'Other call' })).shown).toBe(true);

  // Stop clears the session name; the notif fires for that meeting again.
  await page.evaluate(() => (window as StenoWindow).stenoai.recording.stop());
  await expect.poll(async () => (await showPremeeting(page, EVT)).shown).not.toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

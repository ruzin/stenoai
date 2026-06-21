import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { enableDeterministicRecording } from '../fixtures/user-config';

/**
 * T2 — pre-meeting notification: it's gated by the master "Desktop
 * notifications" toggle (no dedicated setting), and SUPPRESSED for a meeting
 * we're already recording (matched by calendar event id). Uses the
 * `show-premeeting-notification` design-for-test seam, which returns `shown`
 * (the production fire path is the main-side scheduler timer). Model-free.
 */

type ShowResult = { success: boolean; shown?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    settings: {
      setNotifications: (v: boolean) => Promise<unknown>;
      showPremeetingNotification: (payload: {
        event: { id: string; title?: string };
      }) => Promise<ShowResult>;
    };
    recording: {
      start: (name?: string, eventId?: string) => Promise<{ success: boolean }>;
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

test('pre-meeting notification is gated by the master notifications toggle; real dir untouched', async ({
  launchApp,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Default (notifications on) → the gate lets it through (shown is not false).
  expect((await showPremeeting(page, EVT)).shown).not.toBe(false);

  // Master notifications OFF → pre-meeting notif is gated off too (shown:false).
  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setNotifications(false));
  expect((await showPremeeting(page, EVT)).shown).toBe(false);

  // Master notifications ON → gate passes again.
  await page.evaluate(() => (window as StenoWindow).stenoai.settings.setNotifications(true));
  expect((await showPremeeting(page, EVT)).shown).not.toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('pre-meeting notification is suppressed for the meeting being recorded (event-id match)', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  enableDeterministicRecording(userDataDir);
  const { page } = await launchApp();

  // start-recording-ui sets currentRecordingEventId SYNCHRONOUSLY and returns
  // success on every platform (renderer-driven path) — so we check suppression
  // immediately after start, NOT after polling hasRecording. The renderer
  // capture (which may not sustain on a headless runner and would then clear
  // the association) is irrelevant to the suppression logic, and waiting for it
  // is what made this flaky on headless Windows.
  const started = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.recording.start('Daily standup', id),
    EVT.id,
  );
  expect(started.success).toBe(true);

  // Suppressed for the meeting we're recording (matched by event id). Poll to
  // tolerate a brief renderer-capture flap on a headless runner settling the
  // active-recording flag (the event-id association itself now survives a flap).
  await expect.poll(async () => (await showPremeeting(page, EVT)).shown).toBe(false);
  // ...but fires for a DIFFERENT meeting.
  expect((await showPremeeting(page, { id: 'evt-other', title: 'Other call' })).shown).not.toBe(
    false,
  );

  // Stop clears the association; the notif fires for that meeting again.
  await page.evaluate(() => (window as StenoWindow).stenoai.recording.stop());
  await expect.poll(async () => (await showPremeeting(page, EVT)).shown).not.toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

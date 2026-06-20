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
type Queue = { success: boolean; hasRecording: boolean };

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
      getQueue: () => Promise<Queue>;
      getSystemAudioSupport: () => Promise<{ success: boolean; supported?: boolean }>;
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

  // The recording state machine needs the renderer-driven path's OS support
  // (macOS >= 14.4 / Windows >= 10) — same guard as recording-lifecycle.t2.
  const support = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.getSystemAudioSupport(),
  );
  if (!support?.supported) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED premeeting suppression: system-audio path unsupported on this host.');
  }
  test.skip(!support?.supported, 'system-audio path unsupported on this runner');

  // Start a recording tagged with EVT.id (the calendar-event association).
  const started = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.recording.start('Daily standup', id),
    EVT.id,
  );
  expect(started.success).toBe(true);
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as StenoWindow).stenoai.recording.getQueue())).hasRecording,
    )
    .toBe(true);

  // Suppressed for the meeting we're recording (matched by event id)...
  expect((await showPremeeting(page, EVT)).shown).toBe(false);
  // ...but fires for a DIFFERENT meeting.
  expect((await showPremeeting(page, { id: 'evt-other', title: 'Other call' })).shown).not.toBe(
    false,
  );

  // Stop clears the association; the notif fires for that meeting again.
  await page.evaluate(() => (window as StenoWindow).stenoai.recording.stop());
  await expect
    .poll(async () =>
      (await page.evaluate(() => (window as StenoWindow).stenoai.recording.getQueue())).hasRecording,
    )
    .toBe(false);
  expect((await showPremeeting(page, EVT)).shown).not.toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

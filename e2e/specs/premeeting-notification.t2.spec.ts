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
      start: (name?: string) => Promise<{ success: boolean }>;
      stop: () => Promise<{ success: boolean }>;
      getQueue: () => Promise<{ hasRecording: boolean; sessionName: string | null }>;
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

test('pre-meeting notification is suppressed for the meeting being recorded (name match)', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  enableDeterministicRecording(userDataDir);
  const { page } = await launchApp();

  // Start a recording NAMED after the meeting (a calendar-started recording is
  // named after its event title). The live recording's session name then equals
  // the reminder's event.title, which is the suppression match.
  const started = await page.evaluate(
    (name) => (window as StenoWindow).stenoai.recording.start(name),
    EVT.title,
  );
  expect(started.success).toBe(true);

  // Check suppression IMMEDIATELY (one atomic evaluate), while the recording is
  // confirmed active — the renderer-driven capture doesn't sustain for long on a
  // headless runner, so a slow poll would race its teardown (same reason
  // recording-lifecycle.t2 asserts right after start). The single evaluate reads
  // the live queue and, only while hasRecording, fires the notification. The
  // coded result surfaces the real state on failure.
  const whileRecording = await page.evaluate(async (evt) => {
    const q = await (window as StenoWindow).stenoai.recording.getQueue();
    if (!q.hasRecording) return `no-recording(name=${q.sessionName})`;
    const a = await (window as StenoWindow).stenoai.settings.showPremeetingNotification({
      event: evt,
    });
    // Same instant: a DIFFERENT meeting still fires (name mismatch).
    const b = await (window as StenoWindow).stenoai.settings.showPremeetingNotification({
      event: { id: 'evt-other', title: 'Other call' },
    });
    return `recording:self=${a.shown},other=${b.shown}`;
  }, EVT);
  // self suppressed (shown=false), other fires (shown=true).
  expect(whileRecording).toBe('recording:self=false,other=true');

  // Stop clears the session name; the notif fires for that meeting again.
  await page.evaluate(() => (window as StenoWindow).stenoai.recording.stop());
  await expect.poll(async () => (await showPremeeting(page, EVT)).shown).not.toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

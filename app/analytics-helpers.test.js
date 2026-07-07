'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  textLengthBucket,
  durationBucket,
  RENDERER_TRACK_EVENTS,
  RENDERER_TRACK_EVENT_PROPERTIES,
  RENDERER_TRACK_EVENT_VALUE_ALLOWLIST,
  sanitizeTrackProperties,
  calendarMeetingProvider,
  classifyErrorReason,
  redactLocalPaths,
  sanitizeErrorForCrashReport,
  summarizeCalendarWindow,
  summarizeCalendarSnapshot,
  withTimeout,
} = require('./analytics-helpers');

test('textLengthBucket buckets at each boundary', () => {
  assert.strictEqual(textLengthBucket(''), '0');
  assert.strictEqual(textLengthBucket(undefined), '0');
  assert.strictEqual(textLengthBucket('a'.repeat(19)), '1-20');
  assert.strictEqual(textLengthBucket('a'.repeat(20)), '20-50');
  assert.strictEqual(textLengthBucket('a'.repeat(49)), '20-50');
  assert.strictEqual(textLengthBucket('a'.repeat(50)), '50-100');
  assert.strictEqual(textLengthBucket('a'.repeat(99)), '50-100');
  assert.strictEqual(textLengthBucket('a'.repeat(100)), '100-250');
  assert.strictEqual(textLengthBucket('a'.repeat(249)), '100-250');
  assert.strictEqual(textLengthBucket('a'.repeat(250)), '250+');
  assert.strictEqual(textLengthBucket('a'.repeat(5000)), '250+');
});

test('durationBucket buckets at each boundary', () => {
  assert.strictEqual(durationBucket(0), '<1m');
  assert.strictEqual(durationBucket(59), '<1m');
  assert.strictEqual(durationBucket(60), '1-5m');
  assert.strictEqual(durationBucket(299), '1-5m');
  assert.strictEqual(durationBucket(300), '5-15m');
  assert.strictEqual(durationBucket(899), '5-15m');
  assert.strictEqual(durationBucket(900), '15-30m');
  assert.strictEqual(durationBucket(1799), '15-30m');
  assert.strictEqual(durationBucket(1800), '30-60m');
  assert.strictEqual(durationBucket(3599), '30-60m');
  assert.strictEqual(durationBucket(3600), '60m+');
  assert.strictEqual(durationBucket(999999), '60m+');
});

test('sanitizeTrackProperties keeps only allowlisted keys with scalar string/number/boolean values', () => {
  assert.deepStrictEqual(
    sanitizeTrackProperties('notification_shown', {
      type: 'premeeting',
      count: 3,
      enabled: true,
      nested: { title: 'Q3 planning sync' },
      arr: ['a', 'b'],
    }),
    // Only `type` is in notification_shown's allowlist -- count/enabled are
    // scalar-valid but not an allowed key for this event, so they're dropped
    // too, not just the nested/array values.
    { type: 'premeeting' },
  );
});

test('sanitizeTrackProperties enforces the value allowlist, not just the key allowlist (P1: a string under an approved key must still be a known enum value)', () => {
  // `type` is an allowed key for notification_shown, but only 'premeeting' is
  // an allowed VALUE (the only one the renderer bridge actually sends) --
  // anything else must be dropped even though it's short and under an
  // approved key, e.g. a future bug pasting arbitrary text into `type`.
  assert.deepStrictEqual(
    sanitizeTrackProperties('notification_shown', { type: 'meeting_detected' }),
    {},
  );
  assert.deepStrictEqual(
    sanitizeTrackProperties('notification_shown', { type: 'a pasted attendee name' }),
    {},
  );
  assert.deepStrictEqual(
    sanitizeTrackProperties('notification_shown', { type: 'premeeting' }),
    { type: 'premeeting' },
  );

  // Same enforcement for ai_provider_selected / onboarding_completed's enum
  // properties -- only their known literal values survive.
  assert.deepStrictEqual(sanitizeTrackProperties('ai_provider_selected', { provider: 'cloud' }), { provider: 'cloud' });
  assert.deepStrictEqual(sanitizeTrackProperties('ai_provider_selected', { provider: 'openai' }), {});
  assert.deepStrictEqual(
    sanitizeTrackProperties('onboarding_completed', { ai_provider: 'local', calendar_connected: true }),
    { ai_provider: 'local', calendar_connected: true },
  );
  assert.deepStrictEqual(
    sanitizeTrackProperties('onboarding_completed', { ai_provider: 'remote', calendar_connected: true }),
    { calendar_connected: true },
  );
});

test('RENDERER_TRACK_EVENT_VALUE_ALLOWLIST has an entry for every allowlisted string property', () => {
  // Every string-valued property reachable through the renderer bridge
  // should be enum-constrained -- not just key-allowlisted and length-capped.
  const stringProps = [
    'notification_shown.type',
    'notification_clicked.type',
    'notification_dismissed.type',
    'onboarding_completed.ai_provider',
    'ai_provider_selected.provider',
  ];
  for (const prop of stringProps) {
    assert.ok(RENDERER_TRACK_EVENT_VALUE_ALLOWLIST[prop] instanceof Set, `missing value allowlist for ${prop}`);
  }
});

test('sanitizeTrackProperties drops a short scalar value under a key outside the event allowlist (no PII-under-unexpected-key leak)', () => {
  // Regression for the actual privacy boundary: a short string alone used to
  // be enough to pass through. `meeting_title` is well under the 200-char
  // cap, but it is not an allowed key for onboarding_completed.
  const result = sanitizeTrackProperties('onboarding_completed', {
    ai_provider: 'local',
    calendar_connected: true,
    meeting_title: 'Board sync w/ Jane Doe',
  });
  assert.deepStrictEqual(result, { ai_provider: 'local', calendar_connected: true });
});

test('sanitizeTrackProperties drops strings over 200 chars even for an allowlisted key', () => {
  const longTitle = 'x'.repeat(201);
  const result = sanitizeTrackProperties('ai_provider_selected', { provider: 'cloud', extra: longTitle });
  assert.deepStrictEqual(result, { provider: 'cloud' });
});

test('sanitizeTrackProperties returns empty for an event with no allowlist entry', () => {
  assert.deepStrictEqual(sanitizeTrackProperties('not_a_real_event', { type: 'x' }), {});
  assert.deepStrictEqual(sanitizeTrackProperties('__proto__', { type: 'x' }), {});
});

test('sanitizeTrackProperties handles non-object / null / undefined properties', () => {
  assert.deepStrictEqual(sanitizeTrackProperties('notification_shown', null), {});
  assert.deepStrictEqual(sanitizeTrackProperties('notification_shown', undefined), {});
  assert.deepStrictEqual(sanitizeTrackProperties('notification_shown', 'a string'), {});
  assert.deepStrictEqual(sanitizeTrackProperties('notification_shown', 42), {});
});

test('RENDERER_TRACK_EVENTS covers exactly the events the renderer calls via the bridge', () => {
  assert.ok(RENDERER_TRACK_EVENTS.has('notification_shown'));
  assert.ok(RENDERER_TRACK_EVENTS.has('notification_clicked'));
  assert.ok(RENDERER_TRACK_EVENTS.has('notification_dismissed'));
  assert.ok(RENDERER_TRACK_EVENTS.has('onboarding_completed'));
  assert.ok(RENDERER_TRACK_EVENTS.has('ai_provider_selected'));
  assert.ok(!RENDERER_TRACK_EVENTS.has('__proto__'));
  assert.ok(!RENDERER_TRACK_EVENTS.has('arbitrary_event'));
  // chat_message_sent fires directly from main.js's streaming handlers, never
  // via the renderer bridge -- it must NOT be renderer-reachable.
  assert.ok(!RENDERER_TRACK_EVENTS.has('chat_message_sent'));
});

test('RENDERER_TRACK_EVENT_PROPERTIES allowlists are narrow and event-specific', () => {
  assert.deepStrictEqual([...RENDERER_TRACK_EVENT_PROPERTIES.notification_shown], ['type']);
  assert.deepStrictEqual([...RENDERER_TRACK_EVENT_PROPERTIES.ai_provider_selected], ['provider']);
  assert.deepStrictEqual(
    [...RENDERER_TRACK_EVENT_PROPERTIES.onboarding_completed].sort(),
    ['ai_provider', 'calendar_connected'],
  );
});

test('calendarMeetingProvider identifies known providers by hostname', () => {
  assert.strictEqual(calendarMeetingProvider('https://us02web.zoom.us/j/123'), 'zoom');
  assert.strictEqual(calendarMeetingProvider('https://meet.google.com/abc-defg-hij'), 'meet');
  assert.strictEqual(calendarMeetingProvider('https://teams.microsoft.com/l/meetup-join/x'), 'teams');
  assert.strictEqual(calendarMeetingProvider('https://teams.live.com/meet/123'), 'teams');
});

test('calendarMeetingProvider falls back to other/none appropriately', () => {
  assert.strictEqual(calendarMeetingProvider('https://example.com/meeting'), 'other');
  assert.strictEqual(calendarMeetingProvider(undefined), 'none');
  assert.strictEqual(calendarMeetingProvider(null), 'none');
  assert.strictEqual(calendarMeetingProvider(''), 'none');
  assert.strictEqual(calendarMeetingProvider('not a url'), 'other');
});

test('calendarMeetingProvider matches the exact domain or a real subdomain, not any host containing the string (P3)', () => {
  // Bare domain and real subdomains still match.
  assert.strictEqual(calendarMeetingProvider('https://zoom.us/j/123'), 'zoom');
  assert.strictEqual(calendarMeetingProvider('https://us02web.zoom.us/j/123'), 'zoom');
  // A host that merely CONTAINS "zoom.us" as a substring, without it being
  // the actual domain/subdomain, must NOT match -- this was the bug: a
  // naive .includes() check would misclassify these as 'zoom'.
  assert.strictEqual(calendarMeetingProvider('https://evilzoom.us.attacker.com/j/123'), 'other');
  assert.strictEqual(calendarMeetingProvider('https://notzoom.us/j/123'), 'other');
  assert.strictEqual(calendarMeetingProvider('https://myzoom.uscustomdomain.com/x'), 'other');
});

test('classifyErrorReason maps common failure classes to fixed enum values', () => {
  assert.strictEqual(classifyErrorReason(new Error('ENOENT: no such file or directory')), 'not_found');
  assert.strictEqual(classifyErrorReason(new Error('EACCES: permission denied')), 'permission_denied');
  assert.strictEqual(classifyErrorReason(new Error('EPERM: operation not permitted')), 'permission_denied');
  assert.strictEqual(classifyErrorReason(new Error('ENOSPC: no space left')), 'disk_full');
  assert.strictEqual(classifyErrorReason(new Error('process-streaming spawn error: boom')), 'spawn_failed');
  assert.strictEqual(classifyErrorReason(new Error('watchdog timed out after 60000ms')), 'timeout');
  assert.strictEqual(classifyErrorReason(new Error('metal::malloc out of memory')), 'out_of_memory');
  assert.strictEqual(
    classifyErrorReason(new Error('process-streaming exited with code -9: ...')),
    'subprocess_exit_-9',
  );
  assert.strictEqual(classifyErrorReason(new Error('something totally unexpected')), 'unknown');
});

test('classifyErrorReason never leaks the raw message -- fixed enum output only', () => {
  const err = new Error('/Users/alice/Desktop/interview-with-jane-doe.m4a ENOENT');
  const reason = classifyErrorReason(err);
  assert.ok(!reason.includes('alice'));
  assert.ok(!reason.includes('jane'));
  assert.strictEqual(reason, 'not_found');
});

test('sanitizeErrorForCrashReport replaces the message with a fixed enum, never the raw text', () => {
  const err = new Error("ENOENT: no such file or directory, open '/Users/will/Library/Application Support/stenoai/recordings/1:1 with Jane Doe.wav'");
  err.name = 'Error';
  const safe = sanitizeErrorForCrashReport(err);
  assert.strictEqual(safe.message, 'not_found');
  assert.ok(!safe.message.includes('Jane'));
  assert.ok(!safe.message.includes('will'));
});

test('sanitizeErrorForCrashReport strips the risky first stack line but keeps the frame list (file:line) intact for triage', () => {
  const err = new Error("ENOENT: open '/Users/will/recordings/Board sync w Jane Doe.wav'");
  err.name = 'Error';
  err.stack =
    "Error: ENOENT: open '/Users/will/recordings/Board sync w Jane Doe.wav'\n" +
    '    at Object.openSync (node:fs:592:3)\n' +
    '    at processNextInQueue (/Applications/Steno.app/Contents/Resources/app.asar/main.js:3820:15)';
  const safe = sanitizeErrorForCrashReport(err);
  const stackLines = safe.stack.split('\n');
  // First line is sanitized -- the fixed reason, not the raw message.
  assert.strictEqual(stackLines[0], 'Error: not_found');
  assert.ok(!safe.stack.includes('Jane'));
  assert.ok(!safe.stack.includes('/Users/will/recordings'));
  // Frame lines (file:line locations in our own source) are preserved verbatim.
  assert.strictEqual(stackLines[1], '    at Object.openSync (node:fs:592:3)');
  assert.ok(stackLines[2].includes('processNextInQueue (/Applications/Steno.app'));
});

test('sanitizeErrorForCrashReport redacts a username/workspace path in a stack FRAME (P2: dev/unpacked installs are not guaranteed path-free)', () => {
  // A signed production build's frames point into /Applications/Steno.app,
  // which is safe (no username). A dev checkout or portable install's
  // frames instead point somewhere like /Users/alice/Downloads/stenoai/...,
  // which embeds the OS username and local folder name -- this must not
  // survive into the crash report.
  const err = new TypeError('Cannot read properties of undefined');
  err.stack =
    'TypeError: Cannot read properties of undefined\n' +
    '    at processNextInQueue (/Users/alice/Downloads/stenoai-dev/app/main.js:3820:15)\n' +
    '    at Object.<anonymous> (/Users/alice/Downloads/stenoai-dev/app/node_modules/posthog-node/lib/index.js:100:5)';
  const safe = sanitizeErrorForCrashReport(err);
  assert.ok(!safe.stack.includes('alice'));
  assert.ok(!safe.stack.includes('/Users/alice'));
  // Function name + relative structure still present for triage.
  assert.ok(safe.stack.includes('processNextInQueue'));
  assert.ok(safe.stack.includes('main.js:3820:15'));
});

test('redactLocalPaths strips the app install root and falls back to redacting bare home-directory paths', () => {
  const path = require('path');
  const appRoot = __dirname; // analytics-helpers.js's own dir == main.js's dir
  const underAppRoot = `${appRoot}${path.sep}main.js:10:1`;
  const result1 = redactLocalPaths(underAppRoot);
  assert.ok(!result1.includes(appRoot));
  assert.ok(result1.includes('<app>'));

  // Not under the app root at all (e.g. an Electron internal frame or an
  // unexpected library path) -- the regex fallback collapses the WHOLE
  // home-relative path (every directory segment, not just the username) to
  // a filename, so a workspace/client/project folder name after the
  // username can't survive either.
  assert.strictEqual(
    redactLocalPaths('at foo (/Users/bob/somewhere/else.js:1:1)'),
    'at foo (<redacted-path>/else.js:1:1)',
  );
  assert.strictEqual(
    redactLocalPaths('at foo (/Users/bob/acme-corp-confidential/steno-fork/lib/else.js:1:1)'),
    'at foo (<redacted-path>/else.js:1:1)',
  );
  assert.ok(!redactLocalPaths('/Users/bob/acme-corp-confidential/else.js').includes('acme-corp'));
  assert.strictEqual(
    redactLocalPaths('at foo (/home/bob/somewhere/else.js:1:1)'),
    'at foo (<redacted-path>/else.js:1:1)',
  );
  assert.strictEqual(
    redactLocalPaths('at foo (C:\\Users\\bob\\somewhere\\else.js:1:1)'),
    'at foo (<redacted-path>/else.js:1:1)',
  );
  // A path with no user-specific segment at all is left alone.
  assert.strictEqual(redactLocalPaths('at node:internal/process/task_queues:95:5'), 'at node:internal/process/task_queues:95:5');
});

test('sanitizeErrorForCrashReport preserves the error name (generic, not PII) and handles a missing/non-Error stack', () => {
  const typeErr = new TypeError('Cannot read properties of undefined');
  const safe = sanitizeErrorForCrashReport(typeErr);
  assert.strictEqual(safe.name, 'TypeError');
  assert.strictEqual(safe.message, 'unknown');

  const noStack = { message: 'ENOSPC: no space left', name: 'Error' };
  const safeNoStack = sanitizeErrorForCrashReport(noStack);
  assert.strictEqual(safeNoStack.message, 'disk_full');
});

test('summarizeCalendarWindow counts meetings and buckets provider breakdown, content-free', () => {
  const events = [
    { title: 'Standup', meeting_url: 'https://zoom.us/j/1' },
    { title: 'Board planning', meeting_url: 'https://meet.google.com/abc' },
    { title: '1:1', meeting_url: 'https://zoom.us/j/2' },
    { title: 'No video meeting' }, // no meeting_url -> provider 'none'
  ];
  const summary = summarizeCalendarWindow(events);
  assert.strictEqual(summary.meeting_count, 4);
  assert.strictEqual(summary.video_meeting_count, 3);
  assert.deepStrictEqual(summary.provider_breakdown, { zoom: 2, meet: 1 });
  // Content-free: no title/url should ever appear on the summary object.
  assert.strictEqual(JSON.stringify(summary).includes('Standup'), false);
  assert.strictEqual(JSON.stringify(summary).includes('zoom.us'), false);
});

test('summarizeCalendarSnapshot splits events into today vs week windows', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  const events = [
    // Today, timed, zoom
    { title: 'Today standup', start: '2026-07-07T09:00:00Z', meeting_url: 'https://zoom.us/j/1' },
    // Later this week, timed, meet
    { title: 'Later this week', start: '2026-07-09T09:00:00Z', meeting_url: 'https://meet.google.com/abc' },
    // All-day event -- excluded from both windows
    { title: 'On vacation', start: '2026-07-07', is_all_day: true },
    // Declined -- excluded from both windows
    { title: 'Declined meeting', start: '2026-07-07T15:00:00Z', response_status: 'declined' },
  ];
  const { today, week } = summarizeCalendarSnapshot(events, now);
  assert.strictEqual(today.meeting_count, 1);
  assert.strictEqual(today.video_meeting_count, 1);
  assert.strictEqual(week.meeting_count, 2);
  assert.strictEqual(week.video_meeting_count, 2);
  assert.deepStrictEqual(week.provider_breakdown, { zoom: 1, meet: 1 });
});

test('withTimeout resolves with the promise value when it settles before the deadline', async () => {
  const result = await withTimeout(Promise.resolve('calendar-event'), 50);
  assert.strictEqual(result, 'calendar-event');
});

test('withTimeout resolves with the fallback if the promise never settles (a hung token refresh)', async () => {
  const neverSettles = new Promise(() => {});
  const result = await withTimeout(neverSettles, 20, null);
  assert.strictEqual(result, null);
});

test('withTimeout resolves with the fallback (not a rejection) if the promise rejects', async () => {
  const rejecting = Promise.reject(new Error('token refresh failed'));
  const result = await withTimeout(rejecting, 50, null);
  assert.strictEqual(result, null);
});

test('withTimeout supports a custom fallback value', async () => {
  const neverSettles = new Promise(() => {});
  const result = await withTimeout(neverSettles, 20, 'timed-out');
  assert.strictEqual(result, 'timed-out');
});

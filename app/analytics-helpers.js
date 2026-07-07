'use strict';

/**
 * Pure, side-effect-free analytics helpers used by main.js's trackEvent call
 * sites. Extracted into their own module (mirrors shortcut-url.js /
 * setup-check-parse.js) so the bucketing/classification/sanitization logic
 * is unit-testable without requiring Electron.
 */

function textLengthBucket(text) {
  const len = (text || '').length;
  if (len === 0) return '0';
  if (len < 20) return '1-20';
  if (len < 50) return '20-50';
  if (len < 100) return '50-100';
  if (len < 250) return '100-250';
  return '250+';
}

function durationBucket(seconds) {
  if (seconds < 60) return '<1m';
  if (seconds < 300) return '1-5m';
  if (seconds < 900) return '5-15m';
  if (seconds < 1800) return '15-30m';
  if (seconds < 3600) return '30-60m';
  return '60m+';
}

// Renderer-originated analytics event names allowed through the `track` IPC
// bridge (contextIsolation means the renderer can't call trackEvent
// directly), each mapped to its own property-key allowlist. This is the
// actual privacy boundary: sanitizing by type/length alone would still let a
// short PII value (an attendee name, a meeting title) ride through under an
// unexpected key. Only listed here are events the renderer currently calls
// via ipc().analytics.track() -- e.g. chat_message_sent fires directly from
// main.js's streaming handlers and deliberately isn't reachable from here.
// Object.create(null) -- NOT a `{}` literal -- so a lookup by an
// Object.prototype key name (`__proto__`, `constructor`, `toString`, ...)
// returns real `undefined` instead of silently resolving to the inherited
// prototype method/object. A `{}` literal here would let eventName
// '__proto__' resolve to Object.prototype itself (truthy, no .has()),
// crashing sanitizeTrackProperties instead of safely falling through to "no
// allowlist for this event".
const RENDERER_TRACK_EVENT_PROPERTIES = Object.assign(Object.create(null), {
  notification_shown: new Set(['type']),
  notification_clicked: new Set(['type']),
  notification_dismissed: new Set(['type']),
  onboarding_completed: new Set(['ai_provider', 'calendar_connected']),
  ai_provider_selected: new Set(['provider']),
});

const RENDERER_TRACK_EVENTS = new Set(Object.keys(RENDERER_TRACK_EVENT_PROPERTIES));

// Value-sanitizes a renderer-supplied properties object: only keys in that
// event's allowlist survive, and of those, only scalar string/number/boolean
// values with strings <=200 chars. Objects/arrays are dropped entirely --
// never forwarded to PostHog. This is the security boundary between
// renderer-supplied data and PostHog capture.
function sanitizeTrackProperties(eventName, properties) {
  const allowedKeys = typeof eventName === 'string' ? RENDERER_TRACK_EVENT_PROPERTIES[eventName] : undefined;
  const out = {};
  if (!allowedKeys || !properties || typeof properties !== 'object') return out;
  for (const [key, value] of Object.entries(properties)) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value === 'string') {
      if (value.length <= 200) out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
    // keys outside the allowlist, objects/arrays, and long strings are all
    // dropped -- never forwarded to PostHog
  }
  return out;
}

// Enum-only provider inference from a calendar event's meeting_url -- the
// URL itself is discarded, never sent to PostHog.
function calendarMeetingProvider(meetingUrl) {
  if (!meetingUrl || typeof meetingUrl !== 'string') return 'none';
  try {
    const host = new URL(meetingUrl).hostname.toLowerCase();
    if (host.includes('zoom.us') || host.includes('zoom.com')) return 'zoom';
    if (host.includes('meet.google.com')) return 'meet';
    if (host.includes('teams.microsoft.com') || host.includes('teams.live.com')) return 'teams';
    return 'other';
  } catch (_) {
    return 'other';
  }
}

// Coarse, PII-free classification of a caught error for error_occurred's
// `reason` property. Fixed enum output only -- NEVER forwards error.message
// or .stack to PostHog, since either can carry a local file path (username in
// a home directory, an imported audio file's name, etc).
function classifyErrorReason(error) {
  const msg = String((error && error.message) || error || '');
  if (/\bENOENT\b/.test(msg)) return 'not_found';
  if (/\bEACCES\b|\bEPERM\b/.test(msg)) return 'permission_denied';
  if (/\bENOSPC\b/.test(msg)) return 'disk_full';
  if (/spawn error/i.test(msg)) return 'spawn_failed';
  if (/timed out|watchdog/i.test(msg)) return 'timeout';
  if (/malloc|out of memory|\boom\b/i.test(msg)) return 'out_of_memory';
  const exitMatch = msg.match(/exited with code (-?\d+)/i);
  if (exitMatch) return `subprocess_exit_${exitMatch[1]}`;
  return 'unknown';
}

// Coarse, PII-free error for crash reporting ($exception capture). An
// uncaught fs/child_process error's raw .message can embed a local path, a
// session/note name, or -- for a calendar-titled recording -- a meeting
// title or attendee name, so it must never ride along verbatim like
// posthogClient.captureException(err, ...) would send it by default.
// Reuses classifyErrorReason so the message is always one of that function's
// fixed enum values. Stack FRAMES are preserved (they're file:line locations
// in our own source -- the same for every user, no PII) since that's the
// actual triage value of a crash report; only the first line, which
// normally repeats "name: message" and would carry the risky text, is
// replaced with the sanitized reason.
function sanitizeErrorForCrashReport(err) {
  const reason = classifyErrorReason(err);
  const name = (err && err.name) || 'Error';
  const safe = new Error(reason);
  safe.name = name;
  if (err && typeof err.stack === 'string') {
    const lines = err.stack.split('\n');
    safe.stack = [`${name}: ${reason}`, ...lines.slice(1)].join('\n');
  }
  return safe;
}

// Content-free per-window summary for calendar_snapshot: counts + a
// provider breakdown, never titles/attendees/URLs.
function summarizeCalendarWindow(windowEvents) {
  const providerBreakdown = {};
  let videoMeetingCount = 0;
  for (const e of windowEvents) {
    const provider = calendarMeetingProvider(e.meeting_url);
    if (provider !== 'none') {
      videoMeetingCount++;
      providerBreakdown[provider] = (providerBreakdown[provider] || 0) + 1;
    }
  }
  return {
    meeting_count: windowEvents.length,
    video_meeting_count: videoMeetingCount,
    provider_breakdown: providerBreakdown,
  };
}

// Splits a fetched event list into "today" and "week" calendar_snapshot
// payloads. Pure given `now` -- callers own throttling/trackEvent side effects.
function summarizeCalendarSnapshot(events, now) {
  const startOfDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const endOfDayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const timedNonDeclined = events.filter(
    (e) => e && typeof e.start === 'string' && e.start.includes('T') && e.is_all_day !== true && e.response_status !== 'declined'
  );
  const todayEvents = timedNonDeclined.filter((e) => {
    const startMs = new Date(e.start).getTime();
    return isFinite(startMs) && startMs >= startOfDayMs && startMs <= endOfDayMs;
  });
  return {
    today: summarizeCalendarWindow(todayEvents),
    week: summarizeCalendarWindow(timedNonDeclined),
  };
}

// Resolves with `fallback` if `promise` hasn't settled within `ms`, or if it
// rejects -- this function itself never rejects. Needed because
// getCalendarEventForNow's own AbortController only bounds the calendar
// event fetch; a stuck OAuth token-refresh request (no timeout of its own)
// upstream of that fetch can hang the whole chain indefinitely. Without an
// outer bound here, that hang would silently swallow recording_started for
// the recording that triggered the lookup.
function withTimeout(promise, ms, fallback = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

module.exports = {
  textLengthBucket,
  durationBucket,
  RENDERER_TRACK_EVENTS,
  RENDERER_TRACK_EVENT_PROPERTIES,
  sanitizeTrackProperties,
  calendarMeetingProvider,
  classifyErrorReason,
  sanitizeErrorForCrashReport,
  summarizeCalendarWindow,
  summarizeCalendarSnapshot,
  withTimeout,
};

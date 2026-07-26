import i18n from '@/lib/i18n';
import { type CalendarEvent } from '@/lib/ipc';
import { shortcut } from '@/lib/utils';

// Pure copy logic for the Home hero. Extracted from Home.tsx so the
// headline/subtitle string-building can be unit-tested without mounting the
// React route. Recording state always wins over calendar state.

// The shortcut glyphs are platform, not language — they read the same in every
// UI language, so this stays a module constant.
const RECORD_SHORTCUT = shortcut('⌘⇧R', 'Ctrl+Shift+R');

// Default subtitle — also used as the empty/idle fallback. Resolved per call
// rather than cached at module load, so a mid-session language change is
// picked up on the next render.
const recordingHint = () =>
  i18n.t('hero.recordingHint', { shortcut: RECORD_SHORTCUT });

// Cached at module load to avoid rebuilding on every render. We don't
// react to system-locale changes mid-session — that would require a full
// app relaunch on macOS anyway, and creating an Intl.DateTimeFormat per
// render isn't free. If we ever start supporting in-app locale toggles
// we'd need to move this inside the function.
const HERO_TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

export interface HeroState {
  status: 'idle' | 'recording' | 'paused' | 'processing';
  sessionName: string | null;
  inProgressEvent: CalendarEvent | null;
  nextSoonEvent: CalendarEvent | null;
  tomorrowPreview: CalendarEvent | null;
  calendarConnected: boolean;
  now: number;
}

// True only when `now` is inside the event's real [start, end) — i.e. the
// meeting has actually started. `pickInProgressEvent` also returns events in
// the 5-min early-join grace and the late-join floor, which are the right
// targets for the "start recording" CTA but must NOT drive present-tense
// copy like "In a meeting now" (the meeting may not have begun yet).
function eventIsNow(e: CalendarEvent, nowMs: number): boolean {
  const startMs = new Date(e.start).getTime();
  const endMs = new Date(e.end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return startMs <= nowMs && nowMs < endMs;
}

// Headline. Recording state always wins over calendar state — when the
// user is recording / paused / processing they want status, not a
// schedule. Idle falls through to the calendar-driven copy.
export function heroHeadline(s: HeroState): string {
  switch (s.status) {
    case 'recording':
      return i18n.t('hero.headline.recording');
    case 'paused':
      return i18n.t('hero.headline.paused');
    case 'processing':
      return i18n.t('hero.headline.processing');
  }
  // Only present-tense when the meeting has truly started — not during the
  // early-join grace, which would tell the user they're "in" a meeting that
  // hasn't begun. The pre-start case falls through to "Next meeting in N min".
  if (s.inProgressEvent && eventIsNow(s.inProgressEvent, s.now)) {
    return i18n.t('hero.headline.inMeeting');
  }
  if (s.nextSoonEvent) {
    const startMs = new Date(s.nextSoonEvent.start).getTime();
    if (!Number.isNaN(startMs)) {
      const deltaMs = startMs - s.now;
      // Compute mins first and gate on the rounded value: Math.ceil rounds
      // anything in (59 min, 60 min) up to 60, and "60 mins" reads
      // unnaturally — fall straight through to "1 hr" instead. The
      // Math.max(1) keeps the headline non-zero in the last 30 seconds
      // before start.
      const mins = Math.max(1, Math.ceil(deltaMs / MIN_MS));
      if (mins < 60) return i18n.t('hero.headline.nextInMinutes', { count: mins });
      const hrs = Math.max(1, Math.round(deltaMs / HOUR_MS));
      return i18n.t('hero.headline.nextInHours', { count: hrs });
    }
  }
  // Reaching here means nothing is live or upcoming today. Only call the day
  // "clear" when the calendar is actually connected — otherwise we don't know,
  // so keep the neutral invitation.
  if (s.calendarConnected) return i18n.t('hero.headline.clearDay');
  return i18n.t('hero.headline.ready');
}

// Subtitle. Mirrors the headline cases. Keeps the recording shortcut hint
// as the default fallback so the page always tells the user how to act.
export function heroSubtitle(s: HeroState): string {
  if (s.status === 'recording') {
    // Source of truth for "what we're capturing" is the active session
    // name — the user may have started a recording titled after one
    // event while a different calendar event is also concurrently in
    // progress, and the subtitle should reflect what they actually hit
    // record on. ⌘⇧R is a record-toggle per main.js's global shortcut
    // so "to stop" is accurate when already recording.
    const title =
      s.sessionName?.trim() ||
      s.inProgressEvent?.title?.trim() ||
      i18n.t('hero.subtitle.inProgressFallback');
    return i18n.t('hero.subtitle.recording', {
      title,
      shortcut: RECORD_SHORTCUT,
    });
  }
  if (s.status === 'paused') {
    // ⌘⇧R is a record-toggle: while paused it STOPS (finalizes) the recording
    // rather than resuming. Resume is a click-only action on the bottom bar,
    // so point there instead of advertising a shortcut that would end the note.
    return i18n.t('hero.subtitle.paused');
  }
  if (s.status === 'processing') {
    return i18n.t('hero.subtitle.processing');
  }
  // Only when the meeting has truly started (mirrors the headline gate) — the
  // pre-start grace falls through to the timed "starts at …" line below.
  if (s.inProgressEvent && eventIsNow(s.inProgressEvent, s.now)) {
    return i18n.t('hero.subtitle.inMeeting', { shortcut: RECORD_SHORTCUT });
  }
  if (s.nextSoonEvent) {
    const startMs = new Date(s.nextSoonEvent.start).getTime();
    if (!Number.isNaN(startMs)) {
      // Mirror the headline's `mins < 60` threshold (Math.ceil-based) so the
      // title-at-time line and the "Next meeting in N min" headline flip to
      // the hours wording at the same instant.
      const mins = Math.max(1, Math.ceil((startMs - s.now) / MIN_MS));
      if (mins < 60) {
        const at = HERO_TIME_FMT.format(new Date(startMs));
        return i18n.t('hero.subtitle.nextSoon', {
          title: s.nextSoonEvent.title,
          time: at,
          shortcut: RECORD_SHORTCUT,
        });
      }
    }
    return recordingHint();
  }
  if (s.tomorrowPreview) {
    const startMs = new Date(s.tomorrowPreview.start).getTime();
    if (!Number.isNaN(startMs)) {
      const at = HERO_TIME_FMT.format(new Date(startMs));
      return i18n.t('hero.subtitle.tomorrow', {
        title: s.tomorrowPreview.title,
        time: at,
      });
    }
  }
  return recordingHint();
}

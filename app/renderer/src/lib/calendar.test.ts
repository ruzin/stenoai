import { describe, test, expect } from 'vitest';
import type { CalendarEvent } from '@/lib/ipc';
import { pickInProgressEvent } from '@/lib/calendar';

// Coverage for the renderer's calendar-matching helper (#147), which is kept
// in lockstep with main.js → pickCurrentCalendarEvent. These tests pin the
// match window (5-min early grace, 10-min late floor), the filters (all-day,
// declined, malformed), and the priority order so a future edit to either
// copy that drifts from the documented rules fails here.
// NOTE: a true cross-impl equivalence test (renderer port vs the main.js copy)
// is a tracked follow-up — it needs the main.js function extracted into a
// shared CommonJS module first.

const NOW = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
const NOW_MS = NOW.getTime();
const MIN = 60_000;

function ev(
  startOffsetMs: number,
  endOffsetMs: number,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: extra.id ?? 'e',
    title: extra.title ?? 'Meeting',
    start: new Date(NOW_MS + startOffsetMs).toISOString(),
    end: new Date(NOW_MS + endOffsetMs).toISOString(),
    ...extra,
  };
}

describe('pickInProgressEvent', () => {
  test('returns null for empty / nullish input', () => {
    expect(pickInProgressEvent([], NOW)).toBeNull();
    expect(pickInProgressEvent(null, NOW)).toBeNull();
    expect(pickInProgressEvent(undefined, NOW)).toBeNull();
  });

  test('a genuinely in-progress event is picked over an upcoming one', () => {
    const inProgress = ev(-5 * MIN, 25 * MIN, { id: 'now' });
    const upcoming = ev(3 * MIN, 30 * MIN, { id: 'soon' });
    expect(pickInProgressEvent([upcoming, inProgress], NOW)?.id).toBe('now');
  });

  test('early-join grace: an event starting in <5 min matches; >5 min does not', () => {
    expect(pickInProgressEvent([ev(4 * MIN, 30 * MIN, { id: 'grace' })], NOW)?.id).toBe('grace');
    expect(pickInProgressEvent([ev(6 * MIN, 30 * MIN, { id: 'tooEarly' })], NOW)).toBeNull();
  });

  test('late floor: a short meeting still matches within 10 min of its start', () => {
    // 2-min meeting that started 4 min ago: real end passed, but the 10-min
    // floor (start+10) keeps it matchable for a late joiner.
    expect(pickInProgressEvent([ev(-4 * MIN, -2 * MIN, { id: 'late' })], NOW)?.id).toBe('late');
    // ...but once past start+10 it drops off.
    expect(pickInProgressEvent([ev(-12 * MIN, -10 * MIN, { id: 'gone' })], NOW)).toBeNull();
  });

  test('all-day events are skipped (date-only and the explicit is_all_day flag)', () => {
    const dateOnly: CalendarEvent = { id: 'allday', title: 'OOO', start: '2026-01-15', end: '2026-01-16' };
    expect(pickInProgressEvent([dateOnly], NOW)).toBeNull();
    const flagged = ev(-5 * MIN, 25 * MIN, { id: 'flag', is_all_day: true });
    expect(pickInProgressEvent([flagged], NOW)).toBeNull();
  });

  test('declined and malformed events are skipped', () => {
    expect(pickInProgressEvent([ev(-5 * MIN, 25 * MIN, { id: 'no', response_status: 'declined' })], NOW)).toBeNull();
    const bad = { id: 'bad', title: 'x', start: 'not-a-date', end: 'also-bad' } as CalendarEvent;
    expect(pickInProgressEvent([bad], NOW)).toBeNull();
  });

  test('in-progress tie-break: the latest-starting overlapping event wins', () => {
    const early = ev(-30 * MIN, 30 * MIN, { id: 'early' });
    const later = ev(-5 * MIN, 25 * MIN, { id: 'later' });
    expect(pickInProgressEvent([early, later], NOW)?.id).toBe('later');
  });

  test('upcoming tie-break: the soonest-starting event wins', () => {
    const soon = ev(2 * MIN, 30 * MIN, { id: 'soon' });
    const later = ev(4 * MIN, 30 * MIN, { id: 'later' });
    expect(pickInProgressEvent([later, soon], NOW)?.id).toBe('soon');
  });

  test('recently-ended fallback: most-recently-ended within the floor wins when nothing is live or upcoming', () => {
    const endedEarlier = ev(-9 * MIN, -6 * MIN, { id: 'earlier' });
    const endedLater = ev(-8 * MIN, -3 * MIN, { id: 'later' });
    expect(pickInProgressEvent([endedEarlier, endedLater], NOW)?.id).toBe('later');
  });
});

import type { CalendarEvent } from '@/lib/ipc';

const EARLY_GRACE_MS = 5 * 60 * 1000;
const LATE_FLOOR_MS = 10 * 60 * 1000;

/**
 * Find the calendar event the user is most likely "in" right now. Mirrors
 * the backend's `pickCurrentCalendarEvent` in `app/main.js` so the hero
 * and the auto-detect-meeting notification agree on what counts as
 * "currently in a meeting":
 *
 *   - opens 5 min before the scheduled start (early-join grace)
 *   - closes at the scheduled end, OR 10 min after start, whichever is later
 *
 * Priority when multiple events match the window:
 *   1. Truly in-progress (now ∈ [start, end))   — latest-starting wins
 *   2. Upcoming (start > now)                   — soonest wins
 *   3. Recently ended but inside the late-floor — most recently ended wins
 *
 * All-day events are skipped (date-only `start` / `end` with no `T`
 * separator) — they span midnight to midnight and would falsely match
 * every recording all day.
 */
export function pickInProgressEvent(
  events: CalendarEvent[] | null | undefined,
  now: Date = new Date(),
): CalendarEvent | null {
  if (!events || events.length === 0) return null;

  const nowMs = now.getTime();
  type Candidate = { event: CalendarEvent; startMs: number; endMs: number };
  const candidates: Candidate[] = [];

  for (const e of events) {
    if (!e || typeof e.start !== 'string' || typeof e.end !== 'string') continue;
    if (!e.start.includes('T') || !e.end.includes('T')) continue;
    const startMs = new Date(e.start).getTime();
    const endMs = new Date(e.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const closesAt = Math.max(endMs, startMs + LATE_FLOOR_MS);
    if (nowMs >= startMs - EARLY_GRACE_MS && nowMs < closesAt) {
      candidates.push({ event: e, startMs, endMs });
    }
  }

  if (candidates.length === 0) return null;

  const inProgress = candidates.filter(
    (c) => c.startMs <= nowMs && nowMs < c.endMs,
  );
  if (inProgress.length > 0) {
    inProgress.sort((a, b) => b.startMs - a.startMs);
    return inProgress[0].event;
  }

  const upcoming = candidates.filter((c) => c.startMs > nowMs);
  if (upcoming.length > 0) {
    upcoming.sort((a, b) => a.startMs - b.startMs);
    return upcoming[0].event;
  }

  candidates.sort((a, b) => b.endMs - a.endMs);
  return candidates[0].event;
}

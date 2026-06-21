import type { Meeting } from '@/lib/ipc';

/**
 * Single source of truth for note search. Case-insensitive substring match
 * over title + summary, null-guarded so a missing name/summary can never throw
 * (the old folder filter did `name.toLowerCase()` unguarded — the most
 * plausible source of the "search is unresponsive" report in #213).
 *
 * Input order is preserved: callers pass the recency-ordered `useMeetings()`
 * list, so results stay newest-first. An empty/whitespace query returns [] —
 * callers decide what to show in that case (the palette shows recents).
 */
export function searchNotes(meetings: Meeting[], query: string): Meeting[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return meetings.filter((m) => {
    const name = m.session_info.name?.toLowerCase() ?? '';
    const summary = m.summary?.toLowerCase() ?? '';
    return name.includes(needle) || summary.includes(needle);
  });
}

/**
 * Short summary excerpt for a result row. Returns a window around the first
 * occurrence of the query in the summary (with ellipses), or the leading slice
 * when the match was title-only / there's no summary. Never throws on null.
 */
export function snippet(
  summary: string | null | undefined,
  query: string,
  radius = 40,
): string {
  const text = (summary ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const needle = query.trim().toLowerCase();
  const idx = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (idx === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// Shared helpers for the Chat tab + conversation view.

// Sentinel summaryFile that marks a chat session as belonging to the global
// Chat tab rather than any specific meeting. Stored on the session record so
// the Recents list can filter to chat-tab sessions and skip in-meeting
// AskBar history.
export const GLOBAL_SCOPE = '__global__';

export function deriveSessionName(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 40) + '…';
}

// Bucket label for grouped chat-history lists (matches the Granola
// History dropdown's "Today / Last 2 weeks / April" pattern). Returns a
// stable key (not localized) so consumers can sort/group; format the key
// with toBucketLabel() before display.
export function bucketKey(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();
  if (ts >= startOfDay) return 'today';
  // Day-difference comparisons. Subtracting fixed 24h offsets breaks across
  // DST boundaries (a Sunday morning shift means "yesterday" really started
  // 23h ago, not 24h), so step back by calendar day instead.
  const dayBefore = (n: number): number => {
    const t = new Date(today);
    t.setDate(t.getDate() - n);
    return t.getTime();
  };
  if (ts >= dayBefore(1)) return 'yesterday';
  if (ts >= dayBefore(7)) return 'this-week';
  if (ts >= dayBefore(14)) return 'last-2-weeks';
  // Same calendar month
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth()
  ) {
    return 'this-month';
  }
  // Same calendar year — return month name as the key
  if (d.getFullYear() === today.getFullYear()) {
    return `month-${d.getMonth()}`;
  }
  return `year-${d.getFullYear()}`;
}

export function toBucketLabel(key: string): string {
  if (key === 'today') return 'Today';
  if (key === 'yesterday') return 'Yesterday';
  if (key === 'this-week') return 'This week';
  if (key === 'last-2-weeks') return 'Last 2 weeks';
  if (key === 'this-month') return 'This month';
  if (key.startsWith('month-')) {
    const m = parseInt(key.slice(6), 10);
    return new Date(2000, m, 1).toLocaleString(undefined, { month: 'long' });
  }
  if (key.startsWith('year-')) return key.slice(5);
  return key;
}

export function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

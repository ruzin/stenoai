import * as React from 'react';
import { Calendar, PencilLine, RefreshCw, Search, Square, X } from 'lucide-react';
import { isMac, shortcut } from '@/lib/utils';
import { MeetingsShell } from '@/components/MeetingsShell';
import { UpcomingCard } from '@/components/home/UpcomingCard';
import { PreviousRow } from '@/components/home/PreviousRow';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/ui/app-icon';
import { KbdKey } from '@/components/ui/kbd';
import { useMeetings } from '@/hooks/useMeetings';
import { useRecording } from '@/hooks/useRecording';
import {
  useCalendarEvents,
  useGoogleCalendarAuth,
  useOutlookCalendarAuth,
} from '@/hooks/useCalendarEvents';
import { useFolders } from '@/hooks/useFolders';
import type { CalendarEvent, Meeting } from '@/lib/ipc';
import { navigate } from '@/lib/router';

interface HomeProps {
  mode: 'home' | 'meetings';
}

export function Home({ mode }: HomeProps) {
  const meetings = useMeetings();
  const folders = useFolders();
  const calendar = useCalendarEvents();
  const recording = useRecording();

  const emptyState = !meetings.data?.length;
  const isRecording = recording.status === 'recording' || recording.status === 'paused';
  // Empty-state CTA: idle or processing → start a new recording (auto-navigates;
  // previous note keeps processing in the background queue); recording/paused
  // → back to /recording.
  const onToggleRecording = () => {
    if (isRecording) {
      navigate('/recording');
    } else {
      void recording.startRecording();
    }
  };

  const folderName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders.data ?? []) map.set(f.id, f.name);
    return map;
  }, [folders.data]);

  // 60-second tick so the upcoming filter below re-evaluates and
  // events whose end time has passed roll off the list without
  // waiting for the next calendar refetch (which could be many
  // minutes). Minute precision is plenty — events are minute-grained
  // at best. Gated on `mode === 'home'` so the timer doesn't run on
  // /meetings where this widget isn't rendered.
  const [upcomingTickMs, setUpcomingTickMs] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (mode !== 'home') return;
    const id = setInterval(() => setUpcomingTickMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [mode]);

  // Today's relevant events: anything that overlaps with today AND
  // hasn't ended yet AND that the user is likely to attend. Includes
  // timed events for today and timed multi-day events (conference
  // sessions, calls spanning a day boundary) that started in the past
  // but are still ongoing — those are useful context the user might
  // want to glance at. All-day blocks (OOO, conference day) and declined
  // meetings are dropped — they crowd real meetings off the visible page.
  const upcomingToday = React.useMemo<CalendarEvent[]>(() => {
    if (!calendar.data || calendar.data.needsAuth) return [];
    // Use the tick as the time source so the memo is a pure function of
    // its deps (same inputs → same output) — rather than reading
    // Date.now() inside, which would leave upcomingTickMs as an
    // ostensibly-unused dep used only to trigger re-runs. 60s
    // staleness is well within tolerance for "has this event ended."
    const now = new Date(upcomingTickMs);
    const todayY = now.getFullYear();
    const todayM = now.getMonth();
    const todayD = now.getDate();
    // 00:00 tomorrow — events that start at or after this aren't "today."
    const startOfTomorrow = new Date(todayY, todayM, todayD + 1).getTime();
    const nowMs = now.getTime();
    return calendar.data.events
      .filter((e) => {
        const start = new Date(e.start).getTime();
        const end = new Date(e.end).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) return false;
        // Event must end after now (not in the past).
        if (end <= nowMs) return false;
        // Event must start before end-of-today (so it overlaps today).
        if (start >= startOfTomorrow) return false;
        // All-day blocks pose as 00:00 "meetings" and crowd out real ones.
        if (e.is_all_day === true) return false;
        // Declined: user said no — don't surface or auto-act on it.
        if (e.response_status === 'declined') return false;
        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [calendar.data, upcomingTickMs]);

  // First event of tomorrow that the user is likely to attend. Used for
  // the "Tomorrow peek" when today's carousel is empty — keeps the panel
  // useful at 6pm with a clear evening, instead of disappearing.
  const tomorrowPreview = React.useMemo<CalendarEvent | null>(() => {
    if (!calendar.data || calendar.data.needsAuth) return null;
    const now = new Date(upcomingTickMs);
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    const startOfDayAfter = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 2,
    ).getTime();
    const candidates = calendar.data.events
      .filter((e) => {
        const start = new Date(e.start).getTime();
        if (Number.isNaN(start)) return false;
        if (start < startOfTomorrow) return false;
        if (start >= startOfDayAfter) return false;
        if (e.is_all_day === true) return false;
        if (e.response_status === 'declined') return false;
        return true;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return candidates[0] || null;
  }, [calendar.data, upcomingTickMs]);

  // All-day events overlapping today that the user hasn't declined. Rendered
  // as a small clickable chip row so the user can see "OOO" / "Conference
  // Day" without these blocks crowding the timed carousel — and can click
  // a chip to record against that event's title.
  const allDayToday = React.useMemo<CalendarEvent[]>(() => {
    if (!calendar.data || calendar.data.needsAuth) return [];
    const now = new Date(upcomingTickMs);
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    return calendar.data.events.filter((e) => {
      if (e.is_all_day !== true) return false;
      if (e.response_status === 'declined') return false;
      const start = new Date(e.start).getTime();
      const end = new Date(e.end).getTime();
      if (Number.isNaN(start) || Number.isNaN(end)) return false;
      // Overlaps with today's local window.
      return start < startOfTomorrow && end > startOfToday;
    });
  }, [calendar.data, upcomingTickMs]);

  // Same gating as Home's empty-state CTA and UpcomingCard's onStart:
  // block only when actively recording; 'processing' is fine — the
  // previous note keeps summarising in the background queue while a
  // new recording starts.
  const canStartNewRecording =
    recording.status !== 'recording' && recording.status !== 'paused';
  const onStartAllDay = (title: string) => {
    if (!canStartNewRecording) return;
    void recording.startRecording(title);
  };
  const [allDayExpanded, setAllDayExpanded] = React.useState(false);

  const previous = meetings.data ?? [];

  // Search applies only to /meetings (the All meetings list). Home keeps the
  // unfiltered Previous list since it's already chronologically grouped.
  const [search, setSearch] = React.useState('');
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const filtered = React.useMemo(() => {
    if (mode !== 'meetings') return previous;
    const needle = search.trim().toLowerCase();
    if (!needle) return previous;
    return previous.filter((m) => {
      const name = m.session_info.name?.toLowerCase() ?? '';
      const summary = m.summary?.toLowerCase() ?? '';
      return name.includes(needle) || summary.includes(needle);
    });
  }, [mode, previous, search]);
  const groups = React.useMemo(() => groupPrevious(filtered), [filtered]);

  // Calendar-connect nudge: most new users don't realise StenoAI can
  // surface their meetings until something tells them. Show a small
  // dismissible line on Home when calendar is unconnected; persist the
  // dismissal in localStorage so we don't nag the same person twice.
  const NUDGE_KEY = 'home.calendarNudge.dismissed';
  const [calendarNudgeDismissed, setCalendarNudgeDismissed] =
    React.useState<boolean>(() => {
      try {
        return localStorage.getItem(NUDGE_KEY) === 'true';
      } catch {
        return false;
      }
    });
  const onDismissCalendarNudge = () => {
    try {
      localStorage.setItem(NUDGE_KEY, 'true');
    } catch {
      // Private mode / quota errors — just hide locally for this session.
    }
    setCalendarNudgeDismissed(true);
  };
  const showCalendarNudge =
    mode === 'home' &&
    calendar.data?.needsAuth === true &&
    !calendarNudgeDismissed;

  // Inline provider picker for the nudge. Collapsed by default — clicking
  // the message expands it to surface Google / Outlook buttons right
  // where the user is, so we don't make them hunt through Settings.
  const [calendarNudgeExpanded, setCalendarNudgeExpanded] =
    React.useState<boolean>(false);
  const googleAuth = useGoogleCalendarAuth();
  const outlookAuth = useOutlookCalendarAuth();

  // Rendered both in the empty-state Welcome screen (brand-new users with
  // zero meetings — exactly who needs to discover calendar integration)
  // and in the regular Home above the Upcoming section. Extracted here
  // so both branches use the same JSX instead of drifting.
  const calendarNudge = showCalendarNudge ? (
    <div
      className="flex items-center gap-2 text-xs"
      style={{ color: 'var(--fg-2)' }}
    >
      {!calendarNudgeExpanded ? (
        <button
          type="button"
          onClick={() => setCalendarNudgeExpanded(true)}
          className="-mx-1 flex flex-1 items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{ color: 'var(--fg-2)' }}
        >
          <Calendar className="size-3.5 flex-shrink-0" />
          <span>Connect a calendar to see today's meetings.</span>
        </button>
      ) : (
        <>
          <Calendar
            className="size-3.5 flex-shrink-0"
            style={{ color: 'var(--fg-2)' }}
          />
          <span>Connect:</span>
          <button
            type="button"
            onClick={() => googleAuth.connect.mutate()}
            disabled={
              googleAuth.connect.isPending || outlookAuth.connect.isPending
            }
            className="rounded px-2 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
            style={{ color: 'var(--fg-1)' }}
          >
            {googleAuth.connect.isPending ? 'Connecting…' : 'Google'}
          </button>
          <button
            type="button"
            onClick={() => outlookAuth.connect.mutate()}
            disabled={
              googleAuth.connect.isPending || outlookAuth.connect.isPending
            }
            className="rounded px-2 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
            style={{ color: 'var(--fg-1)' }}
          >
            {outlookAuth.connect.isPending ? 'Connecting…' : 'Outlook'}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onDismissCalendarNudge}
        aria-label="Dismiss"
        title="Dismiss"
        className="ml-auto rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: 'var(--fg-2)' }}
      >
        <X className="size-3" />
      </button>
    </div>
  ) : null;

  const greeting = `Ready to capture beautiful notes`;
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <MeetingsShell
      activeSummaryFile={null}
      contentAlign={emptyState && mode === 'home' ? 'center' : 'top'}
    >
      {meetings.isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center text-[color:var(--fg-2)]">
          Loading meetings…
        </div>
      ) : emptyState ? (
        <div className="flex flex-col items-center gap-8 text-center">
          <AppIcon size={56} />
          <div className="space-y-3">
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 44,
                lineHeight: 1.1,
                letterSpacing: '-0.025em',
                color: 'var(--fg-1)',
              }}
            >
              Welcome to StenoAI.
            </h1>
            <p
              className="text-[17px] leading-[1.55]"
              style={{ color: 'var(--fg-2)' }}
            >
              Capture your first meeting — transcription and summaries happen
              locally on your device.
            </p>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              Always get consent when transcribing others.
            </p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <Button
              variant={isRecording ? 'destructive' : 'default'}
              onClick={onToggleRecording}
              className="gap-2"
            >
              {isRecording ? <Square className="size-4" /> : <PencilLine className="size-4" />}
              {isRecording ? 'Stop recording' : 'New note'}
            </Button>
            <p
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--fg-muted)' }}
            >
              <span>Quick start:</span>
              <KbdKey>{isMac ? '⌘' : 'Ctrl'}</KbdKey>
              <KbdKey>{isMac ? '⇧' : 'Shift'}</KbdKey>
              <KbdKey>R</KbdKey>
              <span>from anywhere</span>
            </p>
          </div>
          {calendarNudge && (
            <div className="w-full max-w-[420px]">{calendarNudge}</div>
          )}
        </div>
      ) : (
        <>
          {mode === 'home' && (
            <div className="mb-10">
              <div className="mb-1.5 flex items-end justify-between gap-6">
                <h1 className="home-hello">
                  {greeting}
                  <span className="faint">.</span>
                </h1>
                <div
                  className="pb-2 text-[13px] tabular-nums"
                  style={{ color: 'var(--fg-2)' }}
                >
                  {dateStr}
                </div>
              </div>
              <p
                className="max-w-[52ch] text-sm leading-[1.55]"
                style={{ color: 'var(--fg-2)' }}
              >
                {`Start recording from the top-right, or from anywhere with ${shortcut('⌘⇧R', 'Ctrl+Shift+R')}.`}
              </p>
            </div>
          )}

          {calendarNudge && <div className="mb-8">{calendarNudge}</div>}

          {upcomingToday.length > 0 && mode === 'home' && (
            <section className="mb-10">
              <SectionHead
                title="Upcoming"
                count={upcomingToday.length}
                action={
                  <button
                    type="button"
                    className="inline-flex items-center rounded p-1 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                    title="Check for new calendar events"
                    onClick={() => calendar.refetch()}
                    disabled={calendar.isFetching}
                    style={{ color: 'var(--fg-2)' }}
                  >
                    <RefreshCw className={`size-[14px] ${calendar.isFetching ? 'animate-spin' : ''}`} />
                  </button>
                }
              />
              <AllDayInline
                events={allDayToday}
                expanded={allDayExpanded}
                onToggle={() => setAllDayExpanded((v) => !v)}
                onStart={onStartAllDay}
                canStart={canStartNewRecording}
              />
              <div className="flex flex-col gap-2">
                {upcomingToday.map((event) => (
                  <UpcomingCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          {upcomingToday.length === 0 && tomorrowPreview && mode === 'home' && (
            <section className="mb-10">
              <SectionHead title="Tomorrow" count={1} />
              <AllDayInline
                events={allDayToday}
                expanded={allDayExpanded}
                onToggle={() => setAllDayExpanded((v) => !v)}
                onStart={onStartAllDay}
                canStart={canStartNewRecording}
              />
              <div className="flex flex-col gap-2">
                <UpcomingCard event={tomorrowPreview} />
              </div>
            </section>
          )}

          {upcomingToday.length === 0 && !tomorrowPreview && allDayToday.length > 0 && mode === 'home' && (
            <section className="mb-10">
              <SectionHead title="Today" count={allDayToday.length} />
              <AllDayInline
                events={allDayToday}
                expanded={allDayExpanded}
                onToggle={() => setAllDayExpanded((v) => !v)}
                onStart={onStartAllDay}
                canStart={canStartNewRecording}
              />
            </section>
          )}

          <section>
            <SectionHead
              title={mode === 'meetings' ? 'All notes' : 'Previous'}
              count={mode === 'meetings' ? filtered.length : previous.length}
              action={
                mode === 'meetings' ? (
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-[12px]"
                      style={{ color: 'var(--fg-muted)' }}
                    />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search notes"
                      aria-label="Search notes"
                      className="h-[26px] w-[180px] rounded-md border-0 pl-7 pr-7 text-[12.5px] outline-none transition-colors focus:shadow-[inset_0_0_0_1px_hsl(var(--border))]"
                      style={{
                        background: 'rgba(27,27,25,0.04)',
                        color: 'var(--fg-1)',
                        fontFamily: 'var(--font-sans)',
                      }}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          searchInputRef.current?.focus();
                        }}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex size-4 items-center justify-center rounded transition-colors hover:bg-[color:var(--surface-hover)]"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        <X className="size-[11px]" />
                      </button>
                    )}
                  </div>
                ) : undefined
              }
            />
            {groups.length === 0 && mode === 'meetings' && search.trim() ? (
              <div
                className="px-6 py-12 text-center text-[13px]"
                style={{ color: 'var(--fg-2)' }}
              >
                No meetings match &ldquo;{search.trim()}&rdquo;.
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.label}>
                  <div
                    className="pb-2 pt-4 text-[11.5px] font-medium tracking-[0.02em]"
                    style={{ color: 'var(--fg-2)' }}
                  >
                    {g.label}
                  </div>
                  <div>
                    {g.items.map((m) => (
                      <PreviousRow
                        key={m.session_info.summary_file}
                        meeting={m}
                        folderName={firstFolderName(m, folderName)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </MeetingsShell>
  );
}

interface SectionHeadProps {
  title: string;
  count: number;
  action?: React.ReactNode;
}

function SectionHead({ title, count, action }: SectionHeadProps) {
  return (
    <div
      className="mb-3.5 flex items-baseline justify-between pb-2.5"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-baseline gap-2.5">
        <h2
          className="text-sm font-medium tracking-[-0.005em]"
          style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
        >
          {title}
        </h2>
        <span
          className="text-[12.5px] tabular-nums"
          style={{ color: 'var(--fg-muted)' }}
        >
          {count}
        </span>
      </div>
      {action}
    </div>
  );
}


interface AllDayInlineProps {
  events: CalendarEvent[];
  expanded: boolean;
  onToggle: () => void;
  onStart: (title: string) => void;
  /** Permission to start a new recording — true when idle OR processing
   *  (a previous note still summarising in the background queue doesn't
   *  block a new recording). False only when a recording is actively
   *  in progress (recording / paused). */
  canStart: boolean;
}

function AllDayInline({
  events,
  expanded,
  onToggle,
  onStart,
  canStart,
}: AllDayInlineProps) {
  if (events.length === 0) return null;
  return (
    <div
      className="mb-2 flex flex-col gap-1 text-xs"
      style={{ color: 'var(--fg-2)' }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="-mx-1 self-start rounded px-1 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)]"
      >
        + {events.length} all-day event{events.length === 1 ? '' : 's'} today
      </button>
      {expanded && (
        <div className="flex flex-col items-start gap-0.5 pl-3">
          {events.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onStart(e.title)}
              disabled={!canStart}
              title={`Start recording: ${e.title}`}
              className="-mx-1 rounded px-1 py-0.5 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
              style={{ color: 'var(--fg-1)' }}
            >
              {e.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function firstFolderName(
  m: Meeting,
  folderName: Map<string, string>,
): string | undefined {
  const id = m.folders?.[0] ?? m.session_info.folders?.[0];
  if (!id) return undefined;
  return folderName.get(id);
}

interface Group {
  label: string;
  items: Meeting[];
}

function groupPrevious(meetings: Meeting[]): Group[] {
  const groups: Record<string, Meeting[]> = {};
  const order: string[] = [];
  const now = new Date();
  const sorted = [...meetings].sort((a, b) => {
    const ta = new Date(a.session_info.processed_at ?? a.session_info.updated_at ?? 0).getTime();
    const tb = new Date(b.session_info.processed_at ?? b.session_info.updated_at ?? 0).getTime();
    return tb - ta;
  });
  for (const m of sorted) {
    const raw = m.session_info.processed_at ?? m.session_info.updated_at;
    const label = raw ? groupLabel(new Date(raw), now) : 'Earlier';
    if (!groups[label]) {
      groups[label] = [];
      order.push(label);
    }
    groups[label].push(m);
  }
  return order.map((label) => ({ label, items: groups[label] }));
}

function groupLabel(d: Date, now: Date): string {
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const age = now.getTime() - d.getTime();
  if (age < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

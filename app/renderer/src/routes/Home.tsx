import * as React from 'react';
import { Filter, Mic, RefreshCw, Square } from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { UpcomingCard } from '@/components/home/UpcomingCard';
import { PreviousRow } from '@/components/home/PreviousRow';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/ui/app-icon';
import { KbdKey } from '@/components/ui/kbd';
import { useMeetings } from '@/hooks/useMeetings';
import { useRecording } from '@/hooks/useRecording';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useFolders } from '@/hooks/useFolders';
import type { Meeting } from '@/lib/ipc';
import { shortcut } from '@/lib/utils';
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
  // Empty-state CTA: idle → start (auto-navigates); recording/paused → back to /recording.
  const onToggleRecording = () => {
    if (recording.status === 'idle') {
      void recording.startRecording();
    } else if (isRecording) {
      navigate('/recording');
    }
  };

  const folderName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders.data ?? []) map.set(f.id, f.name);
    return map;
  }, [folders.data]);

  const upcoming =
    calendar.data && !calendar.data.needsAuth ? calendar.data.events.slice(0, 3) : [];

  const previous = meetings.data ?? [];
  const groups = React.useMemo(() => groupPrevious(previous), [previous]);

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
              locally on your Mac.
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
              {isRecording ? <Square className="size-4" /> : <Mic className="size-4" />}
              {isRecording ? 'Stop recording' : 'Start recording'}
            </Button>
            <p
              className="flex items-center gap-1.5 text-xs"
              style={{ color: 'var(--fg-muted)' }}
            >
              <span>Quick start:</span>
              <KbdKey>⌘</KbdKey>
              <KbdKey>⇧</KbdKey>
              <KbdKey>R</KbdKey>
              <span>from anywhere</span>
            </p>
          </div>
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
                {summaryLine(upcoming.length)}
              </p>
            </div>
          )}

          {upcoming.length > 0 && mode === 'home' && (
            <section className="mb-10">
              <SectionHead
                title="Upcoming"
                count={upcoming.length}
                action={
                  <button
                    type="button"
                    className="inline-flex items-center rounded p-0.5 transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                    title="Check for new calendar events"
                    onClick={() => calendar.refetch()}
                    disabled={calendar.isFetching}
                    style={{ color: 'var(--fg-2)' }}
                  >
                    <RefreshCw className={`size-3 ${calendar.isFetching ? 'animate-spin' : ''}`} />
                  </button>
                }
              />
              <div className="flex flex-col gap-2">
                {upcoming.map((event) => (
                  <UpcomingCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionHead
              title={mode === 'meetings' ? 'All meetings' : 'Previous'}
              count={previous.length}
              action={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12.5px] transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{ color: 'var(--fg-2)' }}
                >
                  <Filter className="size-3" />
                  Filter
                </button>
              }
            />
            {groups.map((g) => (
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
            ))}
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

function summaryLine(_upcomingCount: number): string {
  return `Start recording from the top-right, or from anywhere with ${shortcut('⌘⇧R', 'Ctrl+Shift+R')}.`;
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

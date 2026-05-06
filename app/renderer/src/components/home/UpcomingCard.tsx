import * as React from 'react';
import { Video } from 'lucide-react';
import type { CalendarEvent } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useRecording } from '@/hooks/useRecording';

interface UpcomingCardProps {
  event: CalendarEvent;
}

export function UpcomingCard({ event }: UpcomingCardProps) {
  const relative = relativeLabel(event.start);
  const { dayLabel, clock, end } = formatStartEnd(event.start, event.end);
  const meetingUrl = event.meeting_url?.trim();
  const recording = useRecording();

  // Click the card → start a new recording titled after this event. The
  // event title becomes the note's session name (instead of the auto
  // 'Note' placeholder), so the AI rename step skips it and the user
  // gets the meeting they expected. Doesn't open the join URL — the
  // Join / Start now buttons on the right own that action.
  const onStart = () => {
    if (recording.status !== 'idle') return;
    void recording.startRecording(event.title);
  };

  // Open the meeting URL externally. Used by the inner Join button only.
  const onJoin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!meetingUrl) return;
    void ipc().shell.openExternal(meetingUrl);
  };

  // Start recording AND open the URL — used by the urgent "Start now"
  // button when the meeting is imminent.
  const onStartAndJoin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStart();
    if (meetingUrl) void ipc().shell.openExternal(meetingUrl);
  };

  return (
    <div
      className={cn('upcoming-card', relative.urgent && 'upcoming-card-live')}
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStart();
        }
      }}
    >
      {/* Relative time block */}
      <div
        className={cn(
          'flex flex-col items-start gap-0 border-r pr-4',
          relative.urgent && 'text-[color:var(--fg-1)]',
        )}
        style={{ borderRightColor: 'var(--border-subtle)' }}
      >
        {relative.prefix && (
          <span
            className="text-[11px] font-medium tracking-[0.01em] lowercase"
            style={{ color: relative.urgent ? 'var(--fg-1)' : 'var(--fg-2)', opacity: relative.urgent ? 0.7 : 1 }}
          >
            {relative.prefix}
          </span>
        )}
        <span
          className="whitespace-nowrap text-sm font-semibold leading-[1.2] tracking-[-0.01em]"
          style={{ color: 'var(--fg-1)' }}
        >
          {relative.value}
        </span>
      </div>

      {/* Meta + title */}
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--fg-2)' }}
        >
          <span className="font-medium">{dayLabel}</span>
          <span className="opacity-40">·</span>
          <span className="tabular-nums">
            {end ? `${clock} – ${end}` : clock}
          </span>
        </div>
        <div
          className="truncate text-sm font-medium tracking-[-0.005em]"
          style={{ color: 'var(--fg-1)' }}
        >
          {event.title}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        {meetingUrl ? (
          relative.urgent ? (
            <button
              type="button"
              onClick={onStartAndJoin}
              className="inline-flex h-7 items-center gap-[7px] rounded-full px-3 text-xs font-medium"
              style={{
                background: 'var(--fg-1)',
                color: 'var(--primary-fg)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <span
                className="size-[7px] rounded-full"
                style={{
                  background: 'var(--recording)',
                  animation: 'record-pulse 1.6s ease-out infinite',
                }}
              />
              Start now
            </button>
          ) : (
            <button
              type="button"
              onClick={onJoin}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors"
              style={{
                background: 'var(--surface-hover)',
                color: 'var(--fg-1)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <Video className="size-[13px]" />
              Join
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}

function relativeLabel(startIso: string): { prefix: string | null; value: string; urgent: boolean } {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { prefix: null, value: '—', urgent: false };
  const diffMs = start.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins <= 0) return { prefix: null, value: 'Now', urgent: true };
  if (diffMins < 60) return { prefix: 'In', value: `${diffMins} mins`, urgent: diffMins <= 15 };
  const hrs = Math.round(diffMins / 60);
  if (hrs < 24) return { prefix: 'In', value: `${hrs} hrs`, urgent: false };
  const days = Math.round(hrs / 24);
  return { prefix: 'In', value: `${days} day${days === 1 ? '' : 's'}`, urgent: false };
}

function formatStartEnd(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const dayLabel = sameDay(start, now)
    ? 'Today'
    : sameDay(start, tomorrow)
      ? 'Tomorrow'
      : start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const pad = (n: number) => n.toString().padStart(2, '0');
  const clock = Number.isNaN(start.getTime())
    ? ''
    : `${pad(start.getHours())}:${pad(start.getMinutes())}`;

  const endDate = endIso ? new Date(endIso) : null;
  const endClock =
    endDate && !Number.isNaN(endDate.getTime())
      ? `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`
      : null;

  return { dayLabel, clock, end: endClock };
}

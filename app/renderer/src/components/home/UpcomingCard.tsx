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
  const meta = formatMeta(event.start, event.end, relative.state);
  const meetingUrl = event.meeting_url?.trim();
  const recording = useRecording();
  const isLive = relative.state === 'now';
  const urgent = relative.urgent || isLive;

  const onStart = () => {
    if (recording.status !== 'idle') return;
    void recording.startRecording(event.title);
  };

  const onJoin = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!meetingUrl) return;
    void ipc().shell.openExternal(meetingUrl);
  };

  const onStartAndJoin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStart();
    if (meetingUrl) void ipc().shell.openExternal(meetingUrl);
  };

  return (
    <div
      className={cn('upcoming-card', urgent && 'upcoming-card-live')}
      role="button"
      tabIndex={0}
      onClick={onStart}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
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
          urgent && 'text-[color:var(--fg-1)]',
        )}
        style={{ borderRightColor: 'var(--border-subtle)' }}
      >
        {relative.prefix && (
          <span
            className="text-[11px] font-medium tracking-[0.01em] lowercase"
            style={{ color: urgent ? 'var(--fg-1)' : 'var(--fg-2)', opacity: urgent ? 0.7 : 1 }}
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

      {/* Title first (most prominent), then meta below — title is what
          the user is scanning for; date/time is supporting context. */}
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div
          className="truncate text-sm font-semibold tracking-[-0.005em]"
          style={{ color: 'var(--fg-1)' }}
        >
          {event.title}
        </div>
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--fg-2)' }}
        >
          <span className="font-medium">{meta.primary}</span>
          {meta.timeRange && (
            <>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">{meta.timeRange}</span>
            </>
          )}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-shrink-0 flex-col items-end gap-2">
        {meetingUrl ? (
          urgent ? (
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

type RelativeState = 'now' | 'soon' | 'later';

function relativeLabel(startIso: string): {
  prefix: string | null;
  value: string;
  urgent: boolean;
  state: RelativeState;
} {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime()))
    return { prefix: null, value: '—', urgent: false, state: 'later' };
  const diffMs = start.getTime() - Date.now();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins <= 0) return { prefix: null, value: 'Now', urgent: true, state: 'now' };
  if (diffMins < 60)
    return {
      prefix: 'In',
      value: `${diffMins} min${diffMins === 1 ? '' : 's'}`,
      urgent: diffMins <= 15,
      state: diffMins <= 15 ? 'soon' : 'later',
    };
  const hrs = Math.round(diffMins / 60);
  if (hrs < 24)
    return {
      prefix: 'In',
      value: `${hrs} hr${hrs === 1 ? '' : 's'}`,
      urgent: false,
      state: 'later',
    };
  const days = Math.round(hrs / 24);
  return {
    prefix: 'In',
    value: `${days} day${days === 1 ? '' : 's'}`,
    urgent: false,
    state: 'later',
  };
}

// Locale-aware time formatter — inherits the user's system locale, so
// US users get "11:30 PM" and EU users get "23:30" without a setting.
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function formatMeta(
  startIso: string,
  endIso: string,
  state: RelativeState,
): { primary: string; timeRange: string } {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  // For in-progress events, the absolute day ("Today" / "Fri 5 Jun") is
  // noise — what the user actually wants to know is how this meeting maps
  // to the present moment. Surface either the soft deadline ("Ends in 8
  // min" prompts you to wrap up) or progress so far ("Started 30 min ago"
  // for context on what they walked into).
  let primary: string;
  if (state === 'now' && end && !Number.isNaN(end.getTime())) {
    const endsInMins = Math.round((end.getTime() - Date.now()) / 60000);
    if (endsInMins > 0 && endsInMins <= 15) {
      primary = `Ends in ${endsInMins} min${endsInMins === 1 ? '' : 's'}`;
    } else {
      const startedAgoMins = Math.max(
        0,
        Math.round((Date.now() - start.getTime()) / 60000),
      );
      primary =
        startedAgoMins === 0
          ? 'Just started'
          : `Started ${startedAgoMins} min${startedAgoMins === 1 ? '' : 's'} ago`;
    }
  } else if (sameDay(start, now)) {
    primary = 'Today';
  } else if (sameDay(start, tomorrow)) {
    primary = 'Tomorrow';
  } else {
    primary = start.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  const clock = Number.isNaN(start.getTime()) ? '' : TIME_FMT.format(start);
  const endClock =
    end && !Number.isNaN(end.getTime()) ? TIME_FMT.format(end) : '';
  const timeRange = endClock ? `${clock} – ${endClock}` : clock;

  return { primary, timeRange };
}

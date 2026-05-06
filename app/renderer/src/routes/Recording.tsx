import * as React from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  Clock,
  FolderPlus,
  PencilLine,
} from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { useNavigate } from '@/lib/router';
import { useRecording } from '@/hooks/useRecording';
import { useLiveMeeting } from '@/hooks/useLiveMeeting';

export function Recording() {
  const navigate = useNavigate();
  const recording = useRecording();
  const live = useLiveMeeting();

  // If we land on /recording with no active recording (e.g. cold reload after
  // it stopped), bounce back home so we don't leave the user on a dead page.
  // Status 'processing' is handled by the global listener which redirects to
  // /meetings/processing.
  React.useEffect(() => {
    if (!recording.isLoading && !live.active && recording.status !== 'processing') {
      navigate('/');
    }
  }, [recording.isLoading, live.active, recording.status, navigate]);

  const startedAt = live.startedAt ?? new Date();

  return (
    <MeetingsShell activeSummaryFile={null} hideToolbar>
      <div
        data-testid="recording-page"
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--page)' }}
      >
        <div className="scrollbar-clean min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-12 pb-40 pt-8">
            <header className="mb-8">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mb-6 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent text-[13px] transition-colors hover:text-[color:var(--fg-1)]"
                style={{ color: 'var(--fg-2)' }}
                aria-label="Back to home"
              >
                <ChevronLeft size={15} />
                Home
              </button>

              <EditableTitle
                value={live.title}
                onChange={live.setTitle}
                placeholder="New note"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Chip icon={<CalendarIcon size={11} />}>
                  {formatDate(startedAt)}
                </Chip>
                <Chip icon={<Clock size={11} />}>
                  Started {formatTime(startedAt)}
                </Chip>
                <Chip icon={<FolderPlus size={11} />} dashed>
                  Add to folder
                </Chip>
              </div>
            </header>

            <section>
              <div
                className="mb-2 inline-flex items-center gap-1.5 text-[13px]"
                style={{ color: 'var(--fg-2)' }}
              >
                <PencilLine size={13} />
                My notes
              </div>
              <textarea
                value={live.notes}
                onChange={(e) => live.setNotes(e.target.value)}
                placeholder="Type anything you want to capture — decisions, questions, follow-ups. Steno handles the transcript."
                spellCheck
                className="block w-full resize-none border-0 bg-transparent text-[15px] outline-none"
                style={{
                  color: 'var(--fg-1)',
                  fontFamily: 'var(--font-sans)',
                  lineHeight: 1.6,
                  minHeight: 320,
                }}
              />
            </section>
          </div>
        </div>
      </div>
    </MeetingsShell>
  );
}

interface EditableTitleProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

function EditableTitle({ value, onChange, placeholder }: EditableTitleProps) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full border-0 bg-transparent p-0 text-[34px] outline-none"
      style={{
        fontFamily: 'var(--font-serif)',
        letterSpacing: '-0.02em',
        color: 'var(--fg-1)',
        lineHeight: 1.15,
      }}
    />
  );
}

function Chip({
  icon,
  children,
  dashed = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
      style={{
        color: 'var(--fg-2)',
        border: dashed
          ? '1px dashed var(--border-subtle)'
          : '1px solid var(--border-subtle)',
        background: dashed ? 'transparent' : 'var(--surface-raised)',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

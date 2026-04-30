import * as React from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  Clock,
  Loader2,
  PencilLine,
} from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { useNavigate } from '@/lib/router';
import { useRecording } from '@/hooks/useRecording';
import { useUpdateMeeting } from '@/hooks/useMeetings';
import { getLiveDraft, useLiveDraftStore } from '@/hooks/liveDraftStore';
import { ipc } from '@/lib/ipc';

type ProcessingStage = 'transcribing' | 'summarizing' | 'finalizing' | 'error';

const STAGE_LABEL: Record<ProcessingStage, string> = {
  transcribing: 'Analyzing transcript',
  summarizing: 'Generating notes',
  finalizing: 'Almost done…',
  error: 'Couldn’t process this recording.',
};

export function Processing() {
  const navigate = useNavigate();
  const recording = useRecording();
  const updateMeeting = useUpdateMeeting();

  // Capture sessionName when we arrive on this route. The backend clears
  // currentRecordingSessionName once processing-complete fires; we also need
  // to remember it for the brief moment between stop and the queue catching up.
  const [activeSession, setActiveSession] = React.useState<string | null>(
    () => recording.sessionName,
  );
  React.useEffect(() => {
    if (recording.sessionName && recording.sessionName !== activeSession) {
      setActiveSession(recording.sessionName);
    }
  }, [recording.sessionName, activeSession]);

  const draft = useLiveDraftStore((s) =>
    activeSession ? s.drafts[activeSession] : undefined,
  );
  const startedAt = draft ? new Date(draft.startedAtMs) : null;
  const totalElapsedSeconds = startedAt
    ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000))
    : 0;

  const [stage, setStage] = React.useState<ProcessingStage>('transcribing');
  const [streamText, setStreamText] = React.useState('');
  const [streamedTitle, setStreamedTitle] = React.useState<string | null>(null);

  React.useEffect(() => {
    const offs = [
      ipc().on.summaryChunk((e) => {
        if (activeSession && e.sessionName !== activeSession) return;
        setStreamText((t) => t + e.chunk);
        setStage((s) => (s === 'transcribing' ? 'summarizing' : s));
      }),
      ipc().on.summaryTitle((e) => {
        if (activeSession && e.sessionName !== activeSession) return;
        setStreamedTitle(e.title);
      }),
      ipc().on.summaryComplete((e) => {
        if (activeSession && e.sessionName !== activeSession) return;
        setStage((s) => (s === 'error' ? s : 'finalizing'));
      }),
      ipc().on.processingComplete((e) => {
        if (activeSession && e.sessionName !== activeSession) return;
        if (!e.success) {
          setStage('error');
          return;
        }
        // Apply title rename if user edited the draft. The global useRecording
        // listener handles navigation to /meetings/<final>.
        const d = getLiveDraft(e.sessionName);
        const summaryFile = e.meetingData?.session_info.summary_file;
        if (summaryFile && d?.title && d.title !== e.sessionName) {
          updateMeeting.mutate({
            summaryFile,
            patch: { name: d.title },
          });
        }
      }),
    ];
    return () => offs.forEach((fn) => fn());
  }, [activeSession, updateMeeting]);

  const displayTitle =
    streamedTitle ?? draft?.title ?? activeSession ?? 'Meeting';

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto w-full max-w-[760px]">
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

          <h1
            className="m-0 text-[34px] transition-colors"
            style={{
              fontFamily: 'var(--font-serif)',
              letterSpacing: '-0.02em',
              color: 'var(--fg-1)',
              lineHeight: 1.15,
              fontWeight: 400,
            }}
          >
            {displayTitle}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {startedAt && (
              <Chip icon={<CalendarIcon size={11} />}>
                {formatDate(startedAt)}
              </Chip>
            )}
            <Chip icon={<Clock size={11} />}>
              {formatDurationEnglish(totalElapsedSeconds)}
            </Chip>
            <ProcessingChip />
          </div>
        </header>

        {stage === 'error' ? (
          <ErrorPanel onRetry={() => setStage('transcribing')} />
        ) : (
          <StageCard stage={stage} streamText={streamText} />
        )}

        {draft?.notes && (
          <section className="mt-8">
            <div
              className="mb-2 inline-flex items-center gap-1.5 text-[13px]"
              style={{ color: 'var(--fg-2)' }}
            >
              <PencilLine size={13} />
              My notes
            </div>
            <div
              className="whitespace-pre-wrap text-[15px]"
              style={{
                color: 'var(--fg-1)',
                fontFamily: 'var(--font-sans)',
                lineHeight: 1.6,
              }}
            >
              {draft.notes}
            </div>
          </section>
        )}
      </div>
    </MeetingsShell>
  );
}

function StageCard({
  stage,
  streamText,
}: {
  stage: ProcessingStage;
  streamText: string;
}) {
  return (
    <div className="relative" style={{ maxWidth: '72ch' }}>
      {streamText && (
        <div
          className="mb-3 whitespace-pre-wrap text-[15px]"
          style={{
            color: 'var(--fg-1)',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.6,
          }}
        >
          {streamText}
        </div>
      )}

      {/* Scanner bar — rides at the bottom of streamed text, slides down as
          more tokens arrive, matching the legacy generation-scanner. */}
      <div
        className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-md)',
          transition: 'all 0.45s cubic-bezier(0.33, 1, 0.68, 1)',
        }}
      >
        <Loader2
          className="animate-spin"
          size={14}
          style={{ color: 'var(--fg-2)' }}
        />
        <span
          className="text-[13px] transition-colors"
          style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </div>
    </div>
  );
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="py-3">
      <p
        className="text-[17px]"
        style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
      >
        {STAGE_LABEL.error}
      </p>
      <p
        className="mt-1 text-[14px]"
        style={{ color: 'var(--fg-2)' }}
      >
        Try again, or reprocess the recording from the meeting list once it
        appears.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-[8px] border-0 px-4 text-[14px] font-medium"
        style={{
          background: 'var(--fg-1)',
          color: 'var(--fg-inverse)',
        }}
      >
        Try again
      </button>
    </div>
  );
}

function ProcessingChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 text-[12px]"
      style={{
        color: 'var(--fg-2)',
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <Loader2 className="animate-spin" size={11} />
      Processing
    </span>
  );
}

function Chip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]"
      style={{
        color: 'var(--fg-2)',
        border: '1px solid var(--border-subtle)',
        background: 'var(--surface-raised)',
      }}
    >
      {icon}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bottom-dock content for /meetings/processing — same screen slot as AskBar
// and LiveDock so the transition feels like a content swap.
// ---------------------------------------------------------------------------

export function ProcessingDock() {
  const recording = useRecording();
  const sessionName = recording.sessionName;
  const draft = useLiveDraftStore((s) =>
    sessionName ? s.drafts[sessionName] : undefined,
  );
  const startedAt = draft ? new Date(draft.startedAtMs) : null;
  const totalElapsedSeconds = startedAt
    ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000))
    : 0;

  return (
    <div className="flex justify-center pointer-events-none">
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-full px-3 py-2"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <span
          className="inline-flex items-center gap-2 px-2 text-[13px]"
          style={{ color: 'var(--fg-1)' }}
        >
          <Loader2
            className="animate-spin"
            size={14}
            style={{ color: 'var(--fg-2)' }}
          />
          <span style={{ color: 'var(--fg-2)' }}>Processing</span>
          <span
            className="tabular-nums"
            style={{
              color: 'var(--fg-1)',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
            }}
          >
            {formatDurationEnglish(totalElapsedSeconds)}
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Plain-English duration ("12 min", "1 h 4 min"). Mono is reserved for the live timer. */
function formatDurationEnglish(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

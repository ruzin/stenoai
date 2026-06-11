import * as React from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Pause,
  Play,
  Search as SearchIcon,
  Square,
} from 'lucide-react';
import { AudioWave } from '@/components/AudioWave';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useLiveTranscript } from '@/hooks/useLiveTranscript';
import { useRecording } from '@/hooks/useRecording';
import { useLanguageSetting, useSetLanguage } from '@/hooks/useSettings';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { formatElapsed } from '@/lib/utils';

/**
 * Live transcript dock — Granola-style.
 *
 * When the user opens the transcript, this panel takes the dock slot
 * **in place of** the LiveDock pill: header on top, segments in the body,
 * and a footer that owns the recording controls (Pause/Stop) plus the
 * language picker. There's no separate recording pill while the panel is
 * open — all live controls live inside it.
 *
 * Closing returns to the standard LiveDock pill.
 */
export function LiveTranscriptBar() {
  const recording = useRecording();
  const sessionName = recording.sessionName;
  const paused = recording.status === 'paused';
  const isRecording = recording.status === 'recording';
  const stopped = !paused && !isRecording;

  const { status, segments, error, slow } = useLiveTranscript(sessionName);

  const open = useLiveTranscriptOpen((s) => s.open);
  const setOpen = useLiveTranscriptOpen((s) => s.setOpen);

  const [query, setQuery] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to the most recent segment on every change. Compare against
  // trailing text rather than just length so a partial that updates in
  // place (same array length, different last text) still triggers a scroll.
  //
  // Skip the auto-scroll while the user has an active search query — they
  // were browsing past matches and a jump to the new tail would yank the
  // viewport away from what they were reading. They get the new segment
  // automatically once they clear the query.
  const tailText = segments[segments.length - 1]?.text ?? '';
  const filtering = query.trim().length > 0;
  React.useEffect(() => {
    if (filtering) return;
    const el = bodyRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length, tailText, open, filtering]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return segments;
    const needle = query.trim().toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(needle));
  }, [segments, query]);

  const copyAll = React.useCallback(async () => {
    const text = segments
      .filter((s) => s.isFinal)
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [segments]);

  const onPauseToggle = () => {
    if (paused) void recording.resumeRecording();
    else if (isRecording) void recording.pauseRecording();
  };
  const onStop = () => {
    void recording.stopRecording();
  };

  // Don't render when there's no active recording, or when the user has
  // toggled the panel closed via the LiveDock Transcript button. Both
  // gates unmount the whole shell — LiveDock takes over the dock slot.
  if (stopped || !sessionName) return null;
  if (!open) return null;

  return (
    <div className="pointer-events-auto">
      <div
        className="mv-transcript open"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — wave + "Transcript" + copy + minimize. The minimize
            (chevron) is the primary click target; copy is a sibling
            action button, not nested. (Nesting `<button>` inside `<button>`
            is invalid HTML and breaks both keyboard navigation and
            assistive-tech focus order.) */}
        <div className="mv-transcript-head" role="group" aria-label="Transcript header">
          {/* Static (non-animated) wave for the header — the "is anything
              happening?" cue lives in the footer's recording indicator. */}
          <span className="mv-transcript-wave mv-transcript-wave-static" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </span>
          <span className="mv-transcript-label">Transcript</span>
          <button
            type="button"
            className="mv-chat-tool"
            onClick={() => void copyAll()}
            aria-label="Copy transcript"
            title="Copy transcript"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            type="button"
            className="mv-chat-tool"
            onClick={() => setOpen(false)}
            aria-label="Minimize transcript"
            title="Minimize transcript"
          >
            <ChevronDown size={13} />
          </button>
        </div>

        {/* Search bar */}
        <div
          className="flex items-center px-3 py-1.5"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <Input
            variant="sunken"
            size="sm"
            iconStart={<SearchIcon className="size-3.5" />}
            placeholder="Search transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
        </div>

        {/* Body — segments. Height chosen to dominate the bottom of the
            page without crowding the notes area above. */}
        <div
          ref={bodyRef}
          className="scrollbar-clean overflow-auto px-3 pb-2"
          style={{ height: 200 }}
        >
          <LiveTranscriptBodyState
            status={status}
            error={error}
            segments={filtered}
            filtering={query.trim().length > 0}
            slow={slow}
          />
        </div>

        {/* Footer — recording status + controls + language selector. The
            animated wave + timer is the "live" cue (since the header wave
            is now static), replacing the indicator the LiveDock pill
            normally provides. */}
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <RecordingStatusChip paused={paused} elapsedSeconds={recording.elapsed} />
            <button
              type="button"
              onClick={onPauseToggle}
              aria-label={paused ? 'Resume recording' : 'Pause recording'}
              title={paused ? 'Resume recording' : 'Pause recording'}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)]"
              style={{ background: 'transparent', color: 'var(--fg-1)' }}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop recording"
              title="Stop recording"
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 text-[13px] font-medium transition-opacity"
              style={{ background: 'var(--recording)', color: '#FFFFFF' }}
            >
              <Square size={12} fill="currentColor" stroke="currentColor" />
              Stop
            </button>
          </div>
          <LanguageSelector />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body states
// ---------------------------------------------------------------------------

interface BodyStateProps {
  status: 'idle' | 'loading' | 'streaming' | 'error';
  error: { stage: string; message?: string } | null;
  segments: ReturnType<typeof useLiveTranscript>['segments'];
  filtering: boolean;
  slow: boolean;
}

function LiveTranscriptBodyState({ status, error, segments, filtering, slow }: BodyStateProps) {
  if (status === 'error' && error) {
    return (
      <EmptyState
        title="Live transcription unavailable"
        subtitle={
          error.message ? `${error.stage}: ${error.message}` : `Stage: ${error.stage}`
        }
      />
    );
  }
  if (status === 'loading') {
    return (
      <EmptyState
        title="Preparing transcription…"
        subtitle={
          slow
            ? 'Still warming up — first launch can take a moment. Audio is being captured.'
            : 'Parakeet is warming up. Audio is being captured.'
        }
      />
    );
  }
  if (segments.length === 0) {
    return (
      <EmptyState
        title={filtering ? 'No matches' : 'Listening…'}
        subtitle={
          filtering
            ? 'Nothing matches your filter yet.'
            : 'Start speaking — finalised sentences will appear here.'
        }
      />
    );
  }
  // Granola-style bubbles. Speaker attribution comes from the renderer-
  // side per-channel RMS lookup in useLiveTranscript: 'Others' renders
  // grey/left, anything else (explicit 'You' or no attribution) renders
  // green/right. Same charitable default as TranscriptPanel — the
  // recording mechanically belongs to the mic owner, so default to You.
  // Partials stay dimmed at 0.55 opacity so the user can see them
  // forming without confusing them for finalised text.
  return (
    <ul className="flex flex-col gap-0">
      {segments.map((seg, i) => {
        const isYou = seg.speaker !== 'Others';
        return (
          <li
            key={i}
            className={cn(
              'flex px-1 py-0.5',
              isYou ? 'justify-end' : 'justify-start',
            )}
            style={{ opacity: seg.isFinal ? 1 : 0.55 }}
          >
            <div
              className={cn(
                'max-w-[78%] rounded-2xl px-3 py-1.5 text-sm leading-[1.5]',
                isYou
                  ? 'bg-green-100 text-green-950 rounded-br-md dark:bg-green-900/40 dark:text-green-100'
                  : 'bg-neutral-200/80 text-neutral-900 rounded-bl-md dark:bg-neutral-700/60 dark:text-neutral-100',
              )}
            >
              {seg.text}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-1 text-center"
      style={{ color: 'var(--fg-2)' }}
    >
      <div className="text-[13px]" style={{ color: 'var(--fg-1)' }}>
        {title}
      </div>
      <div className="text-[11.5px]">{subtitle}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Language selector (Multi / English) — bottom-right of the panel
// ---------------------------------------------------------------------------

interface LanguageOption {
  code: string;
  label: string;
  hint: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English only', hint: 'Best accuracy when meetings are always in English' },
  { code: 'auto', label: 'Multi-language', hint: '25 European languages, auto-detect per recording' },
];

function LanguageSelector() {
  const language = useLanguageSetting();
  const setLanguage = useSetLanguage();
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const current = language.data ?? 'auto';
  const isEnglish = current === 'en';
  const display = isEnglish ? 'English' : 'Multi';

  const pick = (code: string) => {
    setLanguage.mutate(code);
    setPopoverOpen(false);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium',
            'cursor-pointer transition-colors hover:bg-[color:var(--surface-hover)]',
          )}
          style={{ color: 'var(--fg-2)' }}
          aria-label={`Language: ${display}`}
          title="Change transcript language"
        >
          <span style={{ color: 'var(--fg-1)' }}>{display}</span>
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-56 p-1">
        {LANGUAGE_OPTIONS.map((opt) => {
          const active = isEnglish ? opt.code === 'en' : opt.code === 'auto';
          return (
            <button
              key={opt.code}
              type="button"
              onClick={() => pick(opt.code)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left',
                'cursor-pointer transition-colors hover:bg-[color:var(--surface-hover)]',
              )}
            >
              <span
                className="flex w-full items-center justify-between text-[13px] font-medium"
                style={{ color: 'var(--fg-1)' }}
              >
                {opt.label}
                {active && <Check size={13} />}
              </span>
              <span className="text-[11.5px]" style={{ color: 'var(--fg-2)' }}>
                {opt.hint}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Recording status chip — footer, replaces the LiveDock RecordingPill
// ---------------------------------------------------------------------------

function RecordingStatusChip({
  paused,
  elapsedSeconds,
}: {
  paused: boolean;
  elapsedSeconds: number;
}) {
  const label = paused ? 'Paused' : 'Recording';
  return (
    <span
      className="inline-flex items-center gap-2 px-2 text-[13px]"
      style={{ color: 'var(--fg-1)' }}
    >
      <span style={{ color: 'var(--recording)' }}>
        <AudioWave
          active={!paused}
          paused={paused}
          bars={7}
          height={14}
          barWidth={2}
          gap={2}
        />
      </span>
      <span style={{ color: 'var(--fg-2)' }}>{label}</span>
      <span
        className="tabular-nums"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--fg-1)' }}
      >
        {formatElapsed(elapsedSeconds)}
      </span>
    </span>
  );
}


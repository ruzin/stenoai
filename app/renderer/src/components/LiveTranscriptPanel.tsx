import * as React from 'react';
import { Copy, Search, Settings2, X, ChevronDown } from 'lucide-react';
import { AudioWave } from '@/components/AudioWave';
import { useLiveTranscript } from '@/hooks/useLiveTranscript';
import { useRecording } from '@/hooks/useRecording';
import { ipc, type LiveSegment } from '@/lib/ipc';

interface Props {
  sessionName: string | null;
  onClose?: () => void;
}

/**
 * Floating live-transcript card shown over /recording while the Python
 * `record --live` consumer streams Parakeet segments. Renders the
 * segments as right-aligned chips à la a chat thread, with a search
 * filter, consent banner, timer, and a Multi language selector that
 * (for now) reflects the configured language without driving it — the
 * model is multilingual, so the selector is informational in v1.
 */
export function LiveTranscriptPanel({ sessionName, onClose }: Props) {
  const { status, segments, error } = useLiveTranscript(sessionName);
  const recording = useRecording();
  const [query, setQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest segment on every change — the transcript
  // reads top-to-bottom, latest at the bottom.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length, segments[segments.length - 1]?.text]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return segments;
    const q = query.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  const onCopy = React.useCallback(() => {
    const text = segments.map((s) => s.text).join('\n');
    if (text) void navigator.clipboard.writeText(text);
  }, [segments]);

  const paused = recording.status === 'paused';
  const onPauseToggle = () => {
    if (paused) void recording.resumeRecording();
    else void recording.pauseRecording();
  };

  return (
    <div
      role="region"
      aria-label="Live transcript"
      className="pointer-events-auto flex flex-col overflow-hidden rounded-[14px]"
      style={{
        width: 540,
        height: 320,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-lg, 0 18px 48px rgba(0,0,0,0.16))',
      }}
    >
      <Header
        searchOpen={searchOpen}
        query={query}
        onQueryChange={setQuery}
        onToggleSearch={() => {
          setSearchOpen((open) => {
            if (open) setQuery('');
            return !open;
          });
        }}
        onCopy={onCopy}
        onSettings={() => {
          // No-op for v1. Reserved for the Multi/language selector
          // detail panel and consent text customisation.
        }}
        onClose={onClose}
      />

      <ConsentBanner />

      <Timer seconds={recording.elapsed} />

      <Body
        ref={bodyRef}
        segments={filtered}
        status={status}
        error={error}
        filtering={query.trim().length > 0}
      />

      <Footer
        paused={paused}
        recording={recording.status === 'recording'}
        onPauseToggle={onPauseToggle}
      />
    </div>
  );
}

interface HeaderProps {
  searchOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onToggleSearch: () => void;
  onCopy: () => void;
  onSettings: () => void;
  onClose?: () => void;
}

function Header({
  searchOpen,
  query,
  onQueryChange,
  onToggleSearch,
  onCopy,
  onSettings,
  onClose,
}: HeaderProps) {
  return (
    <div
      className="flex items-center gap-2 px-3"
      style={{
        height: 36,
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <button
        type="button"
        onClick={onToggleSearch}
        aria-label={searchOpen ? 'Close search' : 'Search transcript'}
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Search size={14} />
      </button>

      {searchOpen ? (
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Filter segments"
          className="flex-1 border-0 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--fg-1)' }}
        />
      ) : (
        <div className="flex-1" />
      )}

      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy transcript"
        title="Copy transcript"
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        onClick={onSettings}
        aria-label="Transcript settings"
        title="Transcript settings"
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-[color:var(--surface-hover)]"
        style={{ color: 'var(--fg-2)' }}
      >
        <Settings2 size={14} />
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide transcript"
          title="Hide transcript"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{ color: 'var(--fg-2)' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function ConsentBanner() {
  return (
    <div
      className="flex items-center justify-center gap-1 px-3 py-2 text-[11.5px]"
      style={{ color: 'var(--fg-2)' }}
    >
      Always get consent when transcribing others.{' '}
      <button
        type="button"
        onClick={() => {
          void ipc().shell.openExternal('https://steno.ai/consent');
        }}
        className="inline-flex items-center gap-0.5 cursor-pointer border-0 bg-transparent p-0 text-[11.5px] underline-offset-2 hover:underline"
        style={{ color: 'var(--fg-1)' }}
      >
        Learn more ›
      </button>
    </div>
  );
}

function Timer({ seconds }: { seconds: number }) {
  const s = Math.max(0, seconds | 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <div
      className="flex items-center justify-center text-[11px] tabular-nums"
      style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}
    >
      {pad(m)}:{pad(r)}
    </div>
  );
}

interface BodyProps {
  segments: LiveSegment[];
  status: 'idle' | 'loading' | 'streaming' | 'error';
  error: { stage: string; message?: string } | null;
  filtering: boolean;
}

const Body = React.forwardRef<HTMLDivElement, BodyProps>(function Body(
  { segments, status, error, filtering },
  ref,
) {
  return (
    <div
      ref={ref}
      className="scrollbar-clean flex-1 overflow-y-auto px-4 py-3"
      style={{ background: 'var(--page)' }}
    >
      {status === 'error' && error ? (
        <EmptyState
          title="Live transcription unavailable"
          subtitle={
            error.message
              ? `${error.stage}: ${error.message}`
              : `Stage: ${error.stage}`
          }
        />
      ) : status === 'loading' ? (
        <EmptyState
          title="Loading speech model…"
          subtitle="Parakeet is warming up. Audio is being captured."
        />
      ) : segments.length === 0 ? (
        <EmptyState
          title={filtering ? 'No matches' : 'Listening…'}
          subtitle={
            filtering
              ? 'Nothing matches your filter yet.'
              : 'Start speaking — finalised sentences will appear here.'
          }
        />
      ) : (
        <ul className="flex flex-col items-end gap-2">
          {segments.map((seg, i) => (
            <SegmentChip key={i} text={seg.text} isPartial={!seg.isFinal} />
          ))}
        </ul>
      )}
    </div>
  );
});

function SegmentChip({ text, isPartial }: { text: string; isPartial: boolean }) {
  return (
    <li
      className="max-w-[88%] rounded-[14px] px-3 py-2 text-[13px] leading-snug"
      style={{
        // Sage/olive matches the Granola-style green chips in the
        // reference screenshot — kept muted so it sits on cream paper
        // without clashing. Partial segments are dimmed so the
        // not-yet-finalised tail reads as in-progress.
        background: 'color-mix(in srgb, var(--accent-primary) 18%, transparent)',
        color: 'var(--fg-1)',
        opacity: isPartial ? 0.55 : 1,
      }}
    >
      {text}
    </li>
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

function Footer({
  paused,
  recording,
  onPauseToggle,
}: {
  paused: boolean;
  recording: boolean;
  onPauseToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-3"
      style={{
        height: 40,
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <button
        type="button"
        onClick={onPauseToggle}
        aria-label={paused ? 'Resume recording' : 'Pause recording'}
        title={paused ? 'Resume recording' : 'Pause recording'}
        className="inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-[12.5px]"
        style={{ color: 'var(--accent-primary)' }}
      >
        <AudioWave
          active={recording && !paused}
          paused={paused}
          bars={5}
          height={12}
          barWidth={2}
          gap={2}
        />
        <span>{paused ? 'Resume' : 'Pause'}</span>
      </button>

      <button
        type="button"
        aria-label="Language: multilingual auto-detect"
        title="Parakeet TDT v3 is multilingual; auto-detect"
        className="inline-flex cursor-default items-center gap-1 border-0 bg-transparent p-0 text-[12.5px]"
        style={{ color: 'var(--fg-2)' }}
      >
        <span>Multi</span>
        <ChevronDown size={12} />
      </button>
    </div>
  );
}

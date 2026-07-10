import * as React from 'react';
import { ChevronUp, Play, Square } from 'lucide-react';
import { AudioWave } from '@/components/AudioWave';
import { useRecording } from '@/hooks/useRecording';
import { useLiveTranscript } from '@/hooks/useLiveTranscript';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useLiveTranscriptAvailable } from '@/hooks/useModels';
import { formatElapsed } from '@/lib/utils';

/**
 * Compact (Granola-style) transcription pill shown whenever a recording is
 * active — recording coexists with whatever the user is viewing; PrimaryDock
 * places this either adjacent to the Ask bar or alone. Icon-only: wave +
 * elapsed + expand chevron (Parakeet) + stop glyph. Layout is owned by the
 * parent; this renders just the pill.
 *
 * There is deliberately NO pause control: stop ends the segment, and a note
 * can be continued later (continue-recording appends to it), so "stop is the
 * new pause". The one exception is a Resume affordance that appears only
 * when the SYSTEM auto-paused the recording (laptop sleep, meeting-app mic
 * drop) — without it an auto-paused recording would be stranded.
 */
export function LiveDock() {
  const recording = useRecording();
  const liveAvailable = useLiveTranscriptAvailable();
  const transcriptOpen = useLiveTranscriptOpen((s) => s.open);
  const toggleTranscript = useLiveTranscriptOpen((s) => s.toggle);
  const paused = recording.status === 'paused';
  const isRecording = recording.status === 'recording';
  // Belt-and-braces: PrimaryDock unmounts the pill before status leaves
  // recording/paused, so this branch is normally unreachable — it only
  // covers a same-render race between the queue poll and the unmount.
  const stopped = !paused && !isRecording;

  // Surface model warm-up on the pill itself, since the transcript panel
  // (which already shows a loading state) is usually closed while recording.
  // Gated to Parakeet via `liveAvailable` — Whisper never spawns the live
  // sidecar, so its status would sit at 'loading' forever. Only meaningful
  // while actively recording.
  const live = useLiveTranscript(liveAvailable ? recording.sessionName : null);
  const loadingModel = isRecording && live.status === 'loading';
  // Delay the label by ~500ms so a warm-cache load (the common case after
  // the offline-loading fix) goes straight to the timer with no
  // "Preparing…" flash.
  const [showPreparing, setShowPreparing] = React.useState(false);
  React.useEffect(() => {
    if (!loadingModel) return;
    const id = window.setTimeout(() => setShowPreparing(true), 500);
    return () => {
      window.clearTimeout(id);
      setShowPreparing(false);
    };
  }, [loadingModel]);
  const prepareLabel = showPreparing
    ? live.slow
      ? 'Still preparing…'
      : 'Preparing…'
    : null;

  const onResume = () => {
    if (paused) void recording.resumeRecording();
  };

  const onStop = () => {
    void recording.stopRecording();
  };

  return (
    <div
      data-testid="transcription-pill"
      className="pointer-events-auto flex items-center gap-1 whitespace-nowrap rounded-full py-1.5 pl-3 pr-1.5"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <span
        style={{ color: 'var(--recording)' }}
        title={paused ? 'Paused' : 'Recording'}
        aria-hidden="true"
      >
        <AudioWave
          active={!stopped}
          paused={paused}
          bars={5}
          height={13}
          barWidth={2}
          gap={2}
        />
      </span>
      {/* Compact elapsed timer; swaps to the warm-up hint while the live
          model loads (the recording itself is already capturing). */}
      <span
        className="tabular-nums px-1.5"
        style={{
          fontFamily: prepareLabel ? 'var(--font-sans)' : 'var(--font-mono)',
          fontSize: 12.5,
          color: 'var(--fg-2)',
        }}
      >
        {prepareLabel ?? formatElapsed(recording.elapsed)}
      </span>
      {/* Resume — only when the system auto-paused (sleep / meeting-app mic
          drop). There is no manual pause: stop ends the segment and the note
          can be continued later. */}
      {paused && (
        <button
          type="button"
          onClick={onResume}
          aria-label="Resume recording"
          title="Resume recording"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)]"
          style={{ background: 'transparent', color: 'var(--fg-1)' }}
        >
          <Play size={13} />
        </button>
      )}
      {/* Expand — Parakeet only. Whisper recordings have no live drawer
          (post-stop pipeline produces the final transcript on the meeting
          detail page). Hiding the button entirely rather than disabling
          avoids the dead-control. */}
      {liveAvailable && (
        <button
          type="button"
          onClick={toggleTranscript}
          disabled={stopped}
          aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          aria-pressed={transcriptOpen}
          title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'transparent', color: 'var(--fg-1)' }}
        >
          <ChevronUp size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={onStop}
        disabled={stopped}
        aria-label="Stop recording"
        title="Stop recording"
        className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: 'transparent', color: 'var(--recording)' }}
      >
        <Square size={12} fill="currentColor" stroke="currentColor" />
      </button>
    </div>
  );
}

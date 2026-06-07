import * as React from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { AudioWave } from '@/components/AudioWave';
import { useRecording } from '@/hooks/useRecording';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useTranscriptionEngine } from '@/hooks/useModels';
import { formatElapsed } from '@/lib/utils';

/**
 * Recording-state dock for the /recording route. Mounted at App level inside
 * BottomDockSlot so it shares the same screen slot as AskBar + ProcessingDock
 * — when the user stops, the visual frame stays put while the contents swap.
 */
export function LiveDock() {
  const recording = useRecording();
  const engineQuery = useTranscriptionEngine();
  // Whisper recordings have no live drawer — the sidecar isn't spawned and
  // the renderer never receives LIVE_SEG events. Hiding the toggle keeps
  // the dock honest. Default to parakeet while the query hydrates so the
  // first paint doesn't briefly hide the button under SSR-like conditions.
  const liveAvailable = (engineQuery.data ?? 'parakeet') === 'parakeet';
  const transcriptOpen = useLiveTranscriptOpen((s) => s.open);
  const toggleTranscript = useLiveTranscriptOpen((s) => s.toggle);
  const [transcriptHover, setTranscriptHover] = React.useState(false);
  const paused = recording.status === 'paused';
  const isRecording = recording.status === 'recording';
  const stopped = !paused && !isRecording;

  const onPauseToggle = () => {
    if (paused) void recording.resumeRecording();
    else if (isRecording) void recording.pauseRecording();
  };

  const onStop = () => {
    void recording.stopRecording();
  };

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
        <RecordingPill
          paused={paused}
          stopped={stopped}
          elapsedSeconds={recording.elapsed}
        />
        {/* Transcript toggle — Parakeet only. Whisper recordings have no
            live drawer (post-stop pipeline produces the final transcript
            on the meeting detail page after summary). Hiding the button
            entirely rather than disabling avoids the dead-control. */}
        {liveAvailable && (
          <button
            type="button"
            onClick={toggleTranscript}
            onMouseEnter={() => setTranscriptHover(true)}
            onMouseLeave={() => setTranscriptHover(false)}
            disabled={stopped}
            aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            aria-pressed={transcriptOpen}
            title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: transcriptOpen ? 'var(--surface-hover)' : 'transparent',
              color: 'var(--fg-1)',
            }}
          >
            {/* Static when idle, animated on hover — the wave bars "wake up"
                to telegraph what the button does without competing with the
                recording wave at rest. */}
            <span
              className={
                transcriptHover
                  ? 'mv-transcript-wave'
                  : 'mv-transcript-wave mv-transcript-wave-static'
              }
              aria-hidden="true"
              style={{ width: 20, height: 16 }}
            >
              <span /><span /><span /><span /><span /><span /><span />
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onPauseToggle}
          disabled={stopped}
          aria-label={paused ? 'Resume recording' : 'Pause recording'}
          title={paused ? 'Resume recording' : 'Pause recording'}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'transparent', color: 'var(--fg-1)' }}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={stopped}
          aria-label="Stop recording"
          title="Stop recording"
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 text-[13px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--recording)', color: '#FFFFFF' }}
        >
          <Square size={12} fill="currentColor" stroke="currentColor" />
          Stop
        </button>
      </div>
    </div>
  );
}

function RecordingPill({
  paused,
  stopped,
  elapsedSeconds,
}: {
  paused: boolean;
  stopped: boolean;
  elapsedSeconds: number;
}) {
  const label = stopped ? 'Processing' : paused ? 'Paused' : 'Recording';
  const active = !stopped;
  return (
    <span
      className="inline-flex items-center gap-2 px-2 text-[13px]"
      style={{ color: 'var(--fg-1)' }}
    >
      <span style={{ color: 'var(--recording)' }}>
        <AudioWave
          active={active}
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


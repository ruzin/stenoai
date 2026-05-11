import { Pause, Play, Square } from 'lucide-react';
import { AudioWave } from '@/components/AudioWave';
import { useRecording } from '@/hooks/useRecording';

/**
 * Recording-state dock for the /recording route. Mounted at App level inside
 * BottomDockSlot so it shares the same screen slot as AskBar + ProcessingDock
 * — when the user stops, the visual frame stays put while the contents swap.
 */
export function LiveDock() {
  const recording = useRecording();
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

function formatElapsed(seconds: number): string {
  const s = Math.max(0, seconds | 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(rem)}`;
  return `${pad(m)}:${pad(rem)}`;
}

import { useAudioLevel } from '@/hooks/useAudioLevel';

interface AudioWaveProps {
  /** True while a recording is active and unpaused. */
  active: boolean;
  /** Paused recordings keep the bars but stop reading the mic. */
  paused?: boolean;
  /** Number of bars to render. */
  bars?: number;
  /** Total height in px. */
  height?: number;
  /** Bar width in px. */
  barWidth?: number;
  /** Gap between bars in px. */
  gap?: number;
  /** CSS color for the bars. */
  color?: string;
}

/**
 * Speech-reactive bar-graph driven by useAudioLevel. Falls back to a flat
 * shimmer if mic permission is denied. Used inside the recording pill on
 * /recording and the MainToolbar record button.
 */
export function AudioWave({
  active,
  paused = false,
  bars = 7,
  height = 16,
  barWidth = 2,
  gap = 2,
  color = 'currentColor',
}: AudioWaveProps) {
  const levels = useAudioLevel({ enabled: active && !paused, bars });

  return (
    <span
      aria-hidden
      className="inline-flex items-center"
      style={{ height, gap }}
    >
      {levels.map((lvl, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: barWidth,
            height: `${Math.round(lvl * 100)}%`,
            minHeight: 2,
            background: color,
            borderRadius: barWidth,
            transition: 'height 80ms linear',
            opacity: paused ? 0.45 : 1,
          }}
        />
      ))}
    </span>
  );
}

import { cn } from '@/lib/utils';
import { AskBar } from '@/components/AskBar';
import { LiveDock } from '@/components/LiveDock';
import { LiveTranscriptBar } from '@/components/LiveTranscriptBar';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useRecording } from '@/hooks/useRecording';
import { useLiveTranscriptAvailable } from '@/hooks/useModels';

/**
 * The primary bottom-dock slot (bottomOffset 0). Recording coexists with the
 * app instead of taking over a dedicated route, so this decides what the slot
 * holds from recording *status*, not the route:
 *
 * - recording/paused + transcript open (Parakeet): the expanded
 *   LiveTranscriptBar panel replaces the whole row (it owns Pause/Resume +
 *   language + Stop in its footer).
 * - recording/paused, collapsed: the compact transcription pill, docked left
 *   of the Ask bar in one row — the Ask bar renders disabled (chat needs the
 *   processed note) — or alone on routes without an Ask bar (chat/settings/
 *   setup, and the processing route).
 * - idle: the plain Ask bar (or nothing on routes without one).
 *
 * The row keeps ONE stable tree shape across the idle ↔ recording flip so
 * React re-renders AskBar with a new `disabled` prop instead of remounting
 * it — a remount would silently drop a typed draft or an in-flight ask-AI
 * stream's persistence ref (recordings start from global hotkeys/tray, i.e.
 * potentially mid-typing).
 *
 * The processing dock is handled by the caller (route-gated) — but recording
 * wins the slot when both apply (back-to-back notes), so the pill + Stop are
 * never unreachable.
 */
export function PrimaryDock({ showAskBar }: { showAskBar: boolean }) {
  const recording = useRecording();
  const open = useLiveTranscriptOpen((s) => s.open);
  // Whisper has no live transcript. Belt-and-braces vs the LiveDock toggle
  // being hidden: the store could already be open from a prior Parakeet
  // session, and zustand survives across recordings. Force the pill for
  // whisper regardless of stored state.
  const liveAvailable = useLiveTranscriptAvailable();
  const recordingActive =
    recording.status === 'recording' || recording.status === 'paused';

  if (recordingActive && open && liveAvailable) return <LiveTranscriptBar />;
  if (!recordingActive && !showAskBar) return null;

  return (
    <div
      data-testid="primary-dock-row"
      className={cn('flex items-end gap-3', !showAskBar && 'justify-center')}
    >
      {recordingActive && (
        <div className="shrink-0">
          <LiveDock />
        </div>
      )}
      {showAskBar && (
        <div className="min-w-0 flex-1">
          <AskBar disabled={recordingActive} />
        </div>
      )}
    </div>
  );
}

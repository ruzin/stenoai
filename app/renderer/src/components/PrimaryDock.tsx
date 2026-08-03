import { cn } from '@/lib/utils';
import { AskBar, TranscriptToggle } from '@/components/AskBar';
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
 *   LiveTranscriptBar panel replaces the whole row (it owns Stop + language
 *   in its footer).
 * - recording/paused, collapsed: the compact transcription pill, docked left
 *   of the Ask bar in one row — the Ask bar renders disabled (chat needs the
 *   processed note) — or alone on routes without an Ask bar (chat/settings/
 *   setup, and the processing route).
 * - idle on a note detail: a compact continue-recording button in the pill's
 *   spot — recording from a note APPENDS to that note (stop is the new
 *   pause; the note is regenerated on demand afterwards).
 * - idle elsewhere: the plain Ask bar (or nothing on routes without one).
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

  // Continue-recording ("Resume") now lives in the transcript panel footer
  // (TranscriptBar), Granola-style — open the transcript on a note to resume
  // recording into it. No standalone dock control here.

  if (recordingActive && open && liveAvailable) return <LiveTranscriptBar />;
  if (!recordingActive && !showAskBar) return null;

  return (
    <div
      data-testid="primary-dock-row"
      // items-end, not items-center: the AskBar column grows upward in-flow
      // (chat panel maxHeight 360, suggestion chips), so centering against it
      // would float the left control mid-column when a chat is expanded. The
      // left controls instead carry a small mb-* that optically centers them
      // against the 50px composer row only.
      className={cn('flex items-end gap-3', !showAskBar && 'justify-center')}
    >
      {recordingActive ? (
        // mb-1 only beside the composer - standalone (justify-center) the
        // pill has nothing to align with.
        <div className={cn('shrink-0', showAskBar && 'mb-1')}>
          <LiveDock />
        </div>
      ) : (
        // Idle: the standalone transcript toggle sits left of the Ask bar
        // (Granola-style). While recording, the pill owns the left slot.
        <TranscriptToggle />
      )}
      {showAskBar && (
        <div className="min-w-0 flex-1">
          <AskBar disabled={recordingActive} />
        </div>
      )}
    </div>
  );
}

import { AskBar } from '@/components/AskBar';
import { LiveDock } from '@/components/LiveDock';
import { LiveTranscriptBar } from '@/components/LiveTranscriptBar';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useRecording } from '@/hooks/useRecording';
import { useTranscriptionEngine } from '@/hooks/useModels';

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
 *   processed note) — or alone on routes without an Ask bar (chat/settings).
 * - idle: the plain Ask bar (or nothing on routes without one).
 *
 * The processing dock is handled by the caller (route-gated), matching the
 * old behaviour: processing still owns the screen; recording no longer does.
 */
export function PrimaryDock({ showAskBar }: { showAskBar: boolean }) {
  const recording = useRecording();
  const open = useLiveTranscriptOpen((s) => s.open);
  const engineQuery = useTranscriptionEngine();
  // Whisper has no live transcript. Belt-and-braces vs the LiveDock toggle
  // being hidden: the store could already be open from a prior Parakeet
  // session, and zustand survives across recordings. Force the pill for
  // whisper regardless of stored state.
  const liveAvailable = (engineQuery.data ?? 'parakeet') === 'parakeet';
  const recordingActive =
    recording.status === 'recording' || recording.status === 'paused';

  if (recordingActive && open && liveAvailable) return <LiveTranscriptBar />;

  if (recordingActive) {
    return showAskBar ? (
      <div data-testid="primary-dock-row" className="flex items-end gap-3">
        <div className="shrink-0">
          <LiveDock />
        </div>
        <div className="min-w-0 flex-1">
          <AskBar disabled />
        </div>
      </div>
    ) : (
      <div className="pointer-events-none flex justify-center">
        <LiveDock />
      </div>
    );
  }

  return showAskBar ? <AskBar /> : null;
}

import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AskBar } from '@/components/AskBar';
import { LiveDock } from '@/components/LiveDock';
import { LiveTranscriptBar } from '@/components/LiveTranscriptBar';
import { useAskBar } from '@/lib/askBarContext';
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

  // Continue-recording affordance: on a note's detail page while idle, the
  // pill slot offers "record into this note" — the segment's transcript is
  // appended to the note (backend --append-to) and the note is marked stale
  // for a "Regenerate notes" pass. activeSummaryFile is only set for local
  // meetings (org shared notes set activeOrgMeeting instead), so shared
  // notes never offer it.
  const { activeSummaryFile, activeMeetingName } = useAskBar();
  const canContinue =
    recording.status === 'idle' && showAskBar && activeSummaryFile !== null;

  const onContinue = () => {
    if (!activeSummaryFile) return;
    void recording.startRecording(
      activeMeetingName ?? undefined,
      activeSummaryFile,
    );
  };

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
      {canContinue && (
        <div className="shrink-0">
          <button
            type="button"
            onClick={onContinue}
            data-testid="continue-recording-button"
            aria-label="Resume transcription on this note"
            title="Resume transcription — the new recording is appended to this note"
            className="pointer-events-auto inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-md)',
              color: 'var(--recording)',
            }}
          >
            <Mic size={15} />
          </button>
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

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAskBar } from '@/lib/askBarContext';
import { useReprocessBridge } from '@/hooks/reprocessBridgeStore';

/**
 * Floating "Generate notes" button that sits just above the Ask bar for a
 * transcript-only note (auto-summarise off, #276 → `notes_generated: false`).
 *
 * It's a remote trigger for the note-detail's own reprocess: MeetingDetail
 * publishes its `startReprocess` + streaming state to `reprocessBridgeStore`
 * while showing a pending note, and this button calls that — so clicking here
 * drives the detail's StreamingView and shares its disabled/streaming state
 * with the in-note CTA (no double-fire, one source of truth). Hidden when the
 * transcript panel is open (it owns that band).
 */
export function GenerateNotesBar() {
  const { activeSummaryFile, transcriptOpen } = useAskBar();
  const { summaryFile, streaming, start } = useReprocessBridge();

  const active = summaryFile !== null && summaryFile === activeSummaryFile && start !== null;
  if (!active || transcriptOpen) return null;

  return (
    <div
      className="flex justify-center"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        onClick={() => start?.()}
        disabled={streaming}
        data-testid="generate-notes-dock-button"
        className="shadow-[var(--shadow-md)]"
      >
        <Sparkles />
        Generate notes
      </Button>
    </div>
  );
}

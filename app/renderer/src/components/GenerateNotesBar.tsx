import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAskBar } from '@/lib/askBarContext';
import { useMeeting, useReprocessMeeting } from '@/hooks/useMeetings';
import { streamCache } from '@/lib/meetingDetailState';

/**
 * Floating "Generate notes" button that sits just above the Ask bar for a
 * transcript-only note (auto-summarise off, #276 → `notes_generated: false`).
 * Mirrors the note-detail CTA (MeetingDetail `startReprocess`) so both surfaces
 * drive the same `reprocess` stream — the detail view's StreamingView picks it
 * up via the shared `streamCache`. Hidden once notes exist or while the
 * transcript panel is open (it owns that band).
 */
export function GenerateNotesBar() {
  const { activeSummaryFile, transcriptOpen } = useAskBar();
  const meeting = useMeeting(activeSummaryFile ?? undefined);
  const reprocess = useReprocessMeeting();

  const info = meeting.data?.session_info;
  const notesNotGenerated = info?.notes_generated === false;
  const hasTranscript = Boolean(meeting.data?.transcript);

  if (!activeSummaryFile || transcriptOpen || !notesNotGenerated || !hasTranscript) {
    return null;
  }

  const onGenerate = () => {
    // Seed the shared stream cache so the open note view flips straight into
    // its StreamingView, then fire the same reprocess mutation the detail CTA
    // uses. Title stays as-is (matches #276's startReprocess).
    streamCache.set(activeSummaryFile, { text: '', phase: 'analyzing' });
    reprocess.mutate({ summaryFile: activeSummaryFile, regenTitle: false, name: info?.name ?? '' });
  };

  return (
    <div
      className="flex justify-center"
      style={{ pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        onClick={onGenerate}
        disabled={reprocess.isPending}
        data-testid="generate-notes-dock-button"
        className="shadow-[var(--shadow-md)]"
      >
        <Sparkles />
        Generate notes
      </Button>
    </div>
  );
}

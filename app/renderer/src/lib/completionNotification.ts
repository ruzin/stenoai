/**
 * Decide which notification a finished recording/processing job should fire
 * (#bug2/#bug3). Pure so it can be unit-tested without the IPC/route machinery
 * around it in useRecording.
 *
 * - `note-ready`: notes were generated (auto_summarize on, or the deferred
 *   Generate-notes/reprocess finished), OR a transcription failure that still
 *   wrote a note — either way there's a note to open.
 * - `transcript-ready`: transcript-only note (auto_summarize off → no notes
 *   generated) — prompt the user to generate notes rather than claim it's
 *   ready. This is the correctly-timed replacement for the old premature
 *   meeting-end "Summarise?" prompt.
 *
 * A failed transcription is deliberately routed to `note-ready` (with the
 * caller's `failed` flag), NOT `transcript-ready`: there's nothing to summarise
 * on a failed transcript, so we never offer "generate notes" there.
 *
 * `notesAlreadyExist` covers the continue-recording (append) case: the backend
 * always prints SUMMARY_SKIPPED for an append (deferring to on-demand
 * regenerate), so `notesGenerated` is false — but the note it appended to
 * already has notes (now stale). Prompting "generate notes?" for a note that
 * already has them is wrong, so a note that already has notes is `note-ready`.
 */
export type CompletionNotificationKind = 'note-ready' | 'transcript-ready';

export function classifyCompletionNotification(input: {
  notesGenerated?: boolean;
  notesAlreadyExist?: boolean;
  transcriptionFailed?: boolean;
  meetingTranscriptionFailed?: boolean;
}): CompletionNotificationKind {
  const isFailed =
    Boolean(input.transcriptionFailed) || Boolean(input.meetingTranscriptionFailed);
  const hasNotes = Boolean(input.notesGenerated) || Boolean(input.notesAlreadyExist);
  return hasNotes || isFailed ? 'note-ready' : 'transcript-ready';
}

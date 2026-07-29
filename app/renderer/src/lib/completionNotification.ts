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

/**
 * Whether the completed job's note ALREADY had notes (the M2 append case).
 *
 * Subtle: the backend only ever writes `notes_generated: false` (a transcript-
 * only note) or OMITS the key entirely (a note that has notes) — it is never
 * written `true`. So "has notes" is `notes_generated !== false`, NOT
 * `notes_generated === true` (which is always false and was the ineffective
 * first fix). Guard on meetingData presence: when the completion event carries
 * no meetingData (the rare list-lookup-failed fallback, and the reprocess/report
 * paths), return false so we fall back to the transient `notesGenerated` signal
 * rather than defaulting a transcript-only note to "has notes". `notes_stale`
 * is NOT a substitute — an append sets it unconditionally, including on
 * transcript-only notes.
 */
export function meetingAlreadyHasNotes(
  meetingData?: { session_info?: { notes_generated?: boolean } } | null,
): boolean {
  if (!meetingData) return false;
  return meetingData.session_info?.notes_generated !== false;
}

/**
 * What to do when a job finishes, based on where the user is AND whether the
 * window is actually visible (#bug1). The visibility gate matters because an
 * auto-detected recording can run with the window HIDDEN (tray-only), and
 * "Wrap up" navigates to the note's own route — so route alone would say "the
 * user is looking at it" when the window is hidden and they aren't, suppressing
 * the very prompt this feature exists to send.
 *
 * - `navigate`: user is watching the processing page (visible) → open the note.
 * - `suppress`: user is already viewing this note (visible) → the static
 *   summary is right there, a banner would be noise.
 * - `notify`: anywhere else, OR this note's route but the window is
 *   hidden/minimised → fire a notification.
 */
export type CompletionRouteAction = 'navigate' | 'notify' | 'suppress';

export function completionRouteAction(input: {
  currentRoute: string;
  finishedMeetingRoute: string;
  processingRoute: string;
  windowVisible: boolean;
}): CompletionRouteAction {
  const { currentRoute, finishedMeetingRoute, processingRoute, windowVisible } = input;
  if (currentRoute === processingRoute && windowVisible) return 'navigate';
  if (currentRoute === finishedMeetingRoute && windowVisible) return 'suppress';
  return 'notify';
}

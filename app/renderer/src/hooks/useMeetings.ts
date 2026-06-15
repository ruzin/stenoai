import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type Meeting, type UpdateMeetingPatch } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { useRecording } from '@/hooks/useRecording';
import { useLiveDraftStore } from '@/hooks/liveDraftStore';
import { meetingsKeys } from '@/hooks/meetingKeys';

export { meetingsKeys };

/** Sentinel summary_file path used by the synthetic in-progress recording row.
 *  Never matches a real meeting file. Consumers detect via `meeting.is_recording`. */
export const LIVE_SUMMARY_PREFIX = '__live__/';

export function useMeetings() {
  const query = useQuery({
    queryKey: meetingsKeys.list(),
    queryFn: async () => unwrap(await ipc().meetings.list()).meetings,
  });

  const recording = useRecording();
  const draft = useLiveDraftStore((s) =>
    recording.sessionName ? s.drafts[recording.sessionName] : undefined,
  );

  // Local 1 Hz tick so the live row's duration_seconds advances smoothly
  // regardless of when the queue poll lands. We re-derive from startedAtMs
  // when available, falling back to the polled elapsed value.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (recording.status !== 'recording') return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [recording.status]);

  const liveElapsed = React.useMemo(() => {
    if (!recording.sessionName) return 0;
    if (draft?.startedAtMs && recording.status !== 'paused') {
      return Math.max(0, Math.floor((nowMs - draft.startedAtMs) / 1000));
    }
    return recording.elapsed;
  }, [
    recording.sessionName,
    recording.status,
    recording.elapsed,
    draft?.startedAtMs,
    nowMs,
  ]);

  const data = React.useMemo<Meeting[] | undefined>(() => {
    if (!query.data) return query.data;
    // When one or more reprocesses are in flight, flag the matching
    // existing meeting rows so they show the ProcessingBadge — same
    // surface as a queued recording, no synthetic duplicate row.
    // Without this, Home looks identical to "nothing happening" during
    // a reprocess because reprocess doesn't touch the processingQueue
    // / currentJob. Live recording row (below) is independent — both
    // can co-exist if the user is recording one note AND reprocessing
    // another simultaneously.
    const reprocessing = recording.reprocessingSummaryFiles;
    const base = reprocessing.size > 0
      ? query.data.map((m) =>
          reprocessing.has(m.session_info.summary_file) && !m.is_processing
            ? { ...m, is_processing: true }
            : m,
        )
      : query.data;
    const live = recording.sessionName
      ? buildLiveMeeting(
          recording.sessionName,
          draft?.title,
          draft?.startedAtMs,
          liveElapsed,
          recording.status === 'processing',
        )
      : null;
    if (!live) return base;
    return [live, ...base];
  }, [
    query.data,
    recording.sessionName,
    recording.status,
    recording.reprocessingSummaryFiles,
    liveElapsed,
    draft?.title,
    draft?.startedAtMs,
  ]);

  return { ...query, data };
}

function buildLiveMeeting(
  sessionName: string,
  draftTitle: string | undefined,
  startedAtMs: number | undefined,
  elapsedSeconds: number,
  isProcessing: boolean,
): Meeting {
  const ts = startedAtMs ?? Date.now();
  const iso = new Date(ts).toISOString();
  return {
    is_recording: !isProcessing,
    is_processing: isProcessing,
    session_info: {
      name: draftTitle ?? sessionName,
      summary_file: `${LIVE_SUMMARY_PREFIX}${sessionName}`,
      processed_at: iso,
      updated_at: iso,
      duration_seconds: elapsedSeconds,
    },
    summary: '',
    key_points: [],
    action_items: [],
    transcript: '',
    folders: [],
  };
}

export function useMeeting(summaryFile: string | null | undefined) {
  const meetings = useMeetings();
  const meeting = React.useMemo(
    () =>
      summaryFile
        ? (meetings.data?.find((m) => m.session_info.summary_file === summaryFile) ?? null)
        : null,
    [meetings.data, summaryFile],
  );
  return { ...meetings, data: meeting };
}

export function useTranscript(summaryFile: string | null | undefined) {
  const { data, ...rest } = useMeeting(summaryFile);
  return { ...rest, data: data?.transcript ?? null };
}

export function useUpdateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { summaryFile: string; patch: UpdateMeetingPatch }) =>
      unwrap(await ipc().meetings.update(args.summaryFile, args.patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingsKeys.all }),
  });
}

export function useDeleteMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (meeting: Meeting) => unwrap(await ipc().meetings.delete(meeting)),
    // Cancel any in-flight meetings-list refetch before touching the cache. A
    // refetch already running when the delete fires was scanned by the backend
    // *before* the file was removed, so its (stale) response would re-introduce
    // the deleted row if it landed after the setQueryData below. The many
    // meetingsKeys.all invalidations elsewhere (processing-complete, update,
    // reprocess, folder edits) make such an overlap reachable. Cancelling drops
    // that stale response without kicking off a new fetch, so we still avoid the
    // backend re-scan this hook exists to remove.
    onMutate: () => qc.cancelQueries({ queryKey: meetingsKeys.list() }),
    // The deleted file is known, so drop just that row from the list cache
    // instead of invalidating — a full `invalidateQueries` re-runs the backend
    // `list-meetings` scan (a Python subprocess + whole-directory re-read) only
    // to remove one row we already know is gone. Folder views derive from this
    // same list (FolderDetail filters useMeetings() by folder id), so they
    // update from this single write too. Removing on success (not optimistically
    // in onMutate) means a failed delete simply leaves the row in place — no
    // snapshot/rollback, so concurrent deletes can't clobber each other.
    onSuccess: async (_data, meeting) => {
      // Cancel again here: the onMutate cancel only covers refetches already
      // running at mutation start, but a fresh list refetch can be triggered
      // *during* the (fast) delete IPC and would land after the write below.
      // The setQueryData filter handles a stale response that lands before this
      // point; cancelling handles one that would land after. Together they close
      // the clobber window without a reconciling backend re-scan.
      await qc.cancelQueries({ queryKey: meetingsKeys.list() });
      const deletedFile = meeting.session_info.summary_file;
      // Guard against a falsy summary_file: filtering on it would drop *every*
      // row with a falsy summary_file rather than the one deleted. summary_file
      // is the list's primary key so this shouldn't happen, but the predicate
      // must not silently nuke the list if a malformed row slips through.
      if (!deletedFile) return;
      qc.setQueryData<Meeting[]>(meetingsKeys.list(), (prev) =>
        prev ? prev.filter((m) => m.session_info.summary_file !== deletedFile) : prev,
      );
    },
  });
}

export function useReprocessMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { summaryFile: string; regenTitle: boolean; name: string }) =>
      unwrap(await ipc().meetings.reprocess(args.summaryFile, args.regenTitle, args.name)),
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingsKeys.all }),
  });
}

export function useSaveMeetingNotes() {
  return useMutation({
    mutationFn: async (args: { name: string; notes: string }) =>
      unwrap(await ipc().meetings.saveNotes(args.name, args.notes)),
  });
}

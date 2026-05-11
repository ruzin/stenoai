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
    const live = recording.sessionName
      ? buildLiveMeeting(
          recording.sessionName,
          draft?.title,
          draft?.startedAtMs,
          liveElapsed,
          recording.status === 'processing',
        )
      : null;
    if (!live) return query.data;
    return [live, ...query.data];
  }, [
    query.data,
    recording.sessionName,
    recording.status,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: meetingsKeys.all }),
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

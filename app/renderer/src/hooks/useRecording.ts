import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { meetingsKeys } from './meetingKeys';
import { orgKeys } from './useOrg';
import { useLiveDraftStore } from './liveDraftStore';
import { navigate, routeFromHash } from '@/lib/router';
import { composeShareBody, pickTranscriptForShare } from '@/routes/MeetingDetail';
import { streamCache } from '@/lib/meetingDetailState';
import type { Meeting, QueueStatus } from '@/lib/ipc';

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing';

const queueKey = ['recording', 'queue'] as const;

/** Stable empty-Set sentinel so consumers (useMeetings) don't see a
 *  fresh reference each render when there are no active reprocesses —
 *  keeps their useMemo deps shallow-equal and avoids re-mapping the
 *  whole meetings list every queue poll. */
const EMPTY_REPROCESS_SET: ReadonlySet<string> = new Set<string>();

export function useRecording() {
  const qc = useQueryClient();

  const queue = useQuery({
    queryKey: queueKey,
    queryFn: async () => {
      const res = await ipc().recording.getQueue();
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: (query) => (query.state.data?.hasRecording ? 1000 : 2000),
  });

  const status: RecordingStatus = React.useMemo(() => {
    const q = queue.data;
    if (q?.hasRecording) return q.isPaused ? 'paused' : 'recording';
    if (q?.isProcessing) return 'processing';
    return 'idle';
  }, [queue.data]);

  // Memoised so the Set reference is stable across renders when the
  // backend's currentReprocesses array contents haven't changed —
  // useMeetings's dependency on this is then satisfied by a referential
  // equality check rather than re-running the meeting-list map on every
  // queue poll.
  const reprocessingSummaryFiles = React.useMemo(() => {
    const arr = queue.data?.currentReprocesses;
    if (!arr || arr.length === 0) return EMPTY_REPROCESS_SET;
    return new Set(arr.map((r) => r.summaryFile));
  }, [queue.data?.currentReprocesses]);

  // NOTE: processing-complete handling lives in useRecordingProcessingEffects
  // below, mounted ONCE at App level. Putting it here would attach a fresh
  // listener for every consumer of useRecording (12+ at last count), causing
  // duplicate cache invalidations and N navigations per recording.

  const startRecording = React.useCallback(
    async (name?: string) => {
      // Optimistic cache write so the UI flips to status='recording'
      // instantly. The backend's start-recording-ui has a 2s warm-up and
      // the next queue poll (1s) will reconcile sessionName + elapsed.
      // 'Note' is the placeholder that the Python post-processor recognises
      // (regex ^(Meeting|Note)(-[A-Z0-9]{6})?$) and replaces with an AI-
      // generated title from the summary + transcript.
      const optimisticName = name && name.trim() ? name.trim() : 'Note';
      qc.setQueryData(queueKey, {
        success: true,
        isProcessing: false,
        queueSize: 0,
        currentJob: null,
        hasRecording: true,
        isPaused: false,
        elapsedSeconds: 0,
        sessionName: optimisticName,
      });
      navigate('/recording');
      try {
        const data = unwrap(await ipc().recording.start(name));
        qc.invalidateQueries({ queryKey: queueKey });
        return data;
      } catch (err) {
        // Roll back optimistic state and leave the dead /recording page.
        qc.invalidateQueries({ queryKey: queueKey });
        navigate('/');
        throw err;
      }
    },
    [qc],
  );

  const stopRecording = React.useCallback(async () => {
    // Optimistic: flip the queue cache to processing so the UI can navigate
    // away from /recording instantly, before the backend SIGTERM round-trip.
    qc.setQueryData(queueKey, (prev: QueueStatus | undefined) => ({
      success: true as const,
      isProcessing: true,
      queueSize: prev?.queueSize ?? 0,
      currentJob: prev?.sessionName ?? prev?.currentJob ?? null,
      hasRecording: false,
      isPaused: false,
      elapsedSeconds: 0,
      sessionName: prev?.sessionName ?? null,
    }));
    navigate('/meetings/processing');
    try {
      const data = unwrap(await ipc().recording.stop());
      qc.invalidateQueries({ queryKey: queueKey });
      return data;
    } catch (err) {
      qc.invalidateQueries({ queryKey: queueKey });
      throw err;
    }
  }, [qc]);

  const pauseRecording = React.useCallback(async () => {
    const data = unwrap(await ipc().recording.pause());
    qc.invalidateQueries({ queryKey: queueKey });
    return data;
  }, [qc]);

  const resumeRecording = React.useCallback(async () => {
    const data = unwrap(await ipc().recording.resume());
    qc.invalidateQueries({ queryKey: queueKey });
    return data;
  }, [qc]);

  return {
    status,
    elapsed: queue.data?.elapsedSeconds ?? 0,
    // Fall back to currentJob (the in-flight processing session) when no
    // recording is active. Keeps `sessionName` populated through the full
    // recording → processing → done lifecycle so the synthetic in-progress
    // row in useMeetings stays visible while a note is processing —
    // otherwise Home goes blank between "stopped" and "processed" and the
    // user can't see anything is happening in the background.
    sessionName: queue.data?.sessionName ?? queue.data?.currentJob ?? null,
    /** Set of summary files whose `reprocess-meeting` IPC is currently
     *  in flight. Used by useMeetings to flip the matching existing
     *  meeting rows' `is_processing` flag so Home shows the badge even
     *  when the user navigates away from MeetingDetail mid-reprocess.
     *  Set rather than array so consumers can do O(1) membership checks
     *  inside the meetings list map. */
    reprocessingSummaryFiles: reprocessingSummaryFiles,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isLoading: queue.isLoading,
  };
}

/**
 * Mount once at App level. Wires tray / shortcut / macOS-Shortcuts / global
 * hotkey events to start/stop recording, and tells main.js the renderer is
 * ready to receive shortcut events so any queued-from-launch URLs get
 * flushed.
 */
export function useRecordingEvents() {
  const { status, startRecording, stopRecording, pauseRecording, resumeRecording } = useRecording();

  React.useEffect(() => {
    const bridge = ipc();
    const toggle = () => {
      if (status === 'recording' || status === 'paused') void stopRecording();
      else if (status === 'idle') void startRecording();
    };
    const offs = [
      bridge.on.toggleRecordingHotkey(toggle),
      bridge.on.trayStartRecording(() => {
        void startRecording();
      }),
      bridge.on.trayStopRecording(() => {
        void stopRecording();
      }),
      bridge.on.shortcutStartRecording(({ sessionName }) => {
        void startRecording(sessionName ?? undefined);
      }),
      bridge.on.shortcutStopRecording(() => {
        void stopRecording();
      }),
      bridge.on.autoRecordRequested(({ sessionName }) => {
        // Suggested by the mic-monitor auto-detect notification ("Take Notes").
        // Only fire if we're idle — user may have already manually started.
        if (status === 'idle') void startRecording(sessionName ?? undefined);
      }),
      bridge.on.autoPauseRequested(() => {
        // Mic stopped on the meeting app — pause so we don't keep recording
        // ambient silence while waiting for user to confirm summarise.
        // No status guard: `status` is polled and can lag the main-side state
        // machine by up to a poll interval. If pause then resume fire back-to-
        // back, a stale 'recording' read here would skip the resume on the
        // companion handler below. Trust main (it already gates on its own
        // autoStartedSession state) and let pauseRecording's IPC validate.
        void pauseRecording();
      }),
      bridge.on.autoResumeRequested(() => {
        // Meeting came back before user clicked Summarise — keep capturing.
        // Same stale-status reason as autoPauseRequested above: don't gate
        // on the polled status, just trust that main only fires this when
        // its own state says we're paused.
        void resumeRecording();
      }),
      bridge.on.autoSummariseRequested(() => {
        // User clicked "Summarise" on the Meeting ended notification.
        if (status === 'recording' || status === 'paused') void stopRecording();
      }),
    ];
    bridge.shortcuts.rendererReady();
    return () => offs.forEach((off) => off());
  }, [status, startRecording, stopRecording, pauseRecording, resumeRecording]);
}

/**
 * Mount once at App level. The processing-complete listener does cache
 * pre-seeding + invalidation + post-recording navigation. Splitting this out
 * of useRecording keeps the side-effect singleton even though useRecording
 * itself is consumed by many components.
 */
export function useRecordingProcessingEffects() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const off = ipc().on.processingComplete((data) => {
      if (data.success && data.meetingData?.session_info.summary_file) {
        const newMeeting = data.meetingData as Meeting;
        const newSummaryFile = newMeeting.session_info.summary_file;
        qc.setQueryData<Meeting[]>(meetingsKeys.list(), (prev) => {
          if (!prev) return [newMeeting];
          const filtered = prev.filter(
            (m) => m.session_info.summary_file !== newSummaryFile,
          );
          return [newMeeting, ...filtered];
        });

        // Fire-and-forget auto-backup. Main does all the gating
        // (signed-in, toggle on, not-already-attempted), so the renderer
        // just hands it the formatted artifact and forgets. Failures are
        // silent — the manual Share button is the user-visible recovery
        // path. We invalidate the org meetings list on success so the
        // sidebar Shared Notes view updates without a refresh.
        const title = newMeeting.session_info.name || 'Untitled note';
        const body = composeShareBody(newMeeting);
        const transcript = pickTranscriptForShare(newMeeting);
        if (body) {
          ipc()
            .org.tryAutoBackup({
              summaryFile: newSummaryFile,
              title,
              body,
              transcript,
              visibility: 'org',
            })
            .then((res) => {
              if (res.attempted) {
                qc.invalidateQueries({ queryKey: orgKeys.meetings() });
                // Flip the MeetingDetail Share/Unshare toggle to
                // "Unshare" without waiting for staleTime — the user
                // may already be looking at the note.
                qc.invalidateQueries({ queryKey: orgKeys.backupState(newSummaryFile) });
              } else if (res.reason === 'upload-failed' || res.reason === 'error') {
                console.warn('[org-auto-backup] skipped:', res.reason, res.error);
              }
            })
            .catch((e) => {
              console.warn('[org-auto-backup] ipc failed:', e);
            });
        }
      }
      qc.invalidateQueries({ queryKey: meetingsKeys.all });
      qc.invalidateQueries({ queryKey: queueKey });
      // Clear any streamCache entry for the finished session. MeetingDetail
      // does its own cleanup when mounted (with a 400ms grace so the "done"
      // phase animates), but if the user navigated away mid-reprocess the
      // component-local listener gets torn down before the event arrives
      // and the cache stays stuck at 'generating'. This app-level
      // cleanup runs regardless of route so the next time the user opens
      // the note, the page reads fresh data instead of stale phase state.
      const summaryFileFromEvent =
        data.meetingData?.session_info.summary_file ?? data.summaryFile ?? null;
      if (summaryFileFromEvent) {
        streamCache.delete(summaryFileFromEvent);
      }
      // Clear the live-draft entry for this finished session so the next
      // "New note" with the same default sessionName ('Meeting' / 'Note')
      // doesn't inherit the previous title or notes.
      if (data.sessionName) {
        useLiveDraftStore.getState().clear(data.sessionName);
      }
      // The summary file lands here for both flows: recording-complete
      // carries it via meetingData; reprocess carries it as a top-level
      // summaryFile field (no meetingData). Treat both the same below.
      const finishedSummaryFile =
        data.meetingData?.session_info.summary_file ?? data.summaryFile ?? null;
      if (data.success && finishedSummaryFile) {
        const currentRoute = routeFromHash(window.location.hash);
        const finishedMeetingRoute = `/meetings/${encodeURIComponent(finishedSummaryFile)}`;
        if (currentRoute === '/meetings/processing') {
          // Watching it finish on the processing page → take them straight
          // into the now-ready note.
          navigate(finishedMeetingRoute);
        } else if (currentRoute !== finishedMeetingRoute) {
          // Anywhere else (Home, Chat, Settings, recording another note,
          // a different meeting's detail page) → fire a native "Note
          // ready" banner so the user knows their work-in-progress
          // finished. Route comparison rather than window-focus check on
          // purpose: it means a minimised Steno / alt-tabbed user who
          // *was* sitting on this note's detail page still doesn't get a
          // notification, because the route hasn't changed. They'll see
          // the static summary the moment they come back.
          //
          // Click just focuses Steno (mirrors the auto-stop notification)
          // — no navigation, so a back-to-back recording isn't yanked
          // out and the user can find the new note in the sidebar / Home
          // list at the top once Steno is focused.
          const title =
            data.meetingData?.session_info.name?.trim() ||
            data.sessionName?.trim() ||
            'Your note has finished processing';
          // Note: no `notifications_enabled` pre-check here — the IPC
          // handler in main.js gates internally via
          // `notificationsEnabled()` and short-circuits when the user
          // has Desktop notifications disabled in Settings. Doing a
          // round-trip from the renderer to fetch the setting before
          // firing this IPC would be a wasted poll. The gate stays
          // single-source-of-truth in main.
          void ipc()
            .settings.showNoteReadyNotification({ title })
            .catch(() => {
              // Notification failure isn't fatal — the note is still
              // visible in Home + sidebar. Don't bubble up.
            });
        }
        // else: on this note's own detail page → nothing. The streaming
        // UI's own listener swaps to the static view; no extra signal
        // needed.
      }
      // Clear the live-draft entry AFTER any other processing-complete
      // listeners (notably Processing.tsx's, which reads draft.title to
      // apply a custom rename). Deferring to the next microtask gives
      // those listeners a tick to consume the draft before we drop it.
      if (data.sessionName) {
        const sessionName = data.sessionName;
        queueMicrotask(() => {
          useLiveDraftStore.getState().clear(sessionName);
        });
      }
    });
    return off;
  }, [qc]);
}

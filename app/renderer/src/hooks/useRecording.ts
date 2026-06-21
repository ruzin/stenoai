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

// ── Shared window-visibility subscription ───────────────────────────────
//
// `useRecording` is consumed by 12+ components. If each consumer manages
// its own `visibilitychange` listener + useState, we end up with N
// listeners on `document` and N re-renders per consumer on every
// visibility flip. Hoist to module scope: one listener total, broadcast
// to subscribers via `useSyncExternalStore` so React still re-renders
// each consumer correctly.
const visibilitySubscribers = new Set<() => void>();
let visibilityListenerInstalled = false;

function ensureVisibilityListener() {
  if (visibilityListenerInstalled || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    for (const cb of visibilitySubscribers) cb();
  });
  visibilityListenerInstalled = true;
}

function subscribeVisibility(callback: () => void): () => void {
  ensureVisibilityListener();
  visibilitySubscribers.add(callback);
  return () => {
    visibilitySubscribers.delete(callback);
  };
}

function getVisibilitySnapshot(): boolean {
  return typeof document !== 'undefined'
    ? document.visibilityState === 'visible'
    : true;
}

// SSR fallback. Renderer-only today, but keeps useSyncExternalStore happy.
function getVisibilityServerSnapshot(): boolean {
  return true;
}

function useIsWindowVisible(): boolean {
  return React.useSyncExternalStore(
    subscribeVisibility,
    getVisibilitySnapshot,
    getVisibilityServerSnapshot,
  );
}

/** Stable empty-Set sentinel so consumers (useMeetings) don't see a
 *  fresh reference each render when there are no active reprocesses —
 *  keeps their useMemo deps shallow-equal and avoids re-mapping the
 *  whole meetings list every queue poll. */
const EMPTY_REPROCESS_SET: ReadonlySet<string> = new Set<string>();

export function useRecording() {
  const qc = useQueryClient();

  // Backed by a shared module-level listener (see useIsWindowVisible at
  // the top of this file) so 12+ useRecording consumers don't each
  // attach their own document listener.
  const isVisible = useIsWindowVisible();

  const queue = useQuery({
    queryKey: queueKey,
    queryFn: async () => {
      const res = await ipc().recording.getQueue();
      if (!res.success) throw new Error(res.error);
      return res;
    },
    refetchInterval: (query) => {
      // Hidden: 10s regardless of state. The user can't see a 1s update
      // anyway; when they bring the window back, react-query's
      // refetchOnWindowFocus + the visibilitychange listener flipping
      // isVisible will both trigger a fresh fetch.
      if (!isVisible) return 10_000;
      return query.state.data?.hasRecording ? 1000 : 2000;
    },
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
      // Clear any stale draft keyed under this same name. The live-draft
      // store is keyed by sessionName, and the most common case
      // (default 'Note') means back-to-back recordings collide on the
      // same key. Previously the draft was only cleared
      // on processing-complete, which can land minutes after the user
      // hits '+ New note' — meaning the new recording reads the previous
      // session's notes and shows them in the UI. Clearing here is
      // tighter: the new recording starts with a guaranteed-clean draft
      // before useLiveMeeting's `ensure` looks for one.
      //
      // Edge case: if the previous recording's draft.title was edited
      // (custom user rename), that rename is also cleared — Processing.tsx
      // applies the rename on processing-complete by reading the draft,
      // so it'll be lost. Acceptable trade-off: the leak case is common,
      // the rename case is rare and recoverable via manual rename
      // post-processing.
      //
      // Snapshot before clearing so we can put it back if start-recording
      // fails — without restore, a transient IPC error would silently drop
      // the previous session's in-memory state.
      const priorDraft = useLiveDraftStore.getState().drafts[optimisticName];
      useLiveDraftStore.getState().clear(optimisticName);
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
        // Restore the prior draft too — the recording never started so the
        // previous session (probably still mid-processing) shouldn't lose
        // its in-memory title / notes.
        if (priorDraft) {
          useLiveDraftStore.getState().restore(optimisticName, priorDraft);
        }
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
      // 'processing' is the post-stop, pre-summary state. Treat it like
      // idle for start purposes — the previous note keeps summarising in
      // the background queue while a new recording starts. Matches the
      // Home empty-state CTA + UpcomingCard click behaviour so the hotkey
      // doesn't silently no-op when a user is doing back-to-back notes.
      if (status === 'recording' || status === 'paused') void stopRecording();
      else void startRecording();
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
        // Allow start when idle OR when a previous note is still processing
        // — the user explicitly opted in by clicking "Take Notes", and the
        // background queue handles the previous summary fine. Only skip if
        // an active recording (recording/paused) is already in progress —
        // user already manually started or is mid-meeting.
        if (status === 'recording' || status === 'paused') return;
        void startRecording(sessionName ?? undefined);
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
        // Never auto-backup a transcription failure — it has no real notes,
        // only the failure message, and shouldn't propagate to the org. Check
        // both the event flag and the authoritative meeting marker.
        const isFailedNote =
          Boolean(data.transcriptionFailed) ||
          Boolean(newMeeting.session_info.transcription_failed);
        if (body && !isFailedNote) {
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
                // Only 'upload-failed' persists a failure in main (the outer
                // 'error' catch deliberately doesn't); refresh the per-note
                // backup state so the note-detail "Not backed up" chip appears
                // without waiting for staleTime.
                if (res.reason === 'upload-failed') {
                  qc.invalidateQueries({ queryKey: orgKeys.backupState(newSummaryFile) });
                }
              }
            })
            .catch((e) => {
              console.warn('[org-auto-backup] ipc failed:', e);
            });
        }
      }
      // Hard processing crash (process-streaming non-zero exit): no note was
      // written, so the synthetic processing row is about to vanish on the
      // queue invalidation below with nothing to show for it. Surface a
      // failure notification keyed on the session so an import/recording that
      // dies in the background doesn't just silently disappear. The graceful
      // transcription-failure path takes the success:true branch above (it
      // writes a marked note), so this only fires for true crashes.
      if (!data.success) {
        void ipc()
          .settings.showNoteReadyNotification({
            title: data.sessionName?.trim() || 'your note',
            failed: true,
            hardFailure: true,
          })
          .catch(() => {
            // Notification failure isn't fatal — nothing else to fall back to.
          });
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
      // "New note" with the same default sessionName ('Note') doesn't
      // inherit the previous title or notes.
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
            .settings.showNoteReadyNotification({
              title,
              failed:
                Boolean(data.transcriptionFailed) ||
                Boolean(data.meetingData?.session_info.transcription_failed),
            })
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

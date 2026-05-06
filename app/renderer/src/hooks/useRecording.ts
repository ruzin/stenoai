import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { meetingsKeys } from './meetingKeys';
import { navigate } from '@/lib/router';
import type { Meeting, QueueStatus } from '@/lib/ipc';

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing';

const queueKey = ['recording', 'queue'] as const;

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

  React.useEffect(() => {
    const off = ipc().on.processingComplete((data) => {
      // Pre-seed the meetings list cache with the freshly processed meeting
      // so MeetingDetail can find it on first render -- otherwise the brief
      // window between navigation and the refetch landing shows "not found".
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
      }
      qc.invalidateQueries({ queryKey: meetingsKeys.all });
      qc.invalidateQueries({ queryKey: queueKey });
      if (data.success && data.meetingData?.session_info.summary_file) {
        navigate(`/meetings/${encodeURIComponent(data.meetingData.session_info.summary_file)}`);
      }
    });
    return off;
  }, [qc]);

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
    sessionName: queue.data?.sessionName ?? null,
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
  const { status, startRecording, stopRecording } = useRecording();

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
    ];
    bridge.shortcuts.rendererReady();
    return () => offs.forEach((off) => off());
  }, [status, startRecording, stopRecording]);
}

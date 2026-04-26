import * as React from 'react';
import { useRecording } from '@/hooks/useRecording';
import { useSaveMeetingNotes } from '@/hooks/useMeetings';
import { useLiveDraftStore } from '@/hooks/liveDraftStore';

export function useLiveMeeting() {
  const recording = useRecording();
  const saveNotes = useSaveMeetingNotes();

  const sessionName = recording.sessionName;
  const status = recording.status;
  const active = status === 'recording' || status === 'paused';

  const draft = useLiveDraftStore((s) =>
    sessionName ? s.drafts[sessionName] : undefined,
  );
  const ensure = useLiveDraftStore((s) => s.ensure);
  const setTitleStore = useLiveDraftStore((s) => s.setTitle);
  const setNotesStore = useLiveDraftStore((s) => s.setNotes);

  // Initialize the draft entry the first time we see a sessionName.
  React.useEffect(() => {
    if (!sessionName) return;
    const startedAtMs = Date.now() - recording.elapsed * 1000;
    ensure(sessionName, { startedAtMs });
  }, [sessionName, recording.elapsed, ensure]);

  // Debounced notes save. Re-arm on every notes change; flush after 500 ms.
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const setNotes = React.useCallback(
    (next: string) => {
      if (!sessionName) return;
      setNotesStore(sessionName, next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveNotes.mutate({ name: sessionName, notes: next });
      }, 500);
    },
    [sessionName, setNotesStore, saveNotes],
  );

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const setTitle = React.useCallback(
    (next: string) => {
      if (!sessionName) return;
      setTitleStore(sessionName, next);
    },
    [sessionName, setTitleStore],
  );

  return {
    active,
    sessionName,
    status,
    elapsed: recording.elapsed,
    title: draft?.title ?? sessionName ?? '',
    notes: draft?.notes ?? '',
    startedAt: draft ? new Date(draft.startedAtMs) : null,
    setTitle,
    setNotes,
  };
}

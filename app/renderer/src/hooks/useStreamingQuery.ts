import * as React from 'react';
import { ipc } from '@/lib/ipc';

export type StreamStatus = 'streaming' | 'done' | 'error';

export interface StreamState {
  text: string;
  status: StreamStatus;
  error: string | null;
}

function newId() {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useStreamingQuery() {
  const [streams, setStreams] = React.useState<Record<string, StreamState>>({});
  const unsubsRef = React.useRef<Map<string, () => void>>(new Map());
  const activeRef = React.useRef<Set<string>>(new Set());

  const startStream = React.useCallback((file: string, question: string): string => {
    const id = newId();
    setStreams((prev) => ({
      ...prev,
      [id]: { text: '', status: 'streaming', error: null },
    }));
    activeRef.current.add(id);

    const off = ipc().subscribeQueryStream(id, {
      onChunk: (chunk) => {
        setStreams((prev) => {
          const current = prev[id];
          if (!current) return prev;
          return { ...prev, [id]: { ...current, text: current.text + chunk } };
        });
      },
      onDone: () => {
        setStreams((prev) => {
          const current = prev[id];
          if (!current) return prev;
          return { ...prev, [id]: { ...current, status: 'done' } };
        });
        activeRef.current.delete(id);
      },
      onError: (err) => {
        setStreams((prev) => {
          const current = prev[id];
          if (!current) return prev;
          return { ...prev, [id]: { ...current, status: 'error', error: err.message } };
        });
        activeRef.current.delete(id);
      },
    });
    unsubsRef.current.set(id, off);
    ipc().query.askStream(id, file, question);
    return id;
  }, []);

  const cancelStream = React.useCallback((id: string) => {
    const off = unsubsRef.current.get(id);
    off?.();
    unsubsRef.current.delete(id);
    ipc().query.cancel(id);
    setStreams((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return { ...prev, [id]: { ...current, status: 'done' } };
    });
    activeRef.current.delete(id);
  }, []);

  const clearStream = React.useCallback((id: string) => {
    setStreams((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  React.useEffect(() => {
    return () => {
      for (const off of unsubsRef.current.values()) off();
      unsubsRef.current.clear();
      for (const id of activeRef.current) {
        try {
          ipc().query.cancel(id);
        } catch {
          // bridge may already be torn down
        }
      }
      activeRef.current.clear();
    };
  }, []);

  return { streams, startStream, cancelStream, clearStream };
}

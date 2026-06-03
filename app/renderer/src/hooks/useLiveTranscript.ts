import * as React from 'react';
import { ipc, type LiveSegment } from '@/lib/ipc';

export type LiveTranscriptStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'error';

export interface UseLiveTranscriptResult {
  status: LiveTranscriptStatus;
  segments: LiveSegment[];
  /** Last error reported by the Python consumer (model load failure, MLX
   *  missing, etc.). Null on success. */
  error: { stage: string; message?: string } | null;
}

/**
 * Subscribes to Parakeet live-transcript events for the active recording.
 *
 * Flow:
 *   1. On mount, snapshot the buffer that main.js has been accumulating
 *      since the recording started — this catches a late-mounting panel up
 *      with any segments it missed.
 *   2. Subscribe to `live-transcript-chunk` for the tail. Finals append;
 *      partials replace the trailing partial entry.
 *   3. Track ready/error state via the dedicated channels so the UI can
 *      distinguish "no speech yet" from "model still loading" from
 *      "model failed to load."
 *
 * The hook is safe to mount with no active recording — `getState` returns
 * an empty segments array and the status stays `idle`.
 */
export function useLiveTranscript(sessionName: string | null): UseLiveTranscriptResult {
  const [segments, setSegments] = React.useState<LiveSegment[]>([]);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<{ stage: string; message?: string } | null>(null);

  // Backfill on mount + every session change. Calling getState resets the
  // local view to whatever main.js has buffered for this session.
  React.useEffect(() => {
    let cancelled = false;
    setSegments([]);
    setReady(false);
    setError(null);
    if (!sessionName) return;
    ipc()
      .liveTranscript.getState()
      .then((res) => {
        if (cancelled || !res.success) return;
        // Only backfill if the buffer is actually for this session — main.js
        // resets on each new recording, so a stale name means we missed the
        // boundary; render empty.
        if (res.sessionName !== sessionName) return;
        setSegments(res.segments);
        setReady(res.ready);
        if (res.error) {
          setError({ stage: res.error.stage, message: res.error.message ?? res.error.error });
        }
      })
      .catch(() => {
        // Best-effort backfill; subscription below still works.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionName]);

  React.useEffect(() => {
    if (!sessionName) return;

    const offReady = ipc().on.liveTranscriptReady((ev) => {
      if (ev.sessionName !== sessionName) return;
      setReady(true);
      setError(null);
    });

    const offChunk = ipc().on.liveTranscriptChunk((ev) => {
      if (ev.sessionName !== sessionName) return;
      setSegments((prev) => {
        if (ev.segment.isFinal) {
          // Append-only on final. If the previous tail was a partial, it's
          // promoted (replaced by the final) — Parakeet's contract is that
          // a new sentence supersedes the previous tail.
          const tail = prev[prev.length - 1];
          if (tail && !tail.isFinal) {
            return [...prev.slice(0, -1), ev.segment];
          }
          return [...prev, ev.segment];
        }
        // Partial: overwrite the trailing partial, otherwise append.
        const tail = prev[prev.length - 1];
        if (tail && !tail.isFinal) {
          return [...prev.slice(0, -1), ev.segment];
        }
        return [...prev, ev.segment];
      });
    });

    const offError = ipc().on.liveTranscriptError((ev) => {
      if (ev.sessionName !== sessionName) return;
      setError({ stage: ev.stage, message: ev.message ?? ev.error });
    });

    return () => {
      offReady();
      offChunk();
      offError();
    };
  }, [sessionName]);

  const status: LiveTranscriptStatus = error
    ? 'error'
    : !sessionName
      ? 'idle'
      : segments.length > 0 || ready
        ? 'streaming'
        : 'loading';

  return { status, segments, error };
}

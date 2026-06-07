import * as React from 'react';
import { ipc, type LiveSegment } from '@/lib/ipc';
import { decideSpeaker } from '@/lib/liveRmsBuffer';

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
  // Per-session marker that flips true the moment any subscription event
  // arrives. The backfill (getState resolves async) checks it before
  // applying its snapshot — if a chunk landed first, the snapshot is
  // older than what we already have and would clobber live updates.
  const receivedEventRef = React.useRef(false);

  React.useEffect(() => {
    // Reset state for the new session. Doing this in the same effect as
    // the subscription guarantees the marker resets BEFORE any chunk
    // event can fire for the new session.
    receivedEventRef.current = false;
    setSegments([]);
    setReady(false);
    setError(null);

    if (!sessionName) return;

    // Subscribe FIRST so chunks arriving while getState is in flight are
    // captured (not lost behind a still-pending resolve).
    const offReady = ipc().on.liveTranscriptReady((ev) => {
      if (ev.sessionName !== sessionName) return;
      receivedEventRef.current = true;
      setReady(true);
      setError(null);
    });

    const offChunk = ipc().on.liveTranscriptChunk((ev) => {
      if (ev.sessionName !== sessionName) return;
      receivedEventRef.current = true;
      // Attribute the speaker from the per-channel RMS buffer the
      // useSystemAudioCapture hook populates. Decided here (not in
      // useSystemAudioCapture, not in main.js) because the decision
      // depends on the segment's start/end which only exist on the
      // LIVE_SEG event. Mic-only recordings: no system channel, no
      // samples in the buffer → decideSpeaker returns 'You' which
      // matches the TranscriptPanel charitable default.
      const segment: LiveSegment = {
        ...ev.segment,
        speaker: decideSpeaker(ev.segment.start, ev.segment.end),
      };
      setSegments((prev) => {
        if (segment.isFinal) {
          // Append-only on final. If the previous tail was a partial, it's
          // promoted (replaced by the final) — Parakeet's contract is that
          // a new sentence supersedes the previous tail.
          const tail = prev[prev.length - 1];
          if (tail && !tail.isFinal) {
            return [...prev.slice(0, -1), segment];
          }
          return [...prev, segment];
        }
        // Partial: overwrite the trailing partial, otherwise append.
        const tail = prev[prev.length - 1];
        if (tail && !tail.isFinal) {
          return [...prev.slice(0, -1), segment];
        }
        return [...prev, segment];
      });
    });

    const offError = ipc().on.liveTranscriptError((ev) => {
      if (ev.sessionName !== sessionName) return;
      receivedEventRef.current = true;
      setError({ stage: ev.stage, message: ev.message ?? ev.error });
    });

    // Now backfill. If a live event arrived between subscribe and resolve,
    // skip the snapshot — the subscription has fresher data.
    let cancelled = false;
    ipc()
      .liveTranscript.getState()
      .then((res) => {
        if (cancelled || !res.success) return;
        if (res.sessionName !== sessionName) return;
        if (receivedEventRef.current) return;
        // Attribute each backfilled segment from the same RMS buffer. The
        // RMS samples for these segments were captured at the time the
        // chunks streamed through, so decideSpeaker is a meaningful lookup
        // even though the segments were stored before this hook mounted.
        const attributed: LiveSegment[] = res.segments.map((seg) => ({
          ...seg,
          speaker: decideSpeaker(seg.start, seg.end),
        }));
        setSegments(attributed);
        setReady(res.ready);
        if (res.error) {
          setError({ stage: res.error.stage, message: res.error.message ?? res.error.error });
        }
      })
      .catch(() => {
        // Best-effort backfill; subscription is the source of truth.
      });

    return () => {
      cancelled = true;
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

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
  /** True once the model has been in `loading` for longer than the soft
   *  threshold (~2s) — lets the UI soften "preparing" copy to acknowledge
   *  an unavoidable cold load rather than looking frozen. */
  slow: boolean;
}

/** 'You' | 'Others', normalised the same way the UI's charitable default
 *  treats a missing/undefined speaker tag. */
function speakerKey(segment: LiveSegment): 'You' | 'Others' {
  return segment.speaker === 'Others' ? 'Others' : 'You';
}

/**
 * Insert a LIVE_SEG update into the segment list, maintaining the same
 * invariant main.js keeps on `liveTranscriptState.segments`: chronologically
 * sorted finals first, followed by at most one in-progress partial per
 * speaker trailing at the end.
 *
 * Two independent channels (mic + system) emit interleaved streams, so a
 * naive "replace whatever the last array entry is" would clobber one
 * channel's in-progress partial with the other's the moment they overlap,
 * and a final released late by the live path's bleed-dedup hold (up to
 * PER_SEGMENT_BLEED_WINDOW_S) could land out of chronological order
 * relative to a still-ongoing utterance on the other channel. Splitting
 * finals from trailing partials and inserting each in its own lane fixes
 * both.
 */
function insertLiveSegment(prev: LiveSegment[], segment: LiveSegment): LiveSegment[] {
  let splitIdx = prev.length;
  while (splitIdx > 0 && !prev[splitIdx - 1].isFinal) splitIdx--;
  const finals = prev.slice(0, splitIdx);
  const partials = prev.slice(splitIdx);
  const key = speakerKey(segment);
  if (segment.isFinal) {
    let insertAt = finals.length;
    while (insertAt > 0 && finals[insertAt - 1].start > segment.start) insertAt--;
    const nextFinals = [...finals.slice(0, insertAt), segment, ...finals.slice(insertAt)];
    // Only drop a same-speaker partial if it could plausibly BE the
    // utterance this final supersedes (started before this final's
    // utterance ended). A bleed-delayed final can arrive well after the
    // SAME speaker has already started a newer, unrelated utterance —
    // dropping every same-speaker partial indiscriminately would clobber
    // that unrelated one until its next partial tick.
    const remainingPartials = partials.filter(
      (s) => speakerKey(s) !== key || s.start > segment.end,
    );
    return [...nextFinals, ...remainingPartials];
  }
  const otherPartials = partials.filter((s) => speakerKey(s) !== key);
  return [...finals, ...otherPartials, segment];
}

/**
 * Subscribes to Parakeet live-transcript events for the active recording.
 *
 * Flow:
 *   1. On mount, snapshot the buffer that main.js has been accumulating
 *      since the recording started — this catches a late-mounting panel up
 *      with any segments it missed. main.js maintains the same
 *      finals-then-per-speaker-partials invariant, so the snapshot is used
 *      as-is.
 *   2. Subscribe to `live-transcript-chunk` for the tail and fold each
 *      update in via `insertLiveSegment` (see above for why a naive
 *      replace-the-tail approach doesn't work with two channels).
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
      // ev.segment.speaker already carries the true mic/system channel
      // tag from the Python sidecar — no client-side attribution needed.
      const segment: LiveSegment = ev.segment;
      setSegments((prev) => insertLiveSegment(prev, segment));
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
        // Backfilled segments already carry their true speaker tag —
        // main.js stores it verbatim in liveTranscriptState.segments.
        setSegments(res.segments);
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

  // Flip `slow` once the model has been loading past the soft threshold. The
  // 2s mark is where an unavoidable cold load stops reading as a blink and
  // starts feeling like a hang. The timer (and its reset) live off the effect
  // body — set on timeout, cleared on leaving the loading state — so we never
  // call setState synchronously during render. `sessionName` in the deps
  // restarts the clock for each new recording.
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    if (status !== 'loading') return;
    const id = window.setTimeout(() => setSlow(true), 2000);
    return () => {
      window.clearTimeout(id);
      setSlow(false);
    };
  }, [status, sessionName]);

  return { status, segments, error, slow };
}

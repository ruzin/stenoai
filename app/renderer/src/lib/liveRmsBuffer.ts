/**
 * Rolling per-channel RMS buffer for live speaker attribution.
 *
 * useSystemAudioCapture samples mic + system RMS at LIVE_RMS_HZ and
 * pushes samples here. useLiveTranscript queries this buffer when a new
 * segment arrives (LIVE_SEG events carry start/end seconds since
 * recording start) and decides the speaker from the per-channel energy
 * over that window.
 *
 * Implemented as a module-level mutable singleton — consumers don't need
 * React reactivity (they only read on segment arrival, not every render)
 * and a zustand store would buy us nothing over a plain ring buffer.
 *
 * Time coordinate: seconds since recording start. The renderer chooses
 * the origin (resetBuffer() is called at recording-start in the same
 * effect that arms the silence-auto-stop poll), and the Python pipeline
 * naturally starts its own cursor at 0 when chunks first arrive. The
 * two clocks drift by at most one chunk's worth of latency (~256 ms),
 * well under the speaker-attribution accuracy we need.
 */

export interface LiveRmsSample {
  /** Seconds since recording start, matching LIVE_SEG's start/end coordinate. */
  tSec: number;
  micRms: number;
  sysRms: number;
}

export type LiveSpeaker = 'You' | 'Others';

/** Sampling rate of the underlying interval in useSystemAudioCapture. */
export const LIVE_RMS_HZ = 10;
/** Rolling window cap. Sized for the longest plausible recording rather
 *  than the longest single VAD utterance — useLiveTranscript's backfill
 *  path (getState → decideSpeaker per segment) needs RMS coverage for
 *  segments older than the current utterance, so a 60 s cap would
 *  silently mis-attribute everything past the first minute as 'You'.
 *  3600 s at 10 Hz = 36 000 entries × ~24 bytes each ≈ 850 KB, which is
 *  fine for the renderer process. */
const BUFFER_CAP_S = 3600;
const BUFFER_CAP_SAMPLES = LIVE_RMS_HZ * BUFFER_CAP_S;

const buffer: LiveRmsSample[] = [];

export function resetRmsBuffer(): void {
  buffer.length = 0;
}

export function pushRmsSample(sample: LiveRmsSample): void {
  buffer.push(sample);
  if (buffer.length > BUFFER_CAP_SAMPLES) {
    // Drop oldest. Spliced rather than shift() to amortise the cost when
    // a burst of samples lands at once (e.g. tab visibility change
    // catching up on missed RAF frames).
    buffer.splice(0, buffer.length - BUFFER_CAP_SAMPLES);
  }
}

/**
 * Decide who spoke during [startSec, endSec] from the energy ratio
 * between channels.
 *
 *  - System below SPEECH_FLOOR: loopback is silent (noise floor only),
 *    so there's no plausible Others speaker. Tag You regardless of
 *    mic. Without this, mic-only recordings with system_audio_enabled
 *    set to true (default) would occasionally mis-tag random segments
 *    as Others because mic-quantisation noise nudged sysMean past
 *    micMean during a silent dip.
 *  - Ratio >= 1.5 in either direction: confident attribution.
 *  - Ratio between (1/1.5, 1.5): both channels roughly equal energy.
 *    This is the bleed case (mic picks up speaker echo at similar
 *    amplitude to the loopback). Default to 'You' — the recording
 *    mechanically belongs to the mic owner, and the existing
 *    post-stop charitable rule does the same.
 *  - No samples in the window (recording just started, or window
 *    predates the buffer): default to 'You'.
 *
 * Threshold chosen empirically — 1.5x is ~3.5 dB, which is the gap you
 * typically see between direct speech and reflected/loopback speech
 * even in moderate bleed conditions. Tighter (e.g. 1.2x) would force
 * more segments into the bleed-default bucket; looser (e.g. 2.0x)
 * would falsely tag real Others speech as You when the system audio
 * is quiet.
 */
const SPEAKER_RATIO_THRESHOLD = 1.5;
// Empirical RMS floor below which "system audio" is just the loopback's
// noise floor, not real audio. Conversational speech reaching the
// loopback typically reads 0.01-0.05; this catches "silence-with-
// quantisation-noise" at 0.001-0.003 and prevents it from triggering
// an Others attribution against a quiet mic dip.
const SPEECH_FLOOR = 0.005;

/** Lower-bound binary search for the first index with `tSec >= target`.
 *  Buffer is monotonic by tSec (we push from setInterval, time only
 *  moves forward), so this is sound. Returns buffer.length if every
 *  entry is below the target. */
function lowerBoundIndex(target: number): number {
  let lo = 0;
  let hi = buffer.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (buffer[mid].tSec < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function decideSpeaker(startSec: number, endSec: number): LiveSpeaker {
  // Clamp to a sensible minimum window — a 0-duration segment shouldn't
  // sample everything. Take ±100 ms of slack so a sub-100 ms segment
  // still yields at least one sample.
  const lo = Math.min(startSec, endSec) - 0.1;
  const hi = Math.max(startSec, endSec) + 0.1;
  // O(log N + range) instead of O(N). At BUFFER_CAP_S=3600 the buffer
  // holds ~36 000 entries, and decideSpeaker is called per LIVE_SEG
  // event — linear scans add up over a long recording. The range
  // (samples actually inside [lo, hi]) is typically 20-50 entries.
  let micSum = 0;
  let sysSum = 0;
  let count = 0;
  for (let i = lowerBoundIndex(lo); i < buffer.length; i++) {
    const s = buffer[i];
    if (s.tSec > hi) break;
    micSum += s.micRms;
    sysSum += s.sysRms;
    count += 1;
  }
  if (count === 0) return 'You';
  const micMean = micSum / count;
  const sysMean = sysSum / count;
  // No real audio on the loopback — system_audio is enabled but nothing
  // is actually playing. There's no plausible 'Others' speaker, so
  // don't let mic-quantisation noise tag random segments as Others.
  if (sysMean < SPEECH_FLOOR) return 'You';
  if (micMean >= sysMean * SPEAKER_RATIO_THRESHOLD) return 'You';
  if (sysMean >= micMean * SPEAKER_RATIO_THRESHOLD) return 'Others';
  return 'You';
}

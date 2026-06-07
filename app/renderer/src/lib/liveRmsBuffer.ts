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

export function decideSpeaker(startSec: number, endSec: number): LiveSpeaker {
  // Clamp to a sensible minimum window — a 0-duration segment shouldn't
  // sample everything. Take ±100 ms of slack so a sub-100 ms segment
  // still yields at least one sample.
  const lo = Math.min(startSec, endSec) - 0.1;
  const hi = Math.max(startSec, endSec) + 0.1;
  let micSum = 0;
  let sysSum = 0;
  let count = 0;
  // buffer is append-only by time — could binary search, but the buffer
  // is bounded at 600 entries (60 s * 10 Hz) so a linear scan is fine.
  for (const s of buffer) {
    if (s.tSec < lo) continue;
    if (s.tSec > hi) break;
    micSum += s.micRms;
    sysSum += s.sysRms;
    count += 1;
  }
  if (count === 0) return 'You';
  const micMean = micSum / count;
  const sysMean = sysSum / count;
  if (sysMean === 0) return micMean === 0 ? 'You' : 'You';
  if (micMean === 0) return 'Others';
  if (micMean >= sysMean * SPEAKER_RATIO_THRESHOLD) return 'You';
  if (sysMean >= micMean * SPEAKER_RATIO_THRESHOLD) return 'Others';
  return 'You';
}

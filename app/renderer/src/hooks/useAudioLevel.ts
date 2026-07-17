import * as React from 'react';
import { useMicrophoneSetting } from './useSettings';

interface UseAudioLevelOptions {
  /** When false, the hook tears down the audio graph and returns zeros. */
  enabled: boolean;
  /** Number of bars to produce. */
  bars: number;
  /** Smoothing 0..1 (higher = more inertia). Default 0.55. */
  smoothing?: number;
  /** Min visible amplitude (0..1) so silent bars don't fully collapse. */
  floor?: number;
}

/**
 * Reads the renderer's microphone via getUserMedia and returns N normalized
 * frequency levels (0..1) sampled at ~20 Hz. Works alongside the Python
 * recording subprocess — macOS allows multiple readers on the same input
 * device.
 *
 * Permission errors are swallowed silently; the returned array stays at the
 * floor value so the UI degrades to a flat shimmer.
 */
export function useAudioLevel({
  enabled,
  bars,
  smoothing = 0.55,
  floor = 0.05,
}: UseAudioLevelOptions): number[] {
  const [levels, setLevels] = React.useState<number[]>(() =>
    new Array(bars).fill(floor),
  );
  // Mirrors the same pinned-device setting the actual recording capture uses
  // (useSystemAudioCapture.ts), so this level meter visualizes the mic that's
  // actually being recorded rather than always the OS default. Tracked live
  // here, but the capture effect below only reads it at the moment a session
  // STARTS (enabled flips false -> true) and freezes it for that session's
  // duration — matching useSystemAudioCapture.ts's own semantics, where the
  // pin is read once at recording start, not live. Without that freeze,
  // changing the Settings > Microphone pin mid-recording would make this
  // meter visualize a DIFFERENT device than what's actually being captured.
  const microphone = useMicrophoneSetting();
  const pinnedDeviceIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    pinnedDeviceIdRef.current = microphone.data?.device_id ?? null;
  }, [microphone.data?.device_id]);

  React.useEffect(() => {
    if (!enabled) {
      setLevels(new Array(bars).fill(floor));
      return;
    }
    const pinnedDeviceId = pinnedDeviceIdRef.current;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let raf: number | null = null;
    let lastUpdate = 0;
    const smoothed = new Array(bars).fill(floor);

    void (async () => {
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: pinnedDeviceId ? { deviceId: { exact: pinnedDeviceId } } : true,
          });
        } catch (err) {
          // Only fall back to the system default on a genuinely-missing
          // device — matches useSystemAudioCapture.ts's own rule. Falling
          // back on any error (e.g. NotReadableError/NotAllowedError) would
          // let the meter visualize a different mic than what's actually
          // being recorded.
          const isMissingDeviceError =
            err instanceof DOMException &&
            (err.name === 'OverconstrainedError' || err.name === 'NotFoundError');
          if (!pinnedDeviceId || !isMissingDeviceError) throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.4;
        src.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = (now: number) => {
          if (cancelled || !analyser) return;
          // Throttle React updates to ~20 Hz.
          if (now - lastUpdate >= 50) {
            lastUpdate = now;
            analyser.getByteFrequencyData(data);
            // Sample evenly across the lower-mid range (skip top bins —
            // mostly noise above ~6 kHz for speech).
            const usable = Math.floor(data.length * 0.7);
            const next = new Array(bars);
            for (let i = 0; i < bars; i++) {
              const idx = Math.floor((i * usable) / bars);
              const v = data[idx] / 255;
              const prev = smoothed[i];
              const blended = prev * smoothing + v * (1 - smoothing);
              smoothed[i] = blended;
              next[i] = Math.max(floor, blended);
            }
            setLevels(next);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // Permission denied / no device — leave levels at floor.
      }
    })();

    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      if (analyser) analyser.disconnect();
      if (ctx) ctx.close().catch(() => {});
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, bars, smoothing, floor]);

  return levels;
}

import * as React from 'react';
import { ipc } from '@/lib/ipc';
import {
  LIVE_RMS_HZ,
  pushRmsSample,
  resetRmsBuffer,
} from '@/lib/liveRmsBuffer';
import { useRecording } from './useRecording';
import { useTranscriptionEngine } from './useModels';
import {
  useSystemAudioSetting,
  useSystemAudioSupport,
  useSilenceAutoStopSetting,
} from './useSettings';

/** Hardcoded RMS floor (0..1, computed on the time-domain samples from an
 *  AnalyserNode). Above this on either mic OR system audio counts as
 *  "active." Tuned empirically to ignore desk-fan / room-tone noise but
 *  catch any actual speech or media playback. Not user-configurable —
 *  exposing this just creates a knob no one tunes correctly. */
const SILENCE_RMS_THRESHOLD = 0.01;
const SILENCE_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Mounts ONCE at App level. When system audio is enabled and the user starts
 * recording, captures BOTH mic (getUserMedia) and system loopback
 * (getDisplayMedia routed through CoreAudio Process Taps via
 * `electron-audio-loopback` with forceCoreAudioTap) and emits a single
 * STEREO WebM/Opus blob with **mic in channel 0 (L), system in channel 1
 * (R)**. The backend's `transcribe_diarised` (src/transcriber.py) detects
 * the stereo layout, splits the channels, transcribes each separately with
 * per-segment timestamps, and emits a chronologically interleaved
 * `[You]` / `[Others]` transcript that TranscriptPanel renders as
 * alternating speaker bubbles.
 *
 * macOS 14.4+ only — older versions are gated out at the Settings toggle.
 * This hook also short-circuits if support reports false, so an older
 * machine never reaches getDisplayMedia.
 *
 * The Python `record` subprocess is bypassed in this mode (main.js skips
 * spawning it on start-recording-ui) so we don't end up with two parallel
 * recordings → two notes.
 */
export function useSystemAudioCapture() {
  const { status, sessionName } = useRecording();
  const systemAudio = useSystemAudioSetting();
  const systemAudioSupport = useSystemAudioSupport();
  const engineQuery = useTranscriptionEngine();
  // Whisper recordings have no live transcript: the transcribe-stream
  // sidecar isn't spawned by main.js, so any chunks we'd push would be
  // silently dropped. Skip the tap setup entirely on whisper.
  const liveTapEnabled = (engineQuery.data ?? 'parakeet') === 'parakeet';
  // Read into a ref so the tap callback (closed over once at startCapture)
  // can be a no-op if the engine flips mid-recording without rebuilding
  // the AudioContext graph.
  const liveTapEnabledRef = React.useRef(liveTapEnabled);
  React.useEffect(() => {
    liveTapEnabledRef.current = liveTapEnabled;
  }, [liveTapEnabled]);
  // While the support query is still loading (data === undefined), assume
  // supported so a fast user who hits record before the IPC resolves still
  // gets system audio. The result-aware false case only fires after the
  // query has confirmed the OS is unsupported.
  const enabled = (systemAudio.data ?? false) && (systemAudioSupport.data?.supported ?? true);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const sysStreamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const mixedStreamRef = React.useRef<MediaStream | null>(null);
  // Serialises the incremental writes: each MediaRecorder timeslice is
  // appended to the open on-disk file through this chain so chunks land in
  // arrival order regardless of how their arrayBuffer() promises resolve.
  // Disk is the buffer now — there is no in-memory chunk array.
  const appendChainRef = React.useRef<Promise<void>>(Promise.resolve());
  // Latches on the first failed chunk append so we surface the failure once
  // (not once per second) and don't claim a clean recording when the on-disk
  // file is actually truncated.
  const appendFailedRef = React.useRef(false);
  const sessionNameRef = React.useRef<string | null>(null);
  const activeRef = React.useRef(false);
  // Bumped by stopCapture so any in-flight startCapture awaiting
  // getUserMedia/getDisplayMedia knows it's been cancelled and aborts
  // before installing the streams it just acquired.
  const startTokenRef = React.useRef(0);
  // Silence-auto-stop detector lives alongside the MediaRecorder. The
  // setting and pause state are read via refs so the polling loop sees
  // current values without re-creating the interval.
  const silenceIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // Higher-cadence interval that feeds the per-channel RMS buffer
  // useLiveTranscript reads from to attribute each LIVE_SEG to You vs
  // Others. Kept separate from the silence-auto-stop interval (1 Hz):
  // the silence detector is decision-heavy and runs cheap; speaker
  // attribution needs finer time resolution (~100 ms) than 1 s.
  const rmsIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceConfigRef = React.useRef<{ enabled: boolean; minutes: number }>({
    enabled: true,
    minutes: 15,
  });
  const isPausedRef = React.useRef(false);
  const silenceAutoStop = useSilenceAutoStopSetting();
  React.useEffect(() => {
    if (silenceAutoStop.data) {
      silenceConfigRef.current = {
        enabled: silenceAutoStop.data.enabled,
        minutes: silenceAutoStop.data.minutes,
      };
    }
  }, [silenceAutoStop.data]);
  React.useEffect(() => {
    isPausedRef.current = status === 'paused';
  }, [status]);

  React.useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);

  React.useEffect(() => {
    const bridge = ipc();

    const teardownSilenceDetector = () => {
      if (silenceIntervalRef.current !== null) {
        clearInterval(silenceIntervalRef.current);
        silenceIntervalRef.current = null;
      }
    };

    const teardownRmsSampler = () => {
      if (rmsIntervalRef.current !== null) {
        clearInterval(rmsIntervalRef.current);
        rmsIntervalRef.current = null;
      }
      // Don't reset the buffer on teardown — useLiveTranscript may still
      // be processing the final LIVE_SEG events that arrived after
      // recorder.stop(). Reset only happens at the START of the next
      // recording.
    };

    const teardownStreams = () => {
      teardownSilenceDetector();
      teardownRmsSampler();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      sysStreamRef.current?.getTracks().forEach((t) => t.stop());
      mixedStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => { /* already closed */ });
      }
      micStreamRef.current = null;
      sysStreamRef.current = null;
      mixedStreamRef.current = null;
      audioCtxRef.current = null;
      recorderRef.current = null;
    };

    const startCapture = async () => {
      if (activeRef.current) return;
      activeRef.current = true;
      // Capture the start-token so async aborts can detect cancellation:
      // stopCapture (or the unmount cleanup) bumps startTokenRef and we
      // bail at the next checkpoint after stopping any tracks we already
      // acquired.
      const token = ++startTokenRef.current;
      const cancelled = () => token !== startTokenRef.current;

      let micStream: MediaStream | null = null;
      let sysStream: MediaStream | null = null;
      const stopAcquired = () => {
        micStream?.getTracks().forEach((t) => t.stop());
        sysStream?.getTracks().forEach((t) => t.stop());
      };

      try {
        // 1. Mic stream. Echo cancellation ON so speaker bleed (when not
        //    using headphones) doesn't double-up the remote audio in the
        //    mix. Noise suppression and AGC OFF — whisper handles ambient
        //    noise, and AGC squashes quiet system audio when ducking.
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled()) { stopAcquired(); return; }
        micStreamRef.current = micStream;

        // 2. System audio loopback — BEST-EFFORT. With `forceCoreAudioTap: true`
        //    in main.js's initMain(), getDisplayMedia is intercepted by
        //    electron-audio-loopback's setDisplayMediaRequestHandler and
        //    served via CoreAudio Process Taps (macOS 14.4+). video:true is
        //    required by the API; we drop the track immediately.
        //
        //    If loopback is unavailable (permission denied, no tap on this OS,
        //    or no audio track) we DEGRADE TO MIC-ONLY rather than failing the
        //    whole recording: sysStream stays null and the stereo graph below
        //    wires mic → L with a silent R channel (the backend tolerates an
        //    empty Others side). A genuine mic failure above still aborts.
        try {
          await bridge.recording.enableLoopbackAudio();
          if (cancelled()) { stopAcquired(); return; }
          sysStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
          if (cancelled()) { stopAcquired(); return; }
          sysStream.getVideoTracks().forEach((t) => {
            t.stop();
            sysStream!.removeTrack(t);
          });
          if (sysStream.getAudioTracks().length === 0) {
            throw new Error('No audio track in loopback stream');
          }
          sysStreamRef.current = sysStream;
        } catch (loopbackErr) {
          // eslint-disable-next-line no-console
          console.warn('[systemAudioCapture] loopback unavailable, continuing mic-only', loopbackErr);
          sysStream?.getTracks().forEach((t) => t.stop());
          sysStream = null;
          sysStreamRef.current = null;
          try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
        }

        // 3. Build the stereo graph. AudioContext at 48 kHz matches the
        //    native loopback rate so no resampling. We route mic to
        //    channel 0 (L) and the system audio (downmixed to mono if it
        //    came in stereo) to channel 1 (R) via a ChannelMergerNode.
        //    The backend's _split_stereo_to_channels uses ffmpeg's pan
        //    filter to pull each side out for independent transcription.
        //
        //    Per-source gain at 0.7 leaves ~3 dB of headroom so a loud
        //    user + loud remote at the same instant doesn't clip.
        const ctx = new AudioContext({ sampleRate: 48000 });
        audioCtxRef.current = ctx;

        const micSource = ctx.createMediaStreamSource(micStream);
        const micGain = ctx.createGain();
        micGain.channelCount = 1;
        micGain.channelCountMode = 'explicit';
        micGain.gain.value = 0.7;
        micSource.connect(micGain);

        // System source/gain only exist when loopback was acquired. A
        // mic-only recording leaves the R channel of the merger silent.
        let sysSource: MediaStreamAudioSourceNode | null = null;
        let sysGain: GainNode | null = null;
        if (sysStream) {
          sysSource = ctx.createMediaStreamSource(sysStream);
          sysGain = ctx.createGain();
          // channelCount=1 with channelInterpretation='speakers' triggers
          // Web Audio's automatic stereo→mono downmix (L/2 + R/2) for any
          // multi-channel system loopback (ScreenCaptureKit can return
          // stereo on some macOS versions; CoreAudio Process Tap is mono).
          sysGain.channelCount = 1;
          sysGain.channelCountMode = 'explicit';
          sysGain.channelInterpretation = 'speakers';
          sysGain.gain.value = 0.7;
          sysSource.connect(sysGain);
        }

        const merger = ctx.createChannelMerger(2);
        micGain.connect(merger, 0, 0);  // mic → L
        if (sysGain) sysGain.connect(merger, 0, 1);  // sys → R (silent when mic-only)

        const dest = ctx.createMediaStreamDestination();
        merger.connect(dest);

        mixedStreamRef.current = dest.stream;

        // 4a. Live transcription tap — Parakeet only. Sums mic + system
        //     to a mono mix, decimates 48 kHz → 16 kHz (exact 3:1 — speech
        //     energy lives well below the 8 kHz Nyquist limit at 16 kHz,
        //     so plain decimation is adequate without an anti-alias filter),
        //     and pushes 4096-sample chunks (≈256 ms) to main's transcribe-
        //     stream sidecar via IPC. Main pipes those bytes into the
        //     Python subprocess's stdin; the same Silero VAD + Parakeet
        //     pipeline that drives the mic-only path emits LIVE_SEG events
        //     the renderer's useLiveTranscript hook subscribes to.
        //
        //     Whisper recordings skip this section entirely — main.js
        //     doesn't spawn the sidecar so any chunks we'd push would be
        //     silently dropped. The decision is read off liveTapEnabledRef
        //     so a mid-session engine flip is honoured without rebuilding
        //     the AudioContext graph.
        //
        //     ScriptProcessorNode is deprecated but works without a
        //     separate worklet file. The output is silenced (gain 0) and
        //     connected to ctx.destination only because the node needs a
        //     downstream consumer to fire — no audio plays.
        if (liveTapEnabledRef.current) {
          const liveMono = ctx.createGain();
          liveMono.channelCount = 1;
          liveMono.channelCountMode = 'explicit';
          liveMono.channelInterpretation = 'speakers';
          micGain.connect(liveMono);
          if (sysGain) sysGain.connect(liveMono);

          const TAP_BUFFER = 4096;       // 48 kHz frames per callback (~85 ms)
          const DECIMATION = 3;           // 48 kHz / 16 kHz
          const SEND_SAMPLES = 4096;      // 16 kHz samples per IPC push (~256 ms)
          const tapNode = ctx.createScriptProcessor(TAP_BUFFER, 1, 1);
          const tapBuffer: number[] = [];
          tapNode.onaudioprocess = (ev) => {
            // Re-check each callback so a flip to whisper mid-recording
            // stops pushing (chunks would otherwise stack up in main).
            if (!liveTapEnabledRef.current) return;
            // MediaRecorder.pause() halts the WebM file growth but the
            // underlying MediaStream keeps flowing — without this guard
            // we'd keep feeding the live consumer audio during a pause
            // and the transcript would keep growing after the user
            // explicitly told us to stop. Drop the chunk buffer too so
            // the half-collected samples don't leak across the pause.
            if (isPausedRef.current) {
              tapBuffer.length = 0;
              return;
            }
            const input = ev.inputBuffer.getChannelData(0);
            for (let i = 0; i < input.length; i += DECIMATION) {
              tapBuffer.push(input[i]);
            }
            while (tapBuffer.length >= SEND_SAMPLES) {
              const slice = tapBuffer.splice(0, SEND_SAMPLES);
              const f32 = new Float32Array(slice);
              // Send the underlying ArrayBuffer — Electron's structured-
              // clone path encodes typed arrays as Buffers on the main side.
              ipc().liveTranscript.pushChunk(f32.buffer);
            }
          };
          const tapSilencer = ctx.createGain();
          tapSilencer.gain.value = 0;
          liveMono.connect(tapNode);
          tapNode.connect(tapSilencer);
          tapSilencer.connect(ctx.destination);
        }

        // 4. Record the mix. The WebM blob is streamed to disk a timeslice at
        //    a time (see ondataavailable → appendSystemAudioChunk) rather than
        //    buffered in memory until stop, so a crash leaves a processable
        //    file. Open the on-disk file first; if that fails there's nowhere
        //    to write, so abort (caught below → mic-only would also have no
        //    file, so this is a hard failure).
        const name = sessionNameRef.current ?? 'Note';
        const opened = await bridge.recording.openSystemAudioFile(name);
        if (cancelled()) {
          // Cancelled after the file opened — close it so the main-side write
          // stream isn't leaked (it'd otherwise linger until the next open).
          stopAcquired();
          if (opened.success) void bridge.recording.closeSystemAudioFile();
          return;
        }
        if (!opened.success) {
          throw new Error(opened.error || 'Could not open recording file');
        }

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(dest.stream, {
          mimeType,
          audioBitsPerSecond: 128_000,
        });
        appendChainRef.current = Promise.resolve();
        appendFailedRef.current = false;
        recorder.ondataavailable = (e) => {
          if (!e.data || e.data.size === 0) return;
          const blob = e.data;
          // Chain appends so they serialise in arrival order — the handler
          // fires in order, and chaining synchronously here preserves that
          // even though each blob.arrayBuffer() resolves asynchronously.
          appendChainRef.current = appendChainRef.current
            .then(async () => {
              const buf = new Uint8Array(await blob.arrayBuffer());
              const res = await bridge.recording.appendSystemAudioChunk(buf);
              // A resolved {success:false} (disk error, stream gone) isn't a
              // throw — check it explicitly so a write failure isn't silently
              // dropped. Surface it once; the file is now truncated.
              if (!res.success && !appendFailedRef.current) {
                appendFailedRef.current = true;
                // eslint-disable-next-line no-console
                console.error('[systemAudioCapture] chunk append failed:', res.error);
                bridge.recording.reportCaptureError(
                  `Recording may be incomplete: ${res.error || 'failed to write audio'}`,
                );
              }
            })
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[systemAudioCapture] chunk append failed', err);
            });
        };
        // 1s timeslice so a crash mid-recording loses at most ~1s of audio.
        recorder.start(1_000);
        recorderRef.current = recorder;

        // 5. Silence-auto-stop detector. Taps each pre-merge source with its
        //    own AnalyserNode so we can distinguish "mic active" from
        //    "system audio playing" — auto-stop only fires when BOTH have
        //    been below SILENCE_RMS_THRESHOLD for the configured duration.
        //    Mic-only would auto-stop real meetings where the user is
        //    listening but not talking; system-only would auto-stop when
        //    the user is talking on a phone (headphones, no playback).
        const micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 512;
        micAnalyser.smoothingTimeConstant = 0;
        micSource.connect(micAnalyser);
        // No system analyser on a mic-only recording — sysRms is treated as 0
        // below, so auto-stop falls back to mic-only silence.
        let sysAnalyser: AnalyserNode | null = null;
        if (sysSource) {
          sysAnalyser = ctx.createAnalyser();
          sysAnalyser.fftSize = 512;
          sysAnalyser.smoothingTimeConstant = 0;
          sysSource.connect(sysAnalyser);
        }

        const computeRms = (analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number => {
          analyser.getByteTimeDomainData(buf);
          let sumSq = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sumSq += v * v;
          }
          return Math.sqrt(sumSq / buf.length);
        };

        const micBuf = new Uint8Array(new ArrayBuffer(micAnalyser.fftSize));
        const sysBuf = sysAnalyser
          ? new Uint8Array(new ArrayBuffer(sysAnalyser.fftSize))
          : null;
        let lastActiveAtMs = Date.now();
        // Latch the in-flight stop attempt instead of tearing the
        // interval down: a stop failure (Python crash, queue lock, race
        // with manual stop) used to permanently disarm auto-stop for the
        // rest of the recording. Now the detector keeps running; the
        // latch just prevents re-firing while one attempt is still in
        // flight, and clears on failure so a subsequent sustained silent
        // stretch can retry.
        let stopAttemptInFlight = false;

        silenceIntervalRef.current = setInterval(() => {
          const cfg = silenceConfigRef.current;
          // Treat manual-pause as activity — user paused on purpose; don't
          // auto-stop their recording out from under them. Resetting the
          // timestamp also avoids racing the resume: any silence after a
          // long pause has to re-accumulate from scratch.
          if (!cfg.enabled || isPausedRef.current || !activeRef.current) {
            lastActiveAtMs = Date.now();
            return;
          }
          if (stopAttemptInFlight) return;
          const micRms = computeRms(micAnalyser, micBuf);
          const sysRms = sysAnalyser && sysBuf ? computeRms(sysAnalyser, sysBuf) : 0;
          if (micRms > SILENCE_RMS_THRESHOLD || sysRms > SILENCE_RMS_THRESHOLD) {
            lastActiveAtMs = Date.now();
            return;
          }
          const silenceMs = Date.now() - lastActiveAtMs;
          const limitMs = cfg.minutes * 60 * 1000;
          if (silenceMs < limitMs) return;

          stopAttemptInFlight = true;
          const minutes = cfg.minutes;
          void (async () => {
            try {
              // Check the IPC result envelope before claiming success —
              // if the stop failed (no active recording, Python error,
              // queue lock, etc.) we don't want to fire a "Recording
              // stopped" notification while the recording is actually
              // still running.
              const stopResult = await bridge.recording.stop();
              if (!stopResult.success) {
                // eslint-disable-next-line no-console
                console.error('[silenceAutoStop] stop failed:', stopResult.error);
                // Reset the silence window so the user gets a fresh
                // duration of silence before we retry the stop — avoids
                // hammering a failing IPC every second.
                lastActiveAtMs = Date.now();
                stopAttemptInFlight = false;
                return;
              }
              // Success — the recording is gone, so the detector has no
              // recording to watch anymore. Tear it down here (instead
              // of pre-emptively before the stop call) so a failed stop
              // doesn't permanently disarm auto-stop for the session.
              teardownSilenceDetector();
              const notifResult = await bridge.settings.showSilenceAutoStopNotification({
                minutes,
                // Pre-processing name — calendar event title for
                // auto-detect recordings, "Note" for the default
                // placeholder, user-typed otherwise. Matches what's
                // visible in the sidebar at the moment of stop.
                sessionName: sessionNameRef.current ?? null,
              });
              if (!notifResult.success) {
                // Notification failure isn't fatal — the recording has
                // already been finalised — but worth logging for support.
                // eslint-disable-next-line no-console
                console.warn('[silenceAutoStop] notification failed:', notifResult.error);
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.error('[silenceAutoStop] failed to stop:', e);
              lastActiveAtMs = Date.now();
              stopAttemptInFlight = false;
            }
          })();
        }, SILENCE_SAMPLE_INTERVAL_MS);

        // 5b. Per-channel RMS sampler — feeds liveRmsBuffer so
        //     useLiveTranscript can attribute each LIVE_SEG to You vs
        //     Others. Only meaningful when the live tap is engaged
        //     (Parakeet engine): no live segments → no consumers of
        //     this data. Reset the buffer here so it starts at t=0 for
        //     this recording.
        if (liveTapEnabledRef.current) {
          resetRmsBuffer();
          const recordingStartMs = Date.now();
          rmsIntervalRef.current = setInterval(() => {
            if (!activeRef.current || isPausedRef.current) return;
            const micRms = computeRms(micAnalyser, micBuf);
            const sysRms = sysAnalyser && sysBuf ? computeRms(sysAnalyser, sysBuf) : 0;
            pushRmsSample({
              tSec: (Date.now() - recordingStartMs) / 1000,
              micRms,
              sysRms,
            });
          }, 1000 / LIVE_RMS_HZ);
        }

        // 6. Confirm to main that the renderer-driven recording is live.
        //    Idempotent — main.js already flipped systemAudioRecordingActive
        //    when start-recording-ui ran, but this re-affirms it.
        bridge.recording.reportSystemAudioState(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[systemAudioCapture] start failed', err);
        teardownStreams();
        activeRef.current = false;
        // Close any file opened before the failure so we don't leak the
        // main-side write stream (no-op if open never ran).
        try { await bridge.recording.closeSystemAudioFile(); } catch { /* */ }
        // Tell main to drop the stuck "recording" pill — its optimistic
        // systemAudioRecordingActive flag was set on start-recording-ui.
        bridge.recording.reportSystemAudioState(false);
        // Surface the failure to the user (native notification) — otherwise a
        // denied mic permission looks like a silent no-op.
        bridge.recording.reportCaptureError(
          err instanceof Error ? err.message : 'Recording could not start',
        );
        try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
      }
    };

    const stopCapture = async () => {
      // Invalidate any in-flight startCapture awaiting media APIs — its
      // next cancelled() check will see the token has moved and it'll
      // tear down the streams it acquired without installing them.
      startTokenRef.current++;
      if (!activeRef.current) return;
      activeRef.current = false;
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        teardownStreams();
        try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
        bridge.recording.reportSystemAudioState(false);
        return;
      }
      // Match useRecording.startRecording's 'Note' placeholder so the
      // Python post-processor's AI-rename regex
      //   ^(Meeting|Note)(-[A-Z0-9]{6})?$
      // catches both code paths the same way. Previously this fell back
      // to 'Meeting', so a system-audio recording whose sessionName
      // never landed would persist as "Meeting" while a mic-only
      // recording from the same UI flow persisted as "Note" — visible
      // inconsistency in the user's notes list.
      const name = sessionNameRef.current ?? 'Note';
      await new Promise<void>((resolve) => {
        recorder.onstop = async () => {
          try {
            // Flush any in-flight appends, then close the on-disk file and
            // hand the finished WebM to the processing queue.
            await appendChainRef.current;
            const closed = await bridge.recording.closeSystemAudioFile();
            if (!closed.success) {
              // eslint-disable-next-line no-console
              console.error('[systemAudioCapture] close failed', closed.error);
            } else if (closed.filePath) {
              await bridge.recording.processSystemAudio(closed.filePath, name);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[systemAudioCapture] handoff failed', err);
          } finally {
            teardownStreams();
            try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
            bridge.recording.reportSystemAudioState(false);
            resolve();
          }
        };
        recorder.stop();
      });
    };

    // If support resolved false or the user toggled system audio off
    // during an active recording, gracefully stop the capture rather
    // than leaving streams unmanaged. The stop path tears down the
    // mic/system streams, hands off the recorded blob for processing,
    // and resets the tray state.
    if (!enabled) {
      if (activeRef.current) void stopCapture();
      return;
    }

    if (status === 'recording' && !activeRef.current) {
      void startCapture();
    } else if (
      status === 'paused' &&
      recorderRef.current?.state === 'recording'
    ) {
      recorderRef.current.pause();
    } else if (
      status === 'recording' &&
      recorderRef.current?.state === 'paused'
    ) {
      recorderRef.current.resume();
    } else if (
      (status === 'idle' || status === 'processing') &&
      activeRef.current
    ) {
      void stopCapture();
    }
  }, [enabled, status]);

  // Unmount-only safety net (empty deps = no cleanup on dep changes). Runs
  // when the App tree unmounts (e.g. window close, page reload, StrictMode
  // simulated unmount) and tears down anything the status state machine
  // didn't get to. Crucially this does NOT fire on status changes — the
  // status-driven effect above owns the normal stop flow so the blob isn't
  // lost mid-stop.
  React.useEffect(() => {
    const bridge = ipc();
    return () => {
      // Clear any live intervals first — the per-recording teardown helpers
      // live in the other useEffect's scope so they aren't reachable here,
      // and without explicit clears the silence-auto-stop poll and the
      // per-channel RMS sampler would survive across unmount/remount
      // cycles (visible in dev hot-reload, and a slow leak in any setup
      // that conditionally mounts the app shell).
      if (silenceIntervalRef.current !== null) {
        clearInterval(silenceIntervalRef.current);
        silenceIntervalRef.current = null;
      }
      if (rmsIntervalRef.current !== null) {
        clearInterval(rmsIntervalRef.current);
        rmsIntervalRef.current = null;
      }
      // Close the incremental-write file so the partial recording is flushed
      // and the main-side stream isn't leaked across unmount. Reading
      // appendChainRef.current must be DEFERRED until after recorder.stop()'s
      // final ondataavailable has enqueued its append — otherwise we'd chain
      // the close onto a stale snapshot taken before that last chunk and drop
      // it. So close from the recorder's onstop (fires after the final
      // ondataavailable); fall back to an immediate chain when there's no live
      // recorder. Best-effort either way — unmount cleanup can't await.
      const closeFile = () => {
        void appendChainRef.current.finally(() =>
          bridge.recording.closeSystemAudioFile(),
        );
      };
      const recorder = recorderRef.current;
      // activeRef.current is still true only when THIS unmount owns the live
      // capture; if stopCapture already took over it has flipped it false (and
      // its own onstop will flush+close), so we must not clobber that handoff.
      const hadOpenFile = activeRef.current;
      if (hadOpenFile && recorder && recorder.state !== 'inactive') {
        recorder.onstop = closeFile;
        try { recorder.stop(); } catch { closeFile(); }
      } else if (hadOpenFile) {
        // Open file but no live recorder (failed mid-start) — close directly.
        closeFile();
      } else if (recorder && recorder.state !== 'inactive') {
        // stopCapture is handling the stop; just ensure the recorder stops
        // without overwriting its onstop flush+close handoff.
        try { recorder.stop(); } catch { /* already stopping */ }
      }
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      sysStreamRef.current?.getTracks().forEach((t) => t.stop());
      mixedStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => { /* already closed */ });
      }
      micStreamRef.current = null;
      sysStreamRef.current = null;
      mixedStreamRef.current = null;
      audioCtxRef.current = null;
      recorderRef.current = null;
      if (hadOpenFile) {
        activeRef.current = false;
        void bridge.recording.disableLoopbackAudio();
        bridge.recording.reportSystemAudioState(false);
      }
    };
  }, []);
}

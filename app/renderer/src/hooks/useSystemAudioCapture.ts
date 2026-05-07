import * as React from 'react';
import { ipc } from '@/lib/ipc';
import { useRecording } from './useRecording';
import { useSystemAudioSetting } from './useSettings';

/**
 * Mounts ONCE at App level. When system audio is enabled and the user starts
 * recording, captures BOTH mic (getUserMedia) and system loopback
 * (getDisplayMedia → CoreAudio Process Taps on macOS 14.4+) and emits a
 * single STEREO WebM/Opus blob with **mic in channel 0 (L), system in
 * channel 1 (R)**. The backend's `transcribe_diarised` (src/transcriber.py)
 * detects the stereo layout, splits the channels, transcribes each
 * separately with per-segment timestamps, and emits a chronologically
 * interleaved `[You]` / `[Others]` transcript that the existing
 * TranscriptPanel renders as alternating speaker bubbles.
 *
 * The Python `record` subprocess is bypassed in this mode (main.js skips
 * spawning it on start-recording-ui) so we don't end up with two parallel
 * recordings → two notes.
 */
export function useSystemAudioCapture() {
  const { status, sessionName } = useRecording();
  const systemAudio = useSystemAudioSetting();
  const enabled = systemAudio.data ?? false;

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const micStreamRef = React.useRef<MediaStream | null>(null);
  const sysStreamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const mixedStreamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const sessionNameRef = React.useRef<string | null>(null);
  const activeRef = React.useRef(false);

  React.useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);

  React.useEffect(() => {
    if (!enabled) return;
    const bridge = ipc();

    const teardownStreams = () => {
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
      chunksRef.current = [];
    };

    const startCapture = async () => {
      if (activeRef.current) return;
      activeRef.current = true;
      try {
        // 1. Mic stream. Echo cancellation ON so speaker bleed (when not
        //    using headphones) doesn't double-up the remote audio in the
        //    mix. Noise suppression and AGC OFF — whisper handles ambient
        //    noise, and AGC squashes quiet system audio when ducking.
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        micStreamRef.current = micStream;

        // 2. System audio loopback. Electron 42 routes getDisplayMedia
        //    through CoreAudio Process Taps on macOS 14.4+, ScreenCaptureKit
        //    on older versions. video:true is required by the API; we drop
        //    the track immediately.
        await bridge.recording.enableLoopbackAudio();
        const sysStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        sysStream.getVideoTracks().forEach((t) => {
          t.stop();
          sysStream.removeTrack(t);
        });
        if (sysStream.getAudioTracks().length === 0) {
          throw new Error('No audio track in loopback stream');
        }
        sysStreamRef.current = sysStream;

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
        const sysSource = ctx.createMediaStreamSource(sysStream);

        const micGain = ctx.createGain();
        micGain.channelCount = 1;
        micGain.channelCountMode = 'explicit';
        micGain.gain.value = 0.7;
        micSource.connect(micGain);

        const sysGain = ctx.createGain();
        // channelCount=1 with channelInterpretation='speakers' triggers
        // Web Audio's automatic stereo→mono downmix (L/2 + R/2) for any
        // multi-channel system loopback (ScreenCaptureKit can return
        // stereo on some macOS versions; CoreAudio Process Tap is mono).
        sysGain.channelCount = 1;
        sysGain.channelCountMode = 'explicit';
        sysGain.channelInterpretation = 'speakers';
        sysGain.gain.value = 0.7;
        sysSource.connect(sysGain);

        const merger = ctx.createChannelMerger(2);
        micGain.connect(merger, 0, 0);  // mic → L
        sysGain.connect(merger, 0, 1);  // sys → R

        const dest = ctx.createMediaStreamDestination();
        merger.connect(dest);

        mixedStreamRef.current = dest.stream;

        // 4. Record the mix.
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(dest.stream, {
          mimeType,
          audioBitsPerSecond: 128_000,
        });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        chunksRef.current = [];
        // 1s timeslice so a crash mid-recording loses at most ~1s of audio.
        recorder.start(1_000);
        recorderRef.current = recorder;

        // 5. Confirm to main that the renderer-driven recording is live.
        //    Idempotent — main.js already flipped systemAudioRecordingActive
        //    when start-recording-ui ran, but this re-affirms it.
        bridge.recording.reportSystemAudioState(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[systemAudioCapture] start failed', err);
        teardownStreams();
        activeRef.current = false;
        // Tell main to drop the stuck "recording" pill — its optimistic
        // systemAudioRecordingActive flag was set on start-recording-ui.
        bridge.recording.reportSystemAudioState(false);
        try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
      }
    };

    const stopCapture = async () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        teardownStreams();
        try { await bridge.recording.disableLoopbackAudio(); } catch { /* */ }
        bridge.recording.reportSystemAudioState(false);
        return;
      }
      const name = sessionNameRef.current ?? 'Meeting';
      await new Promise<void>((resolve) => {
        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const written = await bridge.recording.writeSystemAudioBlob(bytes, name);
            if (written.success) {
              await bridge.recording.processSystemAudio(written.filePath, name);
            } else {
              // eslint-disable-next-line no-console
              console.error('[systemAudioCapture] write failed', written.error);
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
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
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
      chunksRef.current = [];
      if (activeRef.current) {
        activeRef.current = false;
        void bridge.recording.disableLoopbackAudio();
        bridge.recording.reportSystemAudioState(false);
      }
    };
  }, []);
}

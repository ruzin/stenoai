import * as React from 'react';
import { ipc } from '@/lib/ipc';
import { useRecording } from './useRecording';
import { useSystemAudioSetting } from './useSettings';

/**
 * Mounts ONCE at App level. Tracks recording status; when system audio is
 * enabled and the user starts recording, captures the system loopback stream
 * via getDisplayMedia (Electron 42 routes this through CoreAudio Process Taps
 * on macOS 14.4+, ScreenCaptureKit otherwise) and writes a WebM/Opus blob
 * back to the main process at stop. The mic recording is independent and
 * unaffected — system audio is purely additive.
 */
export function useSystemAudioCapture() {
  const { status, sessionName } = useRecording();
  const systemAudio = useSystemAudioSetting();
  const enabled = systemAudio.data ?? false;

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const sessionNameRef = React.useRef<string | null>(null);
  const activeRef = React.useRef(false);

  React.useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);

  React.useEffect(() => {
    if (!enabled) return;
    const bridge = ipc();

    const cleanup = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      chunksRef.current = [];
    };

    const startCapture = async () => {
      if (activeRef.current) return;
      activeRef.current = true;
      try {
        await bridge.recording.enableLoopbackAudio();
        // getDisplayMedia requires video:true; we drop the video track.
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        stream.getVideoTracks().forEach((t) => {
          t.stop();
          stream.removeTrack(t);
        });
        if (stream.getAudioTracks().length === 0) {
          throw new Error('No audio track in loopback stream');
        }
        streamRef.current = stream;
        chunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        const recorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 128_000,
        });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        // 1s timeslice so a crash mid-recording loses at most ~1s of audio.
        recorder.start(1_000);
        recorderRef.current = recorder;
        bridge.recording.reportSystemAudioState(true);
      } catch (err) {
        // Most likely cause on macOS < 14.4 with Electron 42: CoreAudio Tap
        // is the only path and isn't available pre-14.4.
        // eslint-disable-next-line no-console
        console.error('[systemAudioCapture] start failed', err);
        cleanup();
        activeRef.current = false;
      }
    };

    const stopCapture = async () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        await bridge.recording.disableLoopbackAudio();
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
            cleanup();
            await bridge.recording.disableLoopbackAudio();
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
}

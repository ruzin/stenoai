import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Shared T2 setup helpers for the core-loop specs. Everything writes into the
 * per-test STENOAI_USER_DATA_DIR temp dir (the isolation keystone) BEFORE launch,
 * mirroring how config-corruption.t2 pre-seeds config.json.
 */

/** Merge a partial config into <userDataDir>/config.json, creating it if absent. */
export function writeUserConfig(
  userDataDir: string,
  partial: Record<string, unknown>,
): void {
  const cfgPath = path.join(userDataDir, 'config.json');
  let cfg: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    } catch {
      cfg = {};
    }
  }
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, ...partial }, null, 2));
}

/**
 * Configure the app so `start-recording-ui` takes the renderer-driven path
 * (system audio ON) with the Whisper engine (so no Parakeet live-transcribe
 * sidecar spawns). That path sets the recording state machine WITHOUT spawning
 * the Python `record` subprocess, touching a real microphone, or loading any
 * model — see app/main.js `start-recording-ui` + `loadSystemAudioEnabled` /
 * `loadTranscriptionEngine`. This is what makes the lifecycle deterministic on a
 * headless CI runner. It still requires `isSystemAudioSupported()` to be true on
 * the host (macOS >= 14.4 / Windows >= 10); the spec guards on that and skips
 * loudly otherwise rather than spawning a real recorder.
 */
export function enableDeterministicRecording(userDataDir: string): void {
  writeUserConfig(userDataDir, {
    system_audio_enabled: true,
    transcription_engine: 'whisper',
  });
}

export interface FixtureMeeting {
  name: string;
  summary?: string;
  participants?: string[];
  key_points?: string[];
  action_items?: string[];
  transcript?: string;
  folders?: string[];
}

/**
 * Write a deterministic `<stem>_summary.json` into <userDataDir>/output so the
 * real backend's `list-meetings` (which globs get_data_dirs()['output']) finds
 * it. Returns the absolute path of the written summary file. Model-free — no
 * transcription/summarisation involved, just a known-good summary document.
 */
export function writeMeetingSummary(
  userDataDir: string,
  stem: string,
  meeting: FixtureMeeting,
): string {
  const outputDir = path.join(userDataDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  const summaryFile = path.join(outputDir, `${stem}_summary.json`);
  const now = new Date().toISOString();
  const data = {
    session_info: {
      name: meeting.name,
      summary_file: summaryFile,
      processed_at: now,
      duration_seconds: 0,
    },
    summary: meeting.summary ?? `Summary for ${meeting.name}`,
    participants: meeting.participants ?? [],
    key_points: meeting.key_points ?? [],
    action_items: meeting.action_items ?? [],
    transcript: meeting.transcript ?? '',
    // Folder membership lives at the TOP level of the summary doc — that's where
    // src/folders.py add_meeting_to_folder writes it and list-meetings reads it.
    folders: meeting.folders ?? [],
  };
  writeFileSync(summaryFile, JSON.stringify(data, null, 2));
  return summaryFile;
}

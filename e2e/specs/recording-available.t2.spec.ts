import { test, expect } from '../fixtures/electron';
import { writeMeetingMarkdown } from '../fixtures/user-config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * T2 — the re-transcribe availability gate (#266).
 *
 * Re-transcribe re-runs ASR on the ORIGINAL recording, so the UI only offers it
 * when that recording still exists on disk (keep-recordings was on). The
 * `recording-available` IPC globs the recordings dir for a file whose stem
 * matches the note's `<stem>_summary.md`, returning `available: true/false`.
 * This drives the REAL preload bridge + main handler against a seeded (or
 * absent) recording on disk — model-free (no ASR, no Ollama).
 *
 * The real re-transcribe (actual ASR) needs a model and is covered manually
 * this round — see the @pipeline TODO below.
 */

type AvailResult = { success: boolean; available?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    meetings: {
      recordingAvailable: (summaryFile: string) => Promise<AvailResult>;
    };
  };
};

const recordingAvailable = (page: import('@playwright/test').Page, file: string) =>
  page.evaluate((f) => (window as StenoWindow).stenoai.meetings.recordingAvailable(f), file);

test('recording-available is true when the source recording still exists', async ({
  launchApp,
  userDataDir,
}) => {
  const file = writeMeetingMarkdown(userDataDir, 'kept', {
    name: 'Kept Recording',
    summaryMarkdown: '## Summary\nKeep-recordings was on.',
    transcript: 'Some transcript.',
  });
  // Seed a matching recording (any extension) under the recordings dir — the
  // stem must equal the note stem ('kept'), mirroring how the pipeline names it.
  const recordingsDir = path.join(userDataDir, 'recordings');
  mkdirSync(recordingsDir, { recursive: true });
  writeFileSync(path.join(recordingsDir, 'kept.wav'), Buffer.from('fake audio'));

  const { page } = await launchApp();

  const res = await recordingAvailable(page, file);
  expect(res.success, res.error).toBe(true);
  expect(res.available).toBe(true);
});

test('recording-available is false when the source recording is gone', async ({
  launchApp,
  userDataDir,
}) => {
  // A note whose audio was cleaned up (keep-recordings off, the default): the
  // note exists in output/, but no matching file lives in recordings/.
  const file = writeMeetingMarkdown(userDataDir, 'gone', {
    name: 'Discarded Recording',
    summaryMarkdown: '## Summary\nAudio was discarded after transcribe.',
    transcript: 'Some transcript.',
  });

  const { page } = await launchApp();

  const res = await recordingAvailable(page, file);
  expect(res.success, res.error).toBe(true);
  expect(res.available).toBe(false);
});

// TODO(@pipeline): the REAL re-transcribe path (reprocess --retranscribe running
// actual ASR and rewriting the note with a fresh transcript + summary) needs a
// model, so it is out of scope for this model-free spec and is covered manually
// this round. A future @pipeline spec could drive `meetings.retranscribe`
// end-to-end through the whisper engine and assert a rewritten transcript.

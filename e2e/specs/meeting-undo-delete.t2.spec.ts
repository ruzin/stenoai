import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

/**
 * T2 — undo / soft-delete for note deletion (#234). Seeds a note's files into
 * the temp user-data dir, drives the real backend's delete/restore/purge IPC,
 * and asserts the on-disk moves:
 *
 *   (a) delete  -> originals gone from output/recordings/transcripts, files
 *       present under <userDataDir>/.trash/<trashId>/, and a trashId is returned.
 *   (b) restore -> files back at their original paths, .trash/<trashId> removed.
 *   (c) delete + purgeTrashed -> files gone entirely, .trash/<trashId> removed.
 *
 * Model-free: delete/restore/purge are pure file moves in the Electron main
 * process — no Python pipeline, Ollama, or network. The keystone check proves
 * the real ~/Library/.../stenoai dir is never touched.
 */

type Meeting = {
  session_info: {
    name: string;
    summary_file: string;
    transcript_file?: string;
    audio_file?: string;
  };
};
type DeleteResult = { success: boolean; error?: string; trashId?: string; message?: string };
type RestoreResult = { success: boolean; error?: string; meeting?: Meeting };
type PurgeResult = { success: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    meetings: {
      delete: (meeting: Meeting) => Promise<DeleteResult>;
      restore: (trashId: string) => Promise<RestoreResult>;
      purgeTrashed: (trashId: string) => Promise<PurgeResult>;
    };
  };
};

/**
 * Seed a note's four on-disk files (summary .json + reports sidecar in output/,
 * transcript in transcripts/, audio .wav in recordings/) and return the meeting
 * object + its file paths. The meeting's session_info carries the exact paths
 * the delete handler moves.
 */
function seedNote(userDataDir: string, stem: string, name: string) {
  const outputDir = path.join(userDataDir, 'output');
  const recordingsDir = path.join(userDataDir, 'recordings');
  const transcriptsDir = path.join(userDataDir, 'transcripts');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(recordingsDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });

  const summaryFile = path.join(outputDir, `${stem}_summary.json`);
  const reportsSidecar = path.join(outputDir, `${stem}_reports.json`);
  const transcriptFile = path.join(transcriptsDir, `${stem}.txt`);
  const audioFile = path.join(recordingsDir, `${stem}.wav`);

  writeFileSync(
    summaryFile,
    JSON.stringify({ session_info: { name, summary_file: summaryFile }, summary: `S ${name}` }),
  );
  writeFileSync(reportsSidecar, JSON.stringify({ reports: [], active_report: null }));
  writeFileSync(transcriptFile, `transcript for ${name}`);
  // Minimal but non-empty "audio" payload — the handler moves bytes, it never
  // decodes, so a stub is enough to prove the audio file survives the round-trip.
  writeFileSync(audioFile, Buffer.from('RIFFstub-wav-bytes'));

  const meeting: Meeting = {
    session_info: {
      name,
      summary_file: summaryFile,
      transcript_file: transcriptFile,
      audio_file: audioFile,
    },
  };
  return { meeting, summaryFile, reportsSidecar, transcriptFile, audioFile };
}

/** All the original file paths for a seeded note. */
const allFiles = (s: ReturnType<typeof seedNote>) => [
  s.summaryFile,
  s.reportsSidecar,
  s.transcriptFile,
  s.audioFile,
];

test('delete moves note files to .trash and restore puts them back', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-alpha', 'Undo Alpha');
  const files = allFiles(seed);

  const { page } = await launchApp();

  // (a) delete -> soft-delete: originals gone, everything under .trash/<id>/.
  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  expect(del.trashId).toBeTruthy();
  const trashId = del.trashId!;

  for (const f of files) expect(existsSync(f)).toBe(false);

  const trashDir = path.join(userDataDir, '.trash', trashId);
  expect(existsSync(trashDir)).toBe(true);
  // Each moved file sits under the trash dir by basename, plus a manifest.
  for (const f of files) {
    expect(existsSync(path.join(trashDir, path.basename(f)))).toBe(true);
  }
  expect(existsSync(path.join(trashDir, 'manifest.json'))).toBe(true);

  // (b) restore -> files back at their original paths, trash entry removed.
  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(true);
  expect(res.meeting?.session_info?.summary_file).toBe(seed.summaryFile);

  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(existsSync(trashDir)).toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('purgeTrashed hard-deletes a trashed note', async ({ launchApp, userDataDir }) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-beta', 'Undo Beta');
  const files = allFiles(seed);

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);
  expect(existsSync(trashDir)).toBe(true);

  // (c) purge -> the trash entry and every file inside it are gone for good.
  const purge = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.purgeTrashed(id),
    trashId,
  );
  expect(purge.success).toBe(true);
  expect(existsSync(trashDir)).toBe(false);
  for (const f of files) expect(existsSync(f)).toBe(false);

  // purge is idempotent: a second call on the same (now-missing) id succeeds.
  const purgeAgain = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.purgeTrashed(id),
    trashId,
  );
  expect(purgeAgain.success).toBe(true);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

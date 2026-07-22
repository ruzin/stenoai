import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs';
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
  // Each moved file sits under the trash dir under an index-prefixed name
  // (`<i>__<basename>`, collision-proof), plus a manifest.
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  for (const f of files) {
    expect(stored.some((n) => n.endsWith(`__${path.basename(f)}`))).toBe(true);
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

/**
 * FACT-A regression (#234 core): a REAL .md note's session_info carries ONLY
 * summary_file — no transcript_file / audio_file. The delete handler must derive
 * the transcript (`<stem>_transcript.txt`) and the RECORDING (`<stem>.wav`) from
 * the summary stem, or they'd be orphaned (audio lost) — defeating soft-delete.
 * Seeds a summary-only note with its transcript + audio present by convention
 * and asserts delete moves ALL of them and restore brings them ALL back.
 */
function seedSummaryOnlyNote(userDataDir: string, stem: string, name: string) {
  const outputDir = path.join(userDataDir, 'output');
  const recordingsDir = path.join(userDataDir, 'recordings');
  const transcriptsDir = path.join(userDataDir, 'transcripts');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(recordingsDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });

  // Backend naming: output/<stem>_summary.md, transcripts/<stem>_transcript.txt,
  // recordings/<stem>.wav, output/<stem>_reports.json.
  const summaryFile = path.join(outputDir, `${stem}_summary.md`);
  const reportsSidecar = path.join(outputDir, `${stem}_reports.json`);
  const transcriptFile = path.join(transcriptsDir, `${stem}_transcript.txt`);
  const audioFile = path.join(recordingsDir, `${stem}.wav`);

  writeFileSync(summaryFile, `# ${name}\n\nSummary body.`);
  writeFileSync(reportsSidecar, JSON.stringify({ reports: [], active_report: null }));
  writeFileSync(transcriptFile, `transcript for ${name}`);
  writeFileSync(audioFile, Buffer.from('RIFFstub-wav-bytes'));

  // Mirrors _parse_meeting_markdown: session_info carries ONLY summary_file.
  const meeting: Meeting = { session_info: { name, summary_file: summaryFile } };
  return { meeting, summaryFile, reportsSidecar, transcriptFile, audioFile };
}

test('summary-only note: delete derives + moves transcript & audio, restore brings all back', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedSummaryOnlyNote(userDataDir, 'undo-gamma', 'Undo Gamma');
  const files = [seed.summaryFile, seed.reportsSidecar, seed.transcriptFile, seed.audioFile];

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  expect(del.trashId).toBeTruthy();
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // ALL four files (incl. the derived transcript + recording) moved out.
  for (const f of files) expect(existsSync(f)).toBe(false);
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stored.length).toBe(files.length);
  // The recording is in trash — the whole point of #234.
  expect(stored.some((n) => n.endsWith(`__${path.basename(seed.audioFile)}`))).toBe(true);
  expect(stored.some((n) => n.endsWith(`__${path.basename(seed.transcriptFile)}`))).toBe(true);

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(true);
  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(existsSync(trashDir)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('restore & purge reject a traversal / invalid trashId and touch nothing', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  // Seed a real note so there's on-disk state a bad call could disturb.
  const seed = seedNote(userDataDir, 'undo-delta', 'Undo Delta');
  const files = allFiles(seed);

  const { page } = await launchApp();

  const badIds = ['../evil', 'a/b', '', '..', 'foo/../bar'];
  for (const id of badIds) {
    const r = await page.evaluate(
      (bad) => (window as StenoWindow).stenoai.meetings.restore(bad),
      id,
    );
    expect(r.success).toBe(false);
    const p = await page.evaluate(
      (bad) => (window as StenoWindow).stenoai.meetings.purgeTrashed(bad),
      id,
    );
    expect(p.success).toBe(false);
  }

  // The seeded note is completely untouched by the rejected calls.
  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('audio_file pointing at a directory is skipped; delete still succeeds for real files', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-epsilon', 'Undo Epsilon');

  // Point audio_file at a DIRECTORY (Codex C2): the handler must skip it (never
  // move a whole dir into trash where purge would rm -rf it), yet still trash
  // the real regular files.
  const evilDir = path.join(userDataDir, 'recordings', 'undo-epsilon-dir');
  mkdirSync(evilDir, { recursive: true });
  writeFileSync(path.join(evilDir, 'canary.txt'), 'must survive');
  seed.meeting.session_info.audio_file = evilDir;

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // The directory (and its canary) survived — not moved into trash.
  expect(existsSync(evilDir)).toBe(true);
  expect(existsSync(path.join(evilDir, 'canary.txt'))).toBe(true);
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stored.some((n) => n.endsWith('__undo-epsilon-dir'))).toBe(false);
  // The real regular files were still trashed (summary, reports, transcript).
  expect(existsSync(seed.summaryFile)).toBe(false);
  expect(existsSync(seed.reportsSidecar)).toBe(false);
  expect(existsSync(seed.transcriptFile)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('restore keeps the trash dir when a stored file cannot be restored (partial failure)', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-zeta', 'Undo Zeta');

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // Remove one stored file so its restore fails — the trash dir must be KEPT
  // (never destroy the remaining, un-restored user files).
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  rmSync(path.join(trashDir, stored[0]));

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(false);
  // Trash dir preserved with the still-unrestored files inside.
  expect(existsSync(trashDir)).toBe(true);

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

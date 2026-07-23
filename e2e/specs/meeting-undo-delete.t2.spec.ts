import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  renameSync,
  chmodSync,
  symlinkSync,
} from 'fs';
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

/**
 * Codex C5: the recording keeps its ORIGINAL extension — imports stay
 * .m4a/.mp3/…, system-audio is .webm, only native captures are .wav. Deriving
 * the recording as a hard-coded `<stem>.wav` orphaned all of those. A
 * summary-only note must derive the recording by stem + ANY extension.
 */
test('summary-only note: delete derives a non-.wav recording by stem and restore brings it back', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const outputDir = path.join(userDataDir, 'output');
  const recordingsDir = path.join(userDataDir, 'recordings');
  const transcriptsDir = path.join(userDataDir, 'transcripts');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(recordingsDir, { recursive: true });
  mkdirSync(transcriptsDir, { recursive: true });

  const stem = 'undo-eta';
  const summaryFile = path.join(outputDir, `${stem}_summary.md`);
  const transcriptFile = path.join(transcriptsDir, `${stem}_transcript.txt`);
  // Neither of these is .wav — an imported .m4a and a system-audio .webm.
  const m4aFile = path.join(recordingsDir, `${stem}.m4a`);
  const webmFile = path.join(recordingsDir, `${stem}.webm`);
  writeFileSync(summaryFile, `# Eta\n\nSummary body.`);
  writeFileSync(transcriptFile, 'transcript for eta');
  writeFileSync(m4aFile, Buffer.from('m4a-stub-bytes'));
  writeFileSync(webmFile, Buffer.from('webm-stub-bytes'));

  // Mirrors a real .md note: session_info carries ONLY summary_file.
  const meeting: Meeting = { session_info: { name: 'Undo Eta', summary_file: summaryFile } };
  const files = [summaryFile, transcriptFile, m4aFile, webmFile];

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // Both non-.wav recordings were derived by stem and moved to trash.
  for (const f of files) expect(existsSync(f)).toBe(false);
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stored.some((n) => n.endsWith(`__${stem}.m4a`))).toBe(true);
  expect(stored.some((n) => n.endsWith(`__${stem}.webm`))).toBe(true);

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(true);
  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(existsSync(trashDir)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * Codex M1: a legit filename may contain a literal ".." (e.g. "Q1..final.m4a").
 * The stored name then becomes "<i>__undo-theta..final_summary.json". The old
 * restore guard rejected any name containing ".."; the basename-equality +
 * realpath-in-trashDir checks already forbid traversal, so such a name must now
 * round-trip through delete -> restore.
 */
test('a stored filename containing ".." round-trips through delete -> restore', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-theta..final', 'Undo Theta');
  const files = allFiles(seed);

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // At least one stored name carries the literal "..".
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stored.some((n) => n.includes('..'))).toBe(true);
  for (const f of files) expect(existsSync(f)).toBe(false);

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(true);
  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(existsSync(trashDir)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * Codex M2: a manifest with an empty (or malformed) `files` list must NOT be
 * treated as a successful zero-file restore — it fails and KEEPS the dir so the
 * trashed files are never silently orphaned.
 */
test('restore of a trash dir with an empty manifest files list fails and keeps the dir', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-iota', 'Undo Iota');

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // Corrupt the manifest to an empty files list.
  const manifestPath = path.join(trashDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files = [];
  writeFileSync(manifestPath, JSON.stringify(manifest));

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(false);
  expect(res.error).toContain('malformed');
  // The dir is preserved with the trashed files still inside.
  expect(existsSync(trashDir)).toBe(true);
  const stillStored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stillStored.length).toBeGreaterThan(0);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * cubic #3 — NO-CLOBBER: if a file already sits at a restore target (e.g. the
 * user re-recorded a note with the same stem while the delete's undo window was
 * open), restore must refuse and overwrite NOTHING — keeping the trash dir so
 * neither the trashed copy nor the pre-existing file is lost.
 */
test('restore refuses to clobber a pre-existing file at a restore target and keeps the trash dir', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-kappa', 'Undo Kappa');

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // A new file now occupies the summary's original path (the delete moved the
  // original into trash; this is a DIFFERENT file the restore must not clobber).
  const sentinel = 'DO-NOT-CLOBBER';
  writeFileSync(seed.summaryFile, sentinel);

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(false);
  expect(res.error).toContain('already exists');

  // The pre-existing file is byte-for-byte untouched.
  expect(readFileSync(seed.summaryFile, 'utf8')).toBe(sentinel);
  // The trash dir is KEPT with every trashed file still inside (nothing moved).
  expect(existsSync(trashDir)).toBe(true);
  const stored = readdirSync(trashDir).filter((n) => n !== 'manifest.json');
  expect(stored.length).toBeGreaterThan(0);
  // The other trashed files were NOT restored (PASS 1 returned before any move).
  expect(existsSync(seed.audioFile)).toBe(false);
  expect(existsSync(seed.transcriptFile)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * cubic #4 — IDEMPOTENT RETRY: a restore that faulted partway through PASS 2
 * leaves a PARTIAL restore (some files back at their origin, some still in
 * trash). Re-running restore must complete: skip the already-restored entries
 * and move the remainder, then remove the trash dir. Simulated by manually
 * moving one stored file to its destination before calling restore once.
 */
test('restore is idempotent after a partial restore — skips already-restored files and completes', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-lambda', 'Undo Lambda');
  const files = allFiles(seed);

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  expect(del.success).toBe(true);
  const trashId = del.trashId!;
  const trashDir = path.join(userDataDir, '.trash', trashId);

  // Simulate a prior partial restore: move ONE stored file back to its original
  // path by hand, leaving the manifest and the rest in trash.
  const manifest = JSON.parse(readFileSync(path.join(trashDir, 'manifest.json'), 'utf8'));
  const partial = manifest.files[0] as { from: string; stored: string };
  mkdirSync(path.dirname(partial.from), { recursive: true });
  renameSync(path.join(trashDir, partial.stored), partial.from);
  // Precondition: the moved-back file is at its dest, gone from trash.
  expect(existsSync(partial.from)).toBe(true);
  expect(existsSync(path.join(trashDir, partial.stored))).toBe(false);

  // Restore must SKIP the already-restored entry and move the remainder.
  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    trashId,
  );
  expect(res.success).toBe(true);

  // Every original file is back, and the trash dir is removed.
  for (const f of files) expect(existsSync(f)).toBe(true);
  expect(existsSync(trashDir)).toBe(false);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * cubic #2 — DELETE ROLLBACK / fail-closed: a genuine move failure on a VALIDATED
 * source must fail the delete (success:false) and leave the originals in place,
 * never report success while files are half-moved (which a later purge would
 * orphan). We inject the failure model-free by making the trash ROOT read-only,
 * so the handler's lazy `mkdirSync(trashDir)` throws on the first validated move.
 * Skipped where the OS doesn't enforce dir read-only perms (Windows / root).
 */
test('delete fails closed (success:false, originals intact) when a validated source cannot be moved', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const seed = seedNote(userDataDir, 'undo-mu', 'Undo Mu');
  const files = allFiles(seed);

  // Pre-create the trash root read-only so the handler can't create <id>/ inside
  // it. Probe enforcement from this (same-uid) process — if we can still write,
  // the OS ignores the perm bit and the injection wouldn't fire.
  const trashRoot = path.join(userDataDir, '.trash');
  mkdirSync(trashRoot, { recursive: true });
  chmodSync(trashRoot, 0o500);
  let enforced = true;
  try {
    const probe = path.join(trashRoot, '.probe');
    writeFileSync(probe, 'x');
    rmSync(probe);
    enforced = false;
  } catch {
    enforced = true;
  }
  test.skip(!enforced, 'read-only directory perms not enforced on this platform');

  const { page } = await launchApp();

  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    seed.meeting,
  );
  // Fail-closed: no success, no trashId.
  expect(del.success).toBe(false);
  expect(del.trashId).toBeFalsy();

  // Every original file is untouched — nothing was half-moved.
  for (const f of files) expect(existsSync(f)).toBe(true);
  // No orphaned trash entry was left behind under the (read-only) root.
  chmodSync(trashRoot, 0o700); // restore perms so we can inspect + teardown
  const leftover = readdirSync(trashRoot);
  expect(leftover.filter((n) => !n.startsWith('.')).length).toBe(0);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

/**
 * New critical: a symlinked `.trash` ROOT is an escape vector — pointed at an
 * allowed dir, a real basename (trashId "config.json") resolves to a genuine
 * file that would pass the containment check and get rmSync'd. Both restore and
 * purge must reject a symlinked root outright and never delete the target.
 * Symlink creation needs a privilege on Windows, so skip there if unavailable.
 */
test('restore/purge reject a symlinked .trash root and never delete the target', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const decoyRoot = path.join(userDataDir, 'decoy-root');
  mkdirSync(decoyRoot, { recursive: true });
  const target = path.join(decoyRoot, 'config.json');
  writeFileSync(target, '{"keep":"me"}');

  const trashRoot = path.join(userDataDir, '.trash');
  let symlinked = false;
  try {
    symlinkSync(decoyRoot, trashRoot, 'dir');
    symlinked = true;
  } catch {
    // Windows without symlink privilege — the guard is still covered on macOS.
  }
  test.skip(!symlinked, 'symlink creation unavailable on this platform');

  const { page } = await launchApp();

  const res = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.restore(id),
    'config.json',
  );
  expect(res.success).toBe(false);
  expect(res.error).toContain('Invalid trash root');

  const purge = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.meetings.purgeTrashed(id),
    'config.json',
  );
  expect(purge.success).toBe(false);
  expect(purge.error).toContain('Invalid trash root');

  // The decoy target survived — never rmSync'd through the symlinked root.
  expect(existsSync(target)).toBe(true);

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

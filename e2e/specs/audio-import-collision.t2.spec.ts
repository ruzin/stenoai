import { test, expect } from '../fixtures/electron';
import { startMockOllama } from '../fixtures/mock-ollama';
import { makeWav } from '../fixtures/make-wav';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { killOllama } from '../fixtures/kill-ollama';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';

/**
 * T2 (model-free) — import collision de-duplication against the durable note.
 *
 * The note lives in output/<stem>_summary.{md,json}, named from the audio stem,
 * and OUTLIVES the audio (process-streaming unlinks the recording after a
 * successful transcribe, keep_recordings off). So a stem that's free in
 * recordings/ can still collide with an EARLIER same-basename import whose audio
 * was already removed — and the old collision check, which looked only at
 * recordings/, would let the second import reuse the stem and silently overwrite
 * the first import's summary. This pins that copyImportIntoRecordings now also
 * skips a stem whose note already exists.
 *
 * Model-free on purpose: the stem is chosen at copy/enqueue time, BEFORE any
 * transcription, so the deduped recordings/ filename is observable without a
 * model. processFile is fire-and-forget; we assert the copy it just made, not
 * the (model-bearing) pipeline result. The end-to-end "original survives the
 * unlink" case stays in audio-import.t2 (@pipeline).
 *
 * The seeded note goes in the output dir that copyImportIntoRecordings actually
 * checks — the sibling of the app's recordings dir (from getDir()). In an
 * unpackaged run that's the repo-root output/ (resolveRecordingsDir doesn't
 * honor STENOAI_USER_DATA_DIR in dev — a pre-existing quirk; the dirs coincide
 * with the user-data root once packaged), so the finally cleans up that scratch.
 */

type StenoWindow = Window & {
  stenoai: {
    recording: {
      processFile: (filePath: string, name: string) => Promise<{ success?: boolean; error?: string }>;
      getDir: () => Promise<{ success?: boolean; path?: string }>;
    };
  };
};

test('a re-import of a same-basename file does not overwrite the first import\'s note', async ({
  launchApp,
  userDataDir,
}) => {
  // Defensive: own 11434 so the queued (modelless) job can't reach a real LLM.
  killOllama();
  const ollama = await startMockOllama();

  const realDirBefore = fileSig(realUserDataDir());

  let firstNote: string | undefined;
  let recordingsDir: string | undefined;

  try {
    const { page } = await launchApp();

    // The dir copyImportIntoRecordings copies into, and its sibling output/ —
    // the same pair the collision check consults.
    const dir = await page.evaluate(() =>
      (window as StenoWindow).stenoai.recording.getDir(),
    );
    recordingsDir = dir?.path;
    expect(recordingsDir).toBeTruthy();
    const outputDir = path.join(path.dirname(recordingsDir!), 'output');

    // Stand in for "an earlier import of imported.wav already produced a note":
    // seed output/imported_summary.md, as if its audio was since unlinked.
    mkdirSync(outputDir, { recursive: true });
    firstNote = path.join(outputDir, 'imported_summary.md');
    const firstNoteBody = '# First import\n\nThis note must survive a re-import.\n';
    writeFileSync(firstNote, firstNoteBody);

    // A fresh, DIFFERENT file that happens to share the basename.
    const srcDir = path.join(userDataDir, 'import-src');
    mkdirSync(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'imported.wav');
    makeWav(srcPath, { seconds: 2 });

    // processFile resolves once the file is copied + queued (before transcribe).
    const queued = await page.evaluate(
      (p) => (window as StenoWindow).stenoai.recording.processFile(p, 'Imported Note'),
      srcPath,
    );
    expect(queued?.success).toBe(true);

    // The copy must have side-stepped the existing note's stem: imported-1.wav,
    // NOT imported.wav. (imported.wav being free in recordings/ is exactly the
    // trap the old code fell into.)
    await expect
      .poll(() => existsSync(path.join(recordingsDir!, 'imported-1.wav')), {
        timeout: 10_000,
        intervals: [200],
      })
      .toBe(true);

    // The first import's note is byte-for-byte intact — nothing overwrote it.
    expect(readFileSync(firstNote, 'utf8')).toBe(firstNoteBody);

    // Keystone: the real user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await ollama.close();
    killOllama();
    // Tidy the (non-isolated in dev) scratch this test wrote.
    if (firstNote) rmSync(firstNote, { force: true });
    if (recordingsDir) {
      rmSync(path.join(recordingsDir, 'imported.wav'), { force: true });
      rmSync(path.join(recordingsDir, 'imported-1.wav'), { force: true });
    }
  }
});

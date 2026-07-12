import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T2 — path-validation trust boundary (security hardening batch,
 * fix/path-validation-trust-boundary).
 *
 * Threat model: the Electron renderer is UNTRUSTED (XSS / compromised renderer /
 * DevTools). A renderer-supplied file path must not let the backend or the main
 * process read / write / delete arbitrary local files. The two seams under test:
 *
 *   - validateMeetingFilePath (output/-only, realpath-canonicalized) guards
 *     query-transcript, add/remove-meeting-to-folder and update-meeting.
 *   - validateSafeFilePath (recordings/ + transcripts/ + output/, now
 *     realpath-canonicalized) guards delete-meeting (unlink), reveal and the
 *     system-audio path.
 *
 * These specs drive the real preload bridge and assert BOTH the rejection AND
 * that the out-of-bounds file on disk is never read / modified / deleted.
 * Model-free: every rejection happens in the Electron main process BEFORE any
 * backend spawn, so no Ollama / network is involved.
 */

type Result = { success: boolean; error?: string; answer?: string };
type Meeting = { session_info: { name: string; summary_file: string } };

type StenoWindow = Window & {
  stenoai: {
    query: { ask: (file: string, q: string) => Promise<Result> };
    meetings: {
      update: (summaryFile: string, patch: Record<string, unknown>) => Promise<Result>;
      delete: (meeting: Meeting) => Promise<Result>;
    };
    folders: {
      addMeeting: (summaryFile: string, folderId: string) => Promise<Result>;
      removeMeeting: (summaryFile: string, folderId: string) => Promise<Result>;
    };
  };
};

test('meeting-file handlers reject a real .json OUTSIDE output/ and never read/modify it', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // A genuine .json file at the data-dir ROOT (a sibling of output/). It passes
  // the extension gate, so only the output/-containment check can stop it — this
  // proves the containment boundary, not merely the ext filter.
  const evilPath = path.join(userDataDir, 'evil.json');
  const evilBody = JSON.stringify({ session_info: { name: 'ATTACKER' }, secret: 'keepme' });
  writeFileSync(evilPath, evilBody, 'utf8');
  const evilSigBefore = fileSig(evilPath);

  const { page } = await launchApp();

  // 1) query-transcript — arbitrary READ. Rejected before any backend spawn.
  const q = await page.evaluate(
    (f) => (window as StenoWindow).stenoai.query.ask(f, 'summarize this'),
    evilPath,
  );
  expect(q.success).toBe(false);
  expect(q.error).toBeTruthy();

  // 2) add-meeting-to-folder / remove-meeting-from-folder — arbitrary WRITE via
  //    the backend. Any folder id works: validation rejects before it's used.
  const add = await page.evaluate(
    (f) => (window as StenoWindow).stenoai.folders.addMeeting(f, 'dummy-folder-id'),
    evilPath,
  );
  expect(add.success).toBe(false);
  expect(add.error).toBeTruthy();

  const remove = await page.evaluate(
    (f) => (window as StenoWindow).stenoai.folders.removeMeeting(f, 'dummy-folder-id'),
    evilPath,
  );
  expect(remove.success).toBe(false);
  expect(remove.error).toBeTruthy();

  // 3) update-meeting — arbitrary WRITE via fs. Rejected, and the file is byte-
  //    for-byte unchanged (the rename attempt never touched it).
  const upd = await page.evaluate(
    (f) => (window as StenoWindow).stenoai.meetings.update(f, { name: 'HACKED' }),
    evilPath,
  );
  expect(upd.success).toBe(false);
  expect(upd.error).toBeTruthy();

  // The out-of-bounds file was never modified.
  expect(fileSig(evilPath)).toBe(evilSigBefore);
  expect(readFileSync(evilPath, 'utf8')).toBe(evilBody);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('meeting-file handlers reject a NON-STRING / malformed path without crashing', async ({
  launchApp,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // The renderer is untrusted, so a compromised/malicious caller can hand the
  // typed bridge a non-string (object/number). validateMeetingFilePath's ext
  // check would call `.endsWith` on it and THROW — which, on the async
  // query-transcript-stream listener, would become an unhandled rejection that
  // can take down the main process. The source now type-guards, so every caller
  // resolves gracefully to { success: false } instead. Cast through `unknown`
  // to smuggle the non-string past the TS bridge types (mirrors a real attacker
  // who isn't bound by our types at runtime).
  for (const bad of [42, { path: '/etc/hosts' }, null, undefined] as unknown[]) {
    const q = await page.evaluate(
      (f) => (window as StenoWindow).stenoai.query.ask(f as unknown as string, 'read'),
      bad,
    );
    expect(q.success).toBe(false);
    expect(q.error).toBeTruthy();

    const upd = await page.evaluate(
      (f) => (window as StenoWindow).stenoai.meetings.update(f as unknown as string, { name: 'x' }),
      bad,
    );
    expect(upd.success).toBe(false);
    expect(upd.error).toBeTruthy();
  }

  // The app is still alive and responsive after the malformed inputs (no crash
  // / no hung main process): a subsequent well-formed-but-rejected call returns.
  const stillAlive = await page.evaluate(() =>
    (window as StenoWindow).stenoai.query.ask('/nope/outside.json', 'ping'),
  );
  expect(stillAlive.success).toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

// Symlink escape: a link that LEXICALLY lives inside output/ but resolves OUTSIDE
// it. A naive path-prefix check passes; only realpath canonicalization rejects it.
// Windows symlink creation needs admin / developer mode, unreliable on headless
// CI runners — skip there. macOS (the signed, primary platform) is the real
// signal, and validateSafeFilePath deliberately canonicalizes both sides so the
// e2e /tmp -> /private/tmp normalization keeps working.
test.describe('symlink escape is canonicalized and rejected', () => {
  test.skip(
    process.platform === 'win32',
    'symlink creation requires admin/developer mode on Windows runners',
  );

  test('output/ symlink -> outside file is rejected by realpath (read/write + delete seams)', async ({
    launchApp,
    userDataDir,
  }) => {
    const realDirBefore = fileSig(realUserDataDir());

    // The escape target lives in an UNRELATED temp dir — outside both the app's
    // project root and the (allowed) user-data dir, so it's out of bounds for
    // BOTH validators.
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'stenoai-evil-'));
    const outsideTarget = path.join(outsideDir, 'secret.json');
    const outsideBody = JSON.stringify({ secret: 'do-not-touch' });
    writeFileSync(outsideTarget, outsideBody, 'utf8');
    const outsideSigBefore = fileSig(outsideTarget);

    // The symlink sits INSIDE output/ (lexically contained) but points out.
    const outputDir = path.join(userDataDir, 'output');
    mkdirSync(outputDir, { recursive: true });
    const linkPath = path.join(outputDir, 'evil_summary.json');
    symlinkSync(outsideTarget, linkPath);

    try {
      const { page } = await launchApp();

      // validateMeetingFilePath seam: query READ + update WRITE both rejected.
      const q = await page.evaluate(
        (f) => (window as StenoWindow).stenoai.query.ask(f, 'read the secret'),
        linkPath,
      );
      expect(q.success).toBe(false);
      expect(q.error).toBeTruthy();

      const upd = await page.evaluate(
        (f) => (window as StenoWindow).stenoai.meetings.update(f, { name: 'HACKED' }),
        linkPath,
      );
      expect(upd.success).toBe(false);
      expect(upd.error).toBeTruthy();

      // validateSafeFilePath seam: delete-meeting must NOT unlink through the
      // symlink. It reports the blocked deletion and the target survives.
      const del = await page.evaluate(
        (f) =>
          (window as StenoWindow).stenoai.meetings.delete({
            session_info: { name: 'Evil', summary_file: f },
          }),
        linkPath,
      );
      expect(del.success).toBe(false);
      expect(del.error).toBeTruthy();

      // The escape target was neither modified nor deleted.
      expect(existsSync(outsideTarget)).toBe(true);
      expect(fileSig(outsideTarget)).toBe(outsideSigBefore);
      expect(readFileSync(outsideTarget, 'utf8')).toBe(outsideBody);

      // Keystone: the real user-data dir is byte-for-byte untouched.
      expect(fileSig(realUserDataDir())).toBe(realDirBefore);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — save-meeting-notes must write into the user-data output dir, NOT the app
 * bundle. The old getBackendCwd()/_internal/output target was read-only in a
 * packaged/signed app (notes-saving failed for real users on macOS + Windows)
 * and was a dir the Python pipeline never reads notes from. This pins the fix:
 * the note lands under <STENOAI_USER_DATA_DIR>/output (where Python's
 * get_data_dirs() looks) and the real user-data dir is untouched.
 */

type SaveResult = { success: boolean; path?: string; error?: string };
type StenoWindow = Window & {
  stenoai: { meetings: { saveNotes: (name: string, notes: string) => Promise<SaveResult> } };
};

test('save-meeting-notes writes into the user-data output dir (not the bundle); real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  const note = 'Ship the Windows alpha to the enterprise pilot.';
  const res = await page.evaluate(
    (n) => (window as StenoWindow).stenoai.meetings.saveNotes('Pilot Meeting', n),
    note,
  );

  expect(res.success).toBe(true);
  expect(res.path).toBeTruthy();

  // The returned path is inside the temp user-data output dir — proving it no
  // longer escapes to the bundle (getBackendCwd()/_internal/output).
  const expectedDir = path.join(userDataDir, 'output');
  expect(path.dirname(res.path!)).toBe(expectedDir);
  expect(path.basename(res.path!)).toBe('Pilot_Meeting_notes.txt');
  expect(existsSync(res.path!)).toBe(true);
  expect(readFileSync(res.path!, 'utf8')).toBe(note);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeMeetingSummary } from '../fixtures/user-config';
import { readFileSync, existsSync, rmSync } from 'fs';

/**
 * T2 — meetings CRUD + folder membership. Pre-seeds known `*_summary.json` docs
 * into the temp user-data `output/` dir, then drives the real backend's meeting
 * IPC and asserts both the returned payloads and the on-disk summary files.
 * Model-free: list/update/delete/add/removeMeeting are pure file ops — the
 * model-bearing reprocess / regen-title handlers are intentionally NOT covered
 * here (they need Ollama; they belong to a @pipeline/@contract spec).
 */

type Meeting = {
  session_info: { name: string; summary_file: string };
  folders?: string[];
};
type ListResult = { success: boolean; meetings: Meeting[] };
type Result = { success: boolean; error?: string; path?: string };
type CreateFolderResult = { success: boolean; folder?: { id: string } };

type StenoWindow = Window & {
  stenoai: {
    meetings: {
      list: () => Promise<ListResult>;
      update: (summaryFile: string, patch: Record<string, unknown>) => Promise<Result>;
      delete: (meeting: Meeting) => Promise<Result>;
      saveNotes: (name: string, notes: string) => Promise<Result>;
    };
    folders: {
      create: (name: string, color?: string) => Promise<CreateFolderResult>;
      addMeeting: (summaryFile: string, folderId: string) => Promise<Result>;
      removeMeeting: (summaryFile: string, folderId: string) => Promise<Result>;
    };
  };
};

const list = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.meetings.list());

const readSummary = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

test('meetings list/update/delete operate on the temp output dir; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // Seed two known meetings before launch.
  const fileA = writeMeetingSummary(userDataDir, 'alpha', { name: 'Alpha Sync' });
  const fileB = writeMeetingSummary(userDataDir, 'beta', { name: 'Beta Review' });

  const { page } = await launchApp();

  // list-meetings enumerates both.
  await expect.poll(async () => (await list(page)).meetings.length).toBe(2);
  const names = (await list(page)).meetings.map((m) => m.session_info.name).sort();
  expect(names).toEqual(['Alpha Sync', 'Beta Review']);

  // Rename Alpha via update-meeting -> the on-disk JSON reflects the new name
  // and gets an updated_at stamp.
  const upd = await page.evaluate(
    (f) => (window as StenoWindow).stenoai.meetings.update(f, { name: 'Alpha Standup' }),
    fileA,
  );
  expect(upd.success).toBe(true);
  await expect.poll(() => readSummary(fileA).session_info.name).toBe('Alpha Standup');
  expect(readSummary(fileA).session_info.updated_at).toBeTruthy();

  // Delete Beta -> its summary file is removed and the list shrinks to one.
  const beta = (await list(page)).meetings.find((m) => m.session_info.name === 'Beta Review')!;
  const del = await page.evaluate(
    (m) => (window as StenoWindow).stenoai.meetings.delete(m),
    beta,
  );
  expect(del.success).toBe(true);
  await expect.poll(() => existsSync(fileB)).toBe(false);
  await expect.poll(async () => (await list(page)).meetings.length).toBe(1);
  expect(existsSync(fileA)).toBe(true);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('folder membership: add/remove a meeting writes the top-level folders array', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const file = writeMeetingSummary(userDataDir, 'gamma', { name: 'Gamma Planning' });
  const { page } = await launchApp();

  const folder = await page.evaluate(() =>
    (window as StenoWindow).stenoai.folders.create('Roadmap'),
  );
  expect(folder.success).toBe(true);
  const folderId = folder.folder!.id;

  // Add the meeting to the folder -> top-level `folders` contains the id.
  const add = await page.evaluate(
    ({ f, id }) => (window as StenoWindow).stenoai.folders.addMeeting(f, id),
    { f: file, id: folderId },
  );
  expect(add.success).toBe(true);
  await expect.poll(() => readSummary(file).folders).toContain(folderId);

  // list-meetings surfaces the membership.
  await expect
    .poll(async () => {
      const m = (await list(page)).meetings.find((x) => x.session_info.name === 'Gamma Planning');
      return m?.folders ?? [];
    })
    .toContain(folderId);

  // Remove it -> the id is gone again.
  const remove = await page.evaluate(
    ({ f, id }) => (window as StenoWindow).stenoai.folders.removeMeeting(f, id),
    { f: file, id: folderId },
  );
  expect(remove.success).toBe(true);
  await expect.poll(() => readSummary(file).folders).not.toContain(folderId);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('save-meeting-notes returns a written path with the note body', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  writeMeetingSummary(userDataDir, 'delta', { name: 'Delta Notes' });
  const { page } = await launchApp();

  const note = 'Follow up with finance on Q3 budget.';
  const res = await page.evaluate(
    (n) => (window as StenoWindow).stenoai.meetings.saveNotes('Delta Notes', n),
    note,
  );
  try {
    expect(res.success).toBe(true);
    // NOTE: save-meeting-notes currently writes to getBackendCwd()/_internal/output
    // (the bundle dir), NOT the user-data output dir — so we assert via the returned
    // path rather than the temp dir. That location mismatch (notes saved where the
    // Python pipeline doesn't read them, into a read-only bundle when packaged) is a
    // pre-existing bug tracked separately, out of scope for this coverage PR.
    expect(res.path).toBeTruthy();
    expect(existsSync(res.path!)).toBe(true);
    expect(readFileSync(res.path!, 'utf8')).toBe(note);
  } finally {
    // This is the one write in the PR that escapes STENOAI_USER_DATA_DIR (per the
    // bug above). Clean it up so the suite stays hermetic — otherwise the note
    // file lingers in the build tree and accumulates across retries/runs.
    if (res.path) rmSync(res.path, { force: true });
  }

  // Keystone: save-notes escapes to the bundle dir (the bug above), but the real
  // user-data dir must still be byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

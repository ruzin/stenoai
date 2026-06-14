import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — folders CRUD + ordering. Drives the real backend's folder IPC through the
 * preload bridge and asserts both the returned payloads AND the on-disk
 * folders.json under the temp user-data dir. Model-free (pure state via the
 * Python folders manager) — runs in the fast t2 jobs.
 */

type Folder = { id: string; name: string; color?: string; order?: number; icon?: string };
type ListResult = { success: boolean; folders: Folder[] };
type CreateResult = { success: boolean; folder?: Folder };
type Result = { success: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    folders: {
      list: () => Promise<ListResult>;
      create: (name: string, color?: string) => Promise<CreateResult>;
      rename: (id: string, name: string) => Promise<Result>;
      delete: (id: string) => Promise<Result>;
      reorder: (ids: string[]) => Promise<Result>;
    };
  };
};

const list = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.folders.list());

function readFoldersJson(userDataDir: string): Folder[] {
  const p = path.join(userDataDir, 'folders.json');
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, 'utf8')).folders ?? []) as Folder[];
}

test('folders CRUD + reorder persist to folders.json in the temp dir; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Starts empty.
  expect((await list(page)).folders).toEqual([]);

  // Create three folders.
  const names = ['Engineering', 'Sales', 'Personal'];
  const ids: string[] = [];
  for (const name of names) {
    const res = await page.evaluate(
      (n) => (window as StenoWindow).stenoai.folders.create(n, '#6366f1'),
      name,
    );
    expect(res.success).toBe(true);
    expect(res.folder?.id).toBeTruthy();
    ids.push(res.folder!.id);
  }

  // All three are listed and persisted to folders.json.
  await expect.poll(async () => (await list(page)).folders.length).toBe(3);
  expect((await list(page)).folders.map((f) => f.name).sort()).toEqual(
    [...names].sort(),
  );
  expect(readFoldersJson(userDataDir).map((f) => f.name).sort()).toEqual(
    [...names].sort(),
  );

  // Rename one.
  const rename = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.folders.rename(id, 'Engineering Team'),
    ids[0],
  );
  expect(rename.success).toBe(true);
  await expect
    .poll(() => readFoldersJson(userDataDir).find((f) => f.id === ids[0])?.name)
    .toBe('Engineering Team');

  // Reorder: reverse the creation order; each folder's `order` field reflects it.
  const reversed = [...ids].reverse();
  const reorder = await page.evaluate(
    (order) => (window as StenoWindow).stenoai.folders.reorder(order),
    reversed,
  );
  expect(reorder.success).toBe(true);
  await expect
    .poll(() => {
      const onDisk = readFoldersJson(userDataDir);
      return reversed.map((id) => onDisk.find((f) => f.id === id)?.order);
    })
    .toEqual([0, 1, 2]);

  // Delete one; it disappears from the list and folders.json, the others remain.
  const del = await page.evaluate(
    (id) => (window as StenoWindow).stenoai.folders.delete(id),
    ids[1],
  );
  expect(del.success).toBe(true);
  await expect.poll(async () => (await list(page)).folders.length).toBe(2);
  expect(readFoldersJson(userDataDir).some((f) => f.id === ids[1])).toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

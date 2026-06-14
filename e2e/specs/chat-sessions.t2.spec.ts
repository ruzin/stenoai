import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — chat session persistence. The Chat tab persists its sessions through
 * save-chat-sessions / load-chat-sessions, an atomic local write with no LLM and
 * no network. Drives the real backend IPC and asserts the round-trip plus the
 * on-disk chat_sessions_v2.json in the temp user-data dir. Deterministic +
 * model-free.
 */

type SaveResult = { success: boolean; error?: string };
type LoadResult = { success: boolean; data: unknown; migratedFromLegacy?: boolean };

type StenoWindow = Window & {
  stenoai: {
    chat: {
      save: (data: unknown) => Promise<SaveResult>;
      load: () => Promise<LoadResult>;
    };
  };
};

const V2_FILE = 'chat_sessions_v2.json';

test('chat sessions save+load round-trip persists to chat_sessions_v2.json; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // First load on a clean profile returns empty (data: null), not an error.
  const empty = await page.evaluate(() => (window as StenoWindow).stenoai.chat.load());
  expect(empty.success).toBe(true);
  expect(empty.data).toBeNull();

  // Save a known session graph.
  const sessions = {
    version: 2,
    sessions: [
      { id: 's1', title: 'Roadmap chat', messages: [{ role: 'user', content: 'hi' }] },
      { id: 's2', title: 'Bug triage', messages: [] },
    ],
  };
  const saved = await page.evaluate(
    (data) => (window as StenoWindow).stenoai.chat.save(data),
    sessions,
  );
  expect(saved.success).toBe(true);

  // It landed in the temp dir as chat_sessions_v2.json with the exact payload.
  const v2Path = path.join(userDataDir, V2_FILE);
  await expect.poll(() => existsSync(v2Path)).toBe(true);
  expect(JSON.parse(readFileSync(v2Path, 'utf8'))).toEqual(sessions);

  // load() returns the saved graph (not the legacy-migration path).
  const loaded = await page.evaluate(() => (window as StenoWindow).stenoai.chat.load());
  expect(loaded.success).toBe(true);
  expect(loaded.data).toEqual(sessions);
  expect(loaded.migratedFromLegacy).toBeFalsy();

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

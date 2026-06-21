import { test, expect } from '../fixtures/electron';
import fs from 'fs';
import path from 'path';

/**
 * T1 — renderer-only, mock IPC, no backend build. main.js still runs, so the
 * processing-log init + startup marker execute. Asserts the disk sink is wired
 * without coupling to volatile auto-updater/protocol lines.
 */
test('writes a processing.log with an [app] startup marker', async ({ launchApp, userDataDir }) => {
  await launchApp({ mockIpc: true });

  const logPath = path.join(userDataDir, 'logs', 'processing.log');

  await expect
    .poll(() => fs.existsSync(logPath), { timeout: 10_000 })
    .toBe(true);

  const content = fs.readFileSync(logPath, 'utf8');
  expect(content).toMatch(/\[app\] startup/);
});

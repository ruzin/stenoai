import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeUserConfig, readUserConfig } from '../fixtures/user-config';
import { startMockOllama } from '../fixtures/mock-ollama';
import { killOllama } from '../fixtures/kill-ollama';
import { existsSync } from 'fs';
import path from 'path';

/**
 * T2 — #123: first-run setup must REUSE an already-installed supported model
 * instead of re-pulling the hardcoded default. The mock Ollama lists `llama3.2:3b`
 * under /api/tags, so the `setup-ollama-and-model` flow should detect it, set it
 * as the active model, and issue NO /api/pull (the regression assertion is
 * `pullCalls() === 0`). Model-free: only /api/tags + config I/O, no model loads.
 *
 * The dev-mode handler still locates the bundled Ollama binary (`bin/ollama`)
 * before reusing a running instance, so this skips LOUDLY when that binary is
 * absent (CI downloads it via scripts/download-ollama.sh; a bare local checkout
 * may not have it) rather than emitting a misleading "Bundled Ollama not found".
 */

type SetupResult = { success: boolean; message?: string; error?: string; skipped?: boolean };
type StenoWindow = Window & {
  stenoai: { setup: { ollamaAndModel: () => Promise<SetupResult> } };
};

const ollamaBinaryExists = (): boolean => {
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  // app/main.js dev path: path.join(__dirname /* app */, '..', 'bin', exe).
  // This spec lives at e2e/specs, so the repo-root bin/ is two levels up.
  return existsSync(path.resolve(__dirname, '../../bin', exe));
};

test('setup reuses an installed supported model and skips the pull (#123)', async ({
  launchApp,
  userDataDir,
}) => {
  if (!ollamaBinaryExists()) {
    // eslint-disable-next-line no-console
    console.warn('[t2] SKIPPED setup-model-reuse: bundled bin/ollama absent on this host.');
    test.info().annotations.push({
      type: 'skip-reason',
      description: 'bin/ollama not present; setup-ollama-and-model refuses to proceed',
    });
  }
  test.skip(!ollamaBinaryExists(), 'bundled bin/ollama unavailable on this runner');

  const realDirBefore = fileSig(realUserDataDir());
  // Own port 11434 with the mock so the handler reuses it (and never spawns the
  // real bundled Ollama). Local provider so setup takes the local path, not the
  // remote/cloud early-return.
  killOllama();
  const mock = await startMockOllama();
  try {
    writeUserConfig(userDataDir, { ai_provider: 'local' });
    const { page } = await launchApp();

    const res = await page.evaluate(() =>
      (window as StenoWindow).stenoai.setup.ollamaAndModel(),
    );
    expect(res.success).toBe(true);
    expect(res.skipped).toBeFalsy();

    // The #123 regression assertion: the installed model was reused, not pulled.
    expect(mock.pullCalls()).toBe(0);
    // ...and it was persisted as the active model.
    await expect.poll(() => readUserConfig(userDataDir).model).toBe('llama3.2:3b');
  } finally {
    await mock.close();
  }

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';

/**
 * T2 — startup setup check. The onboarding wizard polls setup.check() to decide
 * which steps are needed; it reads system state (bundled binaries, model caches,
 * deps) with NO installs and NO network. This asserts the result CONTRACT on a
 * clean profile — the shape the wizard depends on — without asserting any
 * specific host's install state (that varies by runner). The heavy install steps
 * (setup-ollama-and-model, setup-parakeet, …) download hundreds of MB and are
 * deferred to manual /verify + the nightly packaged cold-start.
 */

type Check = [icon: string, label: string];
type SetupResult = { success: boolean; allGood?: boolean; checks?: Check[]; error?: string };

type StenoWindow = Window & {
  stenoai: { setup: { check: () => Promise<SetupResult> } };
};

test('setup.check returns a coherent allGood + checks contract on a clean profile; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  const res = await page.evaluate(() => (window as StenoWindow).stenoai.setup.check());

  expect(res.success).toBe(true);
  // allGood is a boolean verdict (its value is host-dependent — a CI runner
  // without the LLM model reports false — so we assert the type, not the value).
  expect(typeof res.allGood).toBe('boolean');

  // checks is a non-empty list of [status, detail] pairs the wizard renders. The
  // handler splits each "<emoji> <label>   <detail>" line on 2+ spaces, so
  // entry[0] is the emoji-prefixed "<emoji> <label>" and entry[1] is the detail.
  expect(Array.isArray(res.checks)).toBe(true);
  expect(res.checks!.length).toBeGreaterThan(0);
  for (const entry of res.checks!) {
    expect(Array.isArray(entry)).toBe(true);
    expect(entry).toHaveLength(2);
    const [status, detail] = entry;
    expect(['✅', '❌', '⚠️'].some((e) => status.startsWith(e))).toBe(true);
    expect(status.length).toBeGreaterThan(1); // emoji + a label
    expect(typeof detail).toBe('string');
  }

  // setup.check is a read — it must not write into the real user-data dir.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

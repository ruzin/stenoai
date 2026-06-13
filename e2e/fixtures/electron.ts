import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Repo-root/app — the Electron app dir (package.json main: main.js). Resolved
// from this file so the helper works regardless of the cwd Playwright runs in.
const APP_DIR = path.resolve(__dirname, '..', '..', 'app');

type LaunchOptions = {
  /** Install the deterministic mock IPC layer (T1, no backend). */
  mockIpc?: boolean;
  /** Extra env vars merged over the e2e defaults. */
  env?: Record<string, string>;
};

type LaunchResult = { app: ElectronApplication; page: Page };

type Fixtures = {
  userDataDir: string;
  launchApp: (opts?: LaunchOptions) => Promise<LaunchResult>;
};

export const test = base.extend<Fixtures>({
  // Per-test isolated user-data dir. The keystone (STENOAI_USER_DATA_DIR) routes
  // every app + backend write here instead of the real ~/Library/... dir, so a
  // test can never corrupt real user data. Removed after the test.
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stenoai-e2e-'));
    await use(dir);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  },

  // Factory so each spec decides when/how to launch (T1 passes mockIpc:true).
  // Every app launched through it is closed at teardown.
  launchApp: async ({ userDataDir }, use) => {
    const launched: ElectronApplication[] = [];

    const launch = async (opts: LaunchOptions = {}): Promise<LaunchResult> => {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        STENOAI_E2E: '1',
        STENOAI_USER_DATA_DIR: userDataDir,
        ...(opts.mockIpc ? { STENOAI_E2E_MOCK_IPC: '1' } : {}),
        ...(opts.env ?? {}),
      };

      // Electron occasionally fails its very first launch on a cold CI runner;
      // retry once before surfacing the error (test-level retries are the
      // second line of defence, configured in playwright.config.ts).
      let app: ElectronApplication | undefined;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          app = await electron.launch({ args: ['.'], cwd: APP_DIR, env });
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!app) throw lastErr;
      launched.push(app);

      const page = await app.firstWindow();
      // Deterministic launch gate — set in App.tsx's readiness effect. No
      // fixed timeouts anywhere in the suite.
      await page.waitForSelector('[data-app-ready]', { timeout: 30_000 });
      return { app, page };
    };

    await use(launch);

    for (const app of launched) {
      try {
        await app.close();
      } catch {
        /* already gone */
      }
    }
  },
});

export { expect };

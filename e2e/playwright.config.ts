import { defineConfig } from '@playwright/test';

/**
 * Tiered e2e config (PR1 of the e2e plan).
 *
 *  - T1 (`*.t1.spec.ts`): renderer-only, mock IPC, no Python bundle. Runs on
 *    Ubuntu in CI under xvfb.
 *  - T2 (`*.t2.spec.ts`): real bundled backend + mock adapter / Ollama. Needs
 *    `dist/stenoai/` built; runs on macOS (Windows added in PR3).
 *
 * Tiers are selected by spec filename so CI can fan them into separate jobs.
 * `workers: 1` because every test launches a real Electron app and T2 binds the
 * fixed Ollama port 11434 — serialising avoids port and resource collisions.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 't1', testMatch: /.*\.t1\.spec\.ts/ },
    { name: 't2', testMatch: /.*\.t2\.spec\.ts/ },
  ],
});

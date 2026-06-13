import { defineConfig } from '@playwright/test';

/**
 * Tiered e2e config (PR1 of the e2e plan).
 *
 *  - T1 (`*.t1.spec.ts`): renderer-only, mock IPC, no Python bundle. Runs on
 *    Ubuntu in CI under xvfb.
 *  - T2 (`*.t2.spec.ts`): real bundled backend + mock adapter / Ollama. Needs
 *    `dist/stenoai/` built; runs on macOS + Windows.
 *  - T3 (`*.t3.spec.ts`): heavy, nightly-only (the long-meeting chunking smoke).
 *    Real backend like T2 but minutes-long, so it's split into its own project
 *    and run by the scheduled e2e-nightly workflow, never per-PR.
 *
 * Tiers are selected by spec filename so CI can fan them into separate jobs.
 * `workers: 1` because every test launches a real Electron app and T2/T3 bind the
 * fixed Ollama port 11434 — serialising avoids port and resource collisions.
 */
export default defineConfig({
  testDir: './specs',
  // CI-only: kill a stray Ollama + wait for a clean 11434 before the run (no-op
  // locally so a dev's own Ollama is left alone).
  globalSetup: './fixtures/global-setup.ts',
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
    { name: 't1', testMatch: /.*\.t1\.spec\.ts$/ },
    { name: 't2', testMatch: /.*\.t2\.spec\.ts$/ },
    { name: 't3', testMatch: /.*\.t3\.spec\.ts$/ },
  ],
});

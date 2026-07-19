import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// This script lives at app/steno-open.mjs, so its own directory is the app
// dir to launch — derived rather than hardcoded so it works from any
// checkout, not just this machine's.
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const userDataDir = mkdtempSync(path.join(tmpdir(), 'stenoai-live-'));

const app = await electron.launch({
  args: ['.'],
  cwd: APP_DIR,
  env: {
    ...process.env,
    STENOAI_E2E: '1',
    STENOAI_E2E_MOCK_IPC: '1',
    STENOAI_USER_DATA_DIR: userDataDir,
  },
});

const page = await app.firstWindow();
await page.waitForSelector('[data-app-ready]', { timeout: 30_000 });

// Skip onboarding. App.tsx runs a one-time "first-run setup gate" on first
// landing on '/' that checks (async, via IPC) whether any Whisper/Parakeet
// model is installed; under mock IPC both are mocked as NOT installed, so it
// always concludes setup isn't done and navigate('/setup')s — but only once
// per session (ref-guarded). Visit '/' first and wait long enough for that
// one-time check to resolve and burn itself out, THEN go to '/' again
// (safe now) and on to Settings, so Back navigates to Home correctly for
// the rest of this session instead of getting hijacked to /setup later.
await page.evaluate(() => { window.location.hash = '#/'; });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.location.hash = '#/'; });
await page.waitForTimeout(400);
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForSelector('[data-settings-tab="general"]', { timeout: 10_000 });

console.log('Settings is open. Window will stay up — this process is keeping it alive.');

// Keep the script (and therefore the launched Electron app) running
// indefinitely so the window stays open for manual inspection.
await new Promise(() => {});

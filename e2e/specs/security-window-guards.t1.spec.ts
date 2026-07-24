import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC, no backend. Proves the #377 BrowserWindow
 * hardening: the main window's `setWindowOpenHandler` denies every popup, so a
 * renderer `window.open(...)` (or a `target="_blank"` link) can never spawn a
 * chrome-less in-app Electron window. `about:blank` is used deliberately — it is
 * not an http(s)/mailto URL, so the deny path runs without the interactive
 * window's `shell.openExternal` fallback launching a real browser tab in CI.
 *
 * Scope: this asserts the popup-deny guard, which is the primary renderer-
 * reachable risk surface. The companion `will-navigate` guard (defense-in-depth
 * against full-page navigation away from the bundled renderer) is deliberately
 * NOT asserted here: modern Chromium already blocks the only hermetic navigation
 * vectors (`data:`/`about:blank`/missing `file:`), so a fail-before-provable test
 * isn't achievable without a networked http target (side effects). That guard is
 * verified by code review + reasoning, not a test that would pass regardless.
 */
test('window.open is denied — no popup BrowserWindow is created (#377)', async ({
  launchApp,
}) => {
  const { app, page } = await launchApp({ mockIpc: true });

  const windowsBefore = app.windows().length;

  // If the deny handler failed, a new window would appear and fire this event.
  // We assert the *absence* of that event within a bounded window (event-race,
  // not a fixed sleep in the assertion).
  const popupAppeared = app
    .waitForEvent('window', { timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  await page.evaluate(() => {
    window.open('about:blank', '_blank');
  });

  expect(await popupAppeared).toBe(false);
  expect(app.windows().length).toBe(windowsBefore);
});

import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC. Pins WS3's renderer surface: cross-note chat is
 * now usable with a LOCAL provider (was gated to cloud/adapter), and local/remote
 * mode discloses that answers cover a context-capped, most-recent slice of notes.
 * Wire shapes stubbed in app/e2e-mock-ipc.js; readiness logic in routes/Chat.tsx.
 */

const READY_PLACEHOLDER = 'Summarise my meetings this week  /';
const NOT_READY_PLACEHOLDER = 'Set up an AI provider in Settings to ask across notes';
const hint = '[data-testid="chat-local-scope-hint"]';

test('local provider enables chat and discloses the recent-notes scope', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  // Default mock provider is 'local'.
  await page.evaluate(() => {
    window.location.hash = '#/chat';
  });

  // Input is enabled (ready) — the composer shows the active-state placeholder.
  await expect(page.getByPlaceholder(READY_PLACEHOLDER)).toBeVisible();
  // And the local-scope disclosure is shown.
  await expect(page.locator(hint).first()).toBeVisible();
});

test('cloud without an API key keeps chat gated and shows no local-scope hint', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  // Switch to cloud (mock reports cloud_api_key_set:false) on a non-chat route,
  // then mount Chat fresh so the provider query refetches.
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await page.evaluate(() => (window as unknown as { stenoai: { ai: { setProvider: (p: string) => Promise<unknown> } } }).stenoai.ai.setProvider('cloud'));
  await page.evaluate(() => {
    window.location.hash = '#/chat';
  });

  // Not ready → the gated placeholder; no local-scope hint (cloud isn't capped).
  await expect(page.getByPlaceholder(NOT_READY_PLACEHOLDER)).toBeVisible();
  await expect(page.locator(hint)).toHaveCount(0);
});

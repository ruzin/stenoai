import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC. Drives the context-aware ⌘K palette while the
 * Settings page is open: it must switch to "Search settings…" mode, filter the
 * settings index, and navigate to the tab the chosen setting lives on — and,
 * critically, switch the VISIBLE tab even when Settings is already open (the
 * route-reactive fix in Settings.tsx). Ported/adapted from @Vassista's PR #349.
 */

const palette = '[data-testid="command-palette"]';
const input = '[data-testid="command-palette-input"]';
const result = '[data-testid="command-palette-result"]';
const settingsPage = '[data-testid="settings-page"]';

const launchOpts = { mockIpc: true } as const;

async function openSettings(page: Page, tab?: string) {
  await page.evaluate((t) => {
    window.location.hash = t ? `#/settings?tab=${t}` : '#/settings';
  }, tab);
  await expect(page.locator(settingsPage)).toBeVisible();
}

test('⌘K in Settings searches settings, not notes', async ({ launchApp }) => {
  const { page } = await launchApp(launchOpts);
  await openSettings(page);

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(palette)).toBeVisible();

  // Context-aware: the palette is in settings mode.
  await expect(page.locator(input)).toHaveAttribute('placeholder', 'Search settings…');
  await expect(page.locator(palette)).toContainText('Microphone');
  await expect(page.locator(palette)).toContainText('AI provider');

  // Filtering narrows the settings index.
  await page.locator(input).fill('provider');
  await expect(page.locator(result)).toHaveCount(1);
  await expect(page.locator(result).nth(0)).toContainText('AI provider');

  // Query is trimmed, and the index title matches the real settings label
  // ("Post meeting notifications", no hyphen) so searching the visible label
  // works even with surrounding whitespace.
  await page.locator(input).fill('  post meeting  ');
  await expect(page.locator(result).filter({ hasText: 'Post meeting notifications' })).toHaveCount(1);
});

test('selecting a setting navigates to its tab and switches the visible tab', async ({
  launchApp,
}) => {
  const { page } = await launchApp(launchOpts);
  // Start on the AI tab so the jump to a General-tab setting has to actually
  // switch tabs — this exercises the route-reactive sync, not just first mount.
  await openSettings(page, 'ai');
  await expect(page.locator(settingsPage)).toContainText('AI provider');

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator(input).fill('launch on login');
  await expect(page.locator(result)).toHaveCount(1);
  await expect(page.locator(result).nth(0)).toContainText('Launch on login');
  await page.keyboard.press('Enter');

  // Palette closes, the route carries the target tab, and the General tab is
  // now the one rendered (its content is visible; the AI-only row is gone).
  await expect(page.locator(palette)).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('tab=general');
  await expect(page.locator(settingsPage)).toContainText('Launch on login');
  await expect(page.locator(settingsPage)).not.toContainText('AI provider');
});

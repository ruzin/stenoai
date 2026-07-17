import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC, no backend. Proves the new About tab (added
 * by the Settings nav redesign) renders the version and drives a full
 * "Check for Updates" cycle against the mocked `check-for-updates` response
 * (see app/e2e-mock-ipc.js DEFAULTS, which reports no update available) —
 * fully hermetic, no real GitHub call.
 */
test('About tab shows the version and resolves a Check for Updates click', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });

  const aboutSection = page.locator('[data-settings-tab="about"]');
  await expect(aboutSection).toBeVisible();
  await expect(aboutSection.getByText('Version 0.0.0-e2e')).toBeVisible();

  // The check outcome narrates on the button itself (Checking for Updates ->
  // You're on the latest version), rather than a separate status line.
  await aboutSection.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(
    aboutSection.getByRole('button', { name: "You're on the latest version" }),
  ).toBeVisible();
});

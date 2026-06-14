import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC, no backend. Drives the real org sign-in UI and
 * asserts the renderer's org-lock state machine: signing in flips the visible
 * provider to "Organisation" and locks the AI provider picker. The wire shapes
 * here are stubbed (see app/e2e-mock-ipc.js); T2 is the real-backend cross-check.
 */
test('UI sign-in flips provider to org and locks the picker', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  // Deep-link straight to the Organisation tab. RouteView is hash-driven and
  // Settings reads ?tab on mount, so set the hash before Settings mounts.
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=organisation';
  });

  // Signed-out: the sign-in card is shown.
  const signInCard = page.getByTestId('org-sign-in-card');
  await expect(signInCard).toBeVisible();

  // Fill and submit the password sign-in form.
  await page.getByPlaceholder('https://steno-adapter.yourcompany.com').fill('https://e2e.example.com');
  await page.getByPlaceholder('you@yourcompany.com').fill('e2e@example.com');
  await page.getByPlaceholder('••••••').fill('hunter2');
  await page.getByRole('button', { name: /sign in with password/i }).click();

  // Signed-in: the session card replaces the form.
  await expect(page.getByTestId('org-signed-in-card')).toBeVisible();
  await expect(page.getByText(/signed in as/i)).toBeVisible();

  // Switch to the AI tab (click, not hash — Settings only reads ?tab on mount).
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  const aiSection = page.locator('[data-settings-tab="ai"]');
  await expect(aiSection).toBeVisible();

  // The picker now reflects the org lock: the provider Select (the only
  // combobox while not on 'cloud') shows "Organisation", and the managed-by-org
  // copy appears (the Select is disabled while signed in).
  await expect(aiSection.getByRole('combobox')).toContainText('Organisation');
  await expect(aiSection.getByText(/managed by your organisation/i)).toBeVisible();
});

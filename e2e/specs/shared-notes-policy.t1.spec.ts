import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';

/**
 * T1 — renderer-only, mock IPC, no backend. Drives the enterprise "Shared
 * notes" policy gating through the real Electron renderer:
 *  - default (org enables the feature): the sidebar "Shared notes" tab shows
 *    and navigates to the browse view.
 *  - STENOAI_E2E_SHARED_NOTES=0 (org disables it): the tab is hidden and a
 *    deep-link to /org/shared is redirected back to Home.
 *
 * The policy wire shape is stubbed in app/e2e-mock-ipc.js (org-get-policy);
 * T2 is the real-adapter cross-check. Gate logic: useSharedNotesGate in
 * app/renderer/src/hooks/useOrg.ts.
 */

// Mirrors the org-lock.t1 sign-in flow, then returns to Home so the sidebar
// is in view.
async function signIn(page: Page) {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=organisation';
  });
  await expect(page.getByTestId('org-sign-in-card')).toBeVisible();
  await page.getByPlaceholder('https://steno-adapter.yourcompany.com').fill('https://e2e.example.com');
  await page.getByPlaceholder('you@yourcompany.com').fill('e2e@example.com');
  await page.getByPlaceholder('••••••').fill('hunter2');
  await page.getByRole('button', { name: /sign in with password/i }).click();
  await expect(page.getByTestId('org-signed-in-card')).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
}

test('enabled: Shared notes tab shows and opens the browse view', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });
  await signIn(page);

  const tab = page.getByRole('button', { name: 'Shared notes' });
  await expect(tab).toBeVisible();

  await tab.click();
  // The browse view renders its own <h1>Shared notes</h1> (heading role,
  // distinct from the sidebar button) once the route is allowed.
  await expect(page.getByRole('heading', { name: 'Shared notes' })).toBeVisible();
});

test('disabled: Shared notes tab is hidden and /org/shared redirects to Home', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SHARED_NOTES: '0' } });
  await signIn(page);

  // Deep-link straight to the browse route; the gate must redirect to Home
  // once the policy resolves to disabled (navigate('/') -> hash '#/').
  await page.evaluate(() => {
    window.location.hash = '#/org/shared';
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 10_000 })
    .toBe('#/');

  // Did not land on the OrgShared browse view, and the sidebar tab is absent
  // now that policy has positively resolved to disabled.
  await expect(page.getByRole('heading', { name: 'Shared notes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shared notes' })).toHaveCount(0);
});

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

test('About tab explains an update that this macOS is too old to install', async ({
  launchApp,
}) => {
  // Under-floor Mac (#432): the check reports an update, but osUpdateEligible
  // is false, so the tab must say it needs a newer macOS and must NOT offer the
  // "View release" download nudge (which would point at a DMG that won't run).
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_BLOCKED_OS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });

  const aboutSection = page.locator('[data-settings-tab="about"]');
  await expect(aboutSection).toBeVisible();

  await aboutSection.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(
    aboutSection.getByText(/v9\.9\.9 requires a newer version of macOS/),
  ).toBeVisible();
  // No download nudge on an OS that can't run the build.
  await expect(aboutSection.getByRole('button', { name: 'View release' })).toHaveCount(0);
});

test('About tab rehydrates a persisted failed background update on mount', async ({
  launchApp,
}) => {
  // A background update that failed while the user was on another tab is only
  // announced via the one-shot 'update-error' event. main.js persists it in
  // get-update-status so a later About mount can restore it — this asserts that
  // rehydration path (seeded via STENOAI_E2E_SEED_UPDATE_ERROR).
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_ERROR: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });

  const aboutSection = page.locator('[data-settings-tab="about"]');
  await expect(aboutSection).toBeVisible();
  await expect(
    aboutSection.getByText(/Steno couldn't reach the update server/),
  ).toBeVisible();
});

test('a successful check clears a stale update failure', async ({ launchApp }) => {
  // The two states come from different sources — the button from the GitHub
  // poll, the banner from the background updater — so a failed cycle used to
  // leave "Update download failed…" sitting under a fresh "You're on the latest
  // version": two contradictory answers to the same question. A check that just
  // succeeded settles the earlier failure.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_ERROR: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });

  const aboutSection = page.locator('[data-settings-tab="about"]');
  const failure = aboutSection.getByText(/Steno couldn't reach the update server/);
  await expect(failure).toBeVisible();

  await aboutSection.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(
    aboutSection.getByRole('button', { name: "You're on the latest version" }),
  ).toBeVisible();
  await expect(failure).toHaveCount(0);

  // And it stays cleared: main owns the persisted error, so leaving About and
  // coming back must not rehydrate the banner the check just settled. A
  // renderer-local clear would fail here.
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=general';
  });
  await expect(page.locator('[data-settings-tab="about"]')).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });
  await expect(aboutSection).toBeVisible();
  await expect(aboutSection.getByText(/couldn't reach the update server/)).toHaveCount(0);
});

test('a stale status reply cannot restore a failure the check just settled', async ({
  launchApp,
}) => {
  // The banner has two sources that can disagree: the mount-time getStatus()
  // and the re-read after a manual check. Main answers each with the state as
  // of the REQUEST, so if the mount request is slow enough to land after the
  // check settled the failure, its older answer would put the banner back —
  // under a fresh "You're on the latest version", which is exactly the
  // contradiction this whole path removes. STENOAI_E2E_SLOW_UPDATE_STATUS
  // delays only the first status call, so the stale reply is guaranteed to
  // arrive last instead of racing.
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_UPDATE_ERROR: '1', STENOAI_E2E_SLOW_UPDATE_STATUS: '1' },
  });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=about';
  });

  const aboutSection = page.locator('[data-settings-tab="about"]');
  await expect(aboutSection).toBeVisible();

  // Click while the mount request is still in flight — the banner has not even
  // appeared yet, which is the point.
  await aboutSection.getByRole('button', { name: 'Check for Updates' }).click();
  await expect(
    aboutSection.getByRole('button', { name: "You're on the latest version" }),
  ).toBeVisible();

  // Outlast the delayed reply, then assert it changed nothing.
  await page.waitForTimeout(1500);
  await expect(
    aboutSection.getByText(/Steno couldn't reach the update server/),
  ).toHaveCount(0);
});

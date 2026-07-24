import { test, expect } from '../fixtures/electron';

test('Local CLI reveals and persists the Codex/Claude selector', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });

  const provider = page.locator('[data-testid="ai-provider-select"]');
  await expect(provider).toBeVisible();
  await expect(
    page.locator('[data-testid="local-cli-provider-select"]'),
  ).toHaveCount(0);

  await provider.click();
  await page.getByRole('option', { name: /Local CLI \(on-device\)/ }).click();

  const cli = page.locator('[data-testid="local-cli-provider-select"]');
  await expect(cli).toBeVisible();
  await expect(cli).toContainText('Codex CLI');

  await cli.click();
  await page.getByRole('option', { name: 'Claude CLI' }).click();
  await expect(cli).toContainText('Claude CLI');

  // Switching away hides the secondary control without losing the choice.
  await provider.click();
  await page.getByRole('option', { name: /^Local \(on-device\)/ }).click();
  await expect(cli).toHaveCount(0);

  await provider.click();
  await page.getByRole('option', { name: /Local CLI \(on-device\)/ }).click();
  await expect(cli).toContainText('Claude CLI');
});

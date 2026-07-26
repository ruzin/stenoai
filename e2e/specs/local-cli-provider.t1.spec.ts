import { test, expect } from "../fixtures/electron";

test("Locally invoked CLI reveals and persists a generic command", async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });
  await page.evaluate(() => {
    window.location.hash = "#/settings?tab=ai";
  });

  const provider = page.locator('[data-testid="ai-provider-select"]');
  await expect(provider).toBeVisible();
  await expect(page.locator('[data-testid="local-cli-config"]')).toHaveCount(0);

  await provider.click();
  await page.getByRole("option", { name: "Locally invoked CLI" }).click();

  const config = page.locator('[data-testid="local-cli-config"]');
  await expect(config).toBeVisible();
  await expect(config).not.toContainText("Codex");
  await expect(config).not.toContainText("Claude");

  await page
    .locator('[data-testid="local-cli-name"]')
    .fill("My meeting command");
  await page
    .locator('[data-testid="local-cli-command"]')
    .fill("meeting-agent --stdin");
  await config.getByRole("button", { name: "Save" }).click();
  await expect(config).toContainText("Saved");

  // Switching away hides the setup without losing the saved command.
  await provider.click();
  await page.getByRole("option", { name: /^Local \(on-device\)/ }).click();
  await expect(config).toHaveCount(0);

  await provider.click();
  await page.getByRole("option", { name: "Locally invoked CLI" }).click();
  await expect(page.locator('[data-testid="local-cli-name"]')).toHaveValue(
    "My meeting command",
  );
  await expect(page.locator('[data-testid="local-cli-command"]')).toHaveValue(
    "meeting-agent --stdin",
  );
});

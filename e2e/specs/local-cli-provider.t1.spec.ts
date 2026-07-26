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
  const save = config.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();

  await config.getByRole("button", { name: "Test command" }).click();
  await expect(config).toContainText("Command returned a valid Steno summary.");
  await expect(save).toBeEnabled();
  await expect(config).not.toContainText(
    "Command returned a valid Steno summary.",
    {
      timeout: 6_000,
    },
  );

  await save.click();
  await expect(config).toHaveAttribute("data-state", "collapsed");
  await expect(config.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(config.locator('[data-testid="local-cli-name"]')).toHaveCount(0);
  await expect(
    config.locator('[data-testid="local-cli-command-summary"]'),
  ).toHaveText("meeting-agent --stdin");

  // Switching away hides the setup without losing the saved command.
  await provider.click();
  await page.getByRole("option", { name: /^Local \(on-device\)/ }).click();
  await expect(config).toHaveCount(0);

  await provider.click();
  await page.getByRole("option", { name: "Locally invoked CLI" }).click();
  await expect(config).toHaveAttribute("data-state", "collapsed");
  await config.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator('[data-testid="local-cli-name"]')).toHaveValue(
    "My meeting command",
  );
  await expect(page.locator('[data-testid="local-cli-command"]')).toHaveValue(
    "meeting-agent --stdin",
  );

  // Editing invalidates the previous test, so the changed command cannot be
  // saved until that exact draft passes again.
  await page
    .locator('[data-testid="local-cli-command"]')
    .fill("meeting-agent --stdin --verbose");
  await expect(config.getByRole("button", { name: "Save" })).toBeDisabled();
});

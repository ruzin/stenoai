import { test, expect } from "../fixtures/electron";

type LocalCliConfig = {
  name: string;
  command: string;
  timeoutSeconds: number;
};

type LocalCliResult = {
  success?: boolean;
  error?: string;
};

type StenoWindow = Window & {
  stenoai: {
    ai: {
      setLocalCliConfig: (config: LocalCliConfig) => Promise<LocalCliResult>;
      testLocalCli: (config: LocalCliConfig) => Promise<LocalCliResult>;
    };
  };
};

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

test("mock local CLI test and save enforce the production validation limits", async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true });
  const invalidConfigs = [
    {
      config: {
        name: "Agent\u007fspoofed",
        command: "meeting-agent --stdin",
        timeoutSeconds: 300,
      },
      error: "Display name must be between 1 and 80 characters.",
    },
    {
      config: {
        name: "n".repeat(81),
        command: "meeting-agent --stdin",
        timeoutSeconds: 300,
      },
      error: "Display name must be between 1 and 80 characters.",
    },
    {
      config: {
        name: "Agent",
        command: "meeting-agent\n--stdin",
        timeoutSeconds: 300,
      },
      error: "Command must be a single line between 1 and 4096 characters.",
    },
    {
      config: {
        name: "Agent",
        command: "x".repeat(4097),
        timeoutSeconds: 300,
      },
      error: "Command must be a single line between 1 and 4096 characters.",
    },
    {
      config: {
        name: "Agent",
        command: "meeting-agent --stdin",
        timeoutSeconds: 29,
      },
      error: "Timeout must be between 30 and 2100 seconds.",
    },
    {
      config: {
        name: "Agent",
        command: "meeting-agent --stdin",
        timeoutSeconds: 2100.5,
      },
      error: "Timeout must be between 30 and 2100 seconds.",
    },
  ];

  const results = await page.evaluate(async (cases) => {
    const bridge = (window as StenoWindow).stenoai.ai;
    return Promise.all(
      cases.map(async ({ config }) => ({
        test: await bridge.testLocalCli(config),
        save: await bridge.setLocalCliConfig(config),
      })),
    );
  }, invalidConfigs);

  for (const [index, result] of results.entries()) {
    expect(result.test).toMatchObject({
      success: false,
      error: invalidConfigs[index].error,
    });
    expect(result.save).toMatchObject({
      success: false,
      error: invalidConfigs[index].error,
    });
  }
});

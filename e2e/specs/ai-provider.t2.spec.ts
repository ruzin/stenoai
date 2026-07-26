import { test, expect } from "../fixtures/electron";
import { realUserDataDir, fileSig } from "../fixtures/real-user-data";
import { readUserConfig } from "../fixtures/user-config";
import { existsSync, readFileSync } from "fs";
import path from "path";

/**
 * T2 — AI provider configuration matrix. Drives the real backend's `ai` IPC and
 * asserts both the get-ai-provider snapshot and the persisted config.json keys.
 * Model-free + deterministic: every call here is a local config write or local
 * encryption — the network calls (test-cloud-api / test-remote-ollama) and the
 * org-adapter path (covered by the org specs) are intentionally excluded.
 *
 * No org is signed in, so set-ai-provider is not org-locked here.
 */

type ProviderSnapshot = {
  success: boolean;
  ai_provider?: string;
  local_cli_name?: string;
  local_cli_configured?: boolean;
  local_cli_timeout_seconds?: number;
  cloud_provider?: string;
  cloud_api_url?: string;
  cloud_model?: string;
  model?: string;
  cloud_api_key_set?: boolean;
  bedrock_region?: string;
  bedrock_inference_profile?: string;
  remote_ollama_url?: string;
};
type Result = { success?: boolean; error?: string };

type StenoWindow = Window & {
  stenoai: {
    ai: {
      getProvider: () => Promise<ProviderSnapshot>;
      setProvider: (p: string) => Promise<Result>;
      getLocalCliConfig: () => Promise<
        Result & { name?: string; command?: string; timeoutSeconds?: number }
      >;
      setLocalCliConfig: (config: {
        name: string;
        command: string;
        timeoutSeconds: number;
      }) => Promise<Result>;
      testLocalCli: (config: {
        name: string;
        command: string;
        timeoutSeconds: number;
      }) => Promise<Result>;
      setRemoteOllamaUrl: (url: string) => Promise<Result>;
      setCloudApiUrl: (url: string) => Promise<Result>;
      setCloudApiKey: (key: string) => Promise<Result>;
      setCloudProvider: (p: string) => Promise<Result>;
      setCloudModel: (m: string) => Promise<Result>;
      setBedrockRegion: (r: string) => Promise<Result>;
      setBedrockInferenceProfile: (p: string) => Promise<Result>;
    };
  };
};

const getProvider = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as StenoWindow).stenoai.ai.getProvider());

test("provider switch + cloud/bedrock config persist and round-trip through get-ai-provider", async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // Default snapshot is a coherent local config.
  const initial = await getProvider(page);
  expect(initial.success).toBe(true);
  expect(initial.ai_provider).toBe("local");
  // The active local Ollama model is exposed so the Chat indicator can show it
  // (WS2). Fresh config → the registry default.
  expect(initial.model).toBe("gemma4:e2b-it-qat");

  // Every provider switch persists to config.ai_provider; the final provider is
  // verified through the single complete snapshot below.
  for (const provider of ["remote", "cloud", "local_cli", "local"]) {
    const result = await page.evaluate(
      (p) => (window as StenoWindow).stenoai.ai.setProvider(p),
      provider,
    );
    expect(result.success).toBe(true);
    await expect
      .poll(() => readUserConfig(userDataDir).ai_provider)
      .toBe(provider);
  }

  // Cloud config: provider, url, model.
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setCloudProvider("anthropic"),
      )
    ).success,
  ).toBe(true);
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setCloudApiUrl(
          "https://api.example.test/v1",
        ),
      )
    ).success,
  ).toBe(true);
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setCloudModel(
          "claude-haiku-4-5-20251001",
        ),
      )
    ).success,
  ).toBe(true);

  // Bedrock config.
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setBedrockRegion("us-west-2"),
      )
    ).success,
  ).toBe(true);
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setBedrockInferenceProfile(
          "my-profile",
        ),
      )
    ).success,
  ).toBe(true);

  // Remote Ollama URL (no connectivity check — set only).
  expect(
    (
      await page.evaluate(() =>
        (window as StenoWindow).stenoai.ai.setRemoteOllamaUrl(
          "http://ollama.example.test:11434",
        ),
      )
    ).success,
  ).toBe(true);

  // Setters await the backend write, so one final snapshot is sufficient to
  // verify the complete round-trip without repeatedly launching the bundled
  // backend on Windows.
  const snapshot = await getProvider(page);
  expect(snapshot).toMatchObject({
    success: true,
    ai_provider: "local",
    cloud_provider: "anthropic",
    cloud_api_url: "https://api.example.test/v1",
    cloud_model: "claude-haiku-4-5-20251001",
    bedrock_region: "us-west-2",
    bedrock_inference_profile: "my-profile",
    remote_ollama_url: "http://ollama.example.test:11434",
  });

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test("local CLI is Settings-only, test-gated, and stored encrypted", async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { app, page } = await launchApp();

  // The generic command is encrypted outside config.json. Some headless Linux
  // runners have no usable safeStorage backend, so skip this encryption-specific
  // scenario loudly while preserving the real-user-data keystone.
  const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable(),
  );
  if (!encryptionAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "[t2] SKIPPED local-cli-config: safeStorage unavailable on this runner.",
    );
    test.info().annotations.push({
      type: "skip-reason",
      description:
        "safeStorage unavailable; encrypted local command assertion skipped",
    });
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  }
  test.skip(!encryptionAvailable, "safeStorage unavailable on this runner");

  const rejectedOutsideSettings = await page.evaluate(() =>
    (window as StenoWindow).stenoai.ai.setLocalCliConfig({
      name: "Should not persist",
      command: "untrusted-command",
      timeoutSeconds: 60,
    }),
  );
  expect(rejectedOutsideSettings.success).toBe(false);
  expect(
    await page.evaluate(() =>
      (window as StenoWindow).stenoai.ai.getLocalCliConfig(),
    ),
  ).toMatchObject({ success: false });

  await page.evaluate(() => {
    window.location.hash = "#/settings?tab=ai";
  });
  const localCliConfig = {
    name: "My meeting command",
    command:
      "node -e \"process.stdin.resume();process.stdin.on('end',()=>console.log(['## Summary','Ready','## Key Topics','Test','## Key Points','Passed','## Action Items','None'].join(String.fromCharCode(10))))\"",
    timeoutSeconds: 15 * 60,
  };
  const rejectedBeforeTest = await page.evaluate(
    (config) => (window as StenoWindow).stenoai.ai.setLocalCliConfig(config),
    localCliConfig,
  );
  expect(rejectedBeforeTest).toMatchObject({
    success: false,
    error: "Test this command successfully before saving.",
  });
  const tested = await page.evaluate(
    (config) => (window as StenoWindow).stenoai.ai.testLocalCli(config),
    localCliConfig,
  );
  expect(tested.success).toBe(true);
  const saved = await page.evaluate(
    (config) => (window as StenoWindow).stenoai.ai.setLocalCliConfig(config),
    localCliConfig,
  );
  expect(saved.success).toBe(true);

  const diskConfig = readUserConfig(userDataDir);
  expect(diskConfig.local_cli_name).toBeUndefined();
  expect(diskConfig.local_cli_command).toBeUndefined();
  expect(diskConfig.local_cli_timeout_seconds).toBeUndefined();
  expect(
    readFileSync(path.join(userDataDir, ".local-cli-config")).toString("utf8"),
  ).not.toContain("process.stdin.resume");

  const snapshot = await getProvider(page);
  expect(snapshot).toMatchObject({
    success: true,
    local_cli_name: "My meeting command",
    local_cli_configured: true,
    local_cli_timeout_seconds: 15 * 60,
  });
  const guardedConfig = await page.evaluate(() =>
    (window as StenoWindow).stenoai.ai.getLocalCliConfig(),
  );
  expect(guardedConfig).toMatchObject({
    success: true,
    name: localCliConfig.name,
    command: localCliConfig.command,
    timeoutSeconds: localCliConfig.timeoutSeconds,
  });

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test("cloud API key is stored encrypted (safeStorage) in the temp dir, not config.json", async ({
  launchApp,
  userDataDir,
}) => {
  const { app, page } = await launchApp();

  // The key is persisted via safeStorage; on a headless runner with no usable
  // keyring it is unavailable — skip LOUDLY rather than emit a misleading red
  // (mirrors org-lock-lifecycle.t2's keystone guard).
  const encryptionAvailable = await app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable(),
  );
  if (!encryptionAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "[t2] SKIPPED cloud-api-key: safeStorage unavailable on this runner.",
    );
    test.info().annotations.push({
      type: "skip-reason",
      description:
        "safeStorage unavailable; cloud key cannot persist on this runner",
    });
  }
  test.skip(!encryptionAvailable, "safeStorage unavailable on this runner");

  await page.evaluate(() =>
    (window as StenoWindow).stenoai.ai.setCloudApiKey("sk-e2e-secret-123"),
  );

  // Encrypted blob lands in the temp dir...
  await expect
    .poll(() => existsSync(path.join(userDataDir, ".cloud-api-key")), {
      timeout: 10_000,
    })
    .toBe(true);
  // ...the snapshot reports it set...
  await expect
    .poll(async () => (await getProvider(page)).cloud_api_key_set)
    .toBe(true);
  // ...and the plaintext key never appears in config.json.
  expect(JSON.stringify(readUserConfig(userDataDir))).not.toContain(
    "sk-e2e-secret-123",
  );
});

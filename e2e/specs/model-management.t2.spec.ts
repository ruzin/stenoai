import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readUserConfig } from '../fixtures/user-config';
import { startMockOllama } from '../fixtures/mock-ollama';
import { killOllama } from '../fixtures/kill-ollama';

/**
 * T2 — model management (the deterministic, model-free subset). Covers the
 * summary-model and whisper-model config round-trips plus the whisper / parakeet
 * list + status SHAPE. Model PULLS (pull-model / pull-whisper-model /
 * pull-parakeet-model) download hundreds of MB and are NOT covered here — they
 * belong to the model-bearing @pipeline jobs. "installed" reflects the host's
 * real model cache (not the temp dir), so we assert the SHAPE of those flags,
 * never a specific install state.
 */

type ModelInfo = { installed?: boolean };
type ListResult = {
  success: boolean;
  current_model?: string;
  supported_models?: Record<string, ModelInfo>;
  provider?: string;
};
type CurrentModel = { success: boolean; model?: string };
type StatusResult = { success: boolean; model?: string; installed?: boolean };
type Result = { success?: boolean };
type PullResult = { success: boolean; error?: string };
type VerifyResult = { success: boolean; error: string | null };
type DeleteResult = { success: boolean; error: string | null };

type StenoWindow = Window & {
  stenoai: {
    models: {
      getCurrent: () => Promise<CurrentModel>;
      set: (name: string) => Promise<Result>;
      pull: (name: string) => Promise<PullResult>;
      verify: (name: string) => Promise<VerifyResult>;
      delete: (name: string) => Promise<DeleteResult>;
    };
    whisperModels: {
      list: () => Promise<ListResult>;
      set: (name: string) => Promise<Result>;
    };
    parakeetModels: {
      list: () => Promise<ListResult>;
      status: () => Promise<StatusResult>;
    };
  };
};


/** Every entry in a supported-models map must carry a boolean `installed` flag. */
function assertInstalledShape(models: Record<string, ModelInfo> | undefined) {
  expect(models && typeof models === 'object').toBeTruthy();
  const entries = Object.values(models!);
  expect(entries.length).toBeGreaterThan(0);
  for (const m of entries) {
    expect(typeof m.installed).toBe('boolean');
  }
}

test('a fresh install defaults the summary model to gemma4:e2b-it-qat', async ({
  launchApp,
}) => {
  // No config is seeded, so get-current-model returns Config.DEFAULT_MODEL.
  // This pins the WS1 default swap (was llama3.2:3b).
  const { page } = await launchApp();
  const current = await page.evaluate(() =>
    (window as StenoWindow).stenoai.models.getCurrent(),
  );
  expect(current.success).toBe(true);
  expect(current.model).toBe('gemma4:e2b-it-qat');
});

test('summary model set persists to config.model and round-trips through get-current-model', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // There's always a current model (config default).
  const before = await page.evaluate(() =>
    (window as StenoWindow).stenoai.models.getCurrent(),
  );
  expect(before.success).toBe(true);
  expect(before.model).toBeTruthy();

  await page.evaluate(() => (window as StenoWindow).stenoai.models.set('llama3.2:1b'));
  await expect.poll(() => readUserConfig(userDataDir).model).toBe('llama3.2:1b');
  await expect
    .poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.models.getCurrent())).model)
    .toBe('llama3.2:1b');

  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('whisper models: list reports installed flags; set persists to config.whisper_model', async ({
  launchApp,
  userDataDir,
}) => {
  const { page } = await launchApp();

  const listed = await page.evaluate(() =>
    (window as StenoWindow).stenoai.whisperModels.list(),
  );
  expect(listed.success).toBe(true);
  expect(listed.provider).toBe('local');
  assertInstalledShape(listed.supported_models);

  // Pick the supported key (SUPPORTED_WHISPER_MODELS = large-v3-turbo;
  // set-whisper-model validates against it) and set it; it persists + the
  // list's current model follows.
  await page.evaluate(() => (window as StenoWindow).stenoai.whisperModels.set('large-v3-turbo'));
  await expect.poll(() => readUserConfig(userDataDir).whisper_model).toBe('large-v3-turbo');
  await expect
    .poll(async () => (await page.evaluate(() => (window as StenoWindow).stenoai.whisperModels.list())).current_model)
    .toBe('large-v3-turbo');
});

test('parakeet models: list + status return a coherent installed shape', async ({
  launchApp,
}) => {
  const { page } = await launchApp();

  const listed = await page.evaluate(() =>
    (window as StenoWindow).stenoai.parakeetModels.list(),
  );
  expect(listed.success).toBe(true);
  expect(listed.current_model).toBeTruthy();
  assertInstalledShape(listed.supported_models);

  const status = await page.evaluate(() =>
    (window as StenoWindow).stenoai.parakeetModels.status(),
  );
  expect(status.success).toBe(true);
  expect(status.model).toBeTruthy();
  expect(typeof status.installed).toBe('boolean');
  // status + list agree on the default model id.
  expect(status.model).toBe(listed.current_model);
});

test('switch-to-faster-build: pull, verify, and delete the old tag all round-trip through IPC', async ({
  launchApp,
}) => {
  killOllama();
  const mockOllama = await startMockOllama();
  try {
    const { page } = await launchApp();

    const pullResult = await page.evaluate(() =>
      (window as StenoWindow).stenoai.models.pull('gemma4:e2b-nvfp4'),
    );
    expect(pullResult.success).toBe(true);
    expect(mockOllama.lastPulledModel()).toBe('gemma4:e2b-nvfp4');

    const verifyResult = await page.evaluate(() =>
      (window as StenoWindow).stenoai.models.verify('gemma4:e2b-nvfp4'),
    );
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.error).toBeNull();

    const deleteResult = await page.evaluate(() =>
      (window as StenoWindow).stenoai.models.delete('gemma4:e2b-it-qat'),
    );
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.error).toBeNull();
    expect(mockOllama.deleteCalls()).toBe(1);
    expect(mockOllama.lastDeletedModel()).toBe('gemma4:e2b-it-qat');
  } finally {
    await mockOllama.close();
  }
});

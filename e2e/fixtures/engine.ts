import type { Page } from '@playwright/test';

/**
 * Transcription-engine selection for T2 specs that run the real pipeline.
 *
 * parakeet locally (the Mac-divergent path), whisper.cpp in CI — GitHub-hosted
 * macOS runners have no Metal GPU, so parakeet-mlx can't load there. Set via
 * STENOAI_E2E_ENGINE so the specs are unchanged either way.
 *
 * The model must already be installed: the transcriber AUTO-DOWNLOADS a missing
 * model (~0.5 GB) on first use, so a spec that runs without the model present
 * would silently pull weights mid-test. isEngineModelReady() lets specs skip
 * instead; CI installs the model before the model-bearing job.
 */
export const E2E_ENGINE: 'parakeet' | 'whisper' =
  process.env.STENOAI_E2E_ENGINE === 'whisper' ? 'whisper' : 'parakeet';
export const WHISPER_MODEL = 'small'; // smallest registered model (466 MB)

type EngineWindow = Window & {
  stenoai: {
    parakeetModels: { status: () => Promise<{ installed?: boolean }> };
    whisperModels: {
      list: () => Promise<{ supported_models?: Record<string, { installed?: boolean }> }>;
      set: (name: string) => Promise<unknown>;
    };
    transcriptionEngine: { set: (engine: string) => Promise<unknown> };
  };
};

/** Select the engine in the per-test config (the backend reads it at process
 *  time). For whisper, pin the small model so the larger default isn't needed. */
export async function selectEngine(page: Page): Promise<void> {
  await page.evaluate((e) => (window as EngineWindow).stenoai.transcriptionEngine.set(e), E2E_ENGINE);
  if (E2E_ENGINE === 'whisper') {
    await page.evaluate((m) => (window as EngineWindow).stenoai.whisperModels.set(m), WHISPER_MODEL);
  }
}

/** Whether the active engine's model is installed (no auto-download). */
export async function isEngineModelReady(page: Page): Promise<boolean> {
  if (E2E_ENGINE === 'whisper') {
    return page.evaluate(
      async (m) =>
        !!(await (window as EngineWindow).stenoai.whisperModels.list())?.supported_models?.[m]
          ?.installed,
      WHISPER_MODEL,
    );
  }
  return page.evaluate(
    async () => (await (window as EngineWindow).stenoai.parakeetModels.status())?.installed === true,
  );
}

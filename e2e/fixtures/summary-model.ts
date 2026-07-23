import type { Page } from '@playwright/test';

/**
 * Summary-model selection for the real-summarization @summarize-real spec (#382).
 *
 * A tiny (~1B) instruction model so it summarises a short fixed transcript on a
 * CPU-only CI runner in seconds. llama3.2:1b is the repo's canonical
 * "arbitrary user-pulled" summary model: Config.set_model allows any tag (it
 * only warns for non-registry ids), and resolve_runtime_tag / resolve_num_ctx
 * pass an unknown tag through unchanged — so config.model can point straight at
 * it with no backend escape-hatch. Overridable via STENOAI_E2E_SUMMARY_MODEL to
 * swap in a different small tag.
 *
 * The model must already be pulled into Ollama's store: the summarizer
 * AUTO-PULLS a missing model (src/summarizer.py _ensure_model_available) and, on
 * a failed pull, FALLS BACK to the heavy bundled gemma models — so a spec that
 * ran without it present would download weights mid-test. The nightly job
 * pre-pulls + verifies it; isSummaryModelReady() lets the spec skip loudly
 * everywhere else instead of triggering that download.
 */
export const E2E_SUMMARY_MODEL = process.env.STENOAI_E2E_SUMMARY_MODEL || 'llama3.2:1b';

type SummaryModelWindow = Window & {
  stenoai: {
    models: { verify: (name: string) => Promise<{ success: boolean; error: string | null }> };
  };
};

/**
 * Whether the summary model is pulled AND actually loads + responds on this host
 * (models.verify runs a 1-token chat via the real Ollama HTTP API — it never
 * auto-pulls, so a false result means "not ready", not "downloading now").
 */
export async function isSummaryModelReady(page: Page): Promise<boolean> {
  return page.evaluate(
    async (m) =>
      (await (window as SummaryModelWindow).stenoai.models.verify(m)).success === true,
    E2E_SUMMARY_MODEL,
  );
}

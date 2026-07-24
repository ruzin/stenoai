import { test, expect } from '../fixtures/electron';

/**
 * T1 — renderer-only, mock IPC, no backend. Proves the "May exceed memory"
 * badge (#248): the mocked `list-models` reports a 16 GB Mac (total_ram_gb: 16)
 * with the full local Ollama catalog, so the two large models
 * (gemma4:12b 7.2 GB, gpt-oss:20b 14 GB) get the caution badge while the small
 * default (gemma4:e2b 4.3 GB) does not. The badge is non-blocking — the pure
 * heuristic itself is unit-tested in model-memory.test.ts; this pins the
 * provider gate + prop wiring through the real card UI.
 */
test('flags local models that may exceed this Mac\'s memory', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true });

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=ai';
  });

  const aiSection = page.locator('[data-settings-tab="ai"]');
  await expect(aiSection).toBeVisible();

  // Each model row is a card whose root carries the rounded-[8px] class; filter
  // by the model id to scope to a single card.
  const card = (id: string) => aiSection.locator('div.rounded-\\[8px\\]', { hasText: id });

  // Wait for the list to render before asserting badge presence/absence.
  await expect(card('gemma4:e2b-it-qat')).toBeVisible();

  // Large models warn.
  await expect(card('gemma4:12b-it-qat').getByText('May exceed memory')).toBeVisible();
  await expect(card('gpt-oss:20b').getByText('May exceed memory')).toBeVisible();

  // The small default does not.
  await expect(card('gemma4:e2b-it-qat').getByText('May exceed memory')).toHaveCount(0);
});

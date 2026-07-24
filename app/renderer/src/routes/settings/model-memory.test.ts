import { describe, test, expect } from 'vitest';
import { modelMayExceedMemory } from './model-memory';

// Pins the memory-suitability heuristic behind the "May exceed memory" badge
// (#248): on a 16 GB Mac the two large local models (gemma4:12b 7.2 GB,
// gpt-oss:20b 14 GB) warn, while the small ones (e2b/e4b/qwen <= 6.6 GB) do
// not; on a 64 GB Mac nothing warns; and any unknown input never warns (the
// badge must stay non-blocking).
describe('modelMayExceedMemory', () => {
  test('16 GB Mac: warns on models too large, not on small ones', () => {
    const ram = 16;
    // Small models — fit comfortably.
    expect(modelMayExceedMemory(4.3, ram)).toBe(false); // gemma4:e2b
    expect(modelMayExceedMemory(6.1, ram)).toBe(false); // gemma4:e4b
    expect(modelMayExceedMemory(6.6, ram)).toBe(false); // qwen3.5:9b
    // Large models — over the usable budget.
    expect(modelMayExceedMemory(7.2, ram)).toBe(true); // gemma4:12b
    expect(modelMayExceedMemory(14, ram)).toBe(true); // gpt-oss:20b
  });

  test('64 GB Mac: nothing warns', () => {
    const ram = 64;
    for (const size of [4.3, 6.1, 6.6, 7.2, 14]) {
      expect(modelMayExceedMemory(size, ram)).toBe(false);
    }
  });

  test('unknown or zero inputs never warn (non-blocking)', () => {
    expect(modelMayExceedMemory(undefined, 16)).toBe(false);
    expect(modelMayExceedMemory(7.2, undefined)).toBe(false);
    expect(modelMayExceedMemory(undefined, undefined)).toBe(false);
    // Zero is treated as "unknown" (falsy) — never warn.
    expect(modelMayExceedMemory(0, 16)).toBe(false);
    expect(modelMayExceedMemory(7.2, 0)).toBe(false);
  });

  test('exact boundary does not warn (strict >)', () => {
    // 6.6 + 3 === 16 * 0.6 === 9.6 -> not strictly greater, so no warn.
    expect(modelMayExceedMemory(6.6, 16)).toBe(false);
  });
});

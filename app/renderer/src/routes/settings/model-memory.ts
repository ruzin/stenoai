// Heuristic: a local model "may exceed memory" when its on-disk (GGUF)
// size plus runtime headroom exceeds the fraction of unified memory the OS
// will realistically let the model use. Calibrated so a 16 GB Mac warns on
// gemma4:12b (7.2 GB) + gpt-oss:20b (14 GB) but not e2b/e4b/qwen (<=6.6 GB).
// Apple Silicon unified memory is dynamically GPU-capped (~67-75%); this is
// a deliberately conservative heuristic, not an exact measurement.
export const RAM_USABLE_FRACTION = 0.6;
export const RUNTIME_HEADROOM_GB = 3;

export function modelMayExceedMemory(
  sizeGb: number | undefined,
  totalRamGb: number | undefined,
): boolean {
  if (!sizeGb || !totalRamGb) return false; // unknown -> never warn (non-blocking)
  return sizeGb + RUNTIME_HEADROOM_GB > totalRamGb * RAM_USABLE_FRACTION;
}

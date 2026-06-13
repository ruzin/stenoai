import { execSync } from 'child_process';

/**
 * Kill any stray Ollama so a test's mock can own the hardcoded port 11434 (the
 * app probes /api/tags and skips its own `ollama serve` on a 200). Cross-platform:
 * Windows has no pkill, so kill by image name (the spec has no PID; app/main.js
 * killProcessTree kills a known PID + tree instead). No-ops when nothing matches
 * (the kill command exits non-zero → swallowed by the catch).
 */
export function killOllama(): void {
  const cmd =
    process.platform === 'win32' ? 'taskkill /F /IM ollama.exe' : 'pkill -f ollama';
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    /* nothing matched — fine */
  }
}

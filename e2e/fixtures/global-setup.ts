import { createConnection } from 'net';
import { killOllama } from './kill-ollama';

/**
 * Run-wide hardening: before any spec, kill a stray Ollama and wait for the
 * hardcoded port 11434 to be free, so the first T2/T3 mock-Ollama bind can't
 * lose a race with a server left over from a previous run (CI runners are
 * reused). CI-only: locally a dev may be running their own Ollama on purpose,
 * and the per-test killOllama already handles isolation there.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.CI) return;
  killOllama();
  // Poll until a connect to 11434 is refused (nothing listening), up to ~5 s.
  for (let i = 0; i < 25; i++) {
    const free = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ port: 11434, host: '127.0.0.1' });
      // Guard against a DROP'd (non-RST) port so a probe can't hang the run.
      sock.setTimeout(200, () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('connect', () => {
        sock.destroy();
        resolve(false); // something is still listening
      });
      sock.once('error', () => resolve(true)); // connection refused → port free
    });
    if (free) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Surface the failure mode: a server we couldn't kill would let the run
  // proceed into the same port race this setup exists to prevent.
  // eslint-disable-next-line no-console
  console.warn('[e2e:global-setup] port 11434 still busy after ~5s; mock-Ollama bind may race');
}

// Module-level ring buffer for backend debug log lines.
//
// The DeveloperTab in Settings was previously the only listener for the
// `debug-log` IPC channel — it subscribed on mount and tore down on unmount,
// so every log emitted before the user opened that tab was lost. This store
// keeps a rolling buffer that's populated from app start (App.tsx primes it
// once) and consumed by any component that wants to render logs.
//
// Cap is intentionally generous (1000 lines) since each line is short and
// users sometimes need to scroll back through a recording session.

const MAX_LINES = 1000;

type Listener = () => void;

let buffer: string[] = [];
const listeners = new Set<Listener>();
let primed = false;

function notify() {
  listeners.forEach((l) => l());
}

export function appendDebugLog(line: string) {
  buffer = buffer.length >= MAX_LINES ? [...buffer.slice(-(MAX_LINES - 1)), line] : [...buffer, line];
  notify();
}

export function clearDebugLogs() {
  if (buffer.length === 0) return;
  buffer = [];
  notify();
}

export function getDebugLogs(): string[] {
  return buffer;
}

export function subscribeDebugLogs(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Wire the IPC channel into the store. Idempotent — safe to call from any
 * mount point; subsequent calls are no-ops. The returned cleanup unsubscribes
 * the IPC listener AND resets the primed flag, so a later mount can rebind.
 */
export function primeDebugLogs(
  bind: (cb: (line: string) => void) => () => void,
): () => void {
  if (primed) return () => {};
  primed = true;
  const unsubscribe = bind((line) => appendDebugLog(line));
  return () => {
    unsubscribe();
    primed = false;
  };
}

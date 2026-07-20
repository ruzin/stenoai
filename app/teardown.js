'use strict';

/**
 * Teardown registry — the single drain point the app's quit handlers call so
 * modules that own a child process or timer (Ollama, the mic monitor, the
 * recording runtime, the pre-meeting scheduler, …) can register an idempotent
 * `dispose()` instead of each installing its own `before-quit`/`will-quit`
 * handler. Introduced by RFC #327 Phase 0; consumers arrive as those domains
 * move out of main.js (Ollama lifecycle is the first, Phase 2).
 *
 * Disposal contract (RFC ground rule 4), pinned here:
 *   - SYNCHRONOUS. Electron's quit hooks do not await promises, so a dispose()
 *     may only do synchronous work or fire-and-forget kill signals. drain()
 *     never returns a promise and never awaits.
 *   - Drained in REVERSE registration order (last registered tears down first),
 *     mirroring how nested resources unwind.
 *   - REENTRANT-SAFE + IDEMPOTENT per disposer. A disposer runs at most once per
 *     drain, and a drain re-entered from within a dispose is a no-op (the guard).
 *     Each registered disposer is removed as it runs, so a redundant drain with
 *     nothing newly registered does nothing. The registry DOES re-arm, though: a
 *     disposer registered AFTER a drain will run on the next drain (used when a
 *     resource is (re)created post-teardown). Individual dispose()s should also
 *     be idempotent so a resource torn down twice is harmless.
 *   - ISOLATED. A throwing dispose() is swallowed so it can't abort the drain
 *     and strand later resources (a leaked process is worse than a lost error).
 */

function createTeardownRegistry() {
  /** @type {Array<() => void>} */
  const disposers = [];
  let draining = false;

  return {
    /** Register an idempotent, synchronous dispose(). Non-functions are ignored. */
    register(dispose) {
      if (typeof dispose === 'function') disposers.push(dispose);
    },

    /** Run every registered dispose() once, in reverse order. Safe to call
     *  multiple times and reentrantly; later calls are no-ops. */
    drain() {
      if (draining) return;
      draining = true;
      // Reverse order; splice each out as we go so a reentrant drain (a dispose
      // that ends up calling drain again) can't double-run a disposer even if
      // the guard were bypassed.
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        try {
          dispose();
        } catch (_) {
          // Swallow: a failing teardown must not strand the resources after it.
        }
      }
      draining = false;
    },
  };
}

module.exports = { createTeardownRegistry };

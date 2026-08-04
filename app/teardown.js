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
 *     The live list is snapshotted and cleared at the start of a drain, so a
 *     disposer registered DURING or AFTER a drain is deferred to the NEXT drain,
 *     never pulled into the running pass — that is what keeps a self-registering
 *     disposer from spinning the quit path forever. A redundant drain with
 *     nothing newly registered does nothing. Individual dispose()s should also
 *     be idempotent so a resource torn down twice is harmless.
 *     NOTE for when consumers arrive (Phase 2): at QUIT there is no "next drain",
 *     so a dispose() that re-arms a resource mid-teardown would leak it. If a
 *     consumer ever needs that, switch to a BOUNDED re-drain loop (N passes until
 *     the list is empty) — bounded so a pathological self-re-register still can't
 *     hang quit. Left simple here because there are no consumers yet.
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
     *  multiple times and reentrantly; later calls with nothing newly registered
     *  are no-ops. */
    drain() {
      if (draining) return;
      draining = true;
      try {
        // Snapshot + clear the live list up front. A dispose() that registers a
        // NEW disposer during teardown (e.g. re-creating a resource) lands in the
        // now-empty live list and is left for the NEXT drain — it is NOT pulled
        // into this pass. Draining the live array directly would otherwise spin
        // forever if a disposer re-registered itself. Reverse registration order.
        const pending = disposers.splice(0).reverse();
        for (const dispose of pending) {
          try {
            dispose();
          } catch (_) {
            // Swallow: a failing teardown must not strand the resources after it.
          }
        }
      } finally {
        draining = false;
      }
    },
  };
}

module.exports = { createTeardownRegistry };

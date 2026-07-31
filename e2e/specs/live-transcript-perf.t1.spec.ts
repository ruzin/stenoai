import { test, expect } from '../fixtures/electron';
import { emitLiveSegments, type LiveSegmentInput } from '../fixtures/live-transcript';
import type { CDPSession, ElectronApplication, Page } from '@playwright/test';

/**
 * T1 `@perf` - measurement harness for the live transcript panel's steady-state
 * cost. NOT a pass/fail regression gate: it asserts only that the harness
 * actually drove the UI, then prints a table. Wall-clock numbers on a shared
 * runner are not a threshold anyone should block a PR on, so CI excludes
 * `@perf`; run it by hand before and after a rendering change.
 *
 *   cd app && npm run test:e2e -- --project=t1 --grep @perf
 *
 * What it measures. The live path emits a partial roughly every 400 ms per
 * channel (simple_recorder.py `_LiveVadPipeline.PARTIAL_INTERVAL_S`), i.e. up to
 * ~5/s with both mic and system speaking, against a segment list that grows for
 * the whole meeting. So the number that decides whether a two-hour meeting stays
 * responsive is not the cost of one update - it is how that cost scales with the
 * list already on screen. The harness seeds N finalised segments, then times a
 * fixed burst of partial ticks at that size.
 *
 * It drives `live-transcript-chunk` straight from the main process (the same
 * channel main.js's `handleLiveTranscribeLine` uses), so no production code
 * carries a test-only seam and the renderer path under measurement is the real
 * one: preload subscribe → useLiveTranscript → LiveTranscriptBar.
 */

const PERF_ENV = { STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1' };
const SESSION = 'Perf note';

/** List sizes to measure the per-tick cost at. ~1400 finalised segments is the
 *  rough shape of a two-hour two-channel meeting (a real 78-minute single-
 *  speaker recording transcribes to 230 segments). */
const LIST_SIZES = [0, 250, 750, 1500];
/** Partial ticks per measured burst. */
const TICKS = 60;
/**
 * Milliseconds between ticks. Must be comfortably more than two animation
 * frames, and that is not a detail: work the panel defers to
 * `requestAnimationFrame` (the auto-scroll) is cancelled by the next update's
 * effect cleanup, so pacing at one tick per frame would let the deferred work
 * be skipped almost every time and report a saving that does not exist at the
 * sidecar's real ~400 ms cadence. Anything past two frames makes the deferred
 * callbacks run, which is what production does.
 */
const TICK_GAP_MS = 80;

type Segment = LiveSegmentInput;

const emit = (app: ElectronApplication, segments: Segment[]) =>
  emitLiveSegments(app, SESSION, segments);

function finals(from: number, count: number): Segment[] {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return {
      text: `finalised utterance number ${n} with a realistic amount of words in it`,
      start: n * 6,
      end: n * 6 + 5,
      isFinal: true,
      speaker: n % 2 === 0 ? 'You' : 'Others',
    };
  });
}

/** One in-progress partial per tick - the same speaker's utterance growing,
 *  which is what the sidecar actually emits between finals. */
function partials(afterFinals: number, count: number): Segment[] {
  const base = afterFinals * 6 + 6;
  return Array.from({ length: count }, (_, i) => ({
    text: `partial tick ${i} still being spoken`,
    start: base,
    end: base + i * 0.4,
    isFinal: false,
    speaker: 'You' as const,
  }));
}

/** Rendered rows + total DOM nodes. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="live-transcript-panel"]');
    return {
      rows: panel ? panel.querySelectorAll('li').length : 0,
      domNodes: document.getElementsByTagName('*').length,
    };
  });
}

/** Retained heap after a forced collection - `performance.memory` is bucketed
 *  and lazily updated, so it reports a flat number here and is useless. */
async function heapMb(cdp: CDPSession) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return +(usedSize / 1024 / 1024).toFixed(1);
}

/**
 * Time a burst of `TICKS` partial updates, paced `TICK_GAP_MS` apart.
 *
 * The pacing is the whole point, in both directions. Fired back-to-back, React
 * 18 coalesces the burst into a single render and the measurement collapses to
 * ~0.5 ms regardless of list size. Fired one per animation frame, work the
 * panel defers to rAF gets cancelled by the following tick and disappears from
 * the numbers. Neither is what production does: each partial arrives on its own
 * IPC message ~400 ms after the last, so every tick renders AND every deferred
 * callback runs. The gap here is the smallest one that reproduces both.
 *
 * Wall-clock would then be dominated by the deliberate idle, so the reported
 * cost comes from CDP's Performance domain instead: ScriptDuration,
 * RecalcStyleDuration and LayoutDuration accumulate only real work.
 */
async function timeBurst(
  cdp: CDPSession,
  app: ElectronApplication,
  page: Page,
  afterFinals: number,
  open: boolean,
) {
  const batch = partials(afterFinals, TICKS);
  // Count DOM writes so a silently batched burst can't masquerade as N renders.
  // Minimised, near-zero writes is the expected (and interesting) result, so
  // observe the whole document rather than the absent panel.
  await page.evaluate((panelOpen) => {
    const w = window as unknown as { __perfMutations?: number; __perfObserver?: MutationObserver };
    w.__perfObserver?.disconnect();
    w.__perfMutations = 0;
    const target = panelOpen
      ? document.querySelector('[data-testid="live-transcript-panel"]')
      : document.body;
    if (!target) throw new Error('observe target missing');
    const observer = new MutationObserver((records) => {
      w.__perfMutations = (w.__perfMutations ?? 0) + records.length;
    });
    observer.observe(target, { subtree: true, childList: true, characterData: true });
    w.__perfObserver = observer;
  }, open);

  const before = await metrics(cdp);
  const started = Date.now();
  for (const segment of batch) {
    await emit(app, [segment]);
    // Deliberate wall-clock gap, not a poll: the point is to let the frame the
    // update renders in AND the frames its deferred work runs in complete
    // before the next tick, the way a 400 ms sidecar cadence would.
    await page.waitForTimeout(TICK_GAP_MS);
  }
  // Let the last frame's style/layout/paint land before reading the counters.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const wall = Date.now() - started;
  const after = await metrics(cdp);
  const mutations = await page.evaluate(() => {
    const w = window as unknown as { __perfMutations?: number; __perfObserver?: MutationObserver };
    w.__perfObserver?.disconnect();
    return w.__perfMutations ?? 0;
  });

  return {
    wall,
    mutations,
    script: after.ScriptDuration - before.ScriptDuration,
    style: after.RecalcStyleDuration - before.RecalcStyleDuration,
    layout: after.LayoutDuration - before.LayoutDuration,
  };
}

/** Chromium's cumulative timing counters, in seconds. */
async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

/**
 * The same wall-clock window with no segments emitted.
 *
 * Once the ticks are spaced in real time, the counters also collect whatever
 * else the app does in that window - the queue poll, the elapsed timer, the
 * recording wave animation. That baseline is unrelated to the transcript and
 * would otherwise be attributed to it, so every burst is reported net of it.
 */
async function idleBaseline(cdp: CDPSession, page: Page) {
  const before = await metrics(cdp);
  await page.waitForTimeout(TICKS * TICK_GAP_MS);
  const after = await metrics(cdp);
  return {
    script: after.ScriptDuration - before.ScriptDuration,
    style: after.RecalcStyleDuration - before.RecalcStyleDuration,
    layout: after.LayoutDuration - before.LayoutDuration,
  };
}

/**
 * One sweep over LIST_SIZES in a given panel state.
 *
 * Both states matter and they are different code paths. Open, LiveTranscriptBar
 * owns the hook and renders every segment. Minimised (the usual state during a
 * meeting - the pill is what users leave on screen) LiveTranscriptBar is
 * unmounted and LiveDock holds its own `useLiveTranscript`, which keeps
 * accumulating and re-inserting into the same growing array while rendering no
 * list at all.
 *
 * Each sweep starts from an empty list: toggling the panel unmounts the hook, so
 * the segment array is rebuilt from the (mock) backfill, not carried over.
 */
async function sweep(
  cdp: CDPSession,
  app: ElectronApplication,
  page: Page,
  open: boolean,
): Promise<string[]> {
  const pill = page.getByTestId('transcription-pill');
  if (open) {
    await pill.getByRole('button', { name: 'Show transcript' }).click();
    await expect(page.getByTestId('live-transcript-panel')).toBeVisible();
  } else {
    await expect(page.getByTestId('live-transcript-panel')).toHaveCount(0);
  }

  const out: string[] = [];
  let seeded = 0;

  for (const size of LIST_SIZES) {
    for (let sent = seeded; sent < size; sent += 250) {
      await emit(app, finals(sent, Math.min(250, size - sent)));
    }
    if (size > seeded && open) {
      await page.waitForFunction(
        (expected) =>
          (document.querySelector('[data-testid="live-transcript-panel"]')?.querySelectorAll('li')
            .length ?? 0) >= expected,
        size,
        { timeout: 60_000 },
      );
    }
    seeded = size;

    const idle = await idleBaseline(cdp, page);
    const burst = await timeBurst(cdp, app, page, seeded, open);
    const after = await snapshot(page);
    const heap = await heapMb(cdp);
    // Net of the idle baseline, floored at zero - a negative would be noise,
    // not a negative cost, and printing it as one would be misleading.
    const perTick = (measured: number, base: number) =>
      (Math.max(0, measured - base) * 1000 / TICKS).toFixed(2).padStart(5);
    out.push(
      `  ${(open ? 'open' : 'minimised').padEnd(9)} finals=${String(seeded).padStart(4)}  ` +
        `rows=${String(after.rows).padStart(4)}  ` +
        `script=${perTick(burst.script, idle.script)}  ` +
        `style=${perTick(burst.style, idle.style)}  ` +
        `layout=${perTick(burst.layout, idle.layout)} ms/tick  |  ` +
        `domWrites=${String(burst.mutations).padStart(4)}  ` +
        `domNodes=${String(after.domNodes).padStart(5)}  heap=${heap} MB`,
    );
  }

  if (open) {
    // The harness has to have actually driven the UI - a measurement of nothing
    // is worse than no measurement.
    const final = await snapshot(page);
    expect(final.rows).toBeGreaterThanOrEqual(LIST_SIZES[LIST_SIZES.length - 1]);
    await page
      .getByTestId('live-transcript-panel')
      .getByRole('button', { name: 'Minimize transcript' })
      .click();
    await expect(page.getByTestId('live-transcript-panel')).toHaveCount(0);
  }
  return out;
}

test('@perf live transcript: per-tick cost against a growing segment list', async ({
  launchApp,
}) => {
  test.setTimeout(600_000);
  const { app, page } = await launchApp({ mockIpc: true, env: PERF_ENV });
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.evaluate((name) => window.stenoai.recording.start(name), SESSION);
  await expect(page.getByTestId('transcription-pill')).toBeVisible();

  const minimised = await sweep(cdp, app, page, false);
  const opened = await sweep(cdp, app, page, true);

  console.log(
    `\nLive transcript cost per partial tick (${TICKS} paced ticks per row)\n` +
      `${[...minimised, ...opened].join('\n')}\n`,
  );
});

/**
 * The hypothesis raised on Discord: the live transcript view accumulates memory
 * over a long meeting until the app dies. Partials are the churn to look at -
 * they replace rather than append, so at a constant segment count the retained
 * heap must stay flat. 2000 ticks is ~13 minutes of two-channel speech at the
 * sidecar's 400 ms partial cadence.
 */
test('@perf live transcript: sustained partial churn does not retain memory', async ({
  launchApp,
}) => {
  test.setTimeout(600_000);
  const CHURN_TICKS = 2000;
  const { app, page } = await launchApp({ mockIpc: true, env: PERF_ENV });
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.evaluate((name) => window.stenoai.recording.start(name), SESSION);
  await page.getByTestId('transcription-pill').getByRole('button', { name: 'Show transcript' }).click();
  await expect(page.getByTestId('live-transcript-panel')).toBeVisible();

  // A fixed backlog, so anything the churn adds is growth and not the list.
  await emit(app, finals(0, 250));
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="live-transcript-panel"]')?.querySelectorAll('li')
        .length ?? 0) >= 250,
    undefined,
    { timeout: 60_000 },
  );

  const before = await heapMb(cdp);
  const domBefore = (await snapshot(page)).domNodes;
  for (let i = 0; i < CHURN_TICKS; i++) {
    await emit(app, partials(250, 1).map((s) => ({ ...s, text: `partial tick ${i} in progress` })));
    if (i % 4 === 0) {
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await heapMb(cdp);
  const domAfter = (await snapshot(page)).domNodes;

  console.log(
    `\nSustained churn: ${CHURN_TICKS} partial ticks at 250 finals - ` +
      `heap ${before} → ${after} MB, DOM nodes ${domBefore} → ${domAfter}\n`,
  );

  // Retained heap after a forced GC must not track the number of ticks. The
  // budget is loose on purpose: this catches a leak, not a megabyte of noise.
  expect(after - before).toBeLessThan(5);
  expect(domAfter).toBeLessThanOrEqual(domBefore + 20);
});

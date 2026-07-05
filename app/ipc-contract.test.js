'use strict';

/**
 * IPC contract conformance — catches channel-name drift across the four files
 * that hand-maintain the renderer<->main wire, so a rename/removal in one place
 * fails CI instead of silently breaking at runtime.
 *
 * The channel name is a bare string threaded through four files with nothing
 * else tying them together:
 *   - app/main.js           — the registrations: ipcMain.handle/on/once('<ch>')
 *   - app/preload.js        — the contextBridge surface: invoke/send('<ch>') for
 *                             renderer->main calls, subscribe('<ch>') for the
 *                             main->renderer (M->R) event stream
 *   - app/renderer/src/lib/ipc.ts — the typed bridge the renderer actually calls
 *   - app/e2e-mock-ipc.js   — the T1 mock that shims ipcMain.handle
 *
 * These are JS/TS source files; we scan them as text (regex), matching the
 * codebase's pragmatism. That is deliberately good enough: the goal is drift
 * detection, not a full parse.
 *
 * The real relationships (NOT a naive "all four must be identical"):
 *
 *   1. preload invoke/send channels  ==  main.js registrations (+ a small
 *      allowlist of channels registered by a third-party package, not by our
 *      source). A renderer channel with no handler rejects invoke() at runtime
 *      ("no handler registered"); an orphan handler is dead code. Both directions
 *      are checked.
 *   2. e2e-mock stub keys  is-subset-of  renderer-callable channels. The mock
 *      only needs entries for channels whose *shape* matters on first paint; it
 *      resolves everything else permissively (see e2e-mock-ipc.js). So the drift
 *      risk is the reverse of "every channel must be stubbed": a *stale* stub
 *      that names a channel which no longer exists would silently do nothing.
 *   3. preload subscribe (M->R) channels  are each emitted somewhere in main.js
 *      (webContents.send). These are NOT ipcMain registrations.
 *   4. ipc.ts is a *typed structural mirror* of the preload bridge object — it
 *      carries no channel-name string literals, so its channels can't be
 *      string-scanned. We instead assert the top-level bridge namespaces in
 *      ipc.ts match preload's, catching a whole namespace added/removed out of
 *      sync (the per-method shape is covered by tsc + the T1 e2e suite).
 *
 * Cross-platform: pure text scanning, no platform assumptions — runs the same on
 * macOS and Windows.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const MAIN = read('main.js');
const PRELOAD = read('preload.js');
const MOCK = read('e2e-mock-ipc.js');
const IPC_TS = read('renderer/src/lib/ipc.ts');

// Channels registered outside our own source: electron-audio-loopback's
// initMain() (app/main.js) installs these ipcMain handlers itself, so they are
// renderer-callable without a literal ipcMain.handle in main.js.
const EXTERNALLY_REGISTERED = new Set(['enable-loopback-audio', 'disable-loopback-audio']);

function matchAll(src, re) {
  const out = [];
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

// --- main.js: every ipcMain.handle / .on / .once registration ---
function mainRegistrations() {
  return matchAll(MAIN, /ipcMain\.(?:handle|on|once)\(\s*["']([^"']+)["']/g);
}

// --- preload.js: renderer->main channels (invoke = request, send = fire) ---
function preloadInvokeChannels() {
  return new Set(matchAll(PRELOAD, /\b(?:invoke|send)\(\s*["']([^"']+)["']/g));
}

// --- preload.js: main->renderer event channels (subscribe wrapper) ---
function preloadSubscribeChannels() {
  return new Set(matchAll(PRELOAD, /\bsubscribe\(\s*["']([^"']+)["']/g));
}

// --- e2e-mock-ipc.js: the MOCKS + DEFAULTS stub keys. Every channel name is
// kebab-case (>=1 hyphen), which distinguishes a channel key from any plain
// object key and keeps this scan robust. ---
function mockStubKeys() {
  return new Set(matchAll(MOCK, /["']([a-z0-9]+(?:-[a-z0-9]+)+)["']\s*:/g));
}

test('main.js has no duplicate ipcMain registrations (Electron throws on the 2nd)', () => {
  const regs = mainRegistrations();
  const seen = new Set();
  const dups = [];
  for (const ch of regs) {
    if (seen.has(ch)) dups.push(ch);
    else seen.add(ch);
  }
  assert.deepStrictEqual(dups, [], `duplicate ipcMain registration(s): ${dups.join(', ')}`);
});

test('every renderer-callable channel (preload invoke/send) is registered in main.js', () => {
  const registered = new Set(mainRegistrations());
  const missing = [...preloadInvokeChannels()].filter(
    (ch) => !registered.has(ch) && !EXTERNALLY_REGISTERED.has(ch),
  );
  assert.deepStrictEqual(
    missing.sort(),
    [],
    `preload invokes channel(s) with no ipcMain handler (invoke() would reject): ${missing.join(', ')}`,
  );
});

test('every main.js registration is reachable from the preload bridge (no orphan handlers)', () => {
  const invocable = preloadInvokeChannels();
  const orphans = [...new Set(mainRegistrations())].filter((ch) => !invocable.has(ch));
  assert.deepStrictEqual(
    orphans.sort(),
    [],
    `main.js registers channel(s) the renderer bridge never calls (dead handler?): ${orphans.join(', ')}`,
  );
});

test('every e2e-mock stub names a real renderer-callable channel (no stale stub)', () => {
  const invocable = preloadInvokeChannels();
  const stale = [...mockStubKeys()].filter((ch) => !invocable.has(ch));
  assert.deepStrictEqual(
    stale.sort(),
    [],
    `e2e-mock-ipc.js stubs channel(s) that are not renderer-callable (renamed/removed?): ${stale.join(', ')}`,
  );
});

// The channel name in main.js's M->R events is always the FIRST argument of a
// send call — `mainWindow.webContents.send('<ch>', payload)`, `event.sender.send`,
// or `sender.send` — and is sometimes a ternary of literals
// (`send(cond ? 'a' : 'b')`). Extract just that first argument (up to the first
// top-level comma / the closing paren, honoring quotes so a ')' or ',' inside a
// string never ends it early) and collect the channel literals from it. Scoping
// to the first argument keeps channel-shaped strings in a *payload* object from
// counting as a send site, and matching a real `.send(` call — not a bare
// substring anywhere — means a channel named only in a comment can't satisfy it.
function firstSendArg(src, i) {
  let depth = 1;
  let quote = null;
  let out = '';
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) break;
    } else if (c === ',' && depth === 1) break;
    out += c;
  }
  return out;
}

function channelsEmittedViaSend() {
  const emitted = new Set();
  const re = /\.send\(/g;
  let m;
  while ((m = re.exec(MAIN))) {
    const arg = firstSendArg(MAIN, re.lastIndex);
    for (const lit of arg.matchAll(/["']([^"']+)["']/g)) emitted.add(lit[1]);
  }
  return emitted;
}

test('every M->R subscribe channel is emitted at a real send() site in main.js', () => {
  const emitted = channelsEmittedViaSend();
  const missing = [...preloadSubscribeChannels()].filter((ch) => !emitted.has(ch));
  assert.deepStrictEqual(
    missing.sort(),
    [],
    `preload subscribes to M->R channel(s) main.js never send()s: ${missing.join(', ')}`,
  );
});

test('ipc.ts bridge namespaces match the preload bridge (type mirror in sync)', () => {
  // preload: top-level keys of `const stenoai = { ... }` (2-space indent),
  // including shorthand properties like `subscribeQueryStream,`.
  const stenoaiBody = PRELOAD.slice(PRELOAD.indexOf('const stenoai = {'));
  const preloadKeys = new Set(matchAll(stenoaiBody, /^ {2}([a-zA-Z]+)[,:]/gm));

  // ipc.ts: members of `interface StenoaiBridge { ... }` (2-space indent).
  const bridgeBody = IPC_TS.slice(IPC_TS.indexOf('interface StenoaiBridge {'));
  const tsKeys = new Set(matchAll(bridgeBody, /^ {2}([a-zA-Z]+)[?:]/gm));

  const onlyPreload = [...preloadKeys].filter((k) => !tsKeys.has(k)).sort();
  const onlyTs = [...tsKeys].filter((k) => !preloadKeys.has(k)).sort();
  assert.deepStrictEqual(
    { onlyPreload, onlyTs },
    { onlyPreload: [], onlyTs: [] },
    `preload bridge and StenoaiBridge namespaces drifted — only in preload: [${onlyPreload}], only in ipc.ts: [${onlyTs}]`,
  );
});

'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// backend-cli.js destructures child_process.spawn at load time, so stub it
// BEFORE the first require. killProcessTree reads child_process.execFileSync at
// call time, so that can be stubbed per-test.
const cp = require('child_process');
const realSpawn = cp.spawn;
let spawnCalls = [];
cp.spawn = (...args) => { spawnCalls.push(args); return { fake: true }; };

const { spawn, killProcessTree, createBackendCli } = require('./backend-cli');

afterEach(() => {
  spawnCalls = [];
  mock.restoreAll();
});

// ---- spawn wrapper -------------------------------------------------------

test('spawn defaults windowsHide:true for the (command, args[]) form', () => {
  spawn('backend', ['a', 'b']);
  assert.deepStrictEqual(spawnCalls[0][0], 'backend');
  assert.deepStrictEqual(spawnCalls[0][1], ['a', 'b']);
  assert.deepStrictEqual(spawnCalls[0][2], { windowsHide: true });
});

test('spawn lets a caller override windowsHide', () => {
  spawn('backend', ['a'], { windowsHide: false, cwd: '/x' });
  assert.deepStrictEqual(spawnCalls[0][2], { windowsHide: false, cwd: '/x' });
});

test('spawn handles the 2-arg (command, options) form', () => {
  spawn('backend', { cwd: '/y' });
  // Collapsed to the options-object overload; windowsHide defaulted in.
  assert.deepStrictEqual(spawnCalls[0][1], { windowsHide: true, cwd: '/y' });
});

test('spawn defaults options when args is null/undefined', () => {
  spawn('backend');
  assert.deepStrictEqual(spawnCalls[0][1], undefined);
  assert.deepStrictEqual(spawnCalls[0][2], { windowsHide: true });
});

// ---- killProcessTree -----------------------------------------------------

test('killProcessTree is a no-op for a falsy pid', () => {
  const killMock = mock.method(process, 'kill', () => {});
  killProcessTree(0);
  killProcessTree(null);
  killProcessTree(undefined);
  assert.strictEqual(killMock.mock.callCount(), 0);
});

test('killProcessTree escalates SIGTERM -> SIGKILL on POSIX', () => {
  if (process.platform === 'win32') return; // POSIX-only branch
  const killMock = mock.method(process, 'kill', () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  killProcessTree(4242);
  // Immediate SIGTERM.
  assert.strictEqual(killMock.mock.callCount(), 1);
  assert.deepStrictEqual(killMock.mock.calls[0].arguments, [4242, 'SIGTERM']);
  // SIGKILL only after the 1s escalation timer.
  mock.timers.tick(1000);
  assert.strictEqual(killMock.mock.callCount(), 2);
  assert.deepStrictEqual(killMock.mock.calls[1].arguments, [4242, 'SIGKILL']);
});

test('killProcessTree tree-kills via taskkill on win32', () => {
  const origPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const execMock = mock.method(cp, 'execFileSync', () => {});
  try {
    killProcessTree(777);
    assert.strictEqual(execMock.mock.callCount(), 1);
    const [bin, argv, opts] = execMock.mock.calls[0].arguments;
    assert.strictEqual(bin, 'taskkill');
    assert.deepStrictEqual(argv, ['/PID', '777', '/T', '/F']);
    assert.strictEqual(opts.windowsHide, true);
  } finally {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  }
});

// ---- createBackendCli: packaging-aware paths -----------------------------

test('getBackendPath/getBackendCwd resolve the dev build via injected app', () => {
  const { getBackendPath, getBackendCwd } = createBackendCli({ app: { isPackaged: false } });
  const exe = process.platform === 'win32' ? 'stenoai.exe' : 'stenoai';
  // __dirname is app/, so dev paths point at <repo>/dist/stenoai/*.
  assert.strictEqual(getBackendPath(), path.join(__dirname, '..', 'dist', 'stenoai', exe));
  assert.strictEqual(getBackendCwd(), path.join(__dirname, '..', 'dist', 'stenoai'));
});

test('getBackendPath/getBackendCwd resolve the packaged resources dir', () => {
  const origRes = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', { value: '/Apps/Steno.app/Contents/Resources', configurable: true });
  const exe = process.platform === 'win32' ? 'stenoai.exe' : 'stenoai';
  try {
    const { getBackendPath, getBackendCwd } = createBackendCli({ app: { isPackaged: true } });
    assert.strictEqual(getBackendPath(), path.join('/Apps/Steno.app/Contents/Resources', 'stenoai', exe));
    assert.strictEqual(getBackendCwd(), path.join('/Apps/Steno.app/Contents/Resources', 'stenoai'));
  } finally {
    Object.defineProperty(process, 'resourcesPath', { value: origRes, configurable: true });
  }
});

// Restore the real child_process.spawn once this file's tests are done.
test('teardown: restore child_process.spawn', () => {
  cp.spawn = realSpawn;
});

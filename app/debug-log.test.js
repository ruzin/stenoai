'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createDebugLog } = require('./debug-log');

function fakeWindow() {
  const sent = [];
  return { sent, webContents: { send: (...a) => sent.push(a) } };
}

test('sends the message to the main window on the debug-log channel', () => {
  const win = fakeWindow();
  const sendDebugLog = createDebugLog({ getMainWindow: () => win });
  sendDebugLog('hello');
  assert.deepStrictEqual(win.sent, [['debug-log', 'hello']]);
});

test('is a silent no-op when there is no window', () => {
  const sendDebugLog = createDebugLog({ getMainWindow: () => null });
  assert.doesNotThrow(() => sendDebugLog('dropped'));
});

test('reads the accessor on every call (window created/destroyed after wiring)', () => {
  let win = null;
  const sendDebugLog = createDebugLog({ getMainWindow: () => win });
  sendDebugLog('before'); // no window yet — dropped
  const real = fakeWindow();
  win = real;
  sendDebugLog('after'); // window now present
  win = null;
  sendDebugLog('gone'); // destroyed again — dropped
  assert.deepStrictEqual(real.sent, [['debug-log', 'after']]);
});

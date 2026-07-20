'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createTeardownRegistry } = require('./teardown');

test('drains disposers in reverse registration order', () => {
  const order = [];
  const t = createTeardownRegistry();
  t.register(() => order.push('a'));
  t.register(() => order.push('b'));
  t.register(() => order.push('c'));
  t.drain();
  assert.deepStrictEqual(order, ['c', 'b', 'a']);
});

test('drain is idempotent — a second drain runs nothing again', () => {
  let count = 0;
  const t = createTeardownRegistry();
  t.register(() => { count += 1; });
  t.drain();
  t.drain();
  assert.strictEqual(count, 1);
});

test('a throwing disposer does not strand the ones after it', () => {
  const ran = [];
  const t = createTeardownRegistry();
  t.register(() => ran.push('first-registered')); // runs LAST (reverse)
  t.register(() => { throw new Error('boom'); });
  t.register(() => ran.push('last-registered')); // runs FIRST (reverse)
  assert.doesNotThrow(() => t.drain());
  assert.deepStrictEqual(ran, ['last-registered', 'first-registered']);
});

test('a dispose that reentrantly calls drain does not double-run disposers', () => {
  const ran = [];
  const t = createTeardownRegistry();
  t.register(() => ran.push('a'));
  t.register(() => { ran.push('b'); t.drain(); }); // reentrant drain
  t.drain();
  assert.deepStrictEqual(ran, ['b', 'a']); // each exactly once
});

test('ignores non-function registrations', () => {
  const t = createTeardownRegistry();
  assert.doesNotThrow(() => {
    t.register(null);
    t.register(undefined);
    t.register(42);
    t.drain();
  });
});

test('register after a drain participates in the next drain', () => {
  const ran = [];
  const t = createTeardownRegistry();
  t.register(() => ran.push('first'));
  t.drain();
  t.register(() => ran.push('second'));
  t.drain();
  assert.deepStrictEqual(ran, ['first', 'second']);
});

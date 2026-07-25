'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { isSafeToAutoInstall } = require('./update-idle-gate');

// The all-clear baseline: opted in, an update is staged, nothing in flight, and
// idle well past the threshold. Each blocker test flips exactly one field so a
// failure names the single condition that failed to gate.
const ALL_CLEAR = {
  enabled: true,
  updateReady: true,
  isRecording: false,
  isProcessing: false,
  queueLength: 0,
  liveActive: false,
  streaming: false,
  otherJobsActive: false,
  idleSeconds: 700,
  idleThresholdSeconds: 600,
};

// The activity flags that must each be EXPLICITLY false to pass (fail closed).
// Reused by the blocker + garbled-value tests below.
const ACTIVITY_FLAGS = [
  'isRecording',
  'isProcessing',
  'liveActive',
  'streaming',
  'otherJobsActive',
];

test('all-clear -> true', () => {
  assert.strictEqual(isSafeToAutoInstall(ALL_CLEAR), true);
});

test('recording blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, isRecording: true }), false);
});

test('processing blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, isProcessing: true }), false);
});

test('non-empty queue blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, queueLength: 1 }), false);
});

test('live transcription active blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, liveActive: true }), false);
});

test('in-flight AI stream blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, streaming: true }), false);
});

test('reprocess/report/regen-title job active blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, otherJobsActive: true }), false);
});

test('idle below threshold blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, idleSeconds: 599 }), false);
});

test('idle exactly at threshold -> true (boundary is inclusive)', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, idleSeconds: 600 }), true);
});

test('disabled by setting blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, enabled: false }), false);
});

test('no update staged (not ready) blocks', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, updateReady: false }), false);
});

// FAIL CLOSED: a garbled / undefined / non-boolean activity flag (e.g. a failed
// state read) must NOT be treated as "inactive" — it blocks the install. Prove
// this for every activity flag against every non-false value, and that ONLY an
// explicit `false` (not merely a falsy value like 0) is accepted.
const NON_FALSE_VALUES = [undefined, null, true, 1, 0, '', 'false', {}, NaN];
for (const flag of ACTIVITY_FLAGS) {
  for (const bad of NON_FALSE_VALUES) {
    test(`${flag} = ${JSON.stringify(bad)} (non-false) blocks — fail closed`, () => {
      assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, [flag]: bad }), false);
    });
  }
  test(`${flag} passes only when explicitly false`, () => {
    assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, [flag]: false }), true);
  });
}

// The enabling flags likewise require an explicit `true` — a truthy-but-not-true
// value must not enable the install.
test('enabled / updateReady require explicit true (truthy non-true blocks)', () => {
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, enabled: 1 }), false);
  assert.strictEqual(isSafeToAutoInstall({ ...ALL_CLEAR, updateReady: 'yes' }), false);
});

// Defensive: a missing/garbled state object must never green-light an install.
test('empty / missing args -> false', () => {
  assert.strictEqual(isSafeToAutoInstall(), false);
  assert.strictEqual(isSafeToAutoInstall({}), false);
});

test('non-numeric idle values -> false', () => {
  assert.strictEqual(
    isSafeToAutoInstall({ ...ALL_CLEAR, idleSeconds: undefined }),
    false,
  );
  assert.strictEqual(
    isSafeToAutoInstall({ ...ALL_CLEAR, idleThresholdSeconds: null }),
    false,
  );
});

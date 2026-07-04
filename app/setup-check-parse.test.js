const { test } = require('node:test');
const assert = require('node:assert');

const {
  extractSetupCheckPayload,
  isValidSetupCheckPayload,
  parseSetupCheckOutput,
} = require('./setup-check-parse');

const VALID = {
  allGood: true,
  checks: [{ name: 'Python', ok: true, status: 'pass', detail: '3.11.5' }],
};

test('extractSetupCheckPayload reads a clean single JSON line', () => {
  const out = JSON.stringify(VALID) + '\n';
  assert.deepStrictEqual(extractSetupCheckPayload(out), VALID);
});

test('extractSetupCheckPayload tolerates leading stray stdout chatter', () => {
  // A third-party import printing to stdout before the JSON line must not break
  // parsing — this is the exact divergence the coordinator flagged.
  const out = ['ALSA lib pcm.c: some import noise', JSON.stringify(VALID), ''].join('\n');
  assert.deepStrictEqual(extractSetupCheckPayload(out), VALID);
});

test('extractSetupCheckPayload picks the JSON line carrying allGood, not other JSON', () => {
  const out = ['{"unrelated": 1}', JSON.stringify(VALID)].join('\n');
  assert.deepStrictEqual(extractSetupCheckPayload(out), VALID);
});

test('extractSetupCheckPayload returns null when no allGood payload exists', () => {
  assert.strictEqual(extractSetupCheckPayload('no json here\n{"foo":1}\n'), null);
  assert.strictEqual(extractSetupCheckPayload(''), null);
  assert.strictEqual(extractSetupCheckPayload(undefined), null);
});

test('isValidSetupCheckPayload accepts the contract shape', () => {
  assert.strictEqual(isValidSetupCheckPayload(VALID), true);
});

test('isValidSetupCheckPayload rejects valid-but-wrong payloads', () => {
  assert.strictEqual(isValidSetupCheckPayload({}), false); // masks broken backend
  assert.strictEqual(isValidSetupCheckPayload({ allGood: true, checks: [] }), false);
  assert.strictEqual(isValidSetupCheckPayload({ allGood: 'yes', checks: VALID.checks }), false);
  assert.strictEqual(
    isValidSetupCheckPayload({ allGood: true, checks: [{ name: 'X', ok: true, status: 'bogus', detail: 'd' }] }),
    false
  );
  assert.strictEqual(
    isValidSetupCheckPayload({ allGood: true, checks: [{ name: '', ok: true, status: 'pass', detail: 'd' }] }),
    false
  );
});

test('parseSetupCheckOutput returns {allGood, checks} for a good buffer with chatter', () => {
  const out = ['import noise line', JSON.stringify(VALID)].join('\n');
  assert.deepStrictEqual(parseSetupCheckOutput(out), VALID);
});

test('parseSetupCheckOutput throws when no payload is present', () => {
  assert.throws(() => parseSetupCheckOutput('nothing parseable\n'), /no parseable JSON/);
});

test('parseSetupCheckOutput throws on a valid-but-wrong schema', () => {
  // {} has no allGood → not even extracted, treated as no payload.
  assert.throws(() => parseSetupCheckOutput(JSON.stringify({})), /no parseable JSON/);
  // Extracted (allGood is a boolean) but the checks array is empty → schema fail,
  // so an empty/broken payload is a failure, not a passing "setup incomplete".
  assert.throws(
    () => parseSetupCheckOutput(JSON.stringify({ allGood: false, checks: [] })),
    /did not match the expected schema/
  );
});

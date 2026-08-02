const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  shareTempDir,
  sweepShareTemp,
  SHARE_TEMP_DIRNAME,
  SHARE_TEMP_MAX_AGE_MS,
} = require('./share-temp');

const HOUR_MS = 60 * 60 * 1000;

// Track every temp dir we create so a single after-hook removes them all -
// otherwise repeated runs accumulate share-temp-test-* dirs in the system temp.
const createdTmpDirs = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-temp-test-'));
  createdTmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdTmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Write a share-shaped file and backdate its mtime by ageMs. Returns the path.
// mtime is set explicitly (never the wall clock) so the age boundary is exact.
function writeShared(dir, name, ageMs, now) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'payload', 'utf-8');
  const when = (now - ageMs) / 1000; // fs.utimesSync takes seconds
  fs.utimesSync(filePath, when, when);
  return filePath;
}

test('shareTempDir creates the subdirectory under the injected base path', () => {
  const base = makeTmpDir();

  const dir = shareTempDir(base);

  assert.strictEqual(dir, path.join(base, SHARE_TEMP_DIRNAME));
  assert.strictEqual(fs.statSync(dir).isDirectory(), true);
});

test('shareTempDir is idempotent on an existing directory', () => {
  const base = makeTmpDir();
  const first = shareTempDir(base);
  fs.writeFileSync(path.join(first, 'keep.md'), 'x', 'utf-8');

  const second = shareTempDir(base);

  assert.strictEqual(second, first);
  // Re-resolving must never wipe what is already in there: a second call
  // happens on every share, long after the startup sweep decided what stays.
  assert.strictEqual(fs.existsSync(path.join(first, 'keep.md')), true);
});

test('deletes a file older than the cutoff', () => {
  const dir = makeTmpDir();
  const now = 1_800_000_000_000;
  const stale = writeShared(dir, '2026-07-01-old.pdf', 25 * HOUR_MS, now);

  const result = sweepShareTemp(dir, now, SHARE_TEMP_MAX_AGE_MS);

  assert.deepStrictEqual(result.deleted, [stale]);
  assert.strictEqual(fs.existsSync(stale), false);
});

test('keeps a file younger than the cutoff', () => {
  // The load-bearing case. A 23-hour-old file may still be the attachment
  // under an open mail draft; deleting it destroys what the user is sending.
  const dir = makeTmpDir();
  const now = 1_800_000_000_000;
  const fresh = writeShared(dir, '2026-07-30-fresh.pdf', 23 * HOUR_MS, now);

  const result = sweepShareTemp(dir, now, SHARE_TEMP_MAX_AGE_MS);

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, [fresh]);
  assert.strictEqual(fs.existsSync(fresh), true);
});

test('the age boundary is exact and deterministic', () => {
  const dir = makeTmpDir();
  const now = 1_800_000_000_000;

  // age === maxAgeMs is not younger, so it goes.
  const atBoundary = writeShared(dir, 'boundary.md', 5000, now);
  assert.deepStrictEqual(sweepShareTemp(dir, now, 5000).deleted, [atBoundary]);

  // One millisecond inside the window keeps it.
  writeShared(dir, 'boundary.md', 4999, now);
  const inside = sweepShareTemp(dir, now, 5000);
  assert.deepStrictEqual(inside.deleted, []);
  assert.deepStrictEqual(inside.kept, [atBoundary]);
});

test('a missing directory does not throw', () => {
  const missing = path.join(os.tmpdir(), 'share-temp-does-not-exist-xyz');

  const result = sweepShareTemp(missing, Date.now(), SHARE_TEMP_MAX_AGE_MS);

  assert.deepStrictEqual(result, { deleted: [], kept: [] });
});

test('never removes or recurses into a subdirectory', () => {
  const dir = makeTmpDir();
  const now = 1_800_000_000_000;
  const nested = path.join(dir, 'nested');
  fs.mkdirSync(nested);
  const buried = path.join(nested, 'buried.md');
  fs.writeFileSync(buried, 'x', 'utf-8');
  const when = (now - 99 * HOUR_MS) / 1000;
  fs.utimesSync(buried, when, when);
  fs.utimesSync(nested, when, when);

  const result = sweepShareTemp(dir, now, SHARE_TEMP_MAX_AGE_MS);

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, [nested]);
  assert.strictEqual(fs.existsSync(buried), true);
});

test('one unlinkable entry does not abort the rest of the sweep', () => {
  const dir = makeTmpDir();
  const now = 1_800_000_000_000;
  const locked = writeShared(dir, 'locked.pdf', 30 * HOUR_MS, now);
  const other = writeShared(dir, 'other.pdf', 30 * HOUR_MS, now);

  const stubFs = {
    readdirSync: fs.readdirSync,
    lstatSync: fs.lstatSync,
    unlinkSync: (p) => {
      if (p === locked) {
        const err = new Error('EPERM');
        err.code = 'EPERM';
        throw err;
      }
      return fs.unlinkSync(p);
    },
  };

  const result = sweepShareTemp(dir, now, SHARE_TEMP_MAX_AGE_MS, stubFs);

  assert.deepStrictEqual(result.deleted, [other]);
  assert.deepStrictEqual(result.kept, [locked]);
  assert.strictEqual(fs.existsSync(locked), true);
});

test('the default cutoff is 24 hours', () => {
  // The spec's contract: files outlive their own session including any open
  // draft, and the directory still cannot grow without bound.
  assert.strictEqual(SHARE_TEMP_MAX_AGE_MS, 24 * HOUR_MS);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sweepOrphanedLiveSnapshots,
  DEFAULT_MIN_AGE_MS,
} = require('./live-snapshot-sweep');

// Fresh temp dir per test so runs never see each other's files.
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'live-sweep-test-'));
}

// Write a snapshot-shaped file and backdate its mtime by ageMs so the age guard
// sees it as old. Returns the absolute path.
function writeSnapshot(dir, name, { ageMs = DEFAULT_MIN_AGE_MS * 2 } = {}) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, 'transcript', 'utf-8');
  const when = (Date.now() - ageMs) / 1000; // fs.utimesSync takes seconds
  fs.utimesSync(filePath, when, when);
  return filePath;
}

test('deletes an old orphan matching the pattern', () => {
  const dir = makeTmpDir();
  const orphan = writeSnapshot(dir, 'stenoai-live-1700000000000-a1b2c3.txt');

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, [orphan]);
  assert.strictEqual(fs.existsSync(orphan), false);
});

test('keeps a file listed in keepPaths regardless of age', () => {
  const dir = makeTmpDir();
  const wanted = writeSnapshot(dir, 'stenoai-live-1700000000001-keepme.txt');

  const result = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    keepPaths: new Set([wanted]),
  });

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, [wanted]);
  assert.strictEqual(fs.existsSync(wanted), true);
});

test('keeps a too-young file (age guard) via injected now', () => {
  const dir = makeTmpDir();
  // Aged only 1s — younger than the default 60s guard.
  const young = writeSnapshot(dir, 'stenoai-live-1700000000002-fresh1.txt', {
    ageMs: 1000,
  });

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, [young]);
  assert.strictEqual(fs.existsSync(young), true);
});

test('injected now/minAgeMs controls the age boundary deterministically', () => {
  const dir = makeTmpDir();
  const file = path.join(dir, 'stenoai-live-1700000000003-clockd.txt');
  fs.writeFileSync(file, 'transcript', 'utf-8');
  const mtimeSec = 1_000_000; // fixed mtime in seconds
  fs.utimesSync(file, mtimeSec, mtimeSec);
  const mtimeMs = mtimeSec * 1000;

  // now exactly at the boundary: age === minAgeMs is NOT younger, so it deletes.
  const atBoundary = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    minAgeMs: 5000,
    now: mtimeMs + 5000,
  });
  assert.deepStrictEqual(atBoundary.deleted, [file]);

  // Recreate and test just-inside the guard: age < minAgeMs keeps it.
  fs.writeFileSync(file, 'transcript', 'utf-8');
  fs.utimesSync(file, mtimeSec, mtimeSec);
  const insideGuard = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    minAgeMs: 5000,
    now: mtimeMs + 4999,
  });
  assert.deepStrictEqual(insideGuard.deleted, []);
  assert.deepStrictEqual(insideGuard.kept, [file]);
});

test('ignores non-matching names and directories', () => {
  const dir = makeTmpDir();
  // No digit block.
  writeSnapshot(dir, 'stenoai-live-foo.txt');
  // Unrelated .txt.
  writeSnapshot(dir, 'notes.txt');
  // Right prefix, wrong extension.
  writeSnapshot(dir, 'stenoai-live-1700000000004-a1b2c3.log');
  // A directory whose name matches the pattern — must never be removed/recursed.
  const dirMatch = path.join(dir, 'stenoai-live-1700000000005-dddddd.txt');
  fs.mkdirSync(dirMatch);

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, []);
  // The matching-name directory is surfaced as kept; the non-matching files are
  // never listed at all.
  assert.deepStrictEqual(result.kept, [dirMatch]);
  assert.strictEqual(fs.existsSync(dirMatch), true);
  assert.strictEqual(
    fs.existsSync(path.join(dir, 'stenoai-live-foo.txt')),
    true,
  );
});

test('survives a file disappearing between list and unlink (injected fs)', () => {
  const dir = makeTmpDir();
  // Both files exist on disk (so readdir lists them) and are old enough to
  // delete. The stub makes `gone`'s unlink throw ENOENT, as if the
  // finally-unlink reaped it between our lstat and our unlink.
  const gone = writeSnapshot(dir, 'stenoai-live-1700000000006-vanish.txt');
  const survivor = writeSnapshot(dir, 'stenoai-live-1700000000007-a1b2c3.txt');

  const stubFs = {
    readdirSync: fs.readdirSync,
    lstatSync: fs.lstatSync,
    unlinkSync: (p) => {
      if (p === gone) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return fs.unlinkSync(p);
    },
  };

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir, fs: stubFs });

  // The real survivor is deleted; the vanished file is counted as kept, not thrown.
  assert.deepStrictEqual(result.deleted, [survivor]);
  assert.deepStrictEqual(result.kept, [gone]);
});

test('returns accurate deleted/kept lists across a mixed dir', () => {
  const dir = makeTmpDir();
  const oldOrphan = writeSnapshot(dir, 'stenoai-live-1700000000008-a1b2c3.txt');
  const wanted = writeSnapshot(dir, 'stenoai-live-1700000000009-keepme.txt');
  const young = writeSnapshot(dir, 'stenoai-live-1700000000010-fresh1.txt', {
    ageMs: 1000,
  });
  writeSnapshot(dir, 'unrelated.txt');

  const result = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    keepPaths: new Set([wanted]),
  });

  assert.deepStrictEqual(result.deleted, [oldOrphan]);
  assert.deepStrictEqual(result.kept.sort(), [wanted, young].sort());
  assert.strictEqual(fs.existsSync(oldOrphan), false);
  assert.strictEqual(fs.existsSync(wanted), true);
  assert.strictEqual(fs.existsSync(young), true);
});

test('returns empty result when tmpDir does not exist', () => {
  const result = sweepOrphanedLiveSnapshots({
    tmpDir: path.join(os.tmpdir(), 'live-sweep-does-not-exist-xyz'),
  });
  assert.deepStrictEqual(result, { deleted: [], kept: [] });
});

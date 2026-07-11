const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  sweepOrphanedLiveSnapshots,
  DEFAULT_MIN_AGE_MS,
} = require('./live-snapshot-sweep');

// Track every temp dir we create so a single after-hook can remove them all —
// otherwise repeated runs accumulate live-sweep-test-* dirs in the system temp.
const createdTmpDirs = [];

// Fresh temp dir per test so runs never see each other's files.
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-sweep-test-'));
  createdTmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdTmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
  const young = path.join(dir, 'stenoai-live-1700000000002-fresh1.txt');
  fs.writeFileSync(young, 'transcript', 'utf-8');
  const mtimeSec = 1_000_000; // fixed mtime in seconds
  fs.utimesSync(young, mtimeSec, mtimeSec);

  // Inject `now` 1s past the mtime — younger than the default 60s guard, so the
  // file is kept. Fully deterministic: no reliance on the wall clock.
  const result = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    now: mtimeSec * 1000 + 1000,
  });

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

test('matches a real 13-digit-timestamp snapshot name', () => {
  const dir = makeTmpDir();
  // The exact shape the writer emits today: 13-digit epoch-ms + <=6 base36.
  const real = writeSnapshot(dir, 'stenoai-live-1700000000000-a1b2c3.txt');

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, [real]);
});

test('sweeps a degenerate empty-suffix snapshot', () => {
  const dir = makeTmpDir();
  // Math.random() === 0 -> "0", whose slice(2, 8) is "" — the writer can emit
  // `stenoai-live-<ts>-.txt`. It must still be swept, not leaked forever.
  const empty = writeSnapshot(dir, 'stenoai-live-1700000000000-.txt');

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, [empty]);
  assert.strictEqual(fs.existsSync(empty), false);
});

test('ignores a too-short timestamp (single digit)', () => {
  const dir = makeTmpDir();
  // Below the 10-digit floor — a hand-crafted name, not a real snapshot.
  writeSnapshot(dir, 'stenoai-live-1-a.txt');

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, []);
  assert.strictEqual(
    fs.existsSync(path.join(dir, 'stenoai-live-1-a.txt')),
    true,
  );
});

test('ignores an overly long random suffix', () => {
  const dir = makeTmpDir();
  // 9-char suffix exceeds the 1-8 bound — never produced by slice(2, 8).
  writeSnapshot(dir, 'stenoai-live-1700000000000-abcdefghi.txt');

  const result = sweepOrphanedLiveSnapshots({ tmpDir: dir });

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, []);
  assert.strictEqual(
    fs.existsSync(path.join(dir, 'stenoai-live-1700000000000-abcdefghi.txt')),
    true,
  );
});

test('case-sensitive keep-set (default off Windows) misses a differently-cased path', () => {
  const dir = makeTmpDir();
  const wanted = writeSnapshot(dir, 'stenoai-live-1700000000011-abc123.txt');

  // Keep-set references the file with an upper-cased basename. With
  // case-sensitive comparison (caseInsensitive:false) this does NOT match, so
  // the file, being old, is deleted — the pre-fix behavior on macOS/Linux.
  const upper = path.join(dir, 'STENOAI-LIVE-1700000000011-ABC123.TXT');
  const result = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    keepPaths: new Set([upper]),
    caseInsensitive: false,
  });

  assert.deepStrictEqual(result.deleted, [wanted]);
});

test('case-insensitive keep-set (Windows) keeps a differently-cased path', () => {
  const dir = makeTmpDir();
  const wanted = writeSnapshot(dir, 'stenoai-live-1700000000012-abc123.txt');

  // Same differently-cased reference, but with caseInsensitive:true (the
  // Windows default) it now matches and the still-needed snapshot is kept.
  const upper = path.join(dir, 'STENOAI-LIVE-1700000000012-ABC123.TXT');
  const result = sweepOrphanedLiveSnapshots({
    tmpDir: dir,
    keepPaths: new Set([upper]),
    caseInsensitive: true,
  });

  assert.deepStrictEqual(result.deleted, []);
  assert.deepStrictEqual(result.kept, [wanted]);
  assert.strictEqual(fs.existsSync(wanted), true);
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

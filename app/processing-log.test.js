const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const log = require('./processing-log');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plog-'));
  log._reset();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readLog() {
  return fs.readFileSync(path.join(dir, 'processing.log'), 'utf8');
}

test('logLine writes an ISO-timestamped, labelled record', () => {
  log.init({ dir });
  log.logLine('app', 'hello world');
  const content = readLog();
  assert.match(content, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[app\] hello world\n$/);
});

test('a multi-line message becomes one record per line', () => {
  log.init({ dir });
  log.logLine('pipeline', 'line one\nline two');
  const lines = readLog().trimEnd().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /\[pipeline\] line one$/);
  assert.match(lines[1], /\[pipeline\] line two$/);
});

test('an oversized line is truncated to the 8 KiB cap with a marker', () => {
  log.init({ dir });
  const huge = 'x'.repeat(20000);
  log.logLine('pipeline', huge);
  const written = readLog();
  assert.ok(written.includes('…(truncated)'));
  // The record (one line) must not exceed cap + prefix + marker + newline budget.
  assert.ok(Buffer.byteLength(written, 'utf8') < 9000);
});

test('rotation triggers at the 5 MiB boundary and creates a single backup', () => {
  log.init({ dir });
  // Each line is ~1 KiB; write enough to cross 5 MiB. Margin (+60) generously
  // absorbs the per-record prefix overhead so the boundary is always crossed.
  const kib = 'y'.repeat(1024 - 40); // leave room for prefix/newline
  const linesNeeded = Math.ceil((5 * 1024 * 1024) / 1024) + 60;
  for (let i = 0; i < linesNeeded; i++) log.logLine('x', kib);
  assert.ok(fs.existsSync(path.join(dir, 'processing.log.1')), 'backup exists');
  // Current log was reset after rotation, so it is well under 5 MiB.
  const curSize = fs.statSync(path.join(dir, 'processing.log')).size;
  assert.ok(curSize < 5 * 1024 * 1024, 'current log reset after rotation');
});

test('byte counting is UTF-8 aware (multi-byte near the edge)', () => {
  log.init({ dir });
  // '€' is 3 bytes in UTF-8; a naive .length count would under-count and overshoot 5 MiB.
  const euros = '€'.repeat(300); // 900 bytes
  const linesNeeded = Math.ceil((5 * 1024 * 1024) / 900) + 10;
  for (let i = 0; i < linesNeeded; i++) log.logLine('x', euros);
  assert.ok(fs.existsSync(path.join(dir, 'processing.log.1')), 'rotated using byte count');
});

test('rotation overwrites an existing .1 backup (Windows rename safety)', () => {
  fs.writeFileSync(path.join(dir, 'processing.log.1'), 'STALE BACKUP');
  log.init({ dir });
  const big = 'z'.repeat(1024 - 40);
  const linesNeeded = Math.ceil((5 * 1024 * 1024) / 1024) + 60;
  for (let i = 0; i < linesNeeded; i++) log.logLine('x', big);
  const backup = fs.readFileSync(path.join(dir, 'processing.log.1'), 'utf8');
  assert.ok(!backup.includes('STALE BACKUP'), 'stale backup was replaced');
});

test('a rename failure degrades quietly and backs off (no throw per line)', () => {
  log.init({ dir });
  // Force rotation to fail by making renameSync throw.
  const realRename = fs.renameSync;
  let renameCalls = 0;
  fs.renameSync = () => { renameCalls++; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
  try {
    const big = 'q'.repeat(1024 - 40);
    const linesNeeded = Math.ceil((5 * 1024 * 1024) / 1024) + 60;
    // Must not throw.
    assert.doesNotThrow(() => {
      for (let i = 0; i < linesNeeded; i++) log.logLine('x', big);
    });
    // Backoff: after the first failed rotation it stops hammering renameSync.
    assert.ok(renameCalls <= 2, `renameSync called ${renameCalls}x — backoff not engaged`);
  } finally {
    fs.renameSync = realRename;
  }
});

test('logLine before init is a no-op (never throws)', () => {
  assert.doesNotThrow(() => log.logLine('app', 'dropped'));
});

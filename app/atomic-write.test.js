const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomicSync } = require('./atomic-write');

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

test('writeFileAtomicSync replaces the file contents', () => {
  const file = tmpFile('old');
  writeFileAtomicSync(file, 'new');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'new');
});

test('writeFileAtomicSync creates a file that does not exist yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  const file = path.join(dir, 'fresh.md');
  writeFileAtomicSync(file, 'hello');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'hello');
});

test('a failed write leaves the original intact and removes the temp file', () => {
  const file = tmpFile('original');
  const dir = path.dirname(file);
  const before = fs.readdirSync(dir);

  assert.throws(() => {
    // A directory cannot be written as file data; the write fails after the
    // temp file has been created, which is exactly the window under test.
    writeFileAtomicSync(file, { toString() { throw new Error('boom'); } });
  });

  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), before.sort());
});

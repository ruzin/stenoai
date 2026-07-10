const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { safeSessionStem, userNotesFilePath } = require('./notes-file');

test('safeSessionStem replaces every disallowed char with underscore', () => {
  // Must mirror Python: re.sub(r'[^a-zA-Z0-9_-]', '_', name)
  assert.strictEqual(safeSessionStem('Weekly Sync'), 'Weekly_Sync');
  assert.strictEqual(safeSessionStem('Q3 review: budget/plan'), 'Q3_review__budget_plan');
  // BMP non-ASCII (é, ☕ = U+2615) are each a single code unit → one underscore.
  assert.strictEqual(safeSessionStem('café ☕ chat'), 'caf____chat');
});

test('safeSessionStem collapses an astral char (emoji) to a SINGLE underscore', () => {
  // 😀 is one code point but two UTF-16 units; the `u` flag matches Python's one '_'.
  assert.strictEqual(safeSessionStem('a😀b'), 'a_b');
  assert.strictEqual(safeSessionStem('Standup 🚀'), 'Standup__');
});

test('safeSessionStem preserves the already-safe alphabet (letters, digits, _ and -)', () => {
  assert.strictEqual(safeSessionStem('Note-1_v2'), 'Note-1_v2');
});

test('safeSessionStem coerces null/undefined to an empty stem', () => {
  assert.strictEqual(safeSessionStem(null), '');
  assert.strictEqual(safeSessionStem(undefined), '');
});

test('userNotesFilePath joins the output dir with the <stem>_notes.txt sidecar', () => {
  assert.strictEqual(
    userNotesFilePath('/data/output', 'Note'),
    path.join('/data/output', 'Note_notes.txt'),
  );
  assert.strictEqual(
    userNotesFilePath('/data/output', 'Weekly Sync'),
    path.join('/data/output', 'Weekly_Sync_notes.txt'),
  );
});

test('regression: writer and reader resolve to the SAME path for the same dir + name', () => {
  // The bug: two sites computed the path independently and drifted. One helper => can't.
  const outputDir = '/Users/x/Library/Application Support/stenoai/output';
  const sessionName = 'Note';
  const writerPath = userNotesFilePath(outputDir, sessionName); // save-meeting-notes
  const readerPath = userNotesFilePath(outputDir, sessionName); // stop-recording
  assert.strictEqual(writerPath, readerPath);
  assert.strictEqual(readerPath, path.join(outputDir, 'Note_notes.txt'));
});

test('userNotesFilePath does NOT resolve into the app bundle', () => {
  // Guards against regressing to the read-only bundle dir (_internal/output).
  const p = userNotesFilePath('/data/output', 'Note');
  assert.ok(!p.includes('_internal'), `notes path leaked into the bundle: ${p}`);
});

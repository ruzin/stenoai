const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { safeSessionStem, userNotesFilePath } = require('./notes-file');

test('safeSessionStem replaces every disallowed char with underscore', () => {
  // Must mirror Python: re.sub(r'[^a-zA-Z0-9_-]', '_', name)
  assert.strictEqual(safeSessionStem('Weekly Sync'), 'Weekly_Sync');
  assert.strictEqual(safeSessionStem('Q3 review: budget/plan'), 'Q3_review__budget_plan');
  assert.strictEqual(safeSessionStem('café ☕ chat'), 'caf____chat');
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
  // The bug was two call sites computing the notes path independently — the
  // writer used the user-data output dir, the reader used the read-only bundle
  // dir — so the file written was never the file read. Routing both through
  // userNotesFilePath makes divergence impossible: same inputs => same path.
  const outputDir = '/Users/x/Library/Application Support/stenoai/output';
  const sessionName = 'Note';
  const writerPath = userNotesFilePath(outputDir, sessionName); // save-meeting-notes
  const readerPath = userNotesFilePath(outputDir, sessionName); // stop-recording
  assert.strictEqual(writerPath, readerPath);
  assert.strictEqual(readerPath, path.join(outputDir, 'Note_notes.txt'));
});

test('userNotesFilePath does NOT resolve into the app bundle', () => {
  // Guards against a regression back to getBackendCwd()/_internal/output, which
  // is read-only for packaged users and where notes are never written.
  const p = userNotesFilePath('/data/output', 'Note');
  assert.ok(!p.includes('_internal'), `notes path leaked into the bundle: ${p}`);
});

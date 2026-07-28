const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  noteSnapshotPath,
  readSnapshot,
  captureSnapshot,
  markEdited,
} = require('./note-snapshot');

function tmpNote() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-snapshot-'));
  const file = path.join(dir, 'Weekly_Sync_summary.md');
  fs.writeFileSync(file, '---\ntitle: "Weekly Sync"\n---\n\n## Summary\n\nhi\n', 'utf8');
  return file;
}

const FIELDS = {
  summary: 'We agreed the budget.',
  key_points: ['Budget approved'],
  action_items: ['Anna sends the draft'],
  discussion_areas: [{ title: 'Budget', analysis: 'Reviewed.' }],
  participants: ['Anna'],
};

test('noteSnapshotPath swaps the _summary.md suffix for _original.json', () => {
  assert.strictEqual(
    path.basename(noteSnapshotPath('/x/Weekly_Sync_summary.md')),
    'Weekly_Sync_original.json',
  );
});

test('readSnapshot returns null when no sidecar exists', () => {
  assert.strictEqual(readSnapshot(tmpNote()), null);
});

test('captureSnapshot writes the original fields and is readable back', () => {
  const note = tmpNote();
  captureSnapshot(note, FIELDS, 'generation');
  const back = readSnapshot(note);
  assert.strictEqual(back.version, 1);
  assert.strictEqual(back.capture, 'generation');
  assert.deepStrictEqual(back.original, FIELDS);
  assert.deepStrictEqual(back.edited_fields, []);
});

test('captureSnapshot never overwrites an existing snapshot', () => {
  const note = tmpNote();
  captureSnapshot(note, FIELDS, 'generation');
  captureSnapshot(note, { ...FIELDS, summary: 'DIFFERENT' }, 'first_edit');
  assert.strictEqual(readSnapshot(note).original.summary, 'We agreed the budget.');
  assert.strictEqual(readSnapshot(note).capture, 'generation');
});

test('markEdited accumulates field names without duplicates and stamps a time', () => {
  const note = tmpNote();
  captureSnapshot(note, FIELDS, 'generation');
  markEdited(note, ['summary']);
  const back = markEdited(note, ['summary', 'action_items']);
  assert.deepStrictEqual(back.edited_fields.sort(), ['action_items', 'summary']);
  assert.ok(back.edited_at);
});

test('a corrupt sidecar reads as null rather than throwing', () => {
  const note = tmpNote();
  fs.writeFileSync(noteSnapshotPath(note), '{ not json', 'utf8');
  assert.strictEqual(readSnapshot(note), null);
});

test('markEdited on a note with no snapshot is a no-op that does not throw', () => {
  const note = tmpNote();
  assert.strictEqual(markEdited(note, ['summary']), null);
});

const fs = require('fs');
const { writeFileAtomicSync } = require('./atomic-write');

// The model's original output for one note, kept in a sidecar rather than in
// the note itself because reprocess rebuilds the note file completely
// (simple_recorder.py). Without this file there is no diff base: a regenerate
// would silently destroy user corrections, and no later learning mechanism
// could tell a correction from the text it replaced.
const SNAPSHOT_VERSION = 1;

function noteSnapshotPath(summaryPath) {
  return String(summaryPath).replace(/_summary\.md$/, '_original.json');
}

function readSnapshot(summaryPath) {
  const file = noteSnapshotPath(summaryPath);
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // A snapshot from a future version is not ours to interpret.
    if (!parsed || parsed.version !== SNAPSHOT_VERSION) return null;
    return parsed;
  } catch (_) {
    // A corrupt sidecar must never break opening a note. It reads as absent,
    // which costs the learning signal for this note and nothing else.
    return null;
  }
}

// `capture` is 'generation' when Python or main snapshots freshly generated
// output, and 'first_edit' when main snapshots a pre-existing note the moment
// the user first edits it. The second is accurate only because the note was
// never editable before this feature; later consumers should treat it as
// slightly weaker evidence.
function captureSnapshot(summaryPath, fields, capture) {
  const existing = readSnapshot(summaryPath);
  if (existing) return existing;
  const snapshot = {
    version: SNAPSHOT_VERSION,
    captured_at: new Date().toISOString(),
    capture: capture === 'generation' ? 'generation' : 'first_edit',
    original: {
      summary: fields.summary ?? '',
      key_points: fields.key_points ?? [],
      action_items: fields.action_items ?? [],
      discussion_areas: fields.discussion_areas ?? [],
      participants: fields.participants ?? [],
    },
    edited_fields: [],
    edited_at: null,
  };
  writeFileAtomicSync(noteSnapshotPath(summaryPath), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function markEdited(summaryPath, changedFields) {
  const snapshot = readSnapshot(summaryPath);
  if (!snapshot) return null;
  const merged = new Set([...(snapshot.edited_fields || []), ...(changedFields || [])]);
  snapshot.edited_fields = [...merged];
  snapshot.edited_at = new Date().toISOString();
  writeFileAtomicSync(noteSnapshotPath(summaryPath), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

module.exports = { noteSnapshotPath, readSnapshot, captureSnapshot, markEdited, SNAPSHOT_VERSION };

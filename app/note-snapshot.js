const fs = require('fs');
const { writeFileAtomicSync } = require('./atomic-write');

// The model's original output for one note, kept in a sidecar rather than in
// the note itself because reprocess rebuilds the note file completely
// (simple_recorder.py). Without this file there is no diff base: a regenerate
// would silently destroy user corrections, and no later learning mechanism
// could tell a correction from the text it replaced.
const SNAPSHOT_VERSION = 1;

function noteSnapshotPath(summaryPath) {
  const str = String(summaryPath);
  // String.replace returns its input unchanged when the pattern does not
  // match. Without this check, a caller bug that passes a path not ending in
  // "_summary.md" would silently get that same path back, and the write
  // functions below would then overwrite the note itself with snapshot JSON
  // instead of writing a sidecar next to it. Fail loudly here instead.
  if (!str.endsWith('_summary.md')) {
    throw new Error(`noteSnapshotPath: expected a path ending in "_summary.md", got: ${str}`);
  }
  return str.replace(/_summary\.md$/, '_original.json');
}

// Reads never throw; writes fail loudly. This asymmetry is deliberate, not an
// oversight: a read backs "open this note", which must never fail because of
// its sidecar, while a write backs "create/update this sidecar", where
// silently swallowing a malformed path risks the write landing on the note
// itself (see noteSnapshotPath). Do not "fix" this back into symmetry -
// noteSnapshotPath is called inside the try below (not before it) precisely
// so a malformed summaryPath is caught here and returns null, exactly like a
// missing or corrupt sidecar file.
function readSnapshot(summaryPath) {
  try {
    const file = noteSnapshotPath(summaryPath);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // A snapshot from a future version is not ours to interpret.
    if (!parsed || parsed.version !== SNAPSHOT_VERSION) return null;
    return parsed;
  } catch (_) {
    // A corrupt sidecar, an unreadable file, or a malformed summaryPath must
    // never break opening a note. All read as absent, which costs the
    // learning signal for this note and nothing else.
    return null;
  }
}

// `capture` is 'generation' when Python or main snapshots freshly generated
// output, and 'first_edit' when main snapshots a pre-existing note the moment
// the user first edits it. The second is accurate only because the note was
// never editable before this feature; later consumers should treat it as
// slightly weaker evidence.
function captureSnapshot(summaryPath, fields, capture) {
  const file = noteSnapshotPath(summaryPath);
  // Whether we may write depends on whether a sidecar FILE is already there,
  // not on whether readSnapshot can make sense of it. readSnapshot returns
  // null both for "nothing here" and for "something here we don't
  // understand" (corrupt JSON, or a future version's format) - collapsing
  // that distinction is correct for a reader, which just wants "no usable
  // snapshot", but wrong for a writer. If we wrote whenever readSnapshot
  // returned null, a sidecar from a newer app version would look absent and
  // get silently replaced with a version-1 snapshot, destroying whatever the
  // newer format held. So: file exists -> never write, return whatever
  // readSnapshot makes of it (the valid snapshot, or null if unreadable).
  // Only a genuinely absent file is safe to create.
  if (fs.existsSync(file)) {
    return readSnapshot(summaryPath);
  }
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
  writeFileAtomicSync(file, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

// Read-modify-write with no locking or compare-and-swap: this is safe only
// because every caller today runs synchronously inside the single Electron
// main process, so two calls can never interleave. That assumption breaks
// the day the Python side also writes this sidecar (a later task in this
// plan) - two processes racing this read-modify-write could each read the
// same on-disk snapshot, and whichever writes second silently discards the
// other's edited_fields/edited_at update, with no error and no way to tell
// afterwards that data was lost. A future cross-process caller must not
// discover this by losing an edit; it needs either to funnel writes back
// through the main process (keeping the single-writer property) or to add
// real concurrency control (a file lock, or a compare-and-swap on version /
// edited_at before writing) - not attempted here because nothing today
// exercises the concurrent path.
function markEdited(summaryPath, changedFields) {
  // noteSnapshotPath is called directly (not only via readSnapshot below) so
  // a malformed summaryPath throws here, before anything else runs. readSnapshot
  // catches that same throw internally and would otherwise turn it into a
  // silent null, which would make this write-path function swallow a caller
  // bug instead of surfacing it - the opposite of the intended asymmetry.
  const file = noteSnapshotPath(summaryPath);
  const snapshot = readSnapshot(summaryPath);
  if (!snapshot) return null;
  const merged = new Set([...(snapshot.edited_fields || []), ...(changedFields || [])]);
  snapshot.edited_fields = [...merged];
  snapshot.edited_at = new Date().toISOString();
  writeFileAtomicSync(file, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

// A field key the writers above could plausibly have recorded: lowercase ASCII
// with underscores. The sidecar is an ordinary file on disk, and its
// edited_fields ends up named in a confirm dialog, so anything that is not
// shaped like a key is dropped rather than rendered.
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/;
// A sane sidecar lists at most the five snapshotted sections. The cap is a
// bound on a corrupt or hostile file, not a semantic limit.
const MAX_EDITED_FIELDS = 8;

// The sanitized edited_fields for one note, for the renderer's regenerate
// guard. Never throws and always returns an array: "no sidecar", "corrupt
// sidecar", "malformed path" and "never edited" must all reach the UI as the
// same empty list, so the guard cannot fire on a note that has no edits to
// lose. This is a reader, and it keeps readSnapshot's never-throws contract
// rather than relaxing it.
function editedFieldNames(summaryPath) {
  const snapshot = readSnapshot(summaryPath);
  if (!snapshot || !Array.isArray(snapshot.edited_fields)) return [];
  const seen = [];
  for (const field of snapshot.edited_fields) {
    if (typeof field !== 'string' || !FIELD_KEY.test(field)) continue;
    if (seen.includes(field)) continue;
    seen.push(field);
    if (seen.length >= MAX_EDITED_FIELDS) break;
  }
  return seen;
}

module.exports = {
  noteSnapshotPath,
  readSnapshot,
  captureSnapshot,
  markEdited,
  editedFieldNames,
  SNAPSHOT_VERSION,
};

// Unit tests for the Obsidian sync engine (app/obsidian-sync.js). No Electron,
// no model — a temp dir stands in for the vault and the data dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  registerObsidianSync, transformNote, deriveFilename, sanitizeFilename, parseFrontmatter,
} = require('./obsidian-sync');

const NOTE = `---
title: "Acme Q3 Planning"
date: 2026-07-15T14:00:00
is_diarised: true
folders: ["fold1234"]
---

## Summary

Ship the pricing page Friday. Bob owns the release notes.

## Participants

Alice, Bob

## Action Items

- Bob: draft release notes

## Transcript

[You] we ship Friday.
[Others] I'll prep the notes.

## User Notes

Follow up Monday.
`;

// --- pure helpers ----------------------------------------------------------

test('parseFrontmatter reads line-based frontmatter + JSON folders array', () => {
  const { fm, body } = parseFrontmatter(NOTE);
  assert.equal(fm.title, 'Acme Q3 Planning');
  assert.equal(fm.folders, '["fold1234"]');
  assert.ok(body.startsWith('## Summary'));
});

test('transformNote strips transcript, lifts participants, adds Obsidian props', () => {
  const { vaultBody, title, dateStr, folderName } = transformNote(NOTE, {
    stem: '20260715-1400_acme',
    resolveFolderName: (id) => (id === 'fold1234' ? 'Sales' : null),
  });
  assert.equal(title, 'Acme Q3 Planning');
  assert.equal(dateStr, '2026-07-15');
  assert.equal(folderName, 'Sales');
  assert.match(vaultBody, /source: Steno/);
  assert.match(vaultBody, /steno_stem: "20260715-1400_acme"/);
  assert.match(vaultBody, /folder: "Sales"/);
  assert.match(vaultBody, /participants:\n {2}- "Alice"\n {2}- "Bob"/);
  assert.match(vaultBody, /## User Notes/);
  assert.ok(!/## Transcript/.test(vaultBody), 'transcript section removed');
  assert.ok(!/we ship Friday/.test(vaultBody), 'transcript content removed');
});

test('sanitizeFilename strips fs-hostile chars and falls back to stem', () => {
  assert.equal(sanitizeFilename('A/B: C?', 'stemx'), 'A B C');
  assert.equal(sanitizeFilename('///', 'stemx'), 'stemx');
});

test('deriveFilename disambiguates a collision with the stem', () => {
  const taken = (name) => name === '2026-07-15 Sync.md';
  assert.equal(deriveFilename('2026-07-15', 'Sync', 'abc', () => false), '2026-07-15 Sync.md');
  assert.equal(deriveFilename('2026-07-15', 'Sync', 'abc', taken), '2026-07-15 Sync (abc).md');
});

// --- engine (temp vault) ---------------------------------------------------

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'));
  const dataDir = path.join(root, 'data');
  const vault = path.join(root, 'vault');
  const output = path.join(dataDir, 'output');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'folders.json'),
    JSON.stringify({ folders: [{ id: 'fold1234', name: 'Sales' }] }));
  const eng = registerObsidianSync({
    getUserDataDir: () => dataDir,
    getAllowedBaseDirs: () => [dataDir],
    validateSafeFilePath: () => true,
    resolveFoldersJsonPath: () => path.join(dataDir, 'folders.json'),
  });
  eng.setCachedConfig({ enabled: true, vaultPath: vault });
  const writeNote = (stem, content) =>
    fs.writeFileSync(path.join(output, `${stem}_summary.md`), content);
  return { root, dataDir, vault, output, eng, writeNote };
}

test('off by default: no write, no state file when disabled', () => {
  const h = harness();
  h.eng.setCachedConfig({ enabled: false, vaultPath: h.vault });
  h.writeNote('n1', NOTE);
  assert.equal(h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md')).status, 'disabled');
  assert.deepEqual(fs.readdirSync(h.vault), []);
  fs.rmSync(h.root, { recursive: true, force: true });
});

test('sync writes a readable file under the folder subdir; backfill covers all', () => {
  const h = harness();
  h.writeNote('n1', NOTE);
  const r = h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  assert.equal(r.status, 'synced');
  const target = path.join(h.vault, 'Sales', '2026-07-15 Acme Q3 Planning.md');
  assert.ok(fs.existsSync(target), 'file under Sales/ with readable name');
  assert.match(fs.readFileSync(target, 'utf8'), /source: Steno/);
  fs.rmSync(h.root, { recursive: true, force: true });
});

test('title change renames the vault file (no orphan)', () => {
  const h = harness();
  h.writeNote('n1', NOTE);
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  const oldPath = path.join(h.vault, 'Sales', '2026-07-15 Acme Q3 Planning.md');
  assert.ok(fs.existsSync(oldPath));
  h.writeNote('n1', NOTE.replace('Acme Q3 Planning', 'Acme Renamed'));
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  assert.ok(!fs.existsSync(oldPath), 'old filename gone');
  assert.ok(fs.existsSync(path.join(h.vault, 'Sales', '2026-07-15 Acme Renamed.md')), 'renamed');
  fs.rmSync(h.root, { recursive: true, force: true });
});

test('external edit is not clobbered; conflict recorded', () => {
  const h = harness();
  h.writeNote('n1', NOTE);
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  const target = path.join(h.vault, 'Sales', '2026-07-15 Acme Q3 Planning.md');
  fs.writeFileSync(target, 'MY OWN OBSIDIAN EDIT');
  h.writeNote('n1', NOTE.replace('Friday', 'Thursday'));
  const r = h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  assert.equal(r.status, 'conflict');
  assert.equal(fs.readFileSync(target, 'utf8'), 'MY OWN OBSIDIAN EDIT', 'edit preserved');
  assert.ok(h.eng.loadIndex().conflicts.n1, 'conflict flagged');
  fs.rmSync(h.root, { recursive: true, force: true });
});

test('remove deletes the vault copy; preserves an externally-edited one', () => {
  const h = harness();
  h.writeNote('n1', NOTE);
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  const target = path.join(h.vault, 'Sales', '2026-07-15 Acme Q3 Planning.md');
  // clean delete removes it
  assert.equal(h.eng.removeNoteBySummaryPath('n1').status, 'removed');
  assert.ok(!fs.existsSync(target));
  // re-sync, then externally edit, then delete → preserved + flagged
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  fs.writeFileSync(target, 'EDITED');
  assert.equal(h.eng.removeNoteBySummaryPath('n1').status, 'conflict');
  assert.ok(fs.existsSync(target), 'externally-edited copy kept');
  fs.rmSync(h.root, { recursive: true, force: true });
});

test('reconcile removes vault copies whose source note is gone', () => {
  const h = harness();
  h.writeNote('n1', NOTE);
  h.eng.syncNoteBySummaryPath(path.join(h.output, 'n1_summary.md'));
  const target = path.join(h.vault, 'Sales', '2026-07-15 Acme Q3 Planning.md');
  fs.unlinkSync(path.join(h.output, 'n1_summary.md')); // deleted while app closed
  h.eng.reconcileOnLaunch();
  assert.ok(!fs.existsSync(target), 'orphan vault copy cleaned');
  assert.ok(!h.eng.loadIndex().notes.n1, 'index entry dropped');
  fs.rmSync(h.root, { recursive: true, force: true });
});

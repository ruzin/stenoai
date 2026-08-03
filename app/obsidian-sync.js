// Obsidian vault sync (#413) — one-way mirror of Steno notes into a vault folder.
//
// Steno stores each note as `<stem>_summary.md` (YAML-ish frontmatter + `##`
// sections + a transcript). This module mirrors the *note* (transcript dropped)
// into a user-chosen Obsidian vault folder as a readable `YYYY-MM-DD Title.md`,
// organised under subfolders that mirror Steno's folders.
//
// Design contract:
//   - DISK IS THE SOURCE OF TRUTH. Callers pass only a summary-file path; this
//     module re-reads the note and reconciles. One code path for every trigger
//     (pipeline save, title edit, folder move, backfill, reconcile).
//   - NEVER THROW INTO A CALLER. A failing vault write (unplugged drive, cloud
//     folder mid-conflict, read-only) must never break a note save or a delete
//     commit. Every public method swallows its own fs errors.
//   - ONE-WAY. Obsidian-side edits are never read back. If the vault copy was
//     edited externally (its bytes differ from what we last wrote), we SKIP the
//     overwrite and flag a conflict rather than clobber the user's edit — on
//     update AND on delete.
//   - Identity is the stem (stable across title/folder changes); the index maps
//     stem -> vault path so a rename moves the file instead of orphaning it.
//
// Off by default: syncNoteBySummaryPath returns immediately unless the cached
// config has the toggle on AND a vault path set, so the note lifecycle pays
// nothing when the feature is off.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SUMMARY_SUFFIX = '_summary.md';
const STATE_VERSION = 1;
// Windows reserved device names (case-insensitive, with or without extension).
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — no fs, no Electron)
// ---------------------------------------------------------------------------

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Windows transiently locks a freshly-written file (AV / search indexer), so a
// same-instant unlink or rename can throw EPERM/EBUSY. Retry briefly with a real
// synchronous sleep — mirrors the app's own delete path (commitPendingDelete).
// (fs.rmSync's maxRetries is ignored for single files, so we roll our own.)
function sleepMs(ms) {
  // Busy-wait, deliberately: SharedArrayBuffer/Atomics can be unavailable in the
  // Electron main process, and this only runs on a rare Windows lock retry.
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}
function retryTransient(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try { return fn(); }
    catch (err) {
      const transient = err && ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code);
      if (i >= tries - 1 || !transient) throw err;
      sleepMs(50 * (i + 1)); // escalating backoff, up to ~1.8s total
    }
  }
}
// Returns true if the path is gone after this call (removed or already absent),
// false if it survived every retry (a persistently-locked file on Windows).
function rmWithRetry(p) {
  try { retryTransient(() => fs.unlinkSync(p)); return true; }
  catch (err) { return !!(err && err.code === 'ENOENT'); }
}
function renameWithRetry(from, to) { retryTransient(() => fs.renameSync(from, to)); }

// Parse Steno's line-by-line frontmatter (NOT nested YAML — `folders:` is a
// one-line JSON array). Returns { fm, body }. Mirrors report_store._split_frontmatter.
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const rest = raw.slice(3);
  const end = rest.indexOf('\n---');
  if (end === -1) return { fm: {}, body: raw };
  const block = rest.slice(0, end);
  const body = rest.slice(end + 4).replace(/^(?:\r?\n)+/, '');
  const fm = {};
  for (const line of block.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    fm[key] = val;
  }
  return { fm, body };
}

// Return the text of a `## <heading>` section (up to the next `## ` or EOF),
// or '' if absent. Matches a line that IS the heading after trim.
function sectionText(body, heading) {
  const lines = body.split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (inside) break;
      if (m[1] === heading) { inside = true; continue; }
    } else if (inside) {
      out.push(line);
    }
  }
  return out.join('\n').trim();
}

// Body with the named `## <heading>` section removed (heading + content, up to
// the next `## ` or EOF). Used to strip `## Transcript` from the vault copy.
function stripSection(body, heading) {
  const lines = body.split('\n');
  const out = [];
  let dropping = false;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      dropping = m[1] === heading;
      if (dropping) continue;
    }
    if (!dropping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function yamlQuote(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ') + '"';
}

// Filesystem-safe filename for macOS + Windows. `stem` is the fallback when the
// title sanitises to nothing.
function sanitizeFilename(name, stem) {
  let s = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows: no trailing dot/space
  if (process.platform === 'win32' && WIN_RESERVED.test(s)) s = '_' + s;
  if (s.length > 180) s = s.slice(0, 180).trim();
  return s || stem;
}

// `YYYY-MM-DD Title.md`. When a *different* note already owns that name
// (collision), append the stem to disambiguate deterministically.
function deriveFilename(dateStr, title, stem, isTaken) {
  const base = [dateStr, sanitizeFilename(title, stem)].filter(Boolean).join(' ');
  let name = `${base}.md`;
  if (typeof isTaken === 'function' && isTaken(name)) {
    name = `${base} (${stem}).md`;
  }
  return name;
}

// Build the vault-side note from a raw `<stem>_summary.md`. `resolveFolderName`
// maps a folder id -> name (or null). Returns { vaultBody, title, dateStr,
// folderName }.
function transformNote(raw, { stem, resolveFolderName }) {
  const { fm, body } = parseFrontmatter(raw);
  const title = fm.title || stem;
  const dateStr = fm.date ? String(fm.date).slice(0, 10) : '';
  let folderIds = [];
  if (fm.folders) {
    try { folderIds = JSON.parse(fm.folders); } catch (_) { folderIds = []; }
  }
  const folderName = folderIds.length && typeof resolveFolderName === 'function'
    ? resolveFolderName(folderIds[0]) : null;
  const participants = sectionText(body, 'Participants')
    .split(',').map((p) => p.trim()).filter(Boolean);

  const props = [
    `title: ${yamlQuote(title)}`,
    dateStr ? `date: ${dateStr}` : null,
    folderName ? `folder: ${yamlQuote(folderName)}` : null,
  ].filter(Boolean);
  const partBlock = participants.length
    ? 'participants:\n' + participants.map((p) => `  - ${yamlQuote(p)}`).join('\n')
    : null;
  const fmOut = ['---', ...props, partBlock, 'source: Steno',
    `steno_stem: ${yamlQuote(stem)}`, '---'].filter(Boolean).join('\n');

  const vaultBody = fmOut + '\n\n' + stripSection(body, 'Transcript');
  return { vaultBody, title, dateStr, folderName };
}

// ---------------------------------------------------------------------------
// The stateful engine
// ---------------------------------------------------------------------------

function registerObsidianSync({
  getUserDataDir,
  getAllowedBaseDirs,
  validateSafeFilePath,
  resolveFoldersJsonPath,
  sendDebugLog = () => {},
} = {}) {
  let cached = { enabled: false, vaultPath: '' };
  let backfilling = false;

  const log = (msg) => { try { sendDebugLog(`[obsidian-sync] ${msg}`); } catch (_) {} };

  function setCachedConfig(cfg) {
    cached = { enabled: !!(cfg && cfg.enabled), vaultPath: (cfg && cfg.vaultPath) || '' };
  }
  function getCachedConfig() { return cached; }
  function isActive() { return cached.enabled && !!cached.vaultPath; }

  const statePath = () => path.join(getUserDataDir(), '.obsidian-sync-state.json');

  function loadIndex() {
    try {
      const d = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
      if (d && typeof d === 'object') {
        return {
          version: STATE_VERSION,
          notes: d.notes || {},
          conflicts: d.conflicts || {},
          stale: Array.isArray(d.stale) ? d.stale : [],
        };
      }
    } catch (_) { /* missing or corrupt → fresh */ }
    return { version: STATE_VERSION, notes: {}, conflicts: {}, stale: [] };
  }

  // Vault-relative paths whose unlink was blocked by a persistent Windows lock
  // during a rename/delete. Re-attempt them on every sync/reconcile so a
  // transiently-locked file is never permanently orphaned (self-healing).
  function drainStale(idx) {
    if (!idx.stale || !idx.stale.length) return;
    idx.stale = idx.stale.filter((rel) => !rmWithRetry(path.join(cached.vaultPath, rel)));
  }

  function atomicWriteFileSync(dest, data) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = path.join(path.dirname(dest),
      `.tmp-${path.basename(dest)}-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, data);
    renameWithRetry(tmp, dest); // atomic on one volume (Windows-retry on lock)
  }

  function saveIndex(idx) {
    try { atomicWriteFileSync(statePath(), JSON.stringify(idx, null, 2)); }
    catch (e) { log(`state write failed: ${e.code || e.message}`); }
  }

  function resolveFolderName(id) {
    try {
      const data = JSON.parse(fs.readFileSync(resolveFoldersJsonPath(), 'utf8'));
      const f = (data.folders || []).find((x) => x && x.id === id);
      return f ? f.name : null;
    } catch (_) { return null; }
  }

  function stemFromSummaryPath(p) {
    const b = path.basename(p);
    return b.endsWith(SUMMARY_SUFFIX) ? b.slice(0, -SUMMARY_SUFFIX.length) : null;
  }

  // A vault file counts as "externally edited" when its current bytes differ
  // from what we recorded writing. First-ever write (no entry) is never a conflict.
  function isExternallyEdited(absVaultPath, entry) {
    if (!entry) return false;
    try {
      const cur = sha256(fs.readFileSync(absVaultPath));
      return cur !== entry.lastWrittenHash;
    } catch (_) { return false; } // gone → not a conflict, we'll recreate
  }

  function recordConflict(idx, stem, vaultRelPath, reason) {
    idx.conflicts[stem] = { vaultRelPath, detectedAt: new Date().toISOString(), reason };
  }

  // Core: reconcile the vault copy of one note from disk. Returns a status.
  function syncNoteBySummaryPath(summaryPath, { idx } = {}) {
    if (!isActive()) return { status: 'disabled' };
    const ownIdx = !idx;
    idx = idx || loadIndex();
    try {
      drainStale(idx); // retry any previously-blocked unlink first
      if (!summaryPath || !summaryPath.endsWith(SUMMARY_SUFFIX)) {
        return { status: 'skipped' };
      }
      if (typeof validateSafeFilePath === 'function' &&
          !validateSafeFilePath(summaryPath, getAllowedBaseDirs())) {
        return { status: 'skipped' };
      }
      let raw;
      try { raw = fs.readFileSync(summaryPath, 'utf8'); }
      catch (_) { return { status: 'skipped' }; } // note gone → nothing to mirror
      const stem = stemFromSummaryPath(summaryPath);
      const { vaultBody, dateStr, title, folderName } =
        transformNote(raw, { stem, resolveFolderName });
      const sub = folderName ? sanitizeFilename(folderName, folderName) : '';
      const entry = idx.notes[stem];
      const takenBy = (name) => {
        const rel = path.join(sub, name);
        if (Object.entries(idx.notes).some(([s, e]) => s !== stem && e.vaultRelPath === rel)) {
          return true;
        }
        // A pre-existing, untracked file with this name is the user's own — never
        // clobber it; disambiguate with the stem instead so the mirror lands on a
        // free path and the user's file survives (H1).
        const ownedByUs = entry && entry.vaultRelPath === rel;
        return !ownedByUs && fs.existsSync(path.join(cached.vaultPath, rel));
      };
      const filename = deriveFilename(dateStr, title, stem, takenBy);
      const vaultRelPath = path.join(sub, filename);
      const absDest = path.join(cached.vaultPath, vaultRelPath);
      const newHash = sha256(Buffer.from(vaultBody));

      // Rename: the note moved (title or folder changed) since we last wrote it.
      // Remove the old-name copy (unless the user edited it) — the normal write
      // below recreates it at the new path. Deliberately NOT fs.renameSync: it is
      // flaky on Windows (EPERM/EBUSY under the indexer/AV) and a partial rename
      // can orphan the old file; unlink-then-write is atomic-enough here because
      // the fresh content is about to be written regardless.
      if (entry && entry.vaultRelPath !== vaultRelPath) {
        const absOld = path.join(cached.vaultPath, entry.vaultRelPath);
        if (isExternallyEdited(absOld, entry)) {
          recordConflict(idx, stem, entry.vaultRelPath, 'external-edit');
          if (ownIdx) saveIndex(idx);
          return { status: 'conflict' };
        }
        // If a persistent Windows lock blocks the unlink, remember the old path
        // so a later sync/reconcile removes it — never a permanent orphan.
        if (!rmWithRetry(absOld)) idx.stale.push(entry.vaultRelPath);
        try { fs.rmdirSync(path.dirname(absOld)); } catch (_) { /* not empty / root */ }
      }

      let destHash = null;
      try { destHash = sha256(fs.readFileSync(absDest)); } catch (_) {}

      // Already in sync (identical bytes on disk): skip the write — no mtime
      // churn for cloud-synced vaults — and heal the index if a prior crash left
      // it stale (M1). A first write lands on a free path (see takenBy), so this
      // never mistakes a pre-existing user file for our own.
      if (destHash === newHash) {
        idx.notes[stem] = { vaultRelPath, lastWrittenHash: newHash, lastSyncedAt: new Date().toISOString() };
        delete idx.conflicts[stem];
        if (ownIdx) saveIndex(idx);
        return { status: 'synced' };
      }

      // Conflict: an existing, tracked destination was edited in Obsidian since
      // our last write. (destHash === null means no file there — safe to create.)
      if (destHash !== null && isExternallyEdited(absDest, entry)) {
        recordConflict(idx, stem, vaultRelPath, 'external-edit');
        if (ownIdx) saveIndex(idx);
        return { status: 'conflict' };
      }

      atomicWriteFileSync(absDest, vaultBody);
      idx.notes[stem] = {
        vaultRelPath,
        lastWrittenHash: newHash,
        lastSyncedAt: new Date().toISOString(),
      };
      delete idx.conflicts[stem];
      if (ownIdx) saveIndex(idx);
      return { status: 'synced' };
    } catch (e) {
      log(`sync failed: ${e.code || e.message}`);
      return { status: 'error' };
    }
  }

  // Remove the vault copy on note deletion. Preserves an externally-edited copy
  // (skip + flag) — the locked decision favours the user's edit over no-orphan.
  function removeNoteBySummaryPath(target) {
    if (!isActive()) return { status: 'disabled' };
    const idx = loadIndex();
    try {
      const stem = target && target.endsWith && target.endsWith(SUMMARY_SUFFIX)
        ? stemFromSummaryPath(target) : target;
      const entry = idx.notes[stem];
      if (!entry) return { status: 'absent' };
      const abs = path.join(cached.vaultPath, entry.vaultRelPath);
      if (isExternallyEdited(abs, entry)) {
        recordConflict(idx, stem, entry.vaultRelPath, 'external-edit-on-delete');
        saveIndex(idx);
        return { status: 'conflict' };
      }
      if (!rmWithRetry(abs)) idx.stale.push(entry.vaultRelPath);
      try { fs.rmdirSync(path.dirname(abs)); } catch (_) { /* not empty / root */ }
      delete idx.notes[stem];
      delete idx.conflicts[stem];
      saveIndex(idx);
      return { status: 'removed' };
    } catch (e) {
      log(`remove failed: ${e.code || e.message}`);
      return { status: 'error' };
    }
  }

  function listSummaryFiles() {
    const out = [];
    for (const base of (getAllowedBaseDirs() || [])) {
      const dir = path.join(base, 'output');
      let names = [];
      try { names = fs.readdirSync(dir); } catch (_) { continue; }
      for (const n of names) {
        if (n.endsWith(SUMMARY_SUFFIX)) out.push(path.join(dir, n));
      }
    }
    return out;
  }

  // One-time export of every existing note when the user turns sync on.
  async function backfillAll() {
    if (!isActive() || backfilling) return { status: 'skipped' };
    backfilling = true;
    let n = 0;
    try {
      // Each note self-loads/saves the index. Slower than a shared in-memory
      // index, but correct: a per-note hook (rename/update) firing during a
      // yield can't have its index write clobbered by backfill's final save (M2).
      for (const p of listSummaryFiles()) {
        syncNoteBySummaryPath(p);
        n += 1;
        if (n % 25 === 0) await new Promise((r) => setImmediate(r)); // yield
      }
      log(`backfill complete: ${n} notes`);
    } finally { backfilling = false; }
    return { status: 'done', count: n };
  }

  // Repair index drift at launch (notes deleted while closed, crash windows).
  // Async + yielding so a large history never janks the launch critical path.
  async function reconcileOnLaunch() {
    if (!isActive()) return { status: 'disabled' };
    const idx = loadIndex();
    drainStale(idx);
    const onDisk = new Map(
      listSummaryFiles().map((p) => [stemFromSummaryPath(p), p]));
    // Guard against a mass-delete on an untrustworthy scan: an empty scan while
    // the index still tracks notes almost always means the scan failed (e.g. a
    // custom storage path that didn't load this launch) — not that the user
    // deleted everything. Skip the delete pass rather than wipe their vault (H2).
    const trustDeletes = onDisk.size > 0 || Object.keys(idx.notes).length === 0;
    try {
      // 1. Index entries whose source note is gone → remove the vault copy.
      if (trustDeletes) {
        for (const stem of Object.keys(idx.notes)) {
          if (!onDisk.has(stem)) {
            const entry = idx.notes[stem];
            const abs = path.join(cached.vaultPath, entry.vaultRelPath);
            if (!isExternallyEdited(abs, entry)) {
              rmWithRetry(abs);
              try { fs.rmdirSync(path.dirname(abs)); } catch (_) {}
              delete idx.notes[stem];
            }
          }
        }
      }
      saveIndex(idx);
      // 2. Source present but index missing/stale, or vault file missing →
      // re-sync (each self-persists, consistent with backfill's model).
      let n = 0;
      for (const [stem, p] of onDisk) {
        const entry = idx.notes[stem];
        const abs = entry && path.join(cached.vaultPath, entry.vaultRelPath);
        if (!entry || (abs && !fs.existsSync(abs))) {
          syncNoteBySummaryPath(p);
        }
        if (++n % 25 === 0) await new Promise((r) => setImmediate(r)); // yield
      }
    } catch (e) { log(`reconcile failed: ${e.code || e.message}`); }
    return { status: 'done' };
  }

  return {
    setCachedConfig, getCachedConfig,
    syncNoteBySummaryPath, removeNoteBySummaryPath,
    backfillAll, reconcileOnLaunch,
    loadIndex, saveIndex,
    // exported for tests:
    transformNote, deriveFilename, sanitizeFilename, parseFrontmatter,
  };
}

module.exports = {
  registerObsidianSync,
  // pure helpers for unit tests:
  transformNote, deriveFilename, sanitizeFilename, parseFrontmatter,
  sectionText, stripSection,
};

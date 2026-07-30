'use strict';

const fsDefault = require('fs');
const path = require('path');

// Temp files handed to the native macOS share sheet (ShareMenu). The
// `share-note-file` handler in main.js materialises a note as a PDF or a
// markdown file here, then pops the sheet on it.
//
// Why this directory is swept at startup and NEVER during a session: the
// filename becomes the attachment name the recipient reads, and the file has to
// survive the whole time the destination holds it. A user who picks Mail has an
// open draft and may type for ten minutes; AirDrop waits for the receiving side
// to accept. ShareMenu.popup() has no completion callback, so the app is never
// told when that ends. Deleting on sheet close, or on quit, would pull the
// attachment out from under an open draft - an open draft at quit time is not an
// exotic case. Sweeping only files older than a day at the NEXT start means
// files outlive their own session including any draft, the directory still
// cannot grow without bound, and there is no moment at which the app deletes a
// file someone is still reading.
//
// No electron import: the caller passes app.getPath('temp') in. That is what
// keeps this testable under plain node:test.

// Fixed subdirectory name so the sweep can own everything inside it. Because
// the directory is ours by construction there is no filename pattern to match
// (unlike live-snapshot-sweep, which sweeps the shared os.tmpdir()), so a
// crashed atomic write's leftover `.<name>.<hex>.tmp` is reclaimed too.
const SHARE_TEMP_DIRNAME = 'stenoai-share';

const SHARE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Resolve (and create) the share temp directory under baseTempPath. Called on
// every share as well as at startup, so it must never disturb existing files.
function shareTempDir(baseTempPath) {
  const dir = path.join(baseTempPath, SHARE_TEMP_DIRNAME);
  fsDefault.mkdirSync(dir, { recursive: true });
  return dir;
}

// Delete every file in `dir` whose mtime is at least maxAgeMs old, measured
// against the injected `now`. Best-effort throughout: a missing directory
// returns quietly and a per-entry failure is recorded and skipped, so one
// locked file cannot abort the rest. Flat by construction - never recurses.
//
// `fs` is injectable for the deterministic failure test.
// Returns { deleted: string[], kept: string[] } of absolute paths acted on, so
// the caller can log a count.
function sweepShareTemp(dir, now, maxAgeMs = SHARE_TEMP_MAX_AGE_MS, fs = fsDefault) {
  const deleted = [];
  const kept = [];

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    // Directory missing or unreadable - nothing to sweep.
    return { deleted, kept };
  }

  for (const name of entries) {
    const filePath = path.join(dir, name);

    let stat;
    try {
      // lstat, never stat: act only on the regular files we wrote ourselves and
      // never follow a symlink out of the share directory.
      stat = fs.lstatSync(filePath);
    } catch (_) {
      // Vanished between readdir and lstat - already gone.
      continue;
    }

    // Only plain files. A directory (or any other special file) is left alone
    // and not recursed into.
    if (!stat.isFile()) {
      kept.push(filePath);
      continue;
    }

    if (now - stat.mtimeMs < maxAgeMs) {
      kept.push(filePath);
      continue;
    }

    try {
      fs.unlinkSync(filePath);
      deleted.push(filePath);
    } catch (_) {
      // EPERM (a scanner holding it open on Windows) or an ENOENT race. Count it
      // as kept and continue; a best-effort sweep never throws.
      kept.push(filePath);
    }
  }

  return { deleted, kept };
}

module.exports = {
  shareTempDir,
  sweepShareTemp,
  SHARE_TEMP_DIRNAME,
  SHARE_TEMP_MAX_AGE_MS,
};

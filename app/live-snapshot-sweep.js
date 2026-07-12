'use strict';

const fsDefault = require('fs');
const path = require('path');

// Live-transcript snapshot temp files (#259). snapshotLiveTranscriptForFallback
// in main.js writes `stenoai-live-<ts>-<rand>.txt` into os.tmpdir() and hands the
// path to the Python job via --live-transcript. The primary cleanup is the
// finally-unlink in processNextInQueue, but if the app quits/crashes while the
// job is still QUEUED (not yet processed), that unlink never runs and the file
// is orphaned in the temp dir forever. This startup sweep reclaims those leaks.
//
// Lifecycle note (drives the keep-set): the processing queue (`processingQueue`)
// and `currentProcessingJob` in main.js are pure in-memory `let` state — nothing
// persists the queue, and the on-disk `.recording-active` marker carries only a
// timestamp for crash telemetry, no snapshot path. So after an app restart NO
// job can reference a snapshot file; the caller passes an (effectively empty)
// keep-set built defensively from any live queue/current job. The age guard is
// the real safety net: it prevents deleting a snapshot that a concurrent startup
// path just created and is about to enqueue.

// Exactly the shape snapshotLiveTranscriptForFallback writes:
// `stenoai-live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`.
// - The timestamp is Date.now() (epoch ms): 13 digits today. Bound it 10-17
//   digits — 10+ rejects a bare `stenoai-live-1-a.txt`, while the upper bound
//   stays tolerant of clock growth (17 digits covers epoch ms well past the
//   year 5000) without matching an unbounded run of digits.
// - The random suffix is base-36 (lowercase letters + digits), up to 6 chars
//   from slice(2, 8) but SHORTER when Math.random() yields a small value — and
//   EMPTY in the degenerate case (e.g. Math.random() === 0 -> "0", whose
//   slice(2, 8) is ""), producing `stenoai-live-<ts>-.txt`. So the suffix bound
//   is {0,8}: 0 sweeps that empty-suffix leak, 8 gives a little headroom. The
//   anchored 10-17 digit block + literal `-` + `.txt` still prevent
//   over-matching a hand-crafted name like `stenoai-live-foo.txt`.
const LIVE_SNAPSHOT_NAME = /^stenoai-live-\d{10,17}-[a-z0-9]{0,8}\.txt$/;

// Snapshots younger than this are kept even when not in the keep-set: they may
// belong to a job that startup is still wiring up. One minute is far longer than
// the enqueue window and short enough that a true orphan is reclaimed promptly.
const DEFAULT_MIN_AGE_MS = 60_000;

// Remove orphaned live-transcript snapshots from tmpDir. Every fs call is
// wrapped so a single failure (ENOENT race, EPERM) never throws out of the
// sweep — we collect and continue. Never recurses into subdirectories and never
// matches the pattern outside tmpDir (readdir is non-recursive, single level).
//
// keepPaths: absolute snapshot paths a live/restored job still needs (kept
//   regardless of age). Compared by resolved absolute path.
// minAgeMs: files newer than this (by mtime) are kept (age guard).
// now: injectable clock for deterministic tests.
// fs: injectable fs module for deterministic failure tests.
// caseInsensitive: compare keep-set paths case-insensitively. Defaults to true
//   on Windows, whose filesystem is case-insensitive — the same snapshot can be
//   referenced with different casing (e.g. C:\Temp vs c:\temp), and a
//   case-sensitive compare would miss the match and delete a still-needed file
//   once past the age guard. macOS/Linux default to case-sensitive.
//
// Returns { deleted: string[], kept: string[] } of absolute paths acted on.
function sweepOrphanedLiveSnapshots({
  tmpDir,
  keepPaths = new Set(),
  minAgeMs = DEFAULT_MIN_AGE_MS,
  now = Date.now(),
  fs = fsDefault,
  caseInsensitive = process.platform === 'win32',
} = {}) {
  const deleted = [];
  const kept = [];

  // Resolve to an absolute path, then lowercase on a case-insensitive FS so a
  // caller-supplied path and our path.join produce the same comparable key
  // regardless of form or casing. Used for BOTH keep-set insertion and lookup.
  const keyFor = (p) => {
    const resolved = path.resolve(p);
    return caseInsensitive ? resolved.toLowerCase() : resolved;
  };

  const keep = new Set();
  for (const p of keepPaths) {
    if (typeof p === 'string' && p) {
      keep.add(keyFor(p));
    }
  }

  let entries;
  try {
    entries = fs.readdirSync(tmpDir);
  } catch (_) {
    // Temp dir unreadable/missing — nothing to sweep.
    return { deleted, kept };
  }

  for (const name of entries) {
    if (!LIVE_SNAPSHOT_NAME.test(name)) continue;
    const filePath = path.join(tmpDir, name);

    let stat;
    try {
      // lstat (not stat): never follow a symlink — we only act on the regular
      // temp file we ourselves wrote, and won't chase a link out of tmpDir.
      stat = fs.lstatSync(filePath);
    } catch (_) {
      // Vanished between readdir and lstat — treat as already gone.
      continue;
    }

    // Only ever touch plain files matching the pattern. A directory (or other
    // special file) sharing the name is left untouched.
    if (!stat.isFile()) {
      kept.push(filePath);
      continue;
    }

    if (keep.has(keyFor(filePath))) {
      kept.push(filePath);
      continue;
    }

    // Age guard: keep anything younger than minAgeMs.
    if (now - stat.mtimeMs < minAgeMs) {
      kept.push(filePath);
      continue;
    }

    try {
      fs.unlinkSync(filePath);
      deleted.push(filePath);
    } catch (_) {
      // ENOENT (raced with the finally-unlink) or EPERM — count it as kept and
      // move on; a best-effort sweep never throws.
      kept.push(filePath);
    }
  }

  return { deleted, kept };
}

module.exports = {
  sweepOrphanedLiveSnapshots,
  LIVE_SNAPSHOT_NAME,
  DEFAULT_MIN_AGE_MS,
};

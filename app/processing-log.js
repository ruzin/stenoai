'use strict';

// Append-only, byte-counted, size-rotated diagnostic log. Pure fs/path (no
// Electron imports) so it is unit-testable in plain Node and the target dir is
// injected. Never throws to callers: every fs op is best-effort with a short
// cooldown after a failure so a persistent problem (locked file, full disk, AV
// scanner) doesn't cost a throw on every subsequent line. See spec
// docs/superpowers/specs/2026-06-19-processing-log-design.md.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024; // rotate at 5 MiB → net ≈ 10 MiB across 2 files
const LINE_CAP_BYTES = 8 * 1024; // truncate any single record to 8 KiB
const COOLDOWN_MS = 30 * 1000; // pause writes this long after an fs failure

let targetDir = null;
let logPath = null;
let backupPath = null;
let bytes = 0; // running byte total of the current file
let disabledUntil = 0; // epoch ms; writes are skipped until then

function _reset() {
  targetDir = null;
  logPath = null;
  backupPath = null;
  bytes = 0;
  disabledUntil = 0;
}

function init({ dir }) {
  targetDir = dir;
  logPath = path.join(dir, 'processing.log');
  backupPath = path.join(dir, 'processing.log.1');
  // Seed the byte counter from any existing file (once), so we don't lose the
  // bound across restarts.
  try {
    bytes = fs.statSync(logPath).size;
  } catch {
    bytes = 0;
  }
}

function disabled() {
  return Date.now() < disabledUntil;
}

function backoff() {
  disabledUntil = Date.now() + COOLDOWN_MS;
}

function ensureDir() {
  fs.mkdirSync(targetDir, { recursive: true });
}

function rotate() {
  // Windows renameSync fails if the target exists → pre-unlink the backup.
  try {
    fs.unlinkSync(backupPath);
  } catch {
    // no existing backup — fine
  }
  fs.renameSync(logPath, backupPath); // may throw → caller backs off
  bytes = 0;
}

function formatRecord(label, message) {
  let body = String(message);
  // Truncate by bytes so multi-byte content can't blow the cap.
  if (Buffer.byteLength(body, 'utf8') > LINE_CAP_BYTES) {
    // Slice generously by chars then hard-trim by bytes.
    body = body.slice(0, LINE_CAP_BYTES);
    while (Buffer.byteLength(body, 'utf8') > LINE_CAP_BYTES - 32) {
      body = body.slice(0, -16);
    }
    body += '…(truncated)';
  }
  return `[${new Date().toISOString()}] [${label}] ${body}\n`;
}

function writeRecord(record) {
  const lineBytes = Buffer.byteLength(record, 'utf8');
  if (bytes + lineBytes >= MAX_BYTES) {
    rotate();
  }
  fs.appendFileSync(logPath, record);
  bytes += lineBytes;
}

function logLine(label, message) {
  if (!logPath || disabled()) return;
  try {
    ensureDir();
    // One record per physical line in the message.
    const parts = String(message).split('\n');
    for (const part of parts) {
      writeRecord(formatRecord(label, part));
    }
  } catch {
    backoff();
  }
}

module.exports = { init, logLine, _reset };

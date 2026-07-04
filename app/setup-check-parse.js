'use strict';

// Parsing for `stenoai setup-check --json`.
//
// The backend emits one clean JSON object as the FINAL stdout line, but the
// checks it runs import third-party libraries (sounddevice, pywhispercpp,
// ollama, …) that can print unrelated chatter to stdout. So we can't assume the
// whole stdout buffer is JSON — we scan for the JSON payload and validate its
// schema before trusting it. This module is the single source of truth for that
// rule so the unit tests exercise exactly what production runs.

const VALID_STATUS = new Set(['pass', 'fail', 'warn']);

/**
 * Extract the setup-check JSON payload from a raw stdout buffer.
 *
 * Rule: the last non-empty line that JSON-parses to an object carrying a
 * boolean `allGood`. Scanning from the end tolerates leading import chatter;
 * requiring the `allGood` key avoids latching onto some other JSON line.
 *
 * @param {string} stdout
 * @returns {object|null} the parsed payload, or null if none matches.
 */
function extractSetupCheckPayload(stdout) {
  if (typeof stdout !== 'string') return null;
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line[0] !== '{') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.allGood === 'boolean') {
      return parsed;
    }
  }
  return null;
}

/**
 * Validate that a payload matches the setup-check contract:
 *   { allGood: boolean, checks: [{ name, ok, status, detail }, ...] }
 * with a non-empty checks array. A valid-but-wrong payload (e.g. `{}`) must be
 * treated as a broken backend, not a passing/empty "setup incomplete".
 *
 * @returns {boolean}
 */
function isValidSetupCheckPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.allGood !== 'boolean') return false;
  if (!Array.isArray(payload.checks) || payload.checks.length === 0) return false;
  return payload.checks.every(
    (c) =>
      c &&
      typeof c === 'object' &&
      typeof c.name === 'string' &&
      c.name.length > 0 &&
      typeof c.ok === 'boolean' &&
      typeof c.status === 'string' &&
      VALID_STATUS.has(c.status) &&
      typeof c.detail === 'string'
  );
}

/**
 * Extract + validate the setup-check payload from raw stdout, throwing on any
 * problem so callers can treat a malformed backend response as a failure.
 *
 * @param {string} stdout
 * @returns {{ allGood: boolean, checks: Array<{name:string, ok:boolean, status:string, detail:string}> }}
 */
function parseSetupCheckOutput(stdout) {
  const payload = extractSetupCheckPayload(stdout);
  if (payload === null) {
    throw new Error('setup-check produced no parseable JSON payload');
  }
  if (!isValidSetupCheckPayload(payload)) {
    throw new Error('setup-check JSON did not match the expected schema');
  }
  return { allGood: payload.allGood, checks: payload.checks };
}

module.exports = {
  extractSetupCheckPayload,
  isValidSetupCheckPayload,
  parseSetupCheckOutput,
};

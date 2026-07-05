'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  SHORTCUT_SESSION_NAME_MAX_LENGTH,
  extractShortcutUrlFromArgv,
  sanitizeShortcutUrlForLogs,
  sanitizeShortcutSessionName,
  parseShortcutUrl,
} = require('./shortcut-url');

// ---------------------------------------------------------------------------
// parseShortcutUrl — the untrusted-input boundary. A URL here is handed to the
// app by macOS (Shortcuts / open-url / argv) and is attacker-influenceable.
// ---------------------------------------------------------------------------

test('parseShortcutUrl accepts record/start and returns the sanitized name', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start?name=Standup'), {
    type: 'start',
    sessionName: 'Standup',
  });
});

test('parseShortcutUrl accepts record/stop', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/stop'), { type: 'stop' });
});

test('parseShortcutUrl decodes URL-encoded name values', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start?name=Team%20Sync%20%231'), {
    type: 'start',
    sessionName: 'Team Sync #1',
  });
});

test('parseShortcutUrl treats a missing name param as no name', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start'), {
    type: 'start',
    sessionName: null,
  });
});

test('parseShortcutUrl treats an empty name param as no name', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start?name='), {
    type: 'start',
    sessionName: null,
  });
});

test('parseShortcutUrl tolerates a trailing slash on the path', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start/'), {
    type: 'start',
    sessionName: null,
  });
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/stop//'), { type: 'stop' });
});

test('parseShortcutUrl rejects a foreign protocol (no cross-scheme hijack)', () => {
  assert.deepStrictEqual(parseShortcutUrl('https://record/start'), {
    type: 'invalid',
    reason: 'invalid-protocol',
  });
  assert.deepStrictEqual(parseShortcutUrl('file://record/stop'), {
    type: 'invalid',
    reason: 'invalid-protocol',
  });
  // A lookalike scheme must not pass.
  assert.deepStrictEqual(parseShortcutUrl('stenoai-evil://record/start'), {
    type: 'invalid',
    reason: 'invalid-protocol',
  });
});

test('parseShortcutUrl rejects a wrong host', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://evil/start'), {
    type: 'invalid',
    reason: 'invalid-host',
  });
});

test('parseShortcutUrl rejects an unknown action path', () => {
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/delete-everything'), {
    type: 'invalid',
    reason: 'invalid-path',
  });
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/'), {
    type: 'invalid',
    reason: 'invalid-path',
  });
});

test('parseShortcutUrl contains path-traversal within the record host and exact actions', () => {
  // The WHATWG URL parser normalizes ".." path segments, but that can never
  // change the host, so a traversal attempt stays scoped to record/* and only
  // an exact "/start" or "/stop" yields an action. A "/start/../stop" collapses
  // to the (still in-scope, benign) stop action; anything that normalizes to a
  // different path is rejected as invalid-path.
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start/../stop'), { type: 'stop' });
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/../../evil/start'), {
    type: 'invalid',
    reason: 'invalid-path',
  });
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/start/../../../etc'), {
    type: 'invalid',
    reason: 'invalid-path',
  });
  // A percent-encoded slash is NOT decoded into a path separator, so it can't
  // smuggle a second path segment past the exact-match check.
  assert.deepStrictEqual(parseShortcutUrl('stenoai://record/..%2Fstop'), {
    type: 'invalid',
    reason: 'invalid-path',
  });
});

test('parseShortcutUrl returns parse-error for a malformed URL and never throws', () => {
  assert.deepStrictEqual(parseShortcutUrl('not a url'), {
    type: 'invalid',
    reason: 'parse-error',
  });
  assert.deepStrictEqual(parseShortcutUrl(''), { type: 'invalid', reason: 'parse-error' });
  assert.deepStrictEqual(parseShortcutUrl(undefined), {
    type: 'invalid',
    reason: 'parse-error',
  });
  assert.deepStrictEqual(parseShortcutUrl(null), { type: 'invalid', reason: 'parse-error' });
});

test('parseShortcutUrl sanitizes a malicious name payload rather than passing it through', () => {
  const res = parseShortcutUrl(
    'stenoai://record/start?name=' + encodeURIComponent('../../etc/passwd'),
  );
  assert.strictEqual(res.type, 'start');
  // Slashes are stripped by the sanitizer, so no path fragment survives.
  assert.ok(!res.sessionName.includes('/'), `name still had a slash: ${res.sessionName}`);
});

// ---------------------------------------------------------------------------
// sanitizeShortcutSessionName — the string that becomes a folder/display name.
// ---------------------------------------------------------------------------

test('sanitizeShortcutSessionName returns null for non-strings', () => {
  assert.strictEqual(sanitizeShortcutSessionName(null), null);
  assert.strictEqual(sanitizeShortcutSessionName(undefined), null);
  assert.strictEqual(sanitizeShortcutSessionName(42), null);
  assert.strictEqual(sanitizeShortcutSessionName({}), null);
});

test('sanitizeShortcutSessionName returns null when nothing survives sanitizing', () => {
  assert.strictEqual(sanitizeShortcutSessionName(''), null);
  assert.strictEqual(sanitizeShortcutSessionName('   '), null);
  // All-forbidden input collapses to spaces, then trims to empty -> null.
  assert.strictEqual(sanitizeShortcutSessionName('/\\<>:*?"|'), null);
});

test('sanitizeShortcutSessionName preserves Unicode letters, marks and safe punctuation', () => {
  assert.strictEqual(sanitizeShortcutSessionName('Café Sync'), 'Café Sync');
  assert.strictEqual(sanitizeShortcutSessionName('Q3 Review (2026)'), 'Q3 Review (2026)');
  assert.strictEqual(sanitizeShortcutSessionName("O'Brien & co. #1"), "O'Brien & co. #1");
  assert.strictEqual(sanitizeShortcutSessionName('会議 メモ'), '会議 メモ');
});

test('sanitizeShortcutSessionName strips path separators and control characters', () => {
  assert.strictEqual(sanitizeShortcutSessionName('a/b\\c'), 'a b c');
  assert.strictEqual(sanitizeShortcutSessionName('name with\x00control'), 'name with control');
  assert.strictEqual(sanitizeShortcutSessionName('../../secret'), '.. .. secret');
});

test('sanitizeShortcutSessionName collapses runs of whitespace and trims', () => {
  assert.strictEqual(sanitizeShortcutSessionName('  hello    world  '), 'hello world');
  assert.strictEqual(sanitizeShortcutSessionName('tab\tand\nnewline'), 'tab and newline');
});

test('sanitizeShortcutSessionName caps the length', () => {
  const long = 'a'.repeat(SHORTCUT_SESSION_NAME_MAX_LENGTH + 50);
  const out = sanitizeShortcutSessionName(long);
  assert.strictEqual(out.length, SHORTCUT_SESSION_NAME_MAX_LENGTH);
});

// ---------------------------------------------------------------------------
// extractShortcutUrlFromArgv — cold-launch argv path.
// ---------------------------------------------------------------------------

test('extractShortcutUrlFromArgv finds the stenoai:// arg among other args', () => {
  const argv = ['/path/to/electron', '--flag', 'stenoai://record/start?name=Hi', 'x'];
  assert.strictEqual(extractShortcutUrlFromArgv(argv), 'stenoai://record/start?name=Hi');
});

test('extractShortcutUrlFromArgv returns undefined when no shortcut arg is present', () => {
  assert.strictEqual(extractShortcutUrlFromArgv(['/path/to/electron', '--flag']), undefined);
});

test('extractShortcutUrlFromArgv handles an empty/absent argv and non-string entries', () => {
  assert.strictEqual(extractShortcutUrlFromArgv(), undefined);
  assert.strictEqual(extractShortcutUrlFromArgv([]), undefined);
  assert.strictEqual(extractShortcutUrlFromArgv([null, 42, {}]), undefined);
});

test('extractShortcutUrlFromArgv only matches the stenoai:// scheme, not a lookalike', () => {
  assert.strictEqual(
    extractShortcutUrlFromArgv(['stenoai-evil://record/start']),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// sanitizeShortcutUrlForLogs — must never leak the query string (user name).
// ---------------------------------------------------------------------------

test('sanitizeShortcutUrlForLogs drops the query string so a name never reaches logs', () => {
  assert.strictEqual(
    sanitizeShortcutUrlForLogs('stenoai://record/start?name=Secret%20Project'),
    'stenoai://record/start',
  );
});

test('sanitizeShortcutUrlForLogs returns a fixed placeholder for an invalid URL', () => {
  assert.strictEqual(sanitizeShortcutUrlForLogs('not a url'), '[invalid-shortcut-url]');
  assert.strictEqual(sanitizeShortcutUrlForLogs(undefined), '[invalid-shortcut-url]');
});

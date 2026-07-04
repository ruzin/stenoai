'use strict';

/**
 * Pure parsing/sanitizing for the `stenoai://` deep-link surface.
 *
 * These functions are the app's untrusted-input boundary: a URL handed to the
 * app by macOS (Shortcuts, the open-url event, or argv on launch) is attacker-
 * influenceable, so the protocol/host checks and the session-name sanitizer are
 * security-relevant. They are kept pure (no Electron / app / BrowserWindow
 * dependency) and unit-tested here; the stateful side — window creation, IPC
 * dispatch, notifications — stays in main.js and calls parseShortcutUrl().
 *
 * Cross-platform: no platform-specific assumptions. The `stenoai://` scheme is
 * only *registered* on macOS today (see registerShortcutProtocolClient in
 * main.js), but the parsing itself is platform-agnostic.
 */

const SHORTCUT_PROTOCOL = 'stenoai';
const SHORTCUT_HOST = 'record';
const SHORTCUT_SESSION_NAME_MAX_LENGTH = 120;

// First argv entry that looks like our deep link (used on cold launch, where
// macOS passes the URL as a process argument instead of via open-url).
function extractShortcutUrlFromArgv(argv = []) {
  return argv.find(
    (arg) => typeof arg === 'string' && arg.startsWith(`${SHORTCUT_PROTOCOL}://`),
  );
}

// A log-safe rendering of the URL: protocol + host + path only, never the query
// string (which can carry a user-supplied meeting name). Invalid URLs collapse
// to a fixed placeholder so a malformed link can't smuggle content into logs.
function sanitizeShortcutUrlForLogs(incomingUrl) {
  try {
    const parsed = new URL(incomingUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch (error) {
    return '[invalid-shortcut-url]';
  }
}

// Reduce an arbitrary user-supplied session name to a safe, readable string.
// Preserves Unicode letters/marks/numbers and a small punctuation set; every
// other character (path separators, control chars, quotes, etc.) becomes a
// space, runs of whitespace collapse, and the result is length-capped. Returns
// null for a non-string or an empty post-sanitization result so callers fall
// back to a default name.
function sanitizeShortcutSessionName(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  // Keep user-visible names readable while stripping unsupported characters.
  // Preserve Unicode letters (including diacritics) and common punctuation.
  const sanitized = rawValue
    .replace(/[^\p{L}\p{M}\p{N}_\s.,()@&'!+#-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHORTCUT_SESSION_NAME_MAX_LENGTH);

  return sanitized || null;
}

// Parse a `stenoai://record/{start,stop}` deep link into an action descriptor.
// Rejects (type: 'invalid') anything with the wrong protocol, wrong host, an
// unknown path, or an unparseable URL — never throws. On /start, the `name`
// query param is run through sanitizeShortcutSessionName.
function parseShortcutUrl(incomingUrl) {
  try {
    const parsed = new URL(incomingUrl);
    if (parsed.protocol !== `${SHORTCUT_PROTOCOL}:`) {
      return { type: 'invalid', reason: 'invalid-protocol' };
    }

    if (parsed.hostname !== SHORTCUT_HOST) {
      return { type: 'invalid', reason: 'invalid-host' };
    }

    const cleanPath = (parsed.pathname || '').replace(/\/+$/, '');
    if (cleanPath === '/start') {
      const sessionName = sanitizeShortcutSessionName(parsed.searchParams.get('name') || '');
      return {
        type: 'start',
        sessionName,
      };
    }

    if (cleanPath === '/stop') {
      return { type: 'stop' };
    }

    return { type: 'invalid', reason: 'invalid-path' };
  } catch (error) {
    return { type: 'invalid', reason: 'parse-error' };
  }
}

module.exports = {
  SHORTCUT_PROTOCOL,
  SHORTCUT_HOST,
  SHORTCUT_SESSION_NAME_MAX_LENGTH,
  extractShortcutUrlFromArgv,
  sanitizeShortcutUrlForLogs,
  sanitizeShortcutSessionName,
  parseShortcutUrl,
};

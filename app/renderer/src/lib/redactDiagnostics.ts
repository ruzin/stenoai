// Pure, side-effect-free redaction for the shareable debug log.
//
// This is defense-in-depth on top of PR1's source reduction: even the
// allowlisted diagnostic lines still carry paths (the `SAVED:<path>` lines and
// the reprocess/report command echoes embed a title-derived filename) and URLs
// (remote-ollama / cloud-api / org-adapter hostnames, possibly with
// `user:pass@` credentials). `redactDiagnostics` scrubs those at egress so both
// the Copy button and the "Save diagnostics" export are safe to share.
//
// Design: we redact by matching OUR OWN controlled directory structure
// (`recordings/`, `transcripts/`, `output/`) and well-formed URLs, not by
// guessing which free-text token is a meeting title. Rules are applied per line
// in an order chosen so each stage can't re-expose what a later stage would
// hide, and the whole function is idempotent
// (`redact(redact(x)) === redact(x)`).

export interface RedactOptions {
  /**
   * The user's custom storage root, when configured (`custom_path` from
   * `get-storage-path`). It may live outside the home dir (e.g.
   * `/Volumes/NAS/steno`), so the home-dir rule can't catch it - we replace the
   * literal string with `~`. Empty/undefined means the default (under home),
   * which the home-dir rule already handles.
   */
  storageRoot?: string;
}

// The three data sub-directories we own under the storage root. A path segment
// under any of these has a meeting-title-derived basename we must redact.
const DATA_DIRS = ['recordings', 'transcripts', 'output'];
const DATA_DIR_ALT = DATA_DIRS.join('|');

// Characters that terminate a path token in free text (whitespace, quotes,
// closing brackets, and common trailing punctuation). Used as a lookahead so a
// path embedded mid-line is bounded without consuming the delimiter.
const TOKEN_END = `[\\s"'\`)\\]},;]`;

// scheme://[user:pass@]host[:port][/path...] -> scheme://host[:port]
// Keeps the scheme + host (+ port) for diagnosis, strips credentials and the
// path/query that could carry identifiers. Requires a real host char after
// `://` so `file:///Users/...` (triple slash) is left for the path rules.
const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/(?:[^/@\s]*@)?([^/\s:]+(?::\d+)?)[^\s]*/gi;

// macOS home: /Users/<name>/ -> ~/   (any username)
const MAC_HOME_RE = /\/Users\/[^/\\]+\//gi;
// Windows home: C:\Users\<name>\ -> ~\   (case-insensitive drive + "Users")
const WIN_HOME_RE = /[A-Za-z]:\\Users\\[^\\]+\\/gi;

// A data-dir path segment with a file extension, possibly containing spaces and
// unicode in the basename: `.../output/Weekly Team Sync_report.md`. We anchor on
// a preceding separator + the known dir, redact the basename (no separators),
// and keep the final `.<ext>`. Lazy basename so the extension is the LAST dotted
// group before a token boundary.
const DATA_DIR_WITH_EXT_RE = new RegExp(
  `([/\\\\](?:${DATA_DIR_ALT})[/\\\\])([^/\\\\]*?)(\\.[A-Za-z0-9]+)(?=$|${TOKEN_END})`,
  'gi',
);

// A data-dir path segment with NO extension and NO spaces: `.../recordings/foo`.
// The basename excludes separators, whitespace, token-enders AND dots, and the
// lookahead forbids a following dot - so this never touches an already-extension
// redaction (`.../recordings/<redacted>.webm`) and keeps it idempotent. A
// space-containing basename with no extension is the documented, accepted
// residual (best-effort): matching it here would only redact its first word, so
// we deliberately leave it whole rather than partially mangle it.
const DATA_DIR_NO_EXT_RE = new RegExp(
  `([/\\\\](?:${DATA_DIR_ALT})[/\\\\])([^/\\\\\\s"'\`)\\]},;.]+)(?=$|${TOKEN_END})`,
  'gi',
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactLine(line: string, storageRoot?: string): string {
  let out = line;

  // 1. URLs first: strip credentials + path so the path rules below never see a
  //    URL's internals (and can't mistake a URL path for a filesystem path).
  out = out.replace(URL_RE, (_m, scheme: string, host: string) => `${scheme}://${host}`);

  // 2. Custom storage root literal -> ~ (before home, so a root that itself
  //    lives under home is hidden whole rather than left as ~/<folder>).
  if (typeof storageRoot === 'string' && storageRoot.length > 0) {
    out = out.replace(new RegExp(escapeRegExp(storageRoot), 'g'), '~');
  }

  // 3. Home dir -> ~ (both platforms). Covers the default app-support path too.
  out = out.replace(MAC_HOME_RE, '~/');
  out = out.replace(WIN_HOME_RE, '~\\');

  // 4. Data-dir basenames -> <redacted>.<ext>. Extension case first, then the
  //    no-extension single-token case (mutually exclusive by construction).
  out = out.replace(DATA_DIR_WITH_EXT_RE, '$1<redacted>$3');
  out = out.replace(DATA_DIR_NO_EXT_RE, '$1<redacted>');

  return out;
}

/**
 * Redact each line for safe sharing. Pure - returns a new array, mutates
 * nothing. Idempotent: `redactDiagnostics(redactDiagnostics(x))` equals
 * `redactDiagnostics(x)`.
 */
export function redactDiagnostics(lines: string[], opts: RedactOptions = {}): string[] {
  const storageRoot = opts.storageRoot;
  return lines.map((line) => redactLine(line, storageRoot));
}

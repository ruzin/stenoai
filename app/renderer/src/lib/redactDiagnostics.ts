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
//
// Accepted residuals (documented, out of scope for regex):
//  - A scheme-less BARE hostname with no credentials (e.g. `ollama.corp:11434`)
//    is left as-is: it's an internal hostname, not a secret, and fully hiding it
//    would need the Python source to stop logging it (deferred out of this PR).
//  - Nested sub-directories under a data dir (`.../output/Team/Sync.md`) are NOT
//    matched: stenoai writes FLAT data dirs so this isn't currently produced,
//    but it's a known limitation of the separator-anchored basename rules.
//  - A space-containing data-dir path with NO extension that runs mid-line into
//    following prose with no delimiter is best-effort: the common end-of-line /
//    quoted / delimited forms fully redact.

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

// Characters (inside a char class) that terminate a path token in free text:
// whitespace, quotes, closing brackets, and common trailing punctuation.
const TOKEN_END_CHARS = `\\s"'\`)\\]},;`;
// Used as a lookahead so a path embedded mid-line is bounded without consuming
// the delimiter.
const TOKEN_END = `[${TOKEN_END_CHARS}]`;
// The same terminators EXCLUDING whitespace. A data-dir basename may legitimately
// contain spaces (meeting titles do), so for the no-extension case only these
// strong terminators (or a separator / end-of-line) end the basename.
const STRONG_TERM = `"'\`)\\]},;`;

// scheme://[user:pass@]host[:port][/path...] -> scheme://host[:port]
// Keeps the scheme + host (+ port) for diagnosis, strips credentials and the
// path/query that could carry identifiers. Requires a real host char after
// `://` so `file:///Users/...` (triple slash) is left for the path rules. The
// trailing path match is bounded by the token-end set (not `[^\s]*`) so a URL
// embedded in JSON/quoted text can't swallow the following field or path.
const URL_RE = new RegExp(
  `\\b([a-z][a-z0-9+.-]*):\\/\\/(?:[^/@${TOKEN_END_CHARS}]*@)?([^/:${TOKEN_END_CHARS}]+(?::\\d+)?)[^${TOKEN_END_CHARS}]*`,
  'gi',
);

// Scheme-less credentials: `user[:pass]@host[:port][/path?query]` with NO
// `scheme://`, as the Python summarizer can log on stderr. We strip the
// `user[:pass]@` AND the trailing path/query (symmetric with the scheme'd URL
// rule, which keeps only scheme://host - so a `?token=SECRET` can't leak),
// keeping just `host[:port]`. To avoid eating ordinary `word@word` prose, the
// part after `@` must look like a host: either a dotted domain (`host.tld`,
// optional `:port`) or a bare host WITH a port (`host:11434`). A bare
// dot-less/port-less host is left alone. The trailing match is bounded by the
// token-end set so it can't swallow across a quote/JSON delimiter.
const SCHEMELESS_CREDS_RE = new RegExp(
  `([A-Za-z0-9._%+-]+(?::[^\\s@/]+)?)@((?:[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+(?::\\d+)?|[A-Za-z0-9-]+:\\d+))[^${TOKEN_END_CHARS}]*`,
  'g',
);

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

// A data-dir path segment with NO extension: `.../recordings/Weekly Sync`. The
// basename is GREEDY and INCLUDES internal spaces, stopping only at a separator,
// a strong terminator (quote/bracket/`,`/`;`) or end-of-line - so a space-
// containing title is redacted WHOLE (not just its first word). Dots are
// excluded from the basename and the lookahead has no dot, so this never touches
// an already-extension redaction (`.../recordings/<redacted>.webm`) nor a real
// extensioned file (both handled by DATA_DIR_WITH_EXT_RE, which runs first),
// keeping the pass idempotent.
const DATA_DIR_NO_EXT_RE = new RegExp(
  `([/\\\\](?:${DATA_DIR_ALT})[/\\\\])([^/\\\\${STRONG_TERM}.]+)(?=$|${TOKEN_END})`,
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

  // 1b. Scheme-less credentials (`user:pass@host[:port]`) the URL rule can't see
  //     because there's no scheme. Runs after the URL rule (which already
  //     stripped scheme'd creds, leaving no `@`), so the two never overlap.
  out = out.replace(SCHEMELESS_CREDS_RE, (_m, _creds: string, host: string) => host);

  // 2. Custom storage root literal -> ~ (before home, so a root that itself
  //    lives under home is hidden whole rather than left as ~/<folder>). Strip
  //    any trailing separator first: replacing `/Volumes/x/steno/` wholesale
  //    would yield `~output/...` (no separator), which the data-dir rule can't
  //    match - stripping it leaves `~/output/...` so the basename still redacts.
  if (typeof storageRoot === 'string' && storageRoot.length > 0) {
    const root = storageRoot.replace(/[/\\]+$/, '');
    if (root.length > 0) {
      out = out.replace(new RegExp(escapeRegExp(root), 'g'), '~');
    }
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

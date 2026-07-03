'use strict';

// A child process's stdout 'data' event carries an arbitrary byte slice,
// not necessarily a whole line — under load (e.g. the main process busy
// re-rendering while a summary streams in) a protocol line's boundary can
// land inside a chunk, or a \r\n pair can straddle two chunks entirely.
// makeLineReader() accumulates a remainder across feed() calls so callers
// never see a split line or a sentinel with a stray trailing \r.
function makeLineReader() {
  let buf = '';
  return {
    feed(chunk) {
      buf += chunk.toString();
      // CRLF-tolerant: Windows stdout is \r\n, and an exact-match sentinel
      // like 'STREAM_COMPLETE' would otherwise carry a trailing \r and
      // never match. A \r left dangling at the end of buf (no \n yet)
      // correctly stays in buf until the matching \n arrives in a later
      // feed() call.
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      return lines;
    },
  };
}

module.exports = { makeLineReader };

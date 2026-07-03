const { test } = require('node:test');
const assert = require('node:assert');

const { makeLineReader } = require('./backend-stream');

test('feed() returns complete lines and holds an incomplete trailing piece', () => {
  const reader = makeLineReader();
  assert.deepStrictEqual(reader.feed('SAVED:foo\nCHUNK:ab'), ['SAVED:foo']);
});

test('feed() completes a line that was split mid-token across two chunks', () => {
  const reader = makeLineReader();
  assert.deepStrictEqual(reader.feed('CHUNK:ab'), []);
  assert.deepStrictEqual(reader.feed('cd\nSTREAM_COMPLETE\n'), ['CHUNK:abcd', 'STREAM_COMPLETE']);
});

test('feed() handles a CRLF split across chunks (the exact-match sentinel bug case)', () => {
  // Chunk 1 ends with \r but no \n yet; chunk 2 starts with \n. A naive
  // per-event split (e.g. text.split(/\r?\n/) called separately on each
  // chunk) would see the first chunk's trailing "...STREAM_COMPLETE\r" as
  // a single unterminated line and process-streaming/reprocess's own
  // per-event .forEach would emit it verbatim — 'STREAM_COMPLETE\r' does
  // NOT === 'STREAM_COMPLETE', so the completion event is silently dropped.
  // makeLineReader() instead holds the dangling \r in its buffer across the
  // feed() call boundary until the matching \n arrives in the next chunk.
  const reader = makeLineReader();
  assert.deepStrictEqual(reader.feed('SAVED:x\r\nSTREAM_COMPLETE\r'), ['SAVED:x']);
  assert.deepStrictEqual(reader.feed('\nSAVED:y\r\n'), ['STREAM_COMPLETE', 'SAVED:y']);
});

test('feed() returns multiple lines delivered in a single chunk', () => {
  const reader = makeLineReader();
  assert.deepStrictEqual(
    reader.feed('TITLE:a\nPROGRESS:1\nPROGRESS:2\n'),
    ['TITLE:a', 'PROGRESS:1', 'PROGRESS:2'],
  );
});

test('feed() returns an empty array for a chunk with no newline yet', () => {
  const reader = makeLineReader();
  assert.deepStrictEqual(reader.feed('HEARTBEAT:12'), []);
});

test('feed() accepts a Buffer, not just a string', () => {
  const reader = makeLineReader();
  assert.deepStrictEqual(reader.feed(Buffer.from('STREAM_COMPLETE\n')), ['STREAM_COMPLETE']);
});

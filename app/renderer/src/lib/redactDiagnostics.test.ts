import { describe, test, expect } from 'vitest';
import { redactDiagnostics } from '@/lib/redactDiagnostics';

// Redaction is defense-in-depth on top of PR1's source reduction. These tests
// pin the four rules (home dir both platforms, custom storage root, data-dir
// basename, URL host-masking), idempotence, and - just as important - that
// ordinary prose is left untouched. Each `redact` helper redacts a single line.
const redact = (line: string, storageRoot?: string): string =>
  redactDiagnostics([line], { storageRoot })[0];

describe('redactDiagnostics - home dir', () => {
  test('macOS /Users/<name>/ -> ~/ (any username, generically)', () => {
    expect(redact('SAVED:/Users/alice/Documents/notes.txt')).toBe('SAVED:~/Documents/notes.txt');
    expect(redact('opened /Users/bob.smith/thing')).toBe('opened ~/thing');
  });

  test('the default app-support path collapses under home', () => {
    expect(
      redact('SAVED:/Users/alice/Library/Application Support/stenoai/output/x.md'),
    ).toBe('SAVED:~/Library/Application Support/stenoai/output/<redacted>.md');
  });

  test('Windows C:\\Users\\<name>\\ -> ~\\ (case-insensitive drive)', () => {
    expect(redact('SAVED:C:\\Users\\Alice\\Documents\\notes.txt')).toBe(
      'SAVED:~\\Documents\\notes.txt',
    );
    expect(redact('path d:\\Users\\bob\\thing')).toBe('path ~\\thing');
  });
});

describe('redactDiagnostics - custom storage root', () => {
  test('literal storage root outside home -> ~', () => {
    const root = '/Volumes/NAS/steno';
    expect(redact(`SAVED:${root}/recordings/Weekly Sync.webm`, root)).toBe(
      'SAVED:~/recordings/<redacted>.webm',
    );
  });

  test('storage root is regex-escaped (special chars are literal)', () => {
    const root = '/Volumes/My (Backup)/steno+data';
    expect(redact(`at ${root}/output/report.md end`, root)).toBe(
      'at ~/output/<redacted>.md end',
    );
  });

  test('storage root under home is hidden whole (root rule runs before home)', () => {
    const root = '/Users/alice/steno-data';
    expect(redact(`SAVED:${root}/transcripts/Board Meeting.txt`, root)).toBe(
      'SAVED:~/transcripts/<redacted>.txt',
    );
  });

  test('empty storage root is a no-op', () => {
    expect(redact('nothing here', '')).toBe('nothing here');
  });

  test('trailing-slash storage root still lets the data-dir rule redact', () => {
    // Without stripping the trailing slash the literal replace yields
    // `~output/Board.md` (no separator) and the basename survives.
    const root = '/Volumes/Client Acme/steno/';
    expect(redact(`SAVED:${root}output/Board.md`, root)).toBe(
      'SAVED:~/output/<redacted>.md',
    );
  });
});

describe('redactDiagnostics - data-dir basename', () => {
  test('basename with spaces, extension preserved (output)', () => {
    expect(redact('SAVED:/Users/alice/x/output/Weekly Team Sync_report.md')).toBe(
      'SAVED:~/x/output/<redacted>.md',
    );
  });

  test('basename with spaces + unicode (recordings)', () => {
    expect(redact('SAVED:/Users/alice/x/recordings/sysaudio-1783-Wöchentliche Besprechung.webm')).toBe(
      'SAVED:~/x/recordings/<redacted>.webm',
    );
  });

  test('transcripts dir, quoted command echo', () => {
    expect(redact('$ stenoai reprocess "/Users/alice/x/transcripts/Board Meeting Q3.txt"')).toBe(
      '$ stenoai reprocess "~/x/transcripts/<redacted>.txt"',
    );
  });

  test('multi-dot basename keeps only the final extension', () => {
    expect(redact('SAVED:/Users/a/x/output/report.v2.final.json')).toBe(
      'SAVED:~/x/output/<redacted>.json',
    );
  });

  test('no-extension single-token basename is redacted to <redacted>', () => {
    expect(redact('SAVED:/Users/a/x/recordings/rawclip')).toBe(
      'SAVED:~/x/recordings/<redacted>',
    );
  });

  test('no-extension basename WITH spaces redacts whole (end-of-line)', () => {
    expect(redact('SAVED:/Users/a/x/output/Weekly Sync')).toBe(
      'SAVED:~/x/output/<redacted>',
    );
  });

  test('no-extension basename WITH spaces redacts whole (quoted)', () => {
    expect(redact('reprocess "/Users/a/x/output/Weekly Sync"')).toBe(
      'reprocess "~/x/output/<redacted>"',
    );
  });

  test('no-extension basename WITH spaces redacts whole (followed by ;)', () => {
    expect(redact('path=/Users/a/x/transcripts/Board Meeting Q3;next')).toBe(
      'path=~/x/transcripts/<redacted>;next',
    );
  });

  test('does not touch a similarly-named word without a leading separator', () => {
    expect(redact('the throughput/output ratio')).toBe('the throughput/output ratio');
  });
});

describe('redactDiagnostics - URLs', () => {
  test('strips user:pass@ credentials and path, keeps scheme+host+port', () => {
    expect(redact('POST https://alice:secret@ollama.corp.internal:11434/api/x')).toBe(
      'POST https://ollama.corp.internal:11434',
    );
  });

  test('host-only URL with a path is reduced to scheme+host', () => {
    expect(redact('GET http://ollama.corp.internal/api/tags?x=1')).toBe(
      'GET http://ollama.corp.internal',
    );
  });

  test('plain host+port with no path is preserved as-is', () => {
    expect(redact('remote https://ollama.corp.internal:11434')).toBe(
      'remote https://ollama.corp.internal:11434',
    );
  });

  test('URL inside JSON does not swallow the following field or path', () => {
    expect(
      redact('{"url":"https://u:p@host/api","path":"/Users/a/x/output/Board.md"}'),
    ).toBe('{"url":"https://host","path":"~/x/output/<redacted>.md"}');
  });
});

describe('redactDiagnostics - scheme-less credentials', () => {
  test('strips user:pass@ before a host:port even without a scheme', () => {
    expect(redact('connecting alice:secret@ollama.corp:11434/x')).toBe(
      'connecting ollama.corp:11434/x',
    );
  });

  test('strips user@ before a dotted host without a port', () => {
    expect(redact('login bob@ollama.corp.internal/api')).toBe('login ollama.corp.internal/api');
  });

  test('leaves ordinary word@word prose untouched (no host-shape after @)', () => {
    expect(redact('see foo@bar in the log')).toBe('see foo@bar in the log');
  });
});

describe('redactDiagnostics - idempotence + no over-redaction', () => {
  test('redact(redact(x)) === redact(x)', () => {
    const lines = [
      'SAVED:/Users/alice/Library/Application Support/stenoai/output/Weekly Team Sync_report.md',
      'POST https://alice:secret@ollama.corp.internal:11434/api/x',
      'SAVED:C:\\Users\\Alice\\x\\recordings\\Board Meeting.webm',
      'SAVED:/Volumes/NAS/steno/transcripts/Standup.txt',
      'SAVED:/Volumes/NAS/steno/output/Weekly Sync',
      'connecting alice:secret@ollama.corp:11434/x',
      '{"url":"https://u:p@host/api","path":"/Volumes/NAS/steno/output/Board.md"}',
    ];
    const opts = { storageRoot: '/Volumes/NAS/steno/' };
    const once = redactDiagnostics(lines, opts);
    const twice = redactDiagnostics(once, opts);
    expect(twice).toEqual(once);
  });

  test('ordinary prose is left completely untouched', () => {
    expect(redact('the quick brown fox jumps over the lazy dog')).toBe(
      'the quick brown fox jumps over the lazy dog',
    );
    expect(redact('HEARTBEAT: 42s elapsed, exit code 0')).toBe(
      'HEARTBEAT: 42s elapsed, exit code 0',
    );
  });

  test('returns a new array, does not mutate the input', () => {
    const input = ['/Users/alice/x'];
    const out = redactDiagnostics(input);
    expect(input).toEqual(['/Users/alice/x']);
    expect(out).toEqual(['~/x']);
  });
});

import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeMeetingSummary } from '../fixtures/user-config';
import { readFileSync, existsSync, statSync, rmSync } from 'fs';
import path from 'path';

/**
 * T2 - the real `share-note-file` IPC. It materialises a note into the managed
 * share temp directory and would then pop the native macOS sheet; under IS_E2E
 * it stops after the write and returns the path, because a native share sheet
 * cannot be automated (Playwright can neither see nor dismiss it, and an open
 * sheet would block the run). So this spec owns exactly the part that can be
 * checked by machine: the directory, the filename and the bytes.
 *
 * What no automated test covers, here or anywhere: that the sheet opens, that
 * Mail accepts the attachment, and that the recipient sees a usable filename.
 * That is manual acceptance on the packaged build and must not be reported as
 * covered.
 *
 * Cleanup is explicit: the share directory lives under the OS temp path, NOT
 * under STENOAI_USER_DATA_DIR, so the per-test data dir being thrown away does
 * not reclaim these files.
 */

type ShareResult = { success: boolean; error?: string; path?: string };
type StenoWindow = Window & {
  stenoai: {
    share: {
      canShare: () => Promise<boolean>;
      shareFile: (
        kind: string,
        defaultFilename: string,
        payload: string,
        anchor: { x: number; y: number },
      ) => Promise<ShareResult>;
    };
  };
};

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Epsilon</title></head>' +
  '<body><h1>Epsilon Planning</h1><p>The team agreed to ship on Friday.</p></body></html>';

const MARKDOWN = '# Epsilon Planning\n\n## Summary\n\nThe team agreed to ship on Friday.\n';

const ANCHOR = { x: 100, y: 200 };

// Every path the handler reports back, so one place removes them all even when
// an assertion fails part way through.
const written: string[] = [];
const share = (
  page: import('@playwright/test').Page,
  kind: string,
  filename: string,
  payload: string,
) =>
  page
    .evaluate(
      ([k, f, p, a]) =>
        (window as StenoWindow).stenoai.share.shareFile(
          k as string,
          f as string,
          p as string,
          a as { x: number; y: number },
        ),
      [kind, filename, payload, ANCHOR] as const,
    )
    .then((res) => {
      if (res.path) written.push(res.path);
      return res;
    });

test.afterEach(() => {
  for (const file of written.splice(0)) {
    rmSync(file, { force: true });
  }
});

test('share-note-file writes a real PDF into the share temp directory', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  writeMeetingSummary(userDataDir, 'epsilon', {
    name: 'Epsilon Planning',
    transcript: 'Alice: we ship Friday.',
  });

  const { page } = await launchApp();
  const res = await share(page, 'pdf', '2026-07-30-epsilon-planning.pdf', HTML);

  expect(res.success).toBe(true);
  expect(res.path).toBeTruthy();
  const file = res.path!;
  // The managed directory, and the dated slug kept verbatim: this filename is
  // what the recipient of the attachment reads, so it is deliberately not
  // given a random suffix.
  expect(path.dirname(file).endsWith(path.join('stenoai-share'))).toBe(true);
  expect(path.basename(file)).toBe('2026-07-30-epsilon-planning.pdf');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(statSync(file).size).toBeGreaterThan(500);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('share-note-file writes text verbatim as UTF-8', async ({ launchApp }) => {
  const { page } = await launchApp();
  const res = await share(page, 'text', '2026-07-30-epsilon-planning-notes.md', MARKDOWN);

  expect(res.success).toBe(true);
  const file = res.path!;
  expect(path.basename(file)).toBe('2026-07-30-epsilon-planning-notes.md');
  // Byte for byte, not "contains": the markdown builder's output is the
  // contract, and re-encoding it would corrupt a note's own formatting.
  expect(readFileSync(file, 'utf-8')).toBe(MARKDOWN);
});

test('the notes and transcript names do not collide in the shared directory', async ({
  launchApp,
}) => {
  // Both are .md and both land in ONE directory, so identical names would mean
  // the second share silently replaces the first - including under an already
  // open mail draft, whose attachment would quietly become the other document.
  const { page } = await launchApp();
  const notes = await share(page, 'text', '2026-07-30-epsilon-planning-notes.md', MARKDOWN);
  const transcript = await share(page, 'text', '2026-07-30-epsilon-planning.md', '# Transcript\n');

  expect(notes.success && transcript.success).toBe(true);
  expect(notes.path).not.toBe(transcript.path);
  expect(readFileSync(notes.path!, 'utf-8')).toBe(MARKDOWN);
  expect(readFileSync(transcript.path!, 'utf-8')).toBe('# Transcript\n');
});

test('a suggested filename cannot escape the share directory', async ({ launchApp }) => {
  const { page } = await launchApp();

  // The renderer never supplies a path, but it is untrusted: unlike the export
  // handlers - where the reduced name only seeds a dialog the user confirms -
  // this one is joined onto a directory we write into.
  const traversal = await share(page, 'text', '../../../evil.md', 'x');
  expect(traversal.success).toBe(true);
  expect(path.basename(traversal.path!)).toBe('evil.md');
  expect(path.dirname(traversal.path!).endsWith(path.join('stenoai-share'))).toBe(true);

  // A name that reduces to a bare directory component falls back instead of
  // resolving to the directory itself.
  const dotdot = await share(page, 'text', '..', 'x');
  expect(dotdot.success).toBe(true);
  expect(path.basename(dotdot.path!)).toBe('notes.md');
});

test('share-note-file refuses empty content and an unknown kind without writing', async ({
  launchApp,
}) => {
  const { page } = await launchApp();

  const empty = await share(page, 'text', 'empty.md', '');
  expect(empty.success).toBe(false);
  expect(empty.path).toBeUndefined();

  const badKind = await share(page, 'jpeg', 'weird.jpeg', 'x');
  expect(badKind.success).toBe(false);
  expect(badKind.path).toBeUndefined();
});

test('the share capability follows the platform, not the user agent', async ({ launchApp }) => {
  const { page } = await launchApp();
  const canShare = await page.evaluate(() =>
    (window as StenoWindow).stenoai.share.canShare(),
  );

  // Electron exposes ShareMenu on darwin only. This is also the guard against a
  // future Electron dropping the export: it would fail here rather than crash
  // the main process on `new undefined(...)`.
  expect(canShare).toBe(process.platform === 'darwin');
});

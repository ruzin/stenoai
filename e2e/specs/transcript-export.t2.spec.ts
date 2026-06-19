import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeMeetingSummary } from '../fixtures/user-config';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T2 — transcript export. Drives the real backend's `export-transcript` IPC and
 * asserts the bundle is written to disk. The native save dialog is bypassed via
 * STENOAI_E2E_EXPORT_PATH (same isolation philosophy as STENOAI_USER_DATA_DIR),
 * so this stays hermetic and model-free. The renderer-side bundle FORMAT is
 * verified separately by typecheck + manual smoke; this spec owns the only new
 * backend code (the file-writing handler).
 */

type Result = { success: boolean; error?: string; path?: string };
type StenoWindow = Window & {
  stenoai: {
    meetings: {
      exportTranscript: (defaultFilename: string, content: string) => Promise<Result>;
    };
  };
};

test('export-transcript writes the given content to the env-seam path', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // A meeting must exist for the feature to be meaningful, though the handler
  // writes whatever content the renderer passes.
  writeMeetingSummary(userDataDir, 'epsilon', {
    name: 'Epsilon Planning',
    transcript: 'Alice: we ship Friday.\nBob: I will prep the release notes.',
  });

  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-export-'));
  const outFile = path.join(outDir, 'epsilon.md');

  const { page } = await launchApp({ env: { STENOAI_E2E_EXPORT_PATH: outFile } });

  const bundle =
    '# Epsilon Planning\nDatum: 2026-06-19\n\n## Transkript\n' +
    'Alice: we ship Friday.\nBob: I will prep the release notes.';

  const res = await page.evaluate(
    (b) => (window as StenoWindow).stenoai.meetings.exportTranscript('epsilon.md', b),
    bundle,
  );

  try {
    expect(res.success).toBe(true);
    expect(res.path).toBe(outFile);
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, 'utf8')).toBe(bundle);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

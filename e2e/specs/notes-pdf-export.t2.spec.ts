import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeMeetingSummary } from '../fixtures/user-config';
import { readFileSync, existsSync, statSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T2 — notes PDF export. Drives the real backend's `export-note-pdf` IPC, which
 * rasterises the renderer-built HTML to a PDF via an offscreen BrowserWindow and
 * writes it to disk. The native save dialog is bypassed via
 * STENOAI_E2E_EXPORT_PATH (same isolation philosophy as STENOAI_USER_DATA_DIR),
 * so this stays hermetic and model-free (no ASR / no Ollama). The renderer-side
 * HTML FORMAT is covered by the unit test + the T1 spec; this spec owns the only
 * new backend code — the HTML→PDF render + file write.
 */

type Result = { success: boolean; error?: string; path?: string };
type StenoWindow = Window & {
  stenoai: {
    meetings: {
      exportNotePdf: (defaultFilename: string, html: string) => Promise<Result>;
    };
  };
};

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Epsilon</title>' +
  '<style>@page{size:A4;margin:16mm}body{font-family:sans-serif;color:#1B1B19}</style>' +
  '</head><body><h1>Epsilon Planning</h1><p>The team agreed to ship on Friday.</p></body></html>';

test('export-note-pdf renders the given HTML to a valid PDF at the env-seam path', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // A meeting must exist for the feature to be meaningful, though the handler
  // renders whatever HTML the renderer passes.
  writeMeetingSummary(userDataDir, 'epsilon', {
    name: 'Epsilon Planning',
    transcript: 'Alice: we ship Friday.',
  });

  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-pdf-'));
  const outFile = path.join(outDir, 'epsilon.pdf');

  const { page } = await launchApp({ env: { STENOAI_E2E_EXPORT_PATH: outFile } });

  const res = await page.evaluate(
    (h) => (window as StenoWindow).stenoai.meetings.exportNotePdf('epsilon.pdf', h),
    HTML,
  );

  try {
    expect(res.success).toBe(true);
    expect(res.path).toBe(outFile);
    expect(existsSync(outFile)).toBe(true);
    // A real, non-empty PDF: the %PDF- magic header and a non-trivial size.
    const bytes = readFileSync(outFile);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(statSync(outFile).size).toBeGreaterThan(500);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('export-note-pdf rejects empty content without writing a file', async ({ launchApp }) => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-pdf-empty-'));
  const outFile = path.join(outDir, 'empty.pdf');
  const { page } = await launchApp({ env: { STENOAI_E2E_EXPORT_PATH: outFile } });

  const res = await page.evaluate(() =>
    (window as StenoWindow).stenoai.meetings.exportNotePdf('empty.pdf', ''),
  );

  try {
    expect(res.success).toBe(false);
    expect(existsSync(outFile)).toBe(false);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

import { test, expect } from '../fixtures/electron';
import type { Page } from '@playwright/test';
import { readFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T1 — renderer-only, mock IPC, no backend. Drives the REAL MeetingDetail
 * "Save notes as PDF…" action against a seeded meeting, proving the renderer
 * BUILDS the branded HTML document from meeting data and WIRES it to the
 * export-note-pdf channel. The T2 spec proves the real handler rasterises that
 * HTML into a valid PDF; the HTML *content* (sections, escaping, brand chrome)
 * is asserted here, where the mock writes the received HTML verbatim to the
 * STENOAI_E2E_EXPORT_PATH seam.
 */

const SUMMARY_FILE = 'epsilon_summary.json';

async function openDetail(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toBeVisible();
}

test('Save notes as PDF passes the renderer-built branded HTML to export-note-pdf', async ({
  launchApp,
}) => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-pdf-t1-'));
  const outFile = path.join(outDir, 'notes.html');
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_EXPORT_PATH: outFile },
  });

  try {
    await openDetail(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: /Save notes as PDF/ }).click();

    await expect
      .poll(
        () => {
          try {
            return readFileSync(outFile, 'utf8');
          } catch {
            return '';
          }
        },
        { timeout: 10_000, intervals: [200] },
      )
      .toContain('<!doctype html>');

    const html = readFileSync(outFile, 'utf8');

    // It's a complete, self-contained HTML document with the brand chrome.
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<h1>Epsilon Planning</h1>');
    expect(html).toContain('@font-face');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('www.stenoai.co');
    // The seeded meeting's structured note carried through.
    expect(html).toContain('>Summary</h2>');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

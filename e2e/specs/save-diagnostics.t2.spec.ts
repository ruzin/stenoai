import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T2 — the real `save-diagnostics` main-process handler. Drives the preload
 * bridge (`window.stenoai.settings.saveDiagnostics`) and asserts the handler
 * atomic-writes exactly the string it's handed, and rejects empty content.
 * Model-free, no backend subprocess (the handler is pure Electron dialog + fs).
 *
 * The redaction + env-header build live in the renderer and are unit-tested
 * (`renderer/src/lib/redactDiagnostics.test.ts`); this spec covers the IPC
 * wiring + the on-disk write. The save-path dialog is bypassed by the
 * `STENOAI_E2E_DIAGNOSTICS_PATH` seam (mirrors export-transcript), so the
 * handler's target is observable byte-for-byte.
 */

type DiagBridge = {
  settings: {
    saveDiagnostics: (
      defaultFilename: string,
      content: string,
    ) => Promise<{ success?: boolean; error?: string; path?: string }>;
  };
};
type StenoWindow = Window & { stenoai: DiagBridge };

const CONTENT = [
  '# stenoai diagnostics',
  '# Paths, URLs and meeting titles are redacted. No account/telemetry id.',
  'app version: 0.5.7',
  'platform: darwin',
  '',
  'SAVED:~/x/output/<redacted>.md',
  'HEARTBEAT: 42s elapsed',
].join('\n');

test('save-diagnostics writes the handed content byte-for-byte; real dir untouched', async ({
  launchApp,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-diag-t2-'));
  const outFile = path.join(outDir, 'stenoai-diagnostics-20260704.txt');
  const { page } = await launchApp({ env: { STENOAI_E2E_DIAGNOSTICS_PATH: outFile } });

  try {
    const res = await page.evaluate(
      (c) =>
        (window as StenoWindow).stenoai.settings.saveDiagnostics(
          'stenoai-diagnostics-20260704.txt',
          c,
        ),
      CONTENT,
    );
    expect(res.success).toBe(true);
    expect(res.path).toBe(outFile);
    expect(readFileSync(outFile, 'utf8')).toBe(CONTENT);

    // Empty content is rejected without touching disk.
    const empty = await page.evaluate(
      () => (window as StenoWindow).stenoai.settings.saveDiagnostics('x.txt', ''),
    );
    expect(empty.success).toBe(false);

    // Keystone: the real user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

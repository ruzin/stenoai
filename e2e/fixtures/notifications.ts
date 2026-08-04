import type { ElectronApplication } from '@playwright/test';

/**
 * Fire a main→renderer notification-flow event straight from the main process,
 * on the same channel main.js's Notification click/action handlers emit on. This
 * exercises the REAL renderer handlers (preload subscribe → useRecordingEvents)
 * that a native macOS notification click would drive — without needing a native
 * notification (whose click behavior the harness can't script).
 */
export async function emitMainEvent(
  app: ElectronApplication,
  channel: string,
  payload: unknown = {},
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, { channel, payload }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no BrowserWindow to emit into');
      win.webContents.send(channel, payload);
    },
    { channel, payload },
  );
}

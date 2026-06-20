import { readFileSync, existsSync, rmSync } from 'fs';
import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';

/**
 * T2 — incremental-write durability contract for the renderer-driven capture.
 *
 * The renderer streams its WebM blob to disk a timeslice at a time
 * (openSystemAudioFile -> appendSystemAudioChunk* -> closeSystemAudioFile)
 * instead of buffering all chunks in memory until stop, so a crash leaves a
 * processable file. This drives that IPC trio directly through the preload
 * bridge (no real capture, no model) and asserts the bytes land on disk in
 * append order. Model-free — runs in the fast t2-macos / t2-windows jobs.
 *
 * Coverage gap (intentional): the mic-only fallback in useSystemAudioCapture
 * (loopback denial -> record mic only) is NOT covered here — it needs real
 * getUserMedia/getDisplayMedia, out of reach for a model-free T2. That branch
 * becomes the default capture path in the follow-up cutover PR and is
 * exercised end-to-end by the @pipeline transcription smoke there.
 */

type OpenResult = { success: boolean; filePath?: string; error?: string };
type AppendResult = { success: boolean; error?: string };
type CloseResult = { success: boolean; filePath?: string; error?: string };

type StenoWindow = Window & {
  stenoai: {
    recording: {
      openSystemAudioFile: (name: string) => Promise<OpenResult>;
      appendSystemAudioChunk: (bytes: Uint8Array) => Promise<AppendResult>;
      closeSystemAudioFile: () => Promise<CloseResult>;
    };
  };
};

// Three known chunks; the file must equal their concatenation in append order.
const CHUNKS = [
  [0x1a, 0x45, 0xdf, 0xa3], // EBML magic — just bytes here, not a real stream
  [0x42, 0x86, 0x81, 0x01],
  [0x18, 0x53, 0x80, 0x67],
];
const EXPECTED = CHUNKS.flat();

test('incremental write: open -> append* -> close streams chunks to disk in order', async ({
  launchApp,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  const result = await page.evaluate(async (chunks) => {
    const api = (window as StenoWindow).stenoai.recording;
    const opened = await api.openSystemAudioFile('E2E Incremental');
    if (!opened.success) return { stage: 'open', opened };
    // Append sequentially — awaiting each keeps the on-disk order deterministic.
    for (const c of chunks) {
      const appended = await api.appendSystemAudioChunk(new Uint8Array(c));
      if (!appended.success) return { stage: 'append', opened, appended };
    }
    const closed = await api.closeSystemAudioFile();
    return { stage: 'done', opened, closed };
  }, CHUNKS);

  expect(result.stage, JSON.stringify(result)).toBe('done');
  expect(result.opened?.success).toBe(true);
  expect(result.closed?.success).toBe(true);

  const filePath = result.closed?.filePath;
  expect(filePath, 'close returns the written file path').toBeTruthy();
  expect(filePath!).toMatch(/sysaudio-\d+-E2E_Incremental\.webm$/);

  try {
    expect(existsSync(filePath!)).toBe(true);
    const bytes = Array.from(readFileSync(filePath!));
    expect(bytes).toEqual(EXPECTED);
  } finally {
    // Self-clean: in unpackaged e2e the file lands in the repo recordings/ dir.
    if (filePath && existsSync(filePath)) rmSync(filePath, { force: true });
  }

  // Closing again with no open file is a graceful failure, not a throw.
  const closedAgain = await page.evaluate(() =>
    (window as StenoWindow).stenoai.recording.closeSystemAudioFile(),
  );
  expect(closedAgain.success).toBe(false);

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

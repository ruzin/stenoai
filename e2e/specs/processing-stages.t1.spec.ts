import { test, expect } from '../fixtures/electron';
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * T1 -- renderer-only, mock IPC, no backend. Processing.tsx had zero test
 * coverage of any kind before this spec (confirmed via a repo-wide search).
 * The multi-stage transition logic it drives -- transcribing -> diarizing
 * (per-channel) -> summarizing -> finalizing/error, all sharing one
 * `chunkProgress` sub-label state across three different stages -- is
 * exactly the kind of thing that's easy to get a stale-label leak wrong, so
 * it earns T1 coverage per CLAUDE.md's "the interaction itself is the risk"
 * carve-out.
 *
 * Drives the real PROGRESS:, summary-chunk/complete, and processing-complete
 * IPC events directly via ElectronApplication.evaluate (main-process webContents.send),
 * rather than adding any test-only production code to main.js/preload.js --
 * this is a one-way push protocol, so there's nothing for a renderer-side
 * mock invoke to intercept.
 */

async function openProcessing(page: Page) {
  // Reached in real usage only via an active recording (never a bare URL
  // hash) -- start one first so activeSession/recording.sessionName is
  // truthy, matching what canRetry (retryAudioFile && activeSession) needs
  // for the retry-button test below.
  await page.evaluate(() => window.stenoai.recording.start('test-session'));
  await page.evaluate(() => {
    window.location.hash = '/meetings/processing';
  });
  await expect(page.getByTestId('processing-stage-label')).toBeVisible();
  // The queue poll that first reports this recording bumps Processing's
  // `generation`, whose render-phase reset clears stage + retryAudioFile.
  // Wait until that has landed (the header switches from 'Note' to the
  // session name) so a later emit can't race the reset.
  await expect(page.getByRole('heading', { name: 'test-session' })).toBeVisible();
}

function emit(app: ElectronApplication, channel: string, payload: unknown) {
  return app.evaluate(
    ({ BrowserWindow }, arg) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send(arg.channel, arg.payload);
    },
    { channel, payload },
  );
}

test('walks transcribing -> diarizing -> summarizing -> finalizing without leaking a stale sub-label', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true });
  await openProcessing(page);

  const label = page.getByTestId('processing-stage-label');
  await expect(label).toHaveText('Analyzing transcript');
  await expect(label).toHaveAttribute('data-stage', 'transcribing');

  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:You:start' });
  await expect(label).toHaveText('Diarizing You channel…');
  await expect(label).toHaveAttribute('data-stage', 'diarizing');

  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:You:done' });
  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:Others:start' });
  await expect(label).toHaveText('Diarizing Others channel…');
  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:Others:done' });

  await emit(app, 'processing-progress', { line: 'PROGRESS:summarize:1/3' });
  await expect(label).toHaveText('Summarizing part 1 of 3…');
  await expect(label).toHaveAttribute('data-stage', 'summarizing');

  await emit(app, 'processing-progress', { line: 'PROGRESS:summarize:reducing' });
  await expect(label).toHaveText('Merging summaries…');

  // The bug this spec exists to catch: chunkProgress used to persist
  // unconditionally across stage transitions, so a stale sub-label (here,
  // "Merging summaries…") could leak into 'finalizing'.
  await emit(app, 'summary-complete', { success: true, sessionName: 'test-session' });
  await expect(label).toHaveText('Almost done…');
  await expect(label).toHaveAttribute('data-stage', 'finalizing');
});

test('shows a ticking elapsed-time counter throughout diarization, since this branch has no per-chunk percentage', async ({ launchApp }) => {
  // Real bug found via a live app test: on a real ~21-minute recording,
  // segmentation (the diarizer's own pass) took 100+ seconds with the label
  // frozen on "Diarizing You channel…" the whole time -- indistinguishable
  // from actually being stuck. The user quit the app twice. This ticker is
  // the fix; this branch's sidecar has no per-chunk checkpoint at all, so
  // the ticker runs for the whole diarization call rather than yielding to
  // a percentage partway through.
  const { app, page } = await launchApp({ mockIpc: true });
  await openProcessing(page);

  const label = page.getByTestId('processing-stage-label');
  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:You:start' });
  await expect(label).toHaveText('Diarizing You channel…');

  await expect(label).toHaveText(/Diarizing You channel… \(\d+s\)/, { timeout: 3000 });

  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:You:done' });
});

test('a processing failure swaps to the error panel, and retrying does not leak the stale sub-label back', async ({ launchApp }) => {
  const { app, page } = await launchApp({ mockIpc: true });
  await openProcessing(page);

  const label = page.getByTestId('processing-stage-label');
  await emit(app, 'processing-progress', { line: 'PROGRESS:diarize:You:start' });
  await expect(label).toHaveText('Diarizing You channel…');

  // On failure, the stage card is replaced entirely by a distinct error
  // panel (retry button, no processing-stage-label) rather than the label
  // just changing text in place.
  await emit(app, 'processing-complete', {
    success: false,
    sessionName: 'test-session',
    audioFile: '/fake/audio.wav',
    message: 'boom',
  });
  await expect(label).toHaveCount(0);
  await expect(page.getByText('Couldn’t process this recording.')).toBeVisible();

  // The bug this half of the spec exists to catch: without clearing
  // chunkProgress on the failure transition, clicking "Try again" (which
  // resets the stage back to 'transcribing') would remount the stage card
  // still showing the stale "Diarizing You channel…" sub-label instead of
  // the correct fresh-start label.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(label).toHaveText('Analyzing transcript');
  await expect(label).toHaveAttribute('data-stage', 'transcribing');
});

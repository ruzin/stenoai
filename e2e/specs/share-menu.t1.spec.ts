import { test, expect } from '../fixtures/electron';
import { openShareMenu } from '../fixtures/share-menu';
import type { Page } from '@playwright/test';
import { readFileSync, rmSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * T1 - renderer-only, mock IPC, no backend. The Share menu collects every
 * action that carries a note out of the app. The interaction itself is the risk
 * here, which is why this is a UI spec rather than a T2: the entries moved out
 * of two different homes, and an entry that was DUPLICATED rather than moved
 * would look correct from the Share menu alone.
 *
 * Seams (mirrors of the real ones, see app/e2e-mock-ipc.js):
 *  - STENOAI_E2E_SEED_MEETING=1 makes list-meetings return one known meeting.
 *  - the clipboard is captured by replacing navigator.clipboard in-page.
 *  - STENOAI_E2E_EXPORT_PATH makes the export-transcript mock write its payload
 *    to disk, so what "Save notes as .md…" passed is observable byte for byte.
 *  - STENOAI_E2E_SHARE_CAPABLE toggles the share-sheet capability, which is why
 *    the renderer gates on an injected flag rather than navigator.platform:
 *    both branches are reachable on any OS, including in CI on Ubuntu.
 *  - STENOAI_E2E_SHARE_LOG collects one JSON line per share-note-file call, and
 *    STENOAI_E2E_SHARE_DELAY_MS holds a call open so the pending state can be
 *    observed without racing the clock.
 */

const SUMMARY_FILE = 'epsilon_summary.json';

async function installClipboardRecorder(page: Page, delayMs = 0) {
  await page.evaluate((delay) => {
    const w = window as unknown as { __clipboardWrites: string[] };
    w.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          w.__clipboardWrites.push(text);
          // A held-open write makes the transcript copy's await long enough to
          // reopen the menu inside it, without racing the clock.
          return delay > 0
            ? new Promise<void>((resolve) => setTimeout(resolve, delay))
            : Promise.resolve();
        },
      },
    });
  }, delayMs);
}

const clipboardWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clipboardWrites: string[] }).__clipboardWrites);

async function openDetail(page: Page) {
  await page.evaluate((f) => {
    window.location.hash = `#/meetings/${encodeURIComponent(f)}`;
  }, SUMMARY_FILE);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
}

test('the copy actions left the toolbar and are reachable from the Share menu', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);
  await installClipboardRecorder(page);

  // With the menu closed, neither copy action exists anywhere on the detail
  // view. This is the half that catches a duplicate: the entries below would
  // pass just as well if the toolbar icons had been left in place.
  await expect(page.getByRole('button', { name: 'Copy notes' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toHaveCount(0);

  const menu = await openShareMenu(page);
  await expect(menu.getByRole('button', { name: 'Copy notes' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Copy transcript' })).toBeVisible();

  // Both still reach the clipboard from their new home.
  await menu.getByRole('button', { name: 'Copy notes' }).click();
  let writes = await clipboardWrites(page);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain('Epsilon Planning');

  const second = await openShareMenu(page);
  await second.getByRole('button', { name: 'Copy transcript' }).click();
  writes = await clipboardWrites(page);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toContain('## Transcript');
});

test('a copy flips its own label to Copied and then dismisses the menu', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);
  await installClipboardRecorder(page);

  const menu = await openShareMenu(page);
  await menu.getByRole('button', { name: 'Copy notes' }).click();

  // Inside a menu the old checkmark feedback would be dismissed with the
  // popover before it registered, so the label carries the confirmation and the
  // menu stays up for a beat.
  await expect(menu.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(menu).toBeHidden({ timeout: 5_000 });
});

test('dismissing and reopening after a copy does not inherit the auto-close', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);
  await installClipboardRecorder(page);

  const menu = page.getByTestId('note-share-menu');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Copy notes' }).click();

  // Dismiss and reopen INSIDE the 800 ms auto-close window. That timer belongs
  // to the menu instance the copy happened in; left pending it would fire
  // against the new one and shut it in the user's face.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(menu).toBeVisible();

  // Well past the point the stale timer would have fired.
  await page.waitForTimeout(1_500);
  await expect(menu).toBeVisible();
});

test('a copy still in flight does not close the menu reopened during it', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);
  // Copy transcript awaits the clipboard before scheduling its auto-close, so
  // during that await there is no timer to cancel. Cancelling on open/close is
  // therefore not sufficient on its own.
  await installClipboardRecorder(page, 1_500);

  const menu = page.getByTestId('note-share-menu');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Copy transcript' }).click();

  // Dismiss and reopen while the write is still in flight.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(menu).toBeVisible();

  // Past the write resolving plus the 800 ms the inherited timer would add.
  await page.waitForTimeout(2_800);
  await expect(menu).toBeVisible();
});

test('the file saves moved out of the ... menu, which keeps its management actions', async ({
  launchApp,
}) => {
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);

  await page.getByRole('button', { name: 'More options' }).click();
  const more = page.getByRole('button', { name: 'View containing folder' });
  await expect(more).toBeVisible();

  // Neither save entry is offered there any more. No exact entry count is
  // asserted: Re-transcribe and the org share are conditional, so a count would
  // fail for reasons unrelated to this change.
  await expect(page.getByRole('button', { name: /Save transcript as \.md/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save notes as PDF/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save notes as \.md/ })).toHaveCount(0);
  // The management actions it owns are untouched.
  await expect(page.getByRole('button', { name: 'Delete note' })).toBeVisible();

  await page.keyboard.press('Escape');

  // All three saves live in the Share menu now.
  const menu = await openShareMenu(page);
  await expect(menu.getByRole('button', { name: /Save notes as PDF/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Save notes as \.md/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Save transcript as \.md/ })).toBeVisible();
});

test('Save notes as .md passes markdown, not the running text Copy notes builds', async ({
  launchApp,
}) => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-share-md-t1-'));
  const outFile = path.join(outDir, 'notes.md');
  const { page } = await launchApp({
    mockIpc: true,
    env: { STENOAI_E2E_SEED_MEETING: '1', STENOAI_E2E_EXPORT_PATH: outFile },
  });

  try {
    await openDetail(page);

    const menu = await openShareMenu(page);
    await menu.getByRole('button', { name: /Save notes as \.md/ }).click();

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
      .toContain('# Epsilon Planning');

    const md = readFileSync(outFile, 'utf8');
    // Real markdown headings, not notesCopy's uppercase labels - the assertion
    // that separates the third builder from the one it sits next to.
    expect(md).toContain('## Summary');
    expect(md).toContain('## Participants');
    expect(md).toContain('Alice, Bob');
    expect(md).not.toContain('SUMMARY');
    expect(md).not.toContain('PARTICIPANTS');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

const SHARE_ENTRIES = [/Share notes as PDF/, /Share notes as \.md/, /Share transcript/];

function shareCalls(logFile: string) {
  try {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; defaultFilename: string; payloadHead: string });
  } catch {
    return [];
  }
}

test('the share entries are absent when no share sheet exists here', async ({ launchApp }) => {
  // The branch that matters on Windows: Electron exports no ShareMenu there, so
  // an entry that rendered anyway would reach a constructor that is undefined.
  const { page } = await launchApp({ mockIpc: true, env: { STENOAI_E2E_SEED_MEETING: '1' } });
  await openDetail(page);

  const menu = await openShareMenu(page);
  // The rest of the menu is unaffected - Windows keeps every non-sheet action.
  await expect(menu.getByRole('button', { name: 'Copy notes' })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Save transcript as \.md/ })).toBeVisible();
  for (const entry of SHARE_ENTRIES) {
    await expect(menu.getByRole('button', { name: entry })).toHaveCount(0);
  }
});

test('the share entries render when a share sheet exists, and pass the right file', async ({
  launchApp,
}) => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-share-t1-'));
  const logFile = path.join(outDir, 'share-calls.jsonl');
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_MEETING: '1',
      STENOAI_E2E_SHARE_CAPABLE: '1',
      STENOAI_E2E_SHARE_LOG: logFile,
    },
  });

  try {
    await openDetail(page);
    const menu = await openShareMenu(page);
    for (const entry of SHARE_ENTRIES) {
      await expect(menu.getByRole('button', { name: entry })).toBeVisible();
    }

    // Notes as PDF hands over the same branded HTML the save path builds, under
    // a dated .pdf name - the filename is what the recipient reads.
    await menu.getByRole('button', { name: /Share notes as PDF/ }).click();
    await expect.poll(() => shareCalls(logFile).length, { timeout: 10_000 }).toBe(1);
    let call = shareCalls(logFile)[0];
    expect(call.kind).toBe('pdf');
    expect(call.defaultFilename).toMatch(/^\d{4}-\d{2}-\d{2}-epsilon-planning\.pdf$/);
    expect(call.payloadHead).toContain('<!doctype html>');

    // A share does not dismiss the menu (unlike a copy), so the next entry is
    // clicked in the same open menu.
    await expect(menu).toBeVisible();

    // Transcript goes as text under the plain dated .md name.
    await menu.getByRole('button', { name: /Share transcript/ }).click();
    await expect.poll(() => shareCalls(logFile).length, { timeout: 10_000 }).toBe(2);
    call = shareCalls(logFile)[1];
    expect(call.kind).toBe('text');
    expect(call.defaultFilename).toMatch(/^\d{4}-\d{2}-\d{2}-epsilon-planning\.md$/);
    expect(call.payloadHead).toContain('# Epsilon Planning');

    // Notes as .md carries the -notes suffix, so it cannot overwrite the
    // transcript file that the entry above just wrote into the same directory.
    await menu.getByRole('button', { name: /Share notes as \.md/ }).click();
    await expect.poll(() => shareCalls(logFile).length, { timeout: 10_000 }).toBe(3);
    call = shareCalls(logFile)[2];
    expect(call.kind).toBe('text');
    expect(call.defaultFilename).toMatch(/^\d{4}-\d{2}-\d{2}-epsilon-planning-notes\.md$/);
    expect(call.defaultFilename).not.toBe(shareCalls(logFile)[1].defaultFilename);
    expect(call.payloadHead).toContain('## Summary');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a share in flight shows Preparing and swallows a second click', async ({ launchApp }) => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'steno-share-pending-t1-'));
  const logFile = path.join(outDir, 'share-calls.jsonl');
  const { page } = await launchApp({
    mockIpc: true,
    env: {
      STENOAI_E2E_SEED_MEETING: '1',
      STENOAI_E2E_SHARE_CAPABLE: '1',
      STENOAI_E2E_SHARE_LOG: logFile,
      STENOAI_E2E_SHARE_DELAY_MS: '3000',
    },
  });

  try {
    await openDetail(page);
    const menu = await openShareMenu(page);
    await menu.getByRole('button', { name: /Share notes as PDF/ }).click();

    // The menu stays open and the clicked entry says what it is doing. Without
    // this the user sees nothing happen for up to 15 seconds.
    await expect(menu.getByRole('button', { name: 'Preparing…' })).toBeVisible();
    await expect(menu).toBeVisible();
    // Every share entry is off while one is in flight, not just the clicked one.
    for (const entry of [/Share notes as \.md/, /Share transcript/]) {
      await expect(menu.getByRole('button', { name: entry })).toBeDisabled();
    }

    // force: past the disabled attribute, so this tests the guard in the handler
    // rather than only the rendered state. A second sheet must not be queued.
    await menu.getByRole('button', { name: 'Preparing…' }).click({ force: true });
    await expect.poll(() => shareCalls(logFile).length, { timeout: 5_000 }).toBe(1);

    // It resolves back to its own label rather than staying stuck.
    await expect(menu.getByRole('button', { name: /Share notes as PDF/ })).toBeEnabled({
      timeout: 10_000,
    });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

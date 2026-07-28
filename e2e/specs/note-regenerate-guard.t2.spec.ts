import { test, expect } from '../fixtures/electron';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 - the data the regenerate guard runs on, driven through the REAL preload
 * bridge against the REAL get-meeting/update-meeting handlers.
 *
 * The guard in MeetingDetail only ever fires on `meeting.edited_fields`. If that
 * field never leaves main, the confirm dialog is decorative and a regenerate
 * still silently discards the user's corrections - a failure that looks exactly
 * like a working guard from inside the renderer's own unit tests, because those
 * hand the component the field directly. So this spec asserts the whole chain:
 * edit a note through update-meeting, then read it back through get-meeting and
 * check what actually arrives.
 *
 * The other half is the false positive. A note with no sidecar, a note whose
 * sidecar is corrupt, and a note that was generated but never edited must all
 * come back with an empty list, or the dialog fires on notes with nothing to
 * lose and users learn to click through it.
 *
 * Model-free: a seeded note plus the note IPCs, no ASR and no Ollama.
 */

const NOTE = [
  '---',
  'title: "Quarterly Review"',
  'date: "2026-07-28T10:00:00"',
  'duration_seconds: 600',
  'language: "en"',
  'is_diarised: false',
  '---',
  '',
  '## Summary',
  '',
  'The team agreed to ship on Friday.',
  '',
  '## Key Topics',
  '',
  '### Billing',
  '',
  'The migration is blocked on the vendor.',
  '',
  '## Key Points',
  '',
  '- Ship Friday',
  '',
  '## Action Items',
  '',
  '- Alice pings the vendor',
  '',
  '## Transcript',
  '',
  'Alice: we ship Friday.',
  '',
].join('\n');

function seedNote(userDataDir: string, stem: string) {
  const outputDir = path.join(userDataDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, `${stem}_summary.md`);
  writeFileSync(summaryPath, NOTE, 'utf-8');
  return { summaryPath, sidecarPath: path.join(outputDir, `${stem}_original.json`) };
}

test('an edited note reports its edited sections to the renderer', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(60_000);
  const { summaryPath, sidecarPath } = seedNote(userDataDir, 'edited');

  const { page } = await launchApp();
  const get = (f: string) =>
    page.evaluate(async (file) => {
      const r = await window.stenoai.meetings.get(file as string);
      return r.success ? r.meeting : { error: r.error };
    }, f);
  const update = (patch: Record<string, unknown>) =>
    page.evaluate(
      ([f, p]) => window.stenoai.meetings.update(f as string, p as object),
      [summaryPath, patch] as const,
    );

  // Before any edit: the note has no sidecar at all.
  expect(existsSync(sidecarPath)).toBe(false);
  expect((await get(summaryPath)).edited_fields).toEqual([]);

  expect(await update({ summary: 'The team agreed to ship on Monday.' })).toMatchObject({
    success: true,
  });
  expect((await get(summaryPath)).edited_fields).toEqual(['summary']);

  expect(await update({ action_items: ['Alice calls the vendor'] })).toMatchObject({
    success: true,
  });
  // Accumulates, and the renderer sees exactly what the sidecar holds.
  expect(((await get(summaryPath)).edited_fields as string[]).slice().sort()).toEqual([
    'action_items',
    'summary',
  ]);
  const onDisk = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  expect(onDisk.edited_fields.slice().sort()).toEqual(['action_items', 'summary']);
});

test('a note that was never edited reports no edited sections', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(60_000);
  // A generated-but-unedited note: a version-1 sidecar with an empty list, the
  // shape simple_recorder.py writes after every generation and regeneration.
  const { summaryPath, sidecarPath } = seedNote(userDataDir, 'pristine');
  writeFileSync(
    sidecarPath,
    JSON.stringify({
      version: 1,
      captured_at: '2026-07-28T10:00:00',
      capture: 'generation',
      original: {
        summary: 'The team agreed to ship on Friday.',
        key_points: ['Ship Friday'],
        action_items: ['Alice pings the vendor'],
        discussion_areas: [],
        participants: [],
      },
      edited_fields: [],
      edited_at: null,
    }),
    'utf-8',
  );

  const { page } = await launchApp();
  const meeting = await page.evaluate(async (file) => {
    const r = await window.stenoai.meetings.get(file as string);
    return r.success ? r.meeting : { error: r.error };
  }, summaryPath);
  expect(meeting.edited_fields).toEqual([]);
});

test('a corrupt sidecar reports no edited sections instead of failing the note', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(60_000);
  const { summaryPath, sidecarPath } = seedNote(userDataDir, 'corrupt');
  writeFileSync(sidecarPath, '{ not json', 'utf-8');

  const { page } = await launchApp();
  const meeting = await page.evaluate(async (file) => {
    const r = await window.stenoai.meetings.get(file as string);
    return r.success ? r.meeting : { error: r.error };
  }, summaryPath);
  // The note itself still opens - the sidecar is a diff base, not a dependency.
  expect(meeting.summary).toBe('The team agreed to ship on Friday.');
  expect(meeting.edited_fields).toEqual([]);
});

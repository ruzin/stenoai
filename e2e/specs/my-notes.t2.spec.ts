import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

/**
 * T2 — the My notes tab persistence contract (borrowed from meetily's separate
 * notes layer). Drives the REAL update-meeting IPC (main.js body surgery) and
 * the REAL Python parser (get-meeting → _parse_meeting_markdown → user_notes),
 * proving the `## User Notes` section round-trips independently of the summary:
 *
 * - upsert adds a `## User Notes` section at the tail, leaving the summary and
 *   `## Transcript` sections byte-intact;
 * - the parser surfaces it as `user_notes`;
 * - editing replaces it (no accretion); clearing removes the section.
 *
 * Model-free: no ASR, no Ollama — just a seeded note file + the note IPCs.
 */

const SUMMARY_MD = [
  '---',
  'title: "Weekly Sync"',
  'date: "2026-07-12T10:00:00"',
  'duration_seconds: 600',
  'language: "en"',
  'is_diarised: false',
  '---',
  '',
  '## Summary',
  '',
  'The team agreed to ship on Friday.',
  '',
  '## Transcript',
  '',
  'Alice: we ship Friday.',
  '',
].join('\n');

test('My notes upsert round-trips through update-meeting + the parser, decoupled from the summary', async ({
  launchApp,
  userDataDir,
}) => {
  test.setTimeout(60_000);
  const realDirBefore = fileSig(realUserDataDir());

  const outputDir = path.join(userDataDir, 'output');
  mkdirSync(outputDir, { recursive: true });
  const summaryPath = path.join(outputDir, 'weekly_summary.md');
  writeFileSync(summaryPath, SUMMARY_MD, 'utf-8');

  const { page } = await launchApp();

  const update = (patch: Record<string, unknown>) =>
    page.evaluate(
      ([f, p]) => window.stenoai.meetings.update(f as string, p as object),
      [summaryPath, patch] as const,
    );
  const getNotes = () =>
    page.evaluate(async (f) => {
      const res = await window.stenoai.meetings.get(f as string);
      return res.success ? (res.meeting.user_notes ?? null) : `ERR:${res.error}`;
    }, summaryPath);

  // 1. Upsert notes → section added, summary + transcript intact.
  const r1 = await update({ user_notes: 'Remember the billing migration.' });
  expect(r1.success).toBe(true);
  let md = readFileSync(summaryPath, 'utf8');
  expect(md).toContain('## User Notes');
  expect(md).toContain('Remember the billing migration.');
  expect(md).toContain('## Summary');
  expect(md).toContain('The team agreed to ship on Friday.');
  expect(md).toContain('## Transcript');
  expect(md).toContain('Alice: we ship Friday.');

  // Parser surfaces it (decoupled field, independent of summary).
  expect(await getNotes()).toBe('Remember the billing migration.');

  // 2. Edit → replaces, does not accrete a second section.
  await update({ user_notes: 'Updated: soak must be clean first.' });
  md = readFileSync(summaryPath, 'utf8');
  expect(md.match(/## User Notes/g)?.length).toBe(1);
  expect(md).not.toContain('Remember the billing migration.');
  expect(await getNotes()).toBe('Updated: soak must be clean first.');

  // 3. Clear → section removed; summary + transcript still intact.
  await update({ user_notes: '' });
  md = readFileSync(summaryPath, 'utf8');
  expect(md).not.toContain('## User Notes');
  expect(md).toContain('## Summary');
  expect(md).toContain('## Transcript');

  // Keystone: the real user-data dir is untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

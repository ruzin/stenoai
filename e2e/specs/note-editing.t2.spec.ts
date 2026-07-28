import { test, expect } from '../fixtures/electron';
import { writeMeetingMarkdown } from '../fixtures/user-config';
import { readFileSync } from 'fs';

/**
 * T2: editing a generated note (D9). Drives the REAL app end to end: open a
 * seeded markdown note, click the Edit affordance, retype the summary and an
 * action item, Save, then close the app and relaunch it against the same user
 * data dir.
 *
 * Model-free: the note is seeded on disk, so nothing here loads an ASR model or
 * calls Ollama. What it proves that a unit test cannot:
 *  - the Edit button is actually reachable in the shipped toolbar;
 *  - the patch survives the full renderer → preload → main → note-sections →
 *    atomic-write path and lands in the right `##` sections of the .md;
 *  - the edit is still there after a real quit + relaunch (not just in the
 *    react-query cache).
 */

const SUMMARY_MARKDOWN = [
  '## Summary',
  'The team reviewed the quarterly budget and agreed to proceed.',
  '',
  '## Key Topics',
  '',
  '### Budget',
  '',
  'The proposed figures were reviewed line by line.',
  '',
  '## Key Points',
  '',
  '- Budget approved',
  '- Headcount unchanged',
  '',
  '## Action Items',
  '',
  '- Anna sends the draft',
  '- Ben books the room',
].join('\n');

const NEW_SUMMARY = 'The team reviewed the Q3 budget and agreed to proceed on Friday.';
const NEW_ACTION = 'Anna sends the revised draft';

test('an edited note is written to the .md and survives a relaunch', async ({
  launchApp,
  userDataDir,
}) => {
  const file = writeMeetingMarkdown(userDataDir, 'editable', {
    name: 'Budget Review',
    summaryMarkdown: SUMMARY_MARKDOWN,
    transcript: 'We looked at the numbers and agreed.',
  });

  const first = await launchApp();
  const page = first.page;

  await page.getByText('Budget Review').first().click();
  await expect(page.getByTestId('meeting-detail-title')).toContainText('Budget Review');
  // Read-only first: the note is a document until asked otherwise.
  await expect(page.getByTestId('tab-summary-content')).toBeVisible();
  await expect(page.getByTestId('note-editor')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByTestId('note-editor')).toBeVisible();

  const save = page.getByRole('button', { name: /^save$/i });
  await expect(save).toBeDisabled();

  // getByRole, not getByLabel: each row's remove button shares the row's name.
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill(NEW_SUMMARY);
  await page.getByRole('textbox', { name: 'Action item 1', exact: true }).fill(NEW_ACTION);
  await expect(save).toBeEnabled();
  await save.click();

  // Back to the document, showing the edit.
  await expect(page.getByTestId('note-editor')).toHaveCount(0);
  await expect(page.getByTestId('tab-summary-content')).toContainText('Q3 budget');

  // On disk, in the right sections, with everything untouched left alone.
  const raw = readFileSync(file, 'utf8');
  expect(raw).toContain(`## Summary\n\n${NEW_SUMMARY}`);
  expect(raw).toContain(`- ${NEW_ACTION}`);
  expect(raw).toContain('- Ben books the room');
  expect(raw).toContain('- Budget approved');
  expect(raw).toContain('### Budget');
  expect(raw).toContain('## Transcript');
  expect(raw).not.toContain('Anna sends the draft\n');

  await first.app.close();

  // A fresh process, same user data dir: the edit came from the file, not a cache.
  const second = await launchApp();
  await second.page.getByText('Budget Review').first().click();
  await expect(second.page.getByTestId('tab-summary-content')).toContainText('Q3 budget');
  await expect(second.page.getByText(NEW_ACTION)).toBeVisible();
});

test('leaving the view with unsaved edits asks first', async ({ launchApp, userDataDir }) => {
  const file = writeMeetingMarkdown(userDataDir, 'leaving', {
    name: 'Leaving Note',
    summaryMarkdown: SUMMARY_MARKDOWN,
    transcript: 'Nothing to see here.',
  });

  const { page } = await launchApp();
  await page.getByText('Leaving Note').first().click();
  await page.getByRole('button', { name: 'Edit note' }).click();

  const back = page.getByRole('button', { name: 'Back to home' });

  // Nothing typed yet: there is nothing to lose, so no dialog.
  await back.click();
  await expect(page.getByTestId('meeting-detail')).toHaveCount(0);

  await page.getByText('Leaving Note').first().click();
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('Typed but not saved.');

  // Now one click on Home has to ask rather than discard silently.
  await back.click();
  await expect(page.locator('[data-confirm-dialog]')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue(
    'Typed but not saved.'
  );

  // Confirming leaves, and the unsaved draft was never written.
  await back.click();
  await page.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page.getByTestId('meeting-detail')).toHaveCount(0);
  expect(readFileSync(file, 'utf8')).not.toContain('Typed but not saved.');
});

test('a heading typed into a field is refused before it reaches the note', async ({
  launchApp,
  userDataDir,
}) => {
  const file = writeMeetingMarkdown(userDataDir, 'guarded', {
    name: 'Guarded Note',
    summaryMarkdown: SUMMARY_MARKDOWN,
    transcript: 'Nothing to see here.',
  });

  const { page } = await launchApp();
  await page.getByText('Guarded Note').first().click();
  await page.getByRole('button', { name: 'Edit note' }).click();

  const summaryField = page.getByRole('textbox', { name: 'Summary', exact: true });
  await summaryField.fill('Fine so far\n## Transcript\nforged');
  await page.getByRole('button', { name: /^save$/i }).click();

  // Still in edit mode, told why, with the typing intact and the file untouched.
  await expect(page.getByRole('alert')).toContainText(/heading/i);
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(summaryField).toHaveValue(/forged/);
  expect(readFileSync(file, 'utf8')).toContain(
    'The team reviewed the quarterly budget and agreed to proceed.'
  );
});

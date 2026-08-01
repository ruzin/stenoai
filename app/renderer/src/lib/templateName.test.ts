import { describe, test, expect, beforeEach } from 'vitest';

import i18n from '@/lib/i18n';
import { templateDisplayName } from '@/lib/templateName';

/**
 * Template names are user data (#337): built-ins can be overridden and the
 * seeded sample is written into config.json on first run. So the localisation
 * is display-only, and it must get out of the way the moment a user has renamed
 * anything.
 */
describe('templateDisplayName', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  test('localises the seeded sample while its name is untouched', () => {
    expect(templateDisplayName({ id: 'shareable-summary', name: 'Shareable summary' })).toBe(
      'Weitergabe-Zusammenfassung',
    );
  });

  test('a renamed template keeps the user’s name, never ours', () => {
    // The load-bearing case: once someone edits the template, the stored name
    // is theirs and must survive a language switch untouched.
    expect(
      templateDisplayName({ id: 'shareable-summary', name: 'Mein Weiterleitungs-Text' }),
    ).toBe('Mein Weiterleitungs-Text');
  });

  test('the jargon built-ins are deliberately left in English', () => {
    // "Standup" and "Sales Call" ARE the German business terms; translating
    // them would be worse German. This asserts the narrow scope on purpose, so
    // a future well-meaning change has to argue with a failing test.
    for (const name of ['Product Demo', 'Sales Call', 'Standup', '1:1']) {
      const id = name.toLowerCase().replace(/[^a-z]+/g, '-');
      expect(templateDisplayName({ id, name })).toBe(name);
    }
  });

  test('a template with no id falls through unchanged', () => {
    expect(templateDisplayName({ name: 'Shareable summary' })).toBe('Shareable summary');
  });

  test('English shows the English name, not a key', async () => {
    await i18n.changeLanguage('en');
    expect(templateDisplayName({ id: 'shareable-summary', name: 'Shareable summary' })).toBe(
      'Shareable summary',
    );
  });
});

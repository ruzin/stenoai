import { describe, test, expect, beforeEach } from 'vitest';

import i18n from '@/lib/i18n';
import { meetingDisplayTitle } from '@/lib/meetingTitle';

/**
 * The placeholder title is a protocol token the backend matches with
 * _AUTO_NAMED_PATTERN and replaces with a generated title (#337). Localising it
 * is display-only; the storage value must stay byte-identical or the backend
 * stops recognising it and the note keeps its placeholder forever.
 */
describe('meetingDisplayTitle', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  test('translates the bare placeholder', () => {
    expect(meetingDisplayTitle('Note')).toBe('Notiz');
  });

  test('keeps the disambiguating suffix', () => {
    // Back-to-back recordings rely on the suffix to be distinguishable in the
    // list, so it must survive the translation.
    expect(meetingDisplayTitle('Note-A1B2C3')).toBe('Notiz-A1B2C3');
  });

  test('leaves a real title alone', () => {
    expect(meetingDisplayTitle('Quartalsplanung')).toBe('Quartalsplanung');
    expect(meetingDisplayTitle('Notes from the offsite')).toBe('Notes from the offsite');
  });

  test('does not touch the name-plus-timestamp form', () => {
    // The backend pattern also matches "<name> — <timestamp>", but that is a
    // user-named session, not a placeholder.
    expect(meetingDisplayTitle('Standup — 2026-07-27 09:15')).toBe(
      'Standup — 2026-07-27 09:15',
    );
  });

  test('rejects near-misses rather than translating them', () => {
    for (const name of ['Note-abc123', 'Note-A1B2C', 'Notebook', 'My Note']) {
      expect(meetingDisplayTitle(name)).toBe(name);
    }
  });

  test('an empty or missing name yields an empty string for the caller to handle', () => {
    expect(meetingDisplayTitle('')).toBe('');
    expect(meetingDisplayTitle(null)).toBe('');
    expect(meetingDisplayTitle(undefined)).toBe('');
  });

  test('English renders the stored word unchanged', async () => {
    await i18n.changeLanguage('en');
    expect(meetingDisplayTitle('Note')).toBe('Note');
    expect(meetingDisplayTitle('Meeting-ZZ9999')).toBe('Meeting-ZZ9999');
  });
});

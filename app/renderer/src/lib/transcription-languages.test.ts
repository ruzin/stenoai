import { describe, test, expect, beforeEach } from 'vitest';

import i18n from '@/lib/i18n';
import {
  PARAKEET_LANGUAGES,
  languageHint,
  languageLabel,
} from '@/lib/transcription-languages';
import { LANGUAGES_WHISPER } from '@/routes/settings/languages';

/**
 * The picker labels are display-only (#337) — the stored value is always the
 * code — so localising them cannot affect transcription behaviour. These tests
 * guard the two things that could still go wrong: a code with no translation
 * silently rendering a key, and the two different meanings of `auto` collapsing
 * into one.
 */
describe('language picker labels', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  test('German uses exonyms, not the English name and not the endonym', () => {
    expect(languageLabel('es', 'Spanish')).toBe('Spanisch');
    expect(languageLabel('fr', 'French')).toBe('Französisch');
    expect(languageLabel('zh-Hans', 'Chinese (Simplified)')).toBe('Chinesisch (vereinfacht)');
  });

  test('auto has two distinct labels because the engines mean different things', () => {
    // Whisper detects per recording; Parakeet is language-agnostic at inference.
    expect(languageLabel('auto', 'Auto (detect)')).toBe('Automatisch');
    expect(languageLabel('auto', 'Multi-language', 'multi')).toBe('Mehrsprachig');
  });

  test('every shipped Whisper code resolves to a real word, never a key', () => {
    for (const option of LANGUAGES_WHISPER) {
      const label = languageLabel(option.value, option.label);
      expect(label).not.toContain('settings.languages');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('every shipped Parakeet code resolves a label and a hint', () => {
    for (const option of PARAKEET_LANGUAGES) {
      expect(languageLabel(option.code, option.label, 'multi')).not.toContain('settings.languages');
      expect(languageHint(option.code, option.hint)).not.toContain('settings.languages');
    }
  });

  test('an unknown code falls back to the English label rather than a key', () => {
    // Adding a language to the array without adding its key must degrade to the
    // English word, not to "settings.languages.sv".
    expect(languageLabel('sv', 'Swedish')).toBe('Swedish');
    expect(languageHint('sv', 'Transcribe in Swedish')).toBe('Transcribe in Swedish');
  });

  test('English shows the English names', async () => {
    await i18n.changeLanguage('en');
    expect(languageLabel('es', 'Spanish')).toBe('Spanish');
    expect(languageLabel('auto', 'Auto (detect)')).toBe('Auto (detect)');
  });
});

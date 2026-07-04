import { PARAKEET_LANGUAGE_CODES } from '@/lib/transcription-languages';

export type LangOption = { value: string; label: string };

// Curated language list shown in Settings → Transcribe. Whisper supports
// all 12 (it covers 99 languages at the model level; the dropdown is just
// the tested curation).
export const LANGUAGES_WHISPER: LangOption[] = [
  { value: 'auto', label: 'Auto (detect)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
];
// Parakeet exposes the European subset (see transcription-languages.ts for
// why pinning matters even though the decoder is language-agnostic). Derived
// from the Whisper list so labels stay identical and the picker can't drift
// from the shared code set.
export const LANGUAGES_PARAKEET: LangOption[] = LANGUAGES_WHISPER.filter((l) =>
  PARAKEET_LANGUAGE_CODES.has(l.value),
);

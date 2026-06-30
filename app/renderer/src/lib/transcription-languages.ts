// Single source of truth for which languages the Parakeet engine offers.
//
// Parakeet TDT v3 is language-agnostic at inference (the decoder ignores the
// pin), but the language setting still drives the OUTPUT language of the
// summary, title, chat and reports — so a French/German/… user must be able
// to pin their language or those default to English. We expose the European
// languages Parakeet transcribes well; the non-European codes (ja/zh/ko/hi/ar)
// stay Whisper-only because Parakeet can't transcribe them.
//
// Every Parakeet-aware language control imports this set so they can't drift:
//   - Settings → Transcribe picker (LANGUAGES_PARAKEET, routes/Settings.tsx)
//   - the engine-switch coercion (useSetActiveTranscription, hooks/useModels.ts)
//   - the live transcript bar's language selector (components/LiveTranscriptBar.tsx)
// If they drift, switching to Parakeet would reset a still-valid pin to 'auto'.
export const PARAKEET_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'auto',
  'en',
  'es',
  'fr',
  'de',
  'nl',
  'pt',
]);

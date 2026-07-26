/*
 * UI-chrome localisation for the RENDERER (issue #337).
 *
 * The second of two independent i18next instances; the main process runs its
 * own (app/i18n.js) over the same JSON files. See that file for the protocol
 * that keeps them in step.
 *
 * Initialised at module scope, on purpose. main.tsx imports this before it
 * mounts React, so the very first paint is already in the right language and
 * there is no flash of English. That works because the resources are inlined
 * by Vite (no network, no backend plugin) and the bootstrap language arrives
 * synchronously on process.argv via the preload — no IPC round trip to await.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@locales/en.json';
import de from '@locales/de.json';

export const SUPPORTED_UI_LANGUAGES = ['en', 'de'] as const;
export type UiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];
export const FALLBACK_UI_LANGUAGE: UiLanguage = 'en';

function isSupported(value: unknown): value is UiLanguage {
  return typeof value === 'string' && (SUPPORTED_UI_LANGUAGES as readonly string[]).includes(value);
}

/*
 * The language main resolved for this window, handed over as a launch argument
 * rather than fetched. Falls back to English if the bridge is missing, which is
 * the case in unit tests that render a component without the preload.
 */
function bootstrapLanguage(): UiLanguage {
  const fromBridge = (window as { stenoai?: { uiLanguage?: unknown } }).stenoai?.uiLanguage;
  return isSupported(fromBridge) ? fromBridge : FALLBACK_UI_LANGUAGE;
}

i18n.use(initReactI18next).init({
  lng: bootstrapLanguage(),
  fallbackLng: FALLBACK_UI_LANGUAGE,
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  interpolation: {
    // React already escapes anything rendered through JSX, so i18next doing it
    // again would double-escape apostrophes and ampersands in the copy.
    escapeValue: false,
  },
  returnNull: false,
});

document.documentElement.lang = i18n.language;

/*
 * Applies a language the user just picked, or one main pushed after it was
 * changed in another window. Kept here rather than in the component so the
 * document lang attribute cannot drift from the active i18next language.
 */
export async function applyUiLanguage(language: string): Promise<void> {
  const next = isSupported(language) ? language : FALLBACK_UI_LANGUAGE;
  if (i18n.language === next) return;
  await i18n.changeLanguage(next);
  document.documentElement.lang = next;
}

export default i18n;

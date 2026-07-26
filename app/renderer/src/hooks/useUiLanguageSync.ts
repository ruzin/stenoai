import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ipc } from '@/lib/ipc';
import { applyUiLanguage } from '@/lib/i18n';

/*
 * Keeps this window's i18next instance in step with the main process (#337).
 *
 * Main owns the language: it persists the preference, resolves the 'system'
 * sentinel against the OS, relabels the native menu and tray, and only then
 * broadcasts 'ui-language-changed' to every open window. This hook is the
 * receiving end.
 *
 * Every window listens, including the one whose Settings screen triggered the
 * change — so there is exactly one code path that flips the language, rather
 * than the originating window switching itself optimistically and the others
 * arriving via IPC.
 *
 * useTranslation() is called for its side effect only: it subscribes the
 * component to i18next, so mounting this hook re-renders the tree when the
 * language changes. Without it changeLanguage() would update the store and
 * leave the UI showing the old strings until something else re-rendered.
 */
export function useUiLanguageSync(): void {
  useTranslation();

  useEffect(() => {
    if (!window.stenoai) return;
    return ipc().on.uiLanguageChanged((language: string) => {
      void applyUiLanguage(language);
    });
  }, []);
}

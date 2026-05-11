import * as React from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'steno-theme';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

function applyResolved(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  // The design-v2 token layer keys off [data-theme="dark"] in addition to
  // .dark, so mirror the class onto the attribute for both designs.
  document.documentElement.setAttribute('data-theme', resolved);
}

export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>(readStoredTheme);
  const [resolved, setResolved] = React.useState<'light' | 'dark'>(() =>
    readStoredTheme() === 'dark'
      ? 'dark'
      : readStoredTheme() === 'light'
        ? 'light'
        : systemPrefersDark()
          ? 'dark'
          : 'light',
  );

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  React.useEffect(() => {
    const next: 'light' | 'dark' =
      theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
    setResolved(next);
    applyResolved(next);
  }, [theme]);

  React.useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const next = mq.matches ? 'dark' : 'light';
      setResolved(next);
      applyResolved(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return { theme, setTheme, resolved };
}

import * as React from 'react';

export function useHashRoute(): string {
  const [hash, setHash] = React.useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  );
  React.useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return hash;
}

export function routeFromHash(hash: string): string {
  const stripped = hash.replace(/^#/, '');
  return stripped.length > 0 ? stripped : '/';
}

export function useRoute(): string {
  return routeFromHash(useHashRoute());
}

export function navigate(path: string) {
  if (typeof window === 'undefined') return;
  const next = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${next}`) return;
  window.location.hash = next;
}

export function useNavigate() {
  return navigate;
}

// Tracks the most recent non-settings route so Settings's back button (and
// the sidebar Settings toggle) can return the user to where they came from
// instead of dumping them on Home. Module-level so it survives across
// component remounts.
let lastNonSettingsRoute: string = '/';

export function rememberNonSettingsRoute(route: string) {
  if (route !== '/settings') lastNonSettingsRoute = route;
}

export function getLastNonSettingsRoute(): string {
  return lastNonSettingsRoute;
}

/**
 * Toggle Settings: if already on /settings, return to the last non-settings
 * route the user was on. Otherwise stash the current route and navigate to
 * /settings.
 */
export function toggleSettings(currentRoute: string) {
  if (currentRoute === '/settings') {
    navigate(lastNonSettingsRoute || '/');
  } else {
    rememberNonSettingsRoute(currentRoute);
    navigate('/settings');
  }
}

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

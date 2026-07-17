import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { OrgStatusResponse } from '@/lib/ipc';
import {
  useOrgAutoBackup,
  useOrgLogin,
  useOrgLogout,
  useOrgSession,
  useOrgSsoGoogle,
  useSetOrgAutoBackup,
} from '@/hooks/useOrg';
import { COMPACT_BTN } from './primitives';

// ---------------------------------------------------------------------------
// Organisation tab — connect to a self-hosted Steno enterprise adapter.
// ---------------------------------------------------------------------------

const ORG_ADAPTER_URL_KEY = 'steno-org-adapter-url';
const ORG_ADAPTER_URL_DEFAULT = 'http://localhost:8000';

/** Google's official multicolour 'G' glyph. Inlined so we don't carry a
 *  Google-branded asset file; the SVG paths are public branding material.
 *  Sized to sit cleanly next to a button label at our default font size. */
function GoogleGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function OrganisationTab() {
  // useOrgSession + the login/logout mutations all share the same TanStack
  // Query key, so every other consumer (sidebar 'Shared notes' row, profile
  // chip, AskBar gating) reacts immediately to a sign-in or sign-out here.
  const sessionQuery = useOrgSession();
  const loginMutation = useOrgLogin();
  const ssoGoogleMutation = useOrgSsoGoogle();
  const logoutMutation = useOrgLogout();
  const autoBackupQuery = useOrgAutoBackup();
  const setAutoBackup = useSetOrgAutoBackup();
  const status: OrgStatusResponse | null = sessionQuery.data ?? null;

  // Remember the last adapter URL the user typed/signed-in-against so they
  // don't have to retype on every sign-out. Falls back to localhost for
  // first-time / dev usage. The session itself stores its own copy, so this
  // is only consulted when the user is *not* currently signed in.
  const initialAdapterUrl = React.useMemo(() => {
    try {
      return localStorage.getItem(ORG_ADAPTER_URL_KEY) || ORG_ADAPTER_URL_DEFAULT;
    } catch {
      return ORG_ADAPTER_URL_DEFAULT;
    }
  }, []);
  const [adapterUrl, setAdapterUrl] = React.useState(initialAdapterUrl);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // Seed the form's adapter URL from the persisted session, once we know it.
  React.useEffect(() => {
    if (status?.adapterUrl) setAdapterUrl(status.adapterUrl);
  }, [status?.adapterUrl]);

  // Mirror the field into localStorage so the next sign-in lands with the
  // same URL pre-filled even if the user has signed out (which clears the
  // session record entirely).
  React.useEffect(() => {
    if (!adapterUrl) return;
    try { localStorage.setItem(ORG_ADAPTER_URL_KEY, adapterUrl); } catch (_) { /* private mode */ }
  }, [adapterUrl]);

  const busy =
    loginMutation.isPending ||
    logoutMutation.isPending ||
    ssoGoogleMutation.isPending;

  const onSignIn = async () => {
    setError(null);
    try {
      await loginMutation.mutateAsync({ adapterUrl, email, password });
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onGoogleSignIn = async () => {
    setError(null);
    try {
      await ssoGoogleMutation.mutateAsync(adapterUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSignOut = async () => {
    setError(null);
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section data-settings-tab="organisation">
      {status?.signedIn ? (
        <div
          className="mb-5 rounded-[10px] p-4"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
          }}
          data-testid="org-signed-in-card"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[14px] font-medium" style={{ color: 'var(--fg-1)' }}>
                Signed in as {status.name}
              </div>
              <div className="mt-0.5 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                {status.email} · org <span style={{ fontFamily: 'var(--font-mono)' }}>{status.orgId}</span>
              </div>
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {status.adapterUrl}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onSignOut}
              disabled={busy}
              className="h-[28px] px-3 text-[12px]"
            >
              Sign out
            </Button>
          </div>
          <div
            className="mt-4 flex items-start justify-between gap-4 border-t pt-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium" style={{ color: 'var(--fg-1)' }}>
                Auto-back up new notes
              </div>
              <div
                className="mt-0.5 text-[12px] leading-[1.5]"
                style={{ color: 'var(--fg-2)', maxWidth: '52ch' }}
              >
                Push every new note to your org's S3 once summarisation finishes. You can still
                unshare individual notes from the Shared notes view.
              </div>
            </div>
            <Switch
              checked={autoBackupQuery.data ?? true}
              onCheckedChange={(v) => setAutoBackup.mutate(v)}
              disabled={autoBackupQuery.data === undefined || setAutoBackup.isPending}
              aria-label="Auto-back up new notes to org"
            />
          </div>
        </div>
      ) : (
        <div
          className="mb-5 rounded-[10px] p-4"
          style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-subtle)',
          }}
          data-testid="org-sign-in-card"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                Adapter URL
              </label>
              <Input
                value={adapterUrl}
                onChange={(e) => setAdapterUrl(e.target.value)}
                placeholder="https://steno-adapter.yourcompany.com"
                className="h-[30px] rounded-[6px] bg-[color:var(--surface-raised)] text-[13px]"
                disabled={busy}
              />
            </div>

            {/* SSO — primary path for customer deployments. The button opens
                the system browser, waits for the Google sign-in to redirect
                back to a loopback port, and exchanges the code through the
                adapter (client_secret never touches this Mac). */}
            <div className="flex items-center gap-3">
              <Button
                onClick={onGoogleSignIn}
                disabled={busy || !adapterUrl}
                variant="outline"
                className={cn(COMPACT_BTN, 'gap-2')}
              >
                <GoogleGlyph />
                {ssoGoogleMutation.isPending ? 'Waiting for browser…' : 'Sign in with Google'}
              </Button>
              <span className="text-[12px]" style={{ color: 'var(--fg-2)' }}>
                Single sign-on via your organisation's Google Workspace.
              </span>
            </div>

            <div className="relative my-1 flex items-center gap-2">
              <span className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
              <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                or
              </span>
              <span className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                  Email
                </label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourcompany.com"
                  autoComplete="email"
                  className="h-[30px] rounded-[6px] bg-[color:var(--surface-raised)] text-[13px]"
                  disabled={busy}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[12px]" style={{ color: 'var(--fg-2)' }}>
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="current-password"
                  className="h-[30px] rounded-[6px] bg-[color:var(--surface-raised)] text-[13px]"
                  disabled={busy}
                  onKeyDown={(e) => {
                    // Mirror the Sign-in button's own disabled guard so the
                    // Enter shortcut can't fire a login while it's busy or a
                    // required field is empty (#305).
                    if (
                      e.key === 'Enter' &&
                      !busy &&
                      adapterUrl &&
                      email &&
                      password
                    ) {
                      void onSignIn();
                    }
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={onSignIn}
                disabled={busy || !adapterUrl || !email || !password}
                variant="ghost"
                className={COMPACT_BTN}
              >
                {loginMutation.isPending ? 'Signing in…' : 'Sign in with password'}
              </Button>
              {error && (
                <span className="text-[12px]" style={{ color: 'var(--danger, #b3261e)' }}>
                  {error}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

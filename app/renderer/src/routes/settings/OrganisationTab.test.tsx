import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganisationTab } from './OrganisationTab';
import { orgKeys } from '@/hooks/useOrg';

// Two independent bugs in OrganisationTab (#305):
//   (a) pressing Enter in the password field bypassed the sign-in button's own
//       disabled/busy guard, firing a login with empty required fields (or
//       while a sign-in was already in flight).
//   (b) onSignOut did not clear a stale prior error before mutating, unlike
//       onSignIn / onGoogleSignIn — so an old failure message reappeared once
//       the sign-out returned the user to the signed-out card.

const login = vi.fn(async () => ({ success: true }));
const ssoGoogleStart = vi.fn(async () => ({ success: true }));
const logout = vi.fn(async () => ({ signedIn: false }));
const getAutoBackup = vi.fn(async () => ({
  success: true,
  org_auto_backup_enabled: true,
}));

// Mutable so a test can flip the signed-in state and re-invalidate the query.
let statusValue: Record<string, unknown> = { signedIn: false };

vi.mock('@/lib/ipc', () => ({
  ipc: () => ({
    org: {
      status: async () => statusValue,
      login,
      ssoGoogleStart,
      logout,
      getAutoBackup,
    },
  }),
}));

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderTab(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <OrganisationTab />
    </QueryClientProvider>,
  );
}

describe('OrganisationTab', () => {
  beforeEach(() => {
    login.mockClear();
    ssoGoogleStart.mockClear();
    logout.mockClear();
    statusValue = { signedIn: false };
  });

  test('(a) Enter in the password field does not sign in while required fields are empty', async () => {
    const qc = makeClient();
    renderTab(qc);

    const password = await screen.findByPlaceholderText('••••••');
    // Email + password are empty, so the Sign-in button is disabled; the
    // Enter shortcut must respect the same guard and be a no-op.
    fireEvent.keyDown(password, { key: 'Enter' });

    // Give any (incorrect) async login a chance to fire, and let the
    // background status/auto-backup queries settle, before asserting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(login).not.toHaveBeenCalled();
  });

  test('(b) signing out clears a stale sign-in error', async () => {
    ssoGoogleStart.mockRejectedValueOnce(new Error('google boom'));
    const qc = makeClient();
    renderTab(qc);

    // 1. Trigger a Google sign-in failure so an error is shown.
    const googleBtn = await screen.findByRole('button', {
      name: /Sign in with Google/i,
    });
    fireEvent.click(googleBtn);
    await screen.findByText('google boom');

    // 2. Flip to signed-in so the Sign out button is reachable.
    statusValue = {
      signedIn: true,
      name: 'Ada',
      email: 'ada@corp.com',
      orgId: 'org_1',
      adapterUrl: 'http://localhost:8000',
    };
    await qc.invalidateQueries({ queryKey: orgKeys.status() });
    const signOut = await screen.findByRole('button', { name: 'Sign out' });

    // 3. Sign out returns us to the signed-out card. logout's onSuccess
    //    invalidates the status query, which now reports signed-out.
    statusValue = { signedIn: false };
    fireEvent.click(signOut);

    // The signed-out card comes back...
    await screen.findByPlaceholderText('••••••');
    // ...and the stale error must be gone.
    await waitFor(() => expect(screen.queryByText('google boom')).toBeNull());
  });
});

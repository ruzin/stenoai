import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * Race coverage for GeneralTab's calendar OAuth flow (#306) and the name-field
 * seed race (#307). Both are pre-existing behavioural bugs surfaced during the
 * Settings.tsx split review.
 *
 * These are unit tests, not Playwright: the connect/cancel mutations are mocked
 * so their promises resolve/reject by hand, making each race deterministic (no
 * real UI timing). The calendar + settings hooks are mocked directly (simpler
 * than mocking the ipc layer under two hook modules) so mutation pending/error
 * states can be controlled precisely per test.
 */

const h = vi.hoisted(() => {
  function defer<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const makeAuth = () => ({
    status: { data: { connected: false } },
    connect: {
      mutate: vi.fn(),
      mutateAsync: vi.fn(() => new Promise<void>(() => {})),
      isPending: false,
      error: null as Error | null,
      reset: vi.fn(),
    },
    cancel: { mutate: vi.fn() },
    disconnect: { mutate: vi.fn() },
  });
  return {
    defer,
    google: makeAuth(),
    outlook: makeAuth(),
    userName: { data: undefined as string | undefined, isPending: true, isPlaceholderData: false },
    setUserName: { mutate: vi.fn() },
  };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useGoogleCalendarAuth: () => h.google,
  useOutlookCalendarAuth: () => h.outlook,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/useSettings', () => {
  const q = (data: unknown) => ({ data, isPending: false, isPlaceholderData: false });
  const m = () => ({ mutate: vi.fn() });
  return {
    useNotificationsSetting: () => q(true),
    useSetNotifications: m,
    useSystemAudioSetting: () => q(true),
    useSetSystemAudio: m,
    useSystemAudioSupport: () => q({ supported: true, osVersion: '14.4' }),
    useAutoDetectMeetingsSetting: () => q(true),
    useSetAutoDetectMeetings: m,
    useSilenceAutoStopSetting: () =>
      q({ enabled: true, minutes: 15, supportedMinutes: [2, 5, 10, 15, 30] }),
    useSetSilenceAutoStopEnabled: m,
    useSetSilenceAutoStopMinutes: m,
    useDockIconSetting: () => q(false),
    useSetDockIcon: m,
    useUserName: () => h.userName,
    useSetUserName: () => h.setUserName,
  };
});

// Import after the mocks are registered.
import { GeneralTab } from './GeneralTab';

function resetAuth(auth: typeof h.google) {
  auth.status.data = { connected: false };
  auth.connect.mutate.mockReset();
  auth.connect.mutateAsync.mockReset();
  auth.connect.mutateAsync.mockImplementation(() => new Promise<void>(() => {}));
  auth.connect.isPending = false;
  auth.connect.error = null;
  auth.cancel.mutate.mockReset();
  auth.disconnect.mutate.mockReset();
}

beforeEach(() => {
  resetAuth(h.google);
  resetAuth(h.outlook);
  h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
  h.setUserName.mutate.mockReset();
});

// hidden:true because once the OAuth dialog is open (modal), Radix marks the
// rest of the page aria-hidden — the settings connect buttons are still in the
// DOM and clickable, just excluded from the default accessibility query.
const clickConnect = (name: 'Google' | 'Outlook') =>
  fireEvent.click(screen.getByRole('button', { name, hidden: true }));
const clickCancel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

describe('GeneralTab OAuth connect/cancel race (#306)', () => {
  test('Cancel while a connect is pending calls the provider cancel mutation', async () => {
    render(<GeneralTab />);
    await act(async () => {
      clickConnect('Google');
    });
    // Dialog is showing the pending state.
    expect(screen.getByText('Connecting to Google')).toBeTruthy();

    await act(async () => {
      clickCancel();
    });
    expect(h.google.cancel.mutate).toHaveBeenCalledTimes(1);
    expect(h.outlook.cancel.mutate).not.toHaveBeenCalled();
    // Dialog closed.
    expect(screen.queryByText('Connecting to Google')).toBeNull();
  });

  test("a 'Cancelled' rejection after dismiss does not reopen an error dialog", async () => {
    const d = h.defer<void>();
    h.google.connect.mutateAsync.mockReturnValueOnce(d.promise);
    render(<GeneralTab />);

    await act(async () => {
      clickConnect('Google');
    });
    await act(async () => {
      clickCancel();
    });
    // The connect mutation now rejects with the user-cancel contract message.
    await act(async () => {
      d.reject(new Error('Cancelled'));
      await d.promise.catch(() => {});
    });

    expect(screen.queryByText("Couldn't connect to Google")).toBeNull();
    expect(screen.queryByText('Connecting to Google')).toBeNull();
  });

  test('a late rejection after dismiss does not resurrect the dialog', async () => {
    const d = h.defer<void>();
    h.google.connect.mutateAsync.mockReturnValueOnce(d.promise);
    render(<GeneralTab />);

    await act(async () => {
      clickConnect('Google');
    });
    await act(async () => {
      clickCancel();
    });
    await act(async () => {
      d.reject(new Error('Timed out — no response from Google.'));
      await d.promise.catch(() => {});
    });

    expect(screen.queryByText("Couldn't connect to Google")).toBeNull();
    expect(screen.queryByText('Connecting to Google')).toBeNull();
  });

  test("a late rejection for provider A does not clobber provider B's pending state", async () => {
    const dGoogle = h.defer<void>();
    h.google.connect.mutateAsync.mockReturnValueOnce(dGoogle.promise);
    render(<GeneralTab />);

    await act(async () => {
      clickConnect('Google');
    });
    await act(async () => {
      clickCancel();
    });
    // Cancel released the in-flight lock, so a fresh provider can start even
    // while Google's abandoned mutation is still unsettled.

    await act(async () => {
      clickConnect('Outlook');
    });
    expect(screen.getByText('Connecting to Outlook')).toBeTruthy();

    // Google's abandoned attempt now rejects late — must not touch the dialog.
    await act(async () => {
      dGoogle.reject(new Error('Timed out — no response from Google.'));
      await dGoogle.promise.catch(() => {});
    });

    expect(screen.getByText('Connecting to Outlook')).toBeTruthy();
    expect(screen.queryByText("Couldn't connect to Google")).toBeNull();
  });

  test("a stale same-provider retry's late rejection does not overwrite the fresh attempt", async () => {
    const firstAttempt = h.defer<void>();
    // First Google attempt gets a controllable promise; the retry falls back to
    // the default never-resolving mock, so it stays pending.
    h.google.connect.mutateAsync.mockReturnValueOnce(firstAttempt.promise);
    render(<GeneralTab />);

    await act(async () => {
      clickConnect('Google');
    });
    await act(async () => {
      clickCancel();
    });
    // Immediately retry the SAME provider — a fresh pending attempt.
    await act(async () => {
      clickConnect('Google');
    });
    expect(screen.getByText('Connecting to Google')).toBeTruthy();

    // The original (abandoned) attempt rejects late with a non-Cancelled error.
    // provider + state still superficially match the fresh attempt, so only the
    // attempt token can tell them apart.
    await act(async () => {
      firstAttempt.reject(new Error('Timed out — no response from Google.'));
      await firstAttempt.promise.catch(() => {});
    });

    expect(screen.getByText('Connecting to Google')).toBeTruthy();
    expect(screen.queryByText("Couldn't connect to Google")).toBeNull();
  });

  test('two synchronous Connect clicks fire only one connect mutation', async () => {
    render(<GeneralTab />);
    const btn = screen.getByRole('button', { name: 'Google' });

    // Fire both clicks inside a SINGLE act with no await/flush between them, so
    // React has not re-rendered with the mutation's pending=true state yet.
    // A guard that reads react-query's isPending would see the stale false
    // snapshot on both and let two mutate()s through; a synchronous ref lock
    // (set before the first mutate) must drop the second.
    await act(async () => {
      btn.click();
      btn.click();
    });

    expect(h.google.connect.mutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('GeneralTab name-field seed race (#307)', () => {
  test('typing before the userName query resolves is not overwritten by the seed', async () => {
    h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
    const { rerender } = render(<GeneralTab />);

    const input = screen.getByTestId('user-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ruzin' } });
    expect(input.value).toBe('Ruzin');

    // The canonical value now arrives from disk.
    h.userName = { data: 'Old Name', isPending: false, isPlaceholderData: false };
    await act(async () => {
      rerender(<GeneralTab />);
    });

    // The user's in-progress edit must survive the late seed.
    expect((screen.getByTestId('user-name-input') as HTMLInputElement).value).toBe('Ruzin');
  });

  test('the field re-syncs from userName.data after the edit is committed on blur', async () => {
    h.userName = { data: undefined, isPending: true, isPlaceholderData: false };
    const { rerender } = render(<GeneralTab />);

    const input = screen.getByTestId('user-name-input') as HTMLInputElement;
    // Edit before the query resolves, then clear back to the placeholder ('').
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.change(input, { target: { value: '' } });
    // Blur commits: trimmed '' equals the (still-unresolved) placeholder '', so
    // nothing is persisted — but the editing session is now over.
    fireEvent.blur(input);
    expect(h.setUserName.mutate).not.toHaveBeenCalled();

    // The canonical value now arrives from disk. Since the edit was committed
    // (and saved nothing), the field must re-sync to it rather than stay blank.
    h.userName = { data: 'Ruzin', isPending: false, isPlaceholderData: false };
    await act(async () => {
      rerender(<GeneralTab />);
    });

    expect((screen.getByTestId('user-name-input') as HTMLInputElement).value).toBe('Ruzin');
  });
});

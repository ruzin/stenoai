import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Radix Select (used by the Microphone dropdown) checks these on the
// trigger/viewport at open time; jsdom doesn't implement them.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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
    microphone: { data: { device_id: null as string | null, label: null as string | null } },
    setMicrophone: { mutate: vi.fn() },
    audioInputDevices: [] as { deviceId: string; label: string }[],
    systemAudioSupport: {
      data: {
        supported: true,
        osVersion: '14.4',
        screenPermission: 'granted' as string,
        screenPermissionAtLaunch: 'granted' as string,
      },
      refetch: vi.fn(),
    },
    requestScreenRecording: { mutate: vi.fn(), isPending: false },
    openScreenRecordingSettings: { mutate: vi.fn() },
    relaunchApp: { mutate: vi.fn() },
  };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useGoogleCalendarAuth: () => h.google,
  useOutlookCalendarAuth: () => h.outlook,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

// jsdom's navigator.userAgent reports "darwin" (not "Macintosh"), so the real
// isMac constant evaluates false here — force it true so the macOS-only
// "Record system audio" row (isMac-gated in GeneralTab.tsx) is reachable.
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, isMac: true };
});

vi.mock('@/hooks/useSettings', () => {
  const q = (data: unknown) => ({ data, isPending: false, isPlaceholderData: false });
  const m = () => ({ mutate: vi.fn() });
  return {
    useNotificationsSetting: () => q(true),
    useSetNotifications: m,
    useSystemAudioSetting: () => q(true),
    useSetSystemAudio: m,
    useSystemAudioSupport: () => h.systemAudioSupport,
    useRequestScreenRecordingPermission: () => h.requestScreenRecording,
    useOpenScreenRecordingSettings: () => h.openScreenRecordingSettings,
    useRelaunchApp: () => h.relaunchApp,
    useAutoDetectMeetingsSetting: () => q(true),
    useSetAutoDetectMeetings: m,
    useLaunchOnLoginSetting: () => q(true),
    useSetLaunchOnLogin: m,
    useSilenceAutoStopSetting: () =>
      q({ enabled: true, minutes: 15, supportedMinutes: [2, 5, 10, 15, 30] }),
    useSetSilenceAutoStopEnabled: m,
    useSetSilenceAutoStopMinutes: m,
    useDockIconSetting: () => q(false),
    useSetDockIcon: m,
    useUserName: () => h.userName,
    useSetUserName: () => h.setUserName,
    useMicrophoneSetting: () => q(h.microphone.data),
    useSetMicrophone: () => h.setMicrophone,
  };
});

vi.mock('@/hooks/useAudioInputDevices', () => ({
  useAudioInputDevices: () => h.audioInputDevices,
}));

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
  h.microphone.data = { device_id: null, label: null };
  h.setMicrophone.mutate.mockReset();
  h.audioInputDevices = [];
  h.systemAudioSupport.data = {
    supported: true,
    osVersion: '14.4',
    screenPermission: 'granted',
    screenPermissionAtLaunch: 'granted',
  };
  h.systemAudioSupport.refetch.mockReset();
  h.requestScreenRecording.mutate.mockReset();
  h.requestScreenRecording.isPending = false;
  h.openScreenRecordingSettings.mutate.mockReset();
  h.relaunchApp.mutate.mockReset();
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

describe('GeneralTab Microphone setting', () => {
  test('shows "System Default" when no device is pinned', () => {
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'System Default',
    );
  });

  test('shows the persisted device label when one is pinned', () => {
    h.microphone.data = { device_id: 'abc123', label: 'USB Microphone' };
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'USB Microphone',
    );
  });

  test('falls back to a disconnected-device label when the pinned device is no longer enumerated', () => {
    h.microphone.data = { device_id: 'gone', label: 'Old USB Mic' };
    h.audioInputDevices = [{ deviceId: 'abc123', label: 'USB Microphone' }];
    render(<GeneralTab />);
    expect(screen.getByTestId('microphone-select').textContent).toContain(
      'Old USB Mic',
    );
  });

  test('picking a real device calls setMicrophone with its id and label', async () => {
    h.audioInputDevices = [
      { deviceId: 'abc123', label: 'USB Microphone' },
      { deviceId: 'def456', label: 'AirPods' },
    ];
    render(<GeneralTab />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('microphone-select'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'AirPods' }));
    });

    expect(h.setMicrophone.mutate).toHaveBeenCalledWith({
      deviceId: 'def456',
      label: 'AirPods',
    });
  });

  test('picking "System Default" clears the pinned device', async () => {
    h.microphone.data = { device_id: 'abc123', label: 'USB Microphone' };
    h.audioInputDevices = [{ deviceId: 'abc123', label: 'USB Microphone' }];
    render(<GeneralTab />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('microphone-select'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'System Default' }));
    });

    expect(h.setMicrophone.mutate).toHaveBeenCalledWith({ deviceId: 'default', label: '' });
  });

  // No dedicated test for "re-selecting the already-pinned disconnected
  // device preserves its stored label" (the fix for the label-overwrite bug
  // above onValueChange in GeneralTab.tsx): Radix's SelectItem.handleSelect
  // fires via onClick only when pointerTypeRef reads 'mouse' (set by a prior
  // real pointerdown/pointermove) or via onPointerUp otherwise — a bare
  // fireEvent.click on the CURRENTLY-selected item doesn't reliably trigger
  // either path in jsdom, unlike selecting a different item (which the tests
  // above cover fine). The fix itself is a one-line, side-effect-free
  // fallback verified by manual reasoning against Radix's source
  // (SelectItem.handleSelect calls context.onValueChange(value)
  // unconditionally, including for the already-selected value).
});

describe('GeneralTab Record system audio — Screen Recording permission', () => {
  test('granted: plain toggle description, no action buttons', () => {
    render(<GeneralTab />);
    expect(screen.getByText('Capture both sides of a call. Turn off to record your mic only.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grant Access' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Relaunch' })).toBeNull();
  });

  test('not-determined: shows a "Grant Access" button that requests permission', async () => {
    h.systemAudioSupport.data = { supported: true, osVersion: '14.4', screenPermission: 'not-determined', screenPermissionAtLaunch: 'not-determined' };
    render(<GeneralTab />);

    expect(
      screen.getByText(/Needs Screen Recording access first/),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Grant Access' }));
    });
    expect(h.requestScreenRecording.mutate).toHaveBeenCalledTimes(1);
  });

  test('denied: shows "Check Again" and "Open Settings" buttons', async () => {
    h.systemAudioSupport.data = { supported: true, osVersion: '14.4', screenPermission: 'denied', screenPermissionAtLaunch: 'denied' };
    render(<GeneralTab />);

    expect(screen.getByText(/Screen Recording access was denied/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    });
    expect(h.openScreenRecordingSettings.mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    });
    expect(h.systemAudioSupport.refetch).toHaveBeenCalledTimes(1);
  });

  test('restricted: same treatment as denied (MDM/parental controls)', () => {
    h.systemAudioSupport.data = { supported: true, osVersion: '14.4', screenPermission: 'restricted', screenPermissionAtLaunch: 'restricted' };
    render(<GeneralTab />);
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeTruthy();
  });

  test('permission flips to granted mid-session: prompts to relaunch instead of re-showing the request button', async () => {
    h.systemAudioSupport.data = { supported: true, osVersion: '14.4', screenPermission: 'not-determined', screenPermissionAtLaunch: 'not-determined' };
    const { rerender } = render(<GeneralTab />);
    expect(screen.getByRole('button', { name: 'Grant Access' })).toBeTruthy();

    // Permission granted (e.g. the user answered the native prompt) — the
    // query refetches and now reports 'granted'. screenPermissionAtLaunch
    // stays 'not-determined' — it's frozen at process start and only a
    // relaunch updates it, which is exactly what this test is asserting.
    h.systemAudioSupport.data = {
      supported: true,
      osVersion: '14.4',
      screenPermission: 'granted',
      screenPermissionAtLaunch: 'not-determined',
    };
    await act(async () => {
      rerender(<GeneralTab />);
    });

    expect(screen.getByText(/relaunch Steno to start capturing/)).toBeTruthy();
    const relaunchBtn = screen.getByRole('button', { name: 'Relaunch' });
    expect(relaunchBtn).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grant Access' })).toBeNull();

    await act(async () => {
      fireEvent.click(relaunchBtn);
    });
    expect(h.relaunchApp.mutate).toHaveBeenCalledTimes(1);
  });

  test('permission already granted when the app launched: no relaunch prompt', () => {
    // Distinguishes "was already granted at launch" from "granted mid-session"
    // — the whole point of needsRelaunchForScreenRecording tracking the
    // FIRST observed value, not just the current one.
    h.systemAudioSupport.data = {
      supported: true,
      osVersion: '14.4',
      screenPermission: 'granted',
      screenPermissionAtLaunch: 'granted',
    };
    render(<GeneralTab />);
    expect(screen.queryByRole('button', { name: 'Relaunch' })).toBeNull();
  });

  test('unsupported macOS version: no permission action buttons even if screenPermission reads not-determined/denied', () => {
    // getMediaAccessStatus('screen') predates the 14.4 loopback requirement,
    // so it can still return a non-'granted' value on an unsupported OS —
    // the toggle below is already disabled for OS-version reasons, so no
    // actionable-looking button should appear alongside it.
    h.systemAudioSupport.data = {
      supported: false,
      osVersion: '13.0',
      screenPermission: 'not-determined',
      screenPermissionAtLaunch: 'not-determined',
    };
    render(<GeneralTab />);
    expect(screen.getByText(/requires macOS 14.4\+/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grant Access' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check Again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Relaunch' })).toBeNull();
  });
});

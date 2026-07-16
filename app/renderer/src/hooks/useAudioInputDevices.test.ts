import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAudioInputDevices } from './useAudioInputDevices';

/**
 * Regression coverage for the deviceId collision fixed during review: Chromium
 * synthesizes 'default'/'communications' pseudo-devices (e.g. {deviceId:
 * 'default', label: 'Default - AirPods'}) that alias whatever the OS currently
 * considers default. Settings' own "System Default" sentinel in GeneralTab.tsx
 * also uses the literal string 'default' as its Select value — if the real
 * synthetic device weren't filtered out here, picking "Default - AirPods" from
 * the dropdown would collide with that sentinel and silently be treated as
 * "clear to system default" instead of pinning the AirPods device.
 */

let devices: MediaDeviceInfo[] = [];
const enumerateDevices = vi.fn(async () => devices);
const listeners: Record<string, (() => void)[]> = {};
const addEventListener = vi.fn((event: string, cb: () => void) => {
  (listeners[event] ??= []).push(cb);
});
const removeEventListener = vi.fn((event: string, cb: () => void) => {
  listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb);
});

const mkDevice = (deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput') =>
  ({ deviceId, label, kind, groupId: '' }) as MediaDeviceInfo;

beforeEach(() => {
  devices = [];
  enumerateDevices.mockClear();
  addEventListener.mockClear();
  removeEventListener.mockClear();
  listeners.devicechange = [];
  vi.stubGlobal('navigator', {
    ...navigator,
    mediaDevices: { enumerateDevices, addEventListener, removeEventListener },
  });
});

describe('useAudioInputDevices', () => {
  test('returns real audioinput devices', async () => {
    devices = [
      mkDevice('abc123', 'USB Microphone'),
      mkDevice('vid1', 'FaceTime Camera', 'videoinput'),
      mkDevice('out1', 'Speakers', 'audiooutput'),
    ];
    const { result } = renderHook(() => useAudioInputDevices());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current).toEqual([{ deviceId: 'abc123', label: 'USB Microphone' }]);
  });

  test('filters out the synthetic "default"/"communications" pseudo-devices', async () => {
    devices = [
      mkDevice('default', 'Default - AirPods'),
      mkDevice('communications', 'Communications - AirPods'),
      mkDevice('f3b150...', 'AirPods'),
      mkDevice('8a90d8...', 'MacBook Pro Microphone (Built-in)'),
    ];
    const { result } = renderHook(() => useAudioInputDevices());
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map((d) => d.deviceId)).toEqual(['f3b150...', '8a90d8...']);
  });

  test('re-queries on devicechange', async () => {
    devices = [mkDevice('abc123', 'USB Microphone')];
    const { result } = renderHook(() => useAudioInputDevices());
    await waitFor(() => expect(result.current).toHaveLength(1));

    devices = [mkDevice('abc123', 'USB Microphone'), mkDevice('xyz789', 'Bluetooth Headset')];
    listeners.devicechange.forEach((cb) => cb());
    await waitFor(() => expect(result.current).toHaveLength(2));
  });

  test('leaves the list empty (not throwing) when enumerateDevices rejects', async () => {
    enumerateDevices.mockRejectedValueOnce(new Error('permission denied'));
    const { result } = renderHook(() => useAudioInputDevices());
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});

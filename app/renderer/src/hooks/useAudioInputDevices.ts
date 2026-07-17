import * as React from 'react';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

// Chromium synthesizes 'default'/'communications' pseudo-devices (e.g.
// {deviceId: 'default', label: 'Default - AirPods'}) that just alias
// whatever the OS currently considers default — the same thing Settings'
// own "System Default" sentinel already means. Excluded here so a caller
// can safely reserve those id strings for its own sentinel value without a
// real enumerated device colliding with it.
const SYNTHETIC_DEVICE_IDS = new Set(['default', 'communications']);

/**
 * Enumerates available microphone (audioinput) devices via the Web
 * MediaDevices API — purely renderer-side, no IPC involved. Labels are only
 * populated once mic permission has been granted at least once (guaranteed
 * by the app's existing mic-permission flow); until then devices come back
 * with empty labels. Re-queries whenever a device is plugged/unplugged.
 */
export function useAudioInputDevices(): AudioInputDevice[] {
  const [devices, setDevices] = React.useState<AudioInputDevice[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setDevices(
          all
            .filter((d) => d.kind === 'audioinput' && !SYNTHETIC_DEVICE_IDS.has(d.deviceId))
            .map((d) => ({ deviceId: d.deviceId, label: d.label })),
        );
      } catch {
        // No mic permission yet / API unavailable — leave the list empty,
        // the Settings UI falls back to showing only "System Default".
      }
    };

    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  return devices;
}

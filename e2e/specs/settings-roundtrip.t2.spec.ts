import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * T2 — settings get/set round-trip. Drives the real backend's settings IPC and
 * asserts each value persists to the right config.json key in the temp user-data
 * dir. Model-free + deterministic (pure config writes via the Python CLI). The
 * side-effecting settings (storage-path, which creates dirs) get their own test;
 * the network/model ones (model pulls, test-cloud-api) are out of scope here.
 */

type SettingKind =
  | 'language'
  | 'userName'
  | 'keepRecordings'
  | 'silenceEnabled'
  | 'silenceMinutes'
  | 'systemAudio'
  | 'telemetry'
  | 'transcriptionEngine'
  | 'dockIcon';

type SettingsBridge = {
  settings: {
    setLanguage: (v: string) => Promise<unknown>;
    setUserName: (v: string) => Promise<unknown>;
    setKeepRecordings: (v: boolean) => Promise<unknown>;
    setSilenceAutoStopEnabled: (v: boolean) => Promise<unknown>;
    setSilenceAutoStopMinutes: (v: number) => Promise<unknown>;
    setSystemAudio: (v: boolean) => Promise<unknown>;
    setTelemetry: (v: boolean) => Promise<unknown>;
    setDockIcon: (v: boolean) => Promise<unknown>;
    setStoragePath: (p: string) => Promise<{ success?: boolean; error?: string }>;
  };
  transcriptionEngine: { set: (v: string) => Promise<unknown> };
};
type StenoWindow = Window & { stenoai: SettingsBridge };

type Case = { kind: SettingKind; value: string | boolean | number; configKey: string };

// Each case: drive the setter, then assert the persisted config.json key. The
// expected value IS what we set, so this catches a setter writing the wrong key,
// dropping the value, or coercing it.
const CASES: Case[] = [
  { kind: 'language', value: 'fr', configKey: 'language' },
  { kind: 'userName', value: 'E2E Tester', configKey: 'user_name' },
  { kind: 'keepRecordings', value: true, configKey: 'keep_recordings' },
  { kind: 'silenceEnabled', value: false, configKey: 'silence_auto_stop_enabled' },
  { kind: 'silenceMinutes', value: 15, configKey: 'silence_auto_stop_minutes' },
  { kind: 'systemAudio', value: true, configKey: 'system_audio_enabled' },
  { kind: 'telemetry', value: false, configKey: 'telemetry_enabled' },
  { kind: 'transcriptionEngine', value: 'whisper', configKey: 'transcription_engine' },
  { kind: 'dockIcon', value: true, configKey: 'hide_dock_icon' },
];

function readConfig(userDataDir: string): Record<string, unknown> {
  const p = path.join(userDataDir, 'config.json');
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function applySetting(
  page: import('@playwright/test').Page,
  kind: SettingKind,
  value: string | boolean | number,
) {
  return page.evaluate(
    ({ kind, value }) => {
      const s = (window as StenoWindow).stenoai;
      switch (kind) {
        case 'language':
          return s.settings.setLanguage(value as string);
        case 'userName':
          return s.settings.setUserName(value as string);
        case 'keepRecordings':
          return s.settings.setKeepRecordings(value as boolean);
        case 'silenceEnabled':
          return s.settings.setSilenceAutoStopEnabled(value as boolean);
        case 'silenceMinutes':
          return s.settings.setSilenceAutoStopMinutes(value as number);
        case 'systemAudio':
          return s.settings.setSystemAudio(value as boolean);
        case 'telemetry':
          return s.settings.setTelemetry(value as boolean);
        case 'dockIcon':
          return s.settings.setDockIcon(value as boolean);
        case 'transcriptionEngine':
          return s.transcriptionEngine.set(value as string);
        default:
          throw new Error(`unknown setting kind: ${kind}`);
      }
    },
    { kind, value },
  );
}

test('settings setters persist each value to the right config.json key; real dir untouched', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  for (const { kind, value, configKey } of CASES) {
    await applySetting(page, kind, value);
    await expect
      .poll(() => readConfig(userDataDir)[configKey], {
        message: `${kind} -> config.${configKey}`,
      })
      .toBe(value);
  }

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

test('set-storage-path persists the path and provisions its data subdirs', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());
  const { page } = await launchApp();

  // A fresh absolute path inside the temp dir (set-storage-path requires an
  // absolute, writable location and provisions recordings/transcripts/output).
  const target = path.join(userDataDir, 'custom-storage');
  const res = await page.evaluate(
    (p) => (window as StenoWindow).stenoai.settings.setStoragePath(p),
    target,
  );
  expect(res.success).toBe(true);

  await expect.poll(() => readConfig(userDataDir).storage_path).toBe(target);
  for (const sub of ['recordings', 'transcripts', 'output']) {
    expect(existsSync(path.join(target, sub))).toBe(true);
  }

  // Keystone: the real user-data dir is byte-for-byte untouched.
  expect(fileSig(realUserDataDir())).toBe(realDirBefore);
});

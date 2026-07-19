import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type TelemetryToggleSource } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export const settingsKeys = {
  all: ['settings'] as const,
  notifications: () => [...settingsKeys.all, 'notifications'] as const,
  telemetry: () => [...settingsKeys.all, 'telemetry'] as const,
  dockIcon: () => [...settingsKeys.all, 'dockIcon'] as const,
  menuBarIcon: () => [...settingsKeys.all, 'menuBarIcon'] as const,
  systemAudio: () => [...settingsKeys.all, 'systemAudio'] as const,
  systemAudioSupport: () => [...settingsKeys.all, 'systemAudioSupport'] as const,
  autoDetectMeetings: () => [...settingsKeys.all, 'autoDetectMeetings'] as const,
  premeetingNotifications: () => [...settingsKeys.all, 'premeetingNotifications'] as const,
  launchOnLogin: () => [...settingsKeys.all, 'launchOnLogin'] as const,
  silenceAutoStop: () => [...settingsKeys.all, 'silenceAutoStop'] as const,
  language: () => [...settingsKeys.all, 'language'] as const,
  microphone: () => [...settingsKeys.all, 'microphone'] as const,
  storagePath: () => [...settingsKeys.all, 'storagePath'] as const,
  appVersion: () => [...settingsKeys.all, 'appVersion'] as const,
  userName: () => [...settingsKeys.all, 'userName'] as const,
};

export function useNotificationsSetting() {
  return useQuery({
    queryKey: settingsKeys.notifications(),
    queryFn: async () => unwrap(await ipc().settings.getNotifications()).notifications_enabled,
  });
}

export function useSetNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setNotifications(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.notifications() }),
  });
}

export function useTelemetrySetting() {
  return useQuery({
    queryKey: settingsKeys.telemetry(),
    queryFn: async () => unwrap(await ipc().settings.getTelemetry()),
  });
}

export function useSetTelemetry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ enabled, source }: { enabled: boolean; source: TelemetryToggleSource }) =>
      unwrap(await ipc().settings.setTelemetry(enabled, source)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.telemetry() }),
  });
}

export function useDockIconSetting() {
  return useQuery({
    queryKey: settingsKeys.dockIcon(),
    queryFn: async () => unwrap(await ipc().settings.getDockIcon()).hide_dock_icon,
  });
}

export function useSetDockIcon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setDockIcon(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.dockIcon() }),
  });
}

export function useShowMenuBarIconSetting() {
  return useQuery({
    queryKey: settingsKeys.menuBarIcon(),
    queryFn: async () => unwrap(await ipc().settings.getMenuBarIcon()).show_menu_bar_icon,
  });
}

export function useSetShowMenuBarIcon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setMenuBarIcon(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.menuBarIcon() }),
  });
}

export function useSystemAudioSetting() {
  return useQuery({
    queryKey: settingsKeys.systemAudio(),
    queryFn: async () => unwrap(await ipc().settings.getSystemAudio()).system_audio_enabled,
  });
}

export function useSetSystemAudio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setSystemAudio(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.systemAudio() }),
  });
}

export function useSystemAudioSupport() {
  return useQuery({
    queryKey: settingsKeys.systemAudioSupport(),
    queryFn: async () => unwrap(await ipc().recording.getSystemAudioSupport()),
    staleTime: Infinity,
  });
}

/** macOS only: safely triggers the native Screen Recording prompt for a
 *  'not-determined' user (see ipc.ts for why this must NOT go through the
 *  recording capture path). Re-fetches systemAudioSupport afterward so the
 *  Settings row's message updates immediately — actually using the
 *  permission still needs a relaunch (see useRelaunchApp usage below). */
export function useRequestScreenRecordingPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await ipc().perm.requestScreenRecording()),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.systemAudioSupport() }),
  });
}

/** Deep-links to System Settings > Screen Recording for the denied/restricted
 *  case, where macOS won't show the native prompt again. */
export function useOpenScreenRecordingSettings() {
  return useMutation({
    mutationFn: async () => unwrap(await ipc().perm.openScreenRecordingSettings()),
  });
}

/** The process exits before this ever resolves — callers fire-and-forget. */
export function useRelaunchApp() {
  return useMutation({
    mutationFn: async () => {
      void ipc().app.relaunch();
    },
  });
}

export function useAutoDetectMeetingsSetting() {
  return useQuery({
    queryKey: settingsKeys.autoDetectMeetings(),
    queryFn: async () => unwrap(await ipc().settings.getAutoDetectMeetings()).auto_detect_meetings_enabled,
  });
}

export function useSetAutoDetectMeetings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setAutoDetectMeetings(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.autoDetectMeetings() }),
  });
}

export function usePremeetingNotificationsSetting() {
  return useQuery({
    queryKey: settingsKeys.premeetingNotifications(),
    queryFn: async () =>
      unwrap(await ipc().settings.getPremeetingNotifications()).premeeting_notifications_enabled,
  });
}

export function useSetPremeetingNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setPremeetingNotifications(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.premeetingNotifications() }),
  });
}

export function useLaunchOnLoginSetting() {
  return useQuery({
    queryKey: settingsKeys.launchOnLogin(),
    queryFn: async () => unwrap(await ipc().settings.getLaunchOnLogin()).launch_on_login,
  });
}

export function useSetLaunchOnLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setLaunchOnLogin(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.launchOnLogin() }),
  });
}

export function useLanguageSetting() {
  return useQuery({
    queryKey: settingsKeys.language(),
    queryFn: async () => unwrap(await ipc().settings.getLanguage()).language,
  });
}

export function useSetLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => unwrap(await ipc().settings.setLanguage(code)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.language() }),
  });
}

export function useMicrophoneSetting() {
  return useQuery({
    queryKey: settingsKeys.microphone(),
    queryFn: async () => unwrap(await ipc().settings.getMicrophone()),
  });
}

export function useSetMicrophone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ deviceId, label }: { deviceId: string; label: string }) =>
      unwrap(await ipc().settings.setMicrophone(deviceId, label)),
    // Write the mutation's own result straight into the cache instead of
    // invalidating: a bare invalidate leaves a window where a recording
    // started immediately after switching mics (via ensureQueryData in
    // useSystemAudioCapture.ts) could still read the pre-switch cached
    // value before the refetch lands.
    onSuccess: (result) => qc.setQueryData(settingsKeys.microphone(), result),
  });
}

export function useStoragePath() {
  return useQuery({
    queryKey: settingsKeys.storagePath(),
    queryFn: async () => unwrap(await ipc().settings.getStoragePath()),
  });
}

export function useSetStoragePath() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => unwrap(await ipc().settings.setStoragePath(path)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.storagePath() }),
  });
}

export function usePickStorageFolder() {
  return useMutation({
    mutationFn: async () => unwrap(await ipc().settings.pickStorageFolder()).folderPath,
  });
}

export function useAppVersion() {
  return useQuery({
    queryKey: settingsKeys.appVersion(),
    queryFn: async () => unwrap(await ipc().app.getVersion()),
    staleTime: Infinity,
  });
}

export function useClearSystemState() {
  return useMutation({
    mutationFn: async () => unwrap(await ipc().system.clearState()),
  });
}

// Mirror the persisted user name into sessionStorage so the next mount in
// the same session has the value synchronously and the chat greeting
// doesn't flash 'Ask anything' before flipping to 'Hi <name>, ...'.
const USER_NAME_CACHE_KEY = 'steno-user-name';

function readCachedUserName(): string {
  try {
    return sessionStorage.getItem(USER_NAME_CACHE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeCachedUserName(name: string) {
  try {
    sessionStorage.setItem(USER_NAME_CACHE_KEY, name);
  } catch {
    // Storage may be unavailable in private mode — graceful degradation.
  }
}

export function useUserName() {
  return useQuery({
    queryKey: settingsKeys.userName(),
    queryFn: async () => {
      const name = unwrap(await ipc().settings.getUserName()).user_name;
      writeCachedUserName(name);
      return name;
    },
    // The name only changes via useSetUserName (which invalidates this
    // key), so once we have it there's no reason to refetch on remount.
    staleTime: Infinity,
    // placeholderData (NOT initialData) so the query still fetches the
    // canonical value from disk on first mount. initialData was marking
    // the query as already-fresh — combined with staleTime: Infinity that
    // suppressed the queryFn entirely, so the greeting was stuck on the
    // empty sessionStorage default forever.
    placeholderData: readCachedUserName(),
  });
}

export function useSetUserName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await ipc().settings.setUserName(name)),
    onSuccess: (_data, name) => {
      writeCachedUserName(name.trim());
      qc.invalidateQueries({ queryKey: settingsKeys.userName() });
    },
  });
}

export function useKeepRecordingsSetting() {
  return useQuery({
    queryKey: [...settingsKeys.all, 'keepRecordings'] as const,
    queryFn: async () => unwrap(await ipc().settings.getKeepRecordings()).keep_recordings,
  });
}

export function useSetKeepRecordings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setKeepRecordings(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...settingsKeys.all, 'keepRecordings'] }),
  });
}

export function useAutoSummarizeSetting() {
  return useQuery({
    queryKey: [...settingsKeys.all, 'autoSummarize'] as const,
    queryFn: async () => unwrap(await ipc().settings.getAutoSummarize()).auto_summarize_enabled,
  });
}

export function useSetAutoSummarize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setAutoSummarize(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...settingsKeys.all, 'autoSummarize'] }),
  });
}

/** Toggle + duration for the renderer-side silence detector. Defaults
 *  to enabled / 15 minutes (matches Granola). Returns the supported
 *  minutes list too so the Settings dropdown is driven by the same
 *  source of truth as the persisted-value validation. */
export function useSilenceAutoStopSetting() {
  return useQuery({
    queryKey: settingsKeys.silenceAutoStop(),
    queryFn: async () => {
      const res = unwrap(await ipc().settings.getSilenceAutoStop());
      return {
        enabled: res.silence_auto_stop_enabled,
        minutes: res.silence_auto_stop_minutes,
        supportedMinutes: res.supported_minutes,
      };
    },
  });
}

export function useSetSilenceAutoStopEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: boolean) =>
      unwrap(await ipc().settings.setSilenceAutoStopEnabled(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.silenceAutoStop() }),
  });
}

export function useSetSilenceAutoStopMinutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number) =>
      unwrap(await ipc().settings.setSilenceAutoStopMinutes(v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.silenceAutoStop() }),
  });
}

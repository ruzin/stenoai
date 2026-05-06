import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export const settingsKeys = {
  all: ['settings'] as const,
  notifications: () => [...settingsKeys.all, 'notifications'] as const,
  telemetry: () => [...settingsKeys.all, 'telemetry'] as const,
  dockIcon: () => [...settingsKeys.all, 'dockIcon'] as const,
  systemAudio: () => [...settingsKeys.all, 'systemAudio'] as const,
  language: () => [...settingsKeys.all, 'language'] as const,
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
    mutationFn: async (v: boolean) => unwrap(await ipc().settings.setTelemetry(v)),
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

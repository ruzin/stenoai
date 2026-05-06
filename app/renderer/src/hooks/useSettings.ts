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

export function useUserName() {
  return useQuery({
    queryKey: settingsKeys.userName(),
    queryFn: async () => unwrap(await ipc().settings.getUserName()).user_name,
  });
}

export function useSetUserName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await ipc().settings.setUserName(name)),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.userName() }),
  });
}

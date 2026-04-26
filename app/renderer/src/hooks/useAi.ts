import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import type { AiProvider, CloudProvider } from '@/lib/ipc';
import { modelsKeys } from '@/hooks/useModels';

export const aiKeys = {
  all: ['ai'] as const,
  provider: () => [...aiKeys.all, 'provider'] as const,
};

export function useAiProvider() {
  return useQuery({
    queryKey: aiKeys.provider(),
    queryFn: async () => unwrap(await ipc().ai.getProvider()),
  });
}

export function useSetAiProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: AiProvider) => unwrap(await ipc().ai.setProvider(p)),
    onMutate: async (p) => {
      await qc.cancelQueries({ queryKey: aiKeys.provider() });
      const previous = qc.getQueryData(aiKeys.provider());
      qc.setQueryData(aiKeys.provider(), (old: Record<string, unknown> | undefined) => ({
        ...old,
        ai_provider: p,
      }));
      return { previous };
    },
    onError: (_err, _p, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(aiKeys.provider(), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: aiKeys.provider() });
      qc.invalidateQueries({ queryKey: modelsKeys.list() });
    },
  });
}

export function useSetRemoteOllamaUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => unwrap(await ipc().ai.setRemoteOllamaUrl(url)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.provider() }),
  });
}

export function useTestRemoteOllama() {
  return useMutation({
    mutationFn: async (url: string) => unwrap(await ipc().ai.testRemoteOllama(url)),
  });
}

export function useSetCloudApiUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => unwrap(await ipc().ai.setCloudApiUrl(url)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.provider() }),
  });
}

export function useSetCloudApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => unwrap(await ipc().ai.setCloudApiKey(key)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.provider() }),
  });
}

export function useSetCloudProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: CloudProvider) => unwrap(await ipc().ai.setCloudProvider(p)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.provider() }),
  });
}

export function useSetCloudModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: string) => unwrap(await ipc().ai.setCloudModel(m)),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiKeys.provider() }),
  });
}

export function useTestCloudApi() {
  return useMutation({
    mutationFn: async () => unwrap(await ipc().ai.testCloudApi()),
  });
}

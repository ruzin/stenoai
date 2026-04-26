import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type ListedModel } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export const modelsKeys = {
  all: ['models'] as const,
  list: () => [...modelsKeys.all, 'list'] as const,
  current: () => [...modelsKeys.all, 'current'] as const,
  ollama: () => [...modelsKeys.all, 'ollama'] as const,
};

function parseSizeGb(size?: string): number | undefined {
  if (!size) return undefined;
  const match = size.match(/^([\d.]+)\s*(GB|MB|KB|B)?$/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? 'B').toUpperCase();
  if (unit === 'GB') return value;
  if (unit === 'MB') return value / 1024;
  if (unit === 'KB') return value / (1024 * 1024);
  return value / (1024 * 1024 * 1024);
}

export function useModels() {
  return useQuery({
    queryKey: modelsKeys.list(),
    queryFn: async (): Promise<{ models: ListedModel[]; current: string; provider: string }> => {
      const raw = unwrap(await ipc().models.list());
      const models: ListedModel[] = Object.entries(raw.supported_models).map(([id, info]) => ({
        name: id,
        displayName: info.name,
        size_gb: parseSizeGb(info.size),
        installed: info.installed ?? false,
        current: id === raw.current_model,
        deprecated: info.deprecated,
        description: info.description,
        speed: info.speed,
        quality: info.quality,
      }));
      return { models, current: raw.current_model, provider: raw.provider };
    },
  });
}

export function useCurrentModel() {
  return useQuery({
    queryKey: modelsKeys.current(),
    queryFn: async () => unwrap(await ipc().models.getCurrent()).model,
  });
}

export function useOllamaStatus() {
  return useQuery({
    queryKey: modelsKeys.ollama(),
    queryFn: async () => unwrap(await ipc().models.checkOllama()),
  });
}

export function useSetCurrentModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await ipc().models.set(name)),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: modelsKeys.current() });
      const previous = qc.getQueryData(modelsKeys.current());
      qc.setQueryData(modelsKeys.current(), name);
      return { previous };
    },
    onError: (_err, _name, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(modelsKeys.current(), ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: modelsKeys.all }),
  });
}

export function usePullModel() {
  const qc = useQueryClient();
  const [progress, setProgress] = React.useState<Record<string, string>>({});
  const [pendingSelect, setPendingSelect] = React.useState<string | null>(null);

  React.useEffect(() => {
    const offProgress = ipc().on.modelPullProgress(({ model, progress: p }) => {
      setProgress((prev) => ({ ...prev, [model]: p }));
    });
    const offComplete = ipc().on.modelPullComplete(async ({ model, success }) => {
      setProgress((prev) => {
        const { [model]: _drop, ...rest } = prev;
        return rest;
      });
      if (success && pendingSelect === model) {
        await ipc().models.set(model);
        setPendingSelect(null);
      }
      qc.invalidateQueries({ queryKey: modelsKeys.all });
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [qc, pendingSelect]);

  const pullAndSelect = async (name: string) => {
    setPendingSelect(name);
    unwrap(await ipc().models.pull(name));
  };

  const mutation = useMutation({
    mutationFn: pullAndSelect,
  });

  return { ...mutation, progress };
}

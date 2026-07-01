import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type ListedModel, type TranscriptionEngine } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { PARAKEET_LANGUAGE_CODES } from '@/lib/transcription-languages';

export const modelsKeys = {
  all: ['models'] as const,
  list: () => [...modelsKeys.all, 'list'] as const,
  current: () => [...modelsKeys.all, 'current'] as const,
  ollama: () => [...modelsKeys.all, 'ollama'] as const,
};

export const whisperKeys = {
  all: ['whisperModels'] as const,
  list: () => [...whisperKeys.all, 'list'] as const,
};

export const parakeetKeys = {
  all: ['parakeetModels'] as const,
  list: () => [...parakeetKeys.all, 'list'] as const,
  status: () => [...parakeetKeys.all, 'status'] as const,
};

export const transcriptionEngineKeys = {
  all: ['transcriptionEngine'] as const,
  current: () => [...transcriptionEngineKeys.all, 'current'] as const,
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

// ---------------------------------------------------------------------------
// Whisper models (mirrors the Ollama pattern above)
// ---------------------------------------------------------------------------

export function useWhisperModels() {
  return useQuery({
    queryKey: whisperKeys.list(),
    queryFn: async (): Promise<{ models: ListedModel[]; current: string }> => {
      const raw = unwrap(await ipc().whisperModels.list());
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
      return { models, current: raw.current_model };
    },
  });
}

export function useSetWhisperModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => unwrap(await ipc().whisperModels.set(name)),
    onSuccess: () => qc.invalidateQueries({ queryKey: whisperKeys.all }),
  });
}

export function usePullWhisperModel() {
  const qc = useQueryClient();
  const [progress, setProgress] = React.useState<Record<string, string>>({});
  const [pendingSelect, setPendingSelect] = React.useState<string | null>(null);

  React.useEffect(() => {
    const offProgress = ipc().on.whisperPullProgress(({ model, progress: p }) => {
      setProgress((prev) => ({ ...prev, [model]: p }));
    });
    const offComplete = ipc().on.whisperPullComplete(async ({ model, success }) => {
      setProgress((prev) => {
        const { [model]: _drop, ...rest } = prev;
        return rest;
      });
      if (success && pendingSelect === model) {
        await ipc().whisperModels.set(model);
        await ipc().transcriptionEngine.set('whisper');
        setPendingSelect(null);
      }
      qc.invalidateQueries({ queryKey: whisperKeys.all });
      qc.invalidateQueries({ queryKey: transcriptionEngineKeys.all });
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [qc, pendingSelect]);

  const pullAndSelect = async (name: string) => {
    setPendingSelect(name);
    unwrap(await ipc().whisperModels.pull(name));
  };

  const mutation = useMutation({
    mutationFn: pullAndSelect,
  });

  return { ...mutation, progress };
}

// ---------------------------------------------------------------------------
// Parakeet models — same shape as the Whisper hooks above so the unified
// TranscriptionModelList can fold both lists with identical card-action wiring.
// ---------------------------------------------------------------------------

export function useParakeetModels() {
  return useQuery({
    queryKey: parakeetKeys.list(),
    queryFn: async (): Promise<{ models: ListedModel[]; current: string }> => {
      const raw = unwrap(await ipc().parakeetModels.list());
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
      return { models, current: raw.current_model };
    },
  });
}

export function usePullParakeetModel() {
  const qc = useQueryClient();
  // Parakeet only has the one model today, but keyed-by-id state still
  // matches the Whisper hook shape so the UI doesn't fork on engine.
  const [progress, setProgress] = React.useState<Record<string, string>>({});
  const [pendingSelect, setPendingSelect] = React.useState<string | null>(null);

  React.useEffect(() => {
    const offProgress = ipc().on.parakeetPullProgress(({ model, stage }) => {
      // Coarse staged progress ("downloading"/"loading") rather than a
      // percentage — see src/parakeet_models.py for rationale. UI shows
      // a localised label per stage.
      const key = model ?? 'mlx-community/parakeet-tdt-0.6b-v3';
      setProgress((prev) => ({ ...prev, [key]: stage }));
    });
    const offComplete = ipc().on.parakeetPullComplete(async ({ model, success }) => {
      const key = model ?? 'mlx-community/parakeet-tdt-0.6b-v3';
      setProgress((prev) => {
        const { [key]: _drop, ...rest } = prev;
        return rest;
      });
      if (success && pendingSelect === key) {
        // Same coercion as an explicit switch: auto-selecting Parakeet after a
        // download must not leave a Whisper-only pin (e.g. 'ja') in config.
        await coerceLanguageForParakeet();
        await ipc().transcriptionEngine.set('parakeet');
        setPendingSelect(null);
        // Coercion may have reset the pin to 'auto'; refresh the language query
        // so the Settings dropdown + live dock toggle don't show the stale
        // pre-coercion code. Mirrors useSetActiveTranscription's onSuccess.
        qc.invalidateQueries({ queryKey: ['settings', 'language'] });
      }
      qc.invalidateQueries({ queryKey: parakeetKeys.all });
      qc.invalidateQueries({ queryKey: transcriptionEngineKeys.all });
    });
    return () => {
      offProgress();
      offComplete();
    };
  }, [qc, pendingSelect]);

  const pullAndSelect = async (id: string) => {
    setPendingSelect(id);
    unwrap(await ipc().parakeetModels.pull(id));
  };

  const mutation = useMutation({
    mutationFn: pullAndSelect,
  });

  return { ...mutation, progress };
}

// ---------------------------------------------------------------------------
// Active ASR engine — the toggle that gates which engine the live VAD pipeline
// and the post-stop batch transcriber load.
// ---------------------------------------------------------------------------

export function useTranscriptionEngine() {
  return useQuery({
    queryKey: transcriptionEngineKeys.current(),
    queryFn: async (): Promise<TranscriptionEngine> => {
      const raw = unwrap(await ipc().transcriptionEngine.get());
      return raw.engine;
    },
  });
}

// Activating Parakeet must drop a pin Parakeet can't honour as an output
// language (a Whisper-only 'hi'/'ja'/…) back to 'auto' — otherwise the config
// and live-recording metadata keep a language outside PARAKEET_LANGUAGE_CODES.
// Default to 'auto' (not 'en') so the user's "detect / multi-language" intent
// survives. Shared by every Parakeet-activation path: the explicit engine
// switch (useSetActiveTranscription) and the post-download auto-select
// (usePullParakeetModel's complete handler).
async function coerceLanguageForParakeet(): Promise<void> {
  try {
    const current = unwrap(await ipc().settings.getLanguage()).language;
    if (!PARAKEET_LANGUAGE_CODES.has(current)) {
      unwrap(await ipc().settings.setLanguage('auto'));
    }
  } catch {
    // Best-effort: activation shouldn't fail because the language read errored.
  }
}

export function useSetActiveTranscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      engine,
      whisperModel,
    }: {
      engine: TranscriptionEngine;
      whisperModel?: string;
    }) => {
      if (engine === 'parakeet') {
        await coerceLanguageForParakeet();
      }
      unwrap(await ipc().transcriptionEngine.set(engine));
      if (engine === 'whisper' && whisperModel) {
        unwrap(await ipc().whisperModels.set(whisperModel));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: transcriptionEngineKeys.all });
      qc.invalidateQueries({ queryKey: whisperKeys.all });
      qc.invalidateQueries({ queryKey: parakeetKeys.all });
      // Language might have been coerced; refresh the Settings dropdown
      // and the live dock toggle, both of which read from the same key.
      qc.invalidateQueries({ queryKey: ['settings', 'language'] });
    },
  });
}

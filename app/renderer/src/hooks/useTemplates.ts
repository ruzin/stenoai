import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type Template } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export const templatesKeys = {
  all: ['templates'] as const,
  list: () => [...templatesKeys.all, 'list'] as const,
};

export function useTemplates() {
  const q = useQuery({
    queryKey: templatesKeys.list(),
    queryFn: async () => unwrap(await ipc().templates.list()),
  });
  return {
    templates: (q.data?.templates ?? []) as Template[],
    defaultId: q.data?.default_template_id ?? 'standard',
    isLoading: q.isLoading,
  };
}

function useTemplateMutation<TArgs>(fn: (a: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKeys.all }),
  });
}

export const useSaveTemplate = () =>
  useTemplateMutation(async (t: Partial<Template>) => unwrap(await ipc().templates.save(t)));
export const useDeleteTemplate = () =>
  useTemplateMutation(async (id: string) => unwrap(await ipc().templates.remove(id)));
export const useSetDefaultTemplate = () =>
  useTemplateMutation(async (id: string) => unwrap(await ipc().templates.setDefault(id)));
export const useResetTemplate = () =>
  useTemplateMutation(async (id: string) => unwrap(await ipc().templates.reset(id)));

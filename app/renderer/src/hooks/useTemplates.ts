import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type Template } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export const templatesKeys = {
  all: ['templates'] as const,
  list: () => [...templatesKeys.all, 'list'] as const,
};

type TemplatesListData = { templates: Template[]; default_template_id: string };

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

// Optimistic: the mutation itself and the onSuccess refetch each spawn the
// bundled Python CLI, so waiting on both before moving the "Default" badge
// makes a same-page toggle feel like it hung. Flip default_template_id in
// the cache immediately and roll back on failure — Save/Delete/Reset don't
// need this since they navigate away (or show their own pending state)
// rather than expecting an instant in-place UI change.
export const useSetDefaultTemplate = () => {
  const qc = useQueryClient();
  // Guards the rollback below against a stale failure: if the user picks A
  // then B before A's request settles, A's eventual onError must not stomp
  // B's already-applied (optimistic or successful) state with A's outdated
  // pre-A snapshot. Only the attempt that's still the most recent one is
  // allowed to roll back.
  const latestAttempt = React.useRef(0);
  return useMutation({
    mutationFn: async (id: string) => unwrap(await ipc().templates.setDefault(id)),
    onMutate: async (id: string) => {
      const attempt = ++latestAttempt.current;
      await qc.cancelQueries({ queryKey: templatesKeys.list() });
      const previous = qc.getQueryData(templatesKeys.list());
      qc.setQueryData(templatesKeys.list(), (old: TemplatesListData | undefined) =>
        old ? { ...old, default_template_id: id } : old,
      );
      return { previous, attempt };
    },
    onError: (_err, _id, context) => {
      // Interim-only: this only smooths the UI while onSettled's refetch
      // below is in flight. It can't fully protect against two racing
      // requests both failing (whichever settles last "wins" the rollback
      // with a snapshot that may itself be wrong) — onSettled always
      // reconciling against disk is what makes the final state correct
      // regardless of click order or failure combination.
      if (context?.previous && context.attempt === latestAttempt.current) {
        qc.setQueryData(templatesKeys.list(), context.previous);
      }
    },
    // onSettled (not onSuccess): a failed setDefault must also refetch and
    // reconcile the cache with disk truth, not just leave whatever the
    // optimistic write + onError rollback left behind.
    onSettled: () => qc.invalidateQueries({ queryKey: templatesKeys.all }),
  });
};

export const useResetTemplate = () =>
  useTemplateMutation(async (id: string) => unwrap(await ipc().templates.reset(id)));

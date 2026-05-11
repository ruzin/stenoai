import { useQuery } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export function useAiPrompts() {
  return useQuery({
    queryKey: ['ai-prompts'],
    queryFn: async () => unwrap(await ipc().settings.getAiPrompts()),
  });
}

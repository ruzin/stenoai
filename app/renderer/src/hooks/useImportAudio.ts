import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { meetingsKeys } from '@/hooks/meetingKeys';

/**
 * Import an existing local audio file into stenoai.
 *
 * Opens the native file picker (`pickAudioFile`), then runs the chosen
 * file through the same `process-recording` backend pipeline a stopped
 * recording uses (`processFile`). The result lands in the meeting list
 * with the user's configured transcription + summary settings. The
 * meeting title defaults to the file's basename (sans extension); the
 * user can rename it afterwards.
 *
 * `mutateAsync()` resolves to `true` when a file was imported and `false`
 * when the user cancelled the picker. A backend failure rejects so the
 * caller can surface an error state.
 *
 * Hoist this hook into an always-mounted component (e.g. MainToolbar) so
 * the `onSuccess` meeting-list invalidation still fires if the UI that
 * triggered it (the options popover) unmounts mid-import.
 */
export function useImportAudio() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, void>({
    mutationFn: async (): Promise<boolean> => {
      const picked = await ipc().recording.pickAudioFile();
      if (!picked.success) {
        // User cancelled the dialog (or selected nothing) — not an error.
        return false;
      }
      const title = basenameStem(picked.filePath);
      const result = await ipc().recording.processFile(picked.filePath, title);
      if (!result.success) {
        throw new Error(result.error ?? 'Import failed');
      }
      return true;
    },
    onSuccess: (imported) => {
      if (imported) {
        void qc.invalidateQueries({ queryKey: meetingsKeys.all });
      }
    },
  });
}

/** Filename without directory or extension: `/a/b/Talk.m4a` -> `Talk`. */
function basenameStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

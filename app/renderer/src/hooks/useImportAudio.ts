import { useMutation } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';

/**
 * Import an existing local audio file into stenoai.
 *
 * Opens the native file picker (`pickAudioFile`), then hands the chosen
 * file to the backend (`processFile`), which enqueues it on the same
 * processing queue a stopped recording uses. The import then shows up as a
 * processing row in the meeting list (with a badge) and becomes a finished
 * note when summarisation completes. The meeting title defaults to the
 * file's basename (sans extension); the user can rename it afterwards.
 *
 * Fire-and-forget: `processFile` returns as soon as the file is queued, not
 * when processing finishes. The processing row appears via the queue poll
 * and the App-level `processing-complete` listener refreshes the list when
 * the note is ready, so this hook does no cache invalidation itself.
 *
 * `mutateAsync()` resolves to `true` when a file was enqueued and `false`
 * when the user cancelled the picker. A backend failure rejects so the
 * caller can surface an error state.
 */
export function useImportAudio() {
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
  });
}

/** Filename without directory or extension: `/a/b/Talk.m4a` -> `Talk`. */
function basenameStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

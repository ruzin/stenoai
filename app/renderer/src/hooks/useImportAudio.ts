import { useMutation } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';

/**
 * Hand a local audio file (by absolute path) to the backend import pipeline.
 *
 * `processFile` enqueues it on the same processing queue a stopped recording
 * uses, so it shows up as a processing row in the meeting list (with a badge)
 * and becomes a finished note when summarisation completes. The meeting title
 * defaults to the file's basename (sans extension); the user can rename it.
 *
 * Fire-and-forget: resolves as soon as the file is queued, not when processing
 * finishes. The processing row appears via the queue poll and the App-level
 * `processing-complete` listener refreshes the list when the note is ready.
 * Rejects on a backend failure so the caller can surface it.
 *
 * Shared by the file-picker import (`useImportAudio`) and drag-and-drop
 * (`ImportDropZone`).
 */
export async function importAudioFile(filePath: string): Promise<void> {
  const title = basenameStem(filePath);
  const result = await ipc().recording.processFile(filePath, title);
  if (!result.success) {
    throw new Error(result.error ?? 'Import failed');
  }
}

/**
 * Surface an import that failed to even enqueue (e.g. the copy-into-recordings
 * step threw, or the backend rejected the file). Shared by the picker and
 * drag-drop so a foreground import failure isn't swallowed by a bare
 * `console.error`. In-flight processing crashes are surfaced separately by the
 * App-level `processing-complete` handler; this covers the enqueue failure that
 * never produces a processing row. Reuses the note-ready notification channel
 * (`hardFailure`) since there's no in-app toast surface.
 */
export function notifyImportFailed(title: string): void {
  void ipc()
    .settings.showNoteReadyNotification({ title, failed: true, hardFailure: true })
    .catch(() => {
      // Notification failure isn't fatal and there's nothing to fall back to.
    });
}

/**
 * Import an existing local audio file via the native file picker.
 *
 * `mutateAsync()` resolves to `true` when a file was enqueued and `false`
 * when the user cancelled the picker.
 */
export function useImportAudio() {
  return useMutation<boolean, Error, void>({
    mutationFn: async (): Promise<boolean> => {
      const picked = await ipc().recording.pickAudioFile();
      if (!picked.success) {
        // User cancelled the dialog (or selected nothing) — not an error.
        return false;
      }
      try {
        await importAudioFile(picked.filePath);
      } catch (err) {
        // The popover has already closed, so there's no inline slot — fire the
        // failure notification with the title we still have in scope.
        notifyImportFailed(basenameStem(picked.filePath));
        throw err;
      }
      return true;
    },
  });
}

// Formats the backend (librosa/ffmpeg) can decode. Used to filter dropped files
// so non-audio drops are ignored. MUST stay in sync with
// IMPORT_AUDIO_EXTENSIONS in app/main.js (the file-picker dialog filter) — the
// two live in different processes, so the list is mirrored rather than shared.
const AUDIO_EXTENSIONS = [
  'wav', 'mp3', 'm4a', 'aac', 'webm', 'aiff', 'aif', 'flac', 'ogg', 'caf',
  'mp4', 'mov',
];

/** True when `name`'s extension is an audio/video format we can import. */
export function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/** Filename without directory or extension: `/a/b/Talk.m4a` -> `Talk`. */
export function basenameStem(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

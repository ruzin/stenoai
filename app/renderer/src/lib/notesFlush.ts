// Flush the latest notes to disk before handing the recording to processing.
// The debounced autosave (useLiveMeeting) is dropped when the stop flow unmounts
// the editor, so a note typed in the last ~500 ms would miss the sidecar main
// reads. Reading the store directly and awaiting the write closes that race.
export interface StopHandoffDeps {
  name: string;
  filePath: string;
  getDraftNotes: (name: string) => string | undefined;
  saveNotes: (name: string, notes: string) => Promise<unknown>;
  processRecording: (filePath: string, name: string) => Promise<unknown>;
  onFlushError?: (err: unknown) => void;
}

export async function flushNotesThenProcess(deps: StopHandoffDeps): Promise<void> {
  const notes = deps.getDraftNotes(deps.name);
  // `''` means the user cleared notes: write it to overwrite a stale sidecar.
  // `undefined` means no draft exists, so there is nothing to flush.
  if (notes !== undefined) {
    // Best-effort: a failed flush must not block processing.
    try {
      await deps.saveNotes(deps.name, notes);
    } catch (err) {
      deps.onFlushError?.(err);
    }
  }
  await deps.processRecording(deps.filePath, deps.name);
}

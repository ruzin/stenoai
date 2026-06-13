import * as React from 'react';
import { FileAudio } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { importAudioFile, isAudioFile } from '@/hooks/useImportAudio';

/**
 * Full-window drag-and-drop target for importing audio files. Mounted once at
 * the App level. Shows an overlay while a file is dragged over the window and,
 * on drop, runs each audio file through the same import pipeline as the
 * "Import audio file…" picker.
 *
 * Electron 32+ removed `File.path`, so the absolute path is resolved via
 * `webUtils.getPathForFile` through the preload bridge. Imports are
 * fire-and-forget — each file lands as a processing row in the meeting list
 * (the queue serialises them); failures are logged.
 */
export function ImportDropZone() {
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.stenoai) return;

    // Drag events fire for any drag (incl. internal note→folder drags); only
    // react to OS file drags, which carry the 'Files' type.
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

    // enter/leave fire per child element crossed; a depth counter avoids the
    // overlay flickering as the cursor moves over nested elements.
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // required to allow the drop
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer!.files);
      for (const file of files) {
        if (!isAudioFile(file.name)) continue;
        const path = ipc().recording.getPathForFile(file);
        if (!path) continue;
        void importAudioFile(path).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[importDropZone] import failed', err);
        });
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!dragging) return null;

  return (
    <div
      // pointer-events:none so the overlay never intercepts the drop — the
      // window-level listeners handle it.
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.35)', pointerEvents: 'none' }}
    >
      <div
        className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-12 py-10"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'var(--surface-raised)',
          color: 'var(--fg-1)',
        }}
      >
        <FileAudio className="size-8 text-muted-foreground" />
        <p className="text-sm font-medium">Drop audio to import</p>
      </div>
    </div>
  );
}

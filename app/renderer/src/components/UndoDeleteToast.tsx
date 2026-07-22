import * as React from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { useUndoDeleteStore, type UndoDeleteEntry } from '@/hooks/undoDeleteStore';
import { useRestoreMeeting, usePurgeTrashedMeeting } from '@/hooks/useMeetings';

/**
 * Bottom-right "Note deleted — Undo?" toast stack (#234). Deletion is a
 * soft-delete: the note's files are moved to a trash dir and an entry is pushed
 * to the undo store. This component (mounted once at shell level so it survives
 * MeetingDetail's post-delete navigate) renders one toast per entry.
 *
 * Undo restores the files; letting the ~8s window elapse (or dismissing) hard-
 * deletes them. Mirrors UpdateToast's CSS-var theming + a11y.
 */
const UNDO_WINDOW_MS = 8000;

function UndoDeleteToastItem({
  entry,
  onUndo,
  onExpire,
}: {
  entry: UndoDeleteEntry;
  onUndo: () => void;
  onExpire: () => void;
}) {
  // Keep the callbacks in a ref so the auto-dismiss timer runs exactly once and
  // isn't reset by re-renders (it must expire relative to when the note was
  // deleted, not the last render).
  const onExpireRef = React.useRef(onExpire);
  React.useEffect(() => {
    onExpireRef.current = onExpire;
  });

  const [progress, setProgress] = React.useState(1);

  React.useEffect(() => {
    const timer = setTimeout(() => onExpireRef.current(), UNDO_WINDOW_MS);
    // Kick the countdown bar off on the next frame so the CSS width transition
    // actually animates from full to empty.
    const raf = requestAnimationFrame(() => setProgress(0));
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  const name = entry.meeting?.session_info?.name?.trim();

  return (
    <div
      className="pointer-events-auto relative flex w-[280px] flex-col overflow-hidden rounded-xl"
      style={{
        background: 'var(--surface-raised)',
        color: 'var(--fg-1)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-md)',
        fontFamily: 'var(--font-sans)',
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Trash2 size={14} style={{ color: 'var(--fg-2)', flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Note deleted</div>
          {name && (
            <div className="truncate text-[12px]" style={{ color: 'var(--fg-2)' }}>
              {name}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onUndo}
          className="cursor-pointer rounded-full border-0 px-2.5 py-1 text-[12px] font-medium"
          style={{ background: 'var(--fg-1)', color: 'var(--fg-inverse)' }}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onExpire}
          aria-label="Dismiss and delete permanently"
          className="inline-flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-1"
          style={{ color: 'var(--fg-2)' }}
        >
          <X size={12} />
        </button>
      </div>
      {/* Countdown bar depleting over the undo window. */}
      <div
        aria-hidden
        style={{
          height: 2,
          width: `${progress * 100}%`,
          background: 'var(--fg-2)',
          opacity: 0.35,
          transition: `width ${UNDO_WINDOW_MS}ms linear`,
        }}
      />
    </div>
  );
}

export function UndoDeleteToast() {
  const entries = useUndoDeleteStore((s) => s.entries);
  const remove = useUndoDeleteStore((s) => s.remove);
  const restore = useRestoreMeeting();
  const purge = usePurgeTrashedMeeting();

  const host = typeof document !== 'undefined' ? document.getElementById('toast-host') : null;
  if (!host || entries.length === 0) return null;

  const handleUndo = (entry: UndoDeleteEntry) => {
    // Remove first (unmounts the item, cancelling its expiry timer) so a late
    // timer can't purge the files we're about to restore.
    remove(entry.trashId);
    restore.mutate(entry.trashId);
  };

  const handleExpire = (entry: UndoDeleteEntry) => {
    remove(entry.trashId);
    purge.mutate(entry.trashId);
  };

  return createPortal(
    entries.map((entry) => (
      <UndoDeleteToastItem
        key={entry.trashId}
        entry={entry}
        onUndo={() => handleUndo(entry)}
        onExpire={() => handleExpire(entry)}
      />
    )),
    host,
  );
}

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

  // Remaining window is relative to when the note was actually deleted
  // (entry.createdAt), NOT this component's mount. AppShell is rendered per-route
  // (FACT B), so navigation remounts this toast — a mount-relative timer would
  // reset the 8s window on every navigate. Anchoring to createdAt makes a
  // remount RESUME the countdown instead.
  const remainingAtMount = React.useMemo(
    () => Math.max(0, UNDO_WINDOW_MS - (Date.now() - entry.createdAt)),
    [entry.createdAt],
  );

  const [progress, setProgress] = React.useState(remainingAtMount / UNDO_WINDOW_MS);

  React.useEffect(() => {
    // SUSPEND the expiry timer while a restore is in flight — an expiring
    // countdown must never purge a note that's mid-restore (#234). When the
    // restore settles the entry is either removed (success) or re-armed (failure,
    // which bumps createdAt → this effect re-runs with a fresh window).
    if (entry.restoring) {
      return;
    }
    if (remainingAtMount <= 0) {
      // Window already elapsed before this mount — expire immediately.
      onExpireRef.current();
      return;
    }
    const timer = setTimeout(() => onExpireRef.current(), remainingAtMount);
    // Kick the countdown bar off on the next frame so the CSS width transition
    // animates from the elapsed fraction down to empty over the remaining time.
    const raf = requestAnimationFrame(() => setProgress(0));
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [remainingAtMount, entry.restoring]);

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
          <div className="text-[13px] font-medium">
            {entry.restoreFailed ? 'Restore failed' : 'Note deleted'}
          </div>
          {entry.restoreFailed ? (
            <div className="truncate text-[12px]" style={{ color: 'var(--fg-2)' }}>
              Couldn&rsquo;t restore{name ? ` “${name}”` : ''} — try Undo again.
            </div>
          ) : (
            name && (
              <div className="truncate text-[12px]" style={{ color: 'var(--fg-2)' }}>
                {name}
              </div>
            )
          )}
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={entry.restoring}
          className="cursor-pointer rounded-full border-0 px-2.5 py-1 text-[12px] font-medium disabled:cursor-default disabled:opacity-60"
          style={{ background: 'var(--fg-1)', color: 'var(--fg-inverse)' }}
        >
          {entry.restoring ? 'Restoring…' : 'Undo'}
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
          transition: `width ${remainingAtMount}ms linear`,
        }}
      />
    </div>
  );
}

export function UndoDeleteToast() {
  const entries = useUndoDeleteStore((s) => s.entries);
  const remove = useUndoDeleteStore((s) => s.remove);
  const markRestoring = useUndoDeleteStore((s) => s.markRestoring);
  const rearm = useUndoDeleteStore((s) => s.rearm);
  const restore = useRestoreMeeting();
  const purge = usePurgeTrashedMeeting();

  const host = typeof document !== 'undefined' ? document.getElementById('toast-host') : null;
  if (!host || entries.length === 0) return null;

  const handleUndo = (entry: UndoDeleteEntry) => {
    // Do NOT remove the entry up front. Mark it "restoring" so its expiry timer
    // is SUSPENDED while the restore IPC is in flight — an expiring countdown
    // must never purge a note that's mid-restore (#234). Only a successful
    // restore removes the toast; a failed one re-arms it so the user can retry.
    if (entry.restoring) return; // Guard against a double click while in flight.
    markRestoring(entry.trashId);
    restore.mutate(entry.trashId, {
      onSuccess: () => remove(entry.trashId),
      onError: () => {
        // Restore failed — clear "restoring", flag the failure, and restart the
        // undo window so a retryable toast stays on screen. Removing it here
        // would strand the still-trashed note for the startup sweep to purge.
        rearm(entry.trashId);
      },
    });
  };

  const handleExpire = (entry: UndoDeleteEntry) => {
    remove(entry.trashId);
    purge.mutate(entry.trashId);
  };

  return createPortal(
    entries.map((entry) => (
      <UndoDeleteToastItem
        // Include createdAt in the key so a re-arm (failed restore bumps
        // createdAt) REMOUNTS the item, resetting its countdown + progress bar to
        // a fresh window cleanly — no in-effect setState. A plain markRestoring
        // (createdAt unchanged) keeps the same key, so the item stays mounted and
        // just suspends its timer.
        key={`${entry.trashId}:${entry.createdAt}`}
        entry={entry}
        onUndo={() => handleUndo(entry)}
        onExpire={() => handleExpire(entry)}
      />
    )),
    host,
  );
}

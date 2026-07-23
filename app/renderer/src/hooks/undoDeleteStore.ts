import { create } from 'zustand';
import type { Meeting } from '@/lib/ipc';

/**
 * Holds the active "note deleted — Undo?" entries (#234). A soft-delete moves
 * the note's files to a trash dir and pushes an entry here; the UndoDeleteToast
 * (mounted once at shell level) renders one toast per entry and drives restore
 * (Undo) or purge (expiry/dismiss).
 *
 * The store lives ABOVE the routes so a toast survives the navigate('/') that
 * MeetingDetail runs after deleting — the trigger unmounts, the toast doesn't.
 */
export interface UndoDeleteEntry {
  /** The trash id returned by delete-meeting; restore/purge key off it. */
  trashId: string;
  /** The deleted meeting, so Undo can re-insert its list row. */
  meeting: Meeting;
  /** When the entry was created (drives the auto-dismiss countdown). */
  createdAt: number;
  /**
   * True while an Undo/restore IPC is in flight. The toast's expiry timer is
   * SUSPENDED while this is set, so an expiring countdown can never fire a purge
   * on a note that is mid-restore (which would hard-delete it under the
   * in-flight restore = silent data loss, #234).
   */
  restoring?: boolean;
  /**
   * True after a restore attempt FAILED. Keeps the toast on screen (re-armed for
   * retry) and lets it surface the failure instead of silently vanishing.
   */
  restoreFailed?: boolean;
}

interface UndoDeleteStore {
  entries: UndoDeleteEntry[];
  /** Push a new undo entry (called on a successful delete). */
  add: (entry: UndoDeleteEntry) => void;
  /** Remove an entry by trashId (after a successful Undo, purge, or dismiss). */
  remove: (trashId: string) => void;
  /** Mark an entry as restore-in-flight (suspends its expiry timer). */
  markRestoring: (trashId: string) => void;
  /**
   * A restore attempt failed: clear the in-flight flag, flag the failure, and
   * RESTART the undo window (createdAt = now) so the toast stays up and the user
   * gets a fresh window to retry — never remove it (that would strand the
   * trashed note for the startup sweep to purge).
   */
  rearm: (trashId: string) => void;
}

export const useUndoDeleteStore = create<UndoDeleteStore>((set) => ({
  entries: [],
  add: (entry) =>
    set((s) => ({
      // De-dupe on trashId (defensive — trashIds are unique per delete).
      entries: [...s.entries.filter((e) => e.trashId !== entry.trashId), entry],
    })),
  remove: (trashId) =>
    set((s) => ({ entries: s.entries.filter((e) => e.trashId !== trashId) })),
  markRestoring: (trashId) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trashId === trashId ? { ...e, restoring: true, restoreFailed: false } : e,
      ),
    })),
  rearm: (trashId) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.trashId === trashId
          ? { ...e, restoring: false, restoreFailed: true, createdAt: Date.now() }
          : e,
      ),
    })),
}));

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
}

interface UndoDeleteStore {
  entries: UndoDeleteEntry[];
  /** Push a new undo entry (called on a successful delete). */
  add: (entry: UndoDeleteEntry) => void;
  /** Remove an entry by trashId (after Undo, purge, or dismiss). */
  remove: (trashId: string) => void;
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
}));

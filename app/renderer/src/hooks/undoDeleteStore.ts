import { create } from 'zustand';
import type { Meeting } from '@/lib/ipc';

/**
 * Holds the active "note deleted — Undo?" entries (#234). A soft-delete hides the
 * note's summary (main renames it into a hidden dir) and pushes an entry here;
 * the UndoDeleteToast (mounted once at shell level) renders one toast per entry
 * and drives undo (rename back) or commit (permanent delete on dismiss/expiry).
 *
 * The store lives ABOVE the routes so a toast survives the navigate('/') that
 * MeetingDetail runs after deleting — the trigger unmounts, the toast doesn't.
 * MAIN is the source of truth for the deadline; on app start the toast rehydrates
 * this store from list-pending-deletes so a renderer reload can't lose a window.
 */
export interface UndoDeleteEntry {
  /** The delete id returned by delete-meeting; undo/commit key off it. */
  id: string;
  /** The deleted meeting, so Undo can re-insert its list row. */
  meeting: Meeting;
  /** The note's `summary_file` (the list's primary key). Lets the commit path
   *  drop the right row from the list cache when the window is dismissed. */
  summaryFile: string;
  /** MAIN-owned deadline (epoch ms). The toast countdown is display-only — main
   *  owns the real timer, so a renderer reload can't drift the window. */
  deadline: number;
}

interface UndoDeleteStore {
  entries: UndoDeleteEntry[];
  /** Push a new undo entry (called on a successful delete). */
  add: (entry: UndoDeleteEntry) => void;
  /** Remove an entry by id (after a successful Undo, commit, or dismiss). */
  remove: (id: string) => void;
  /**
   * One-shot rehydration from main's list-pending-deletes. MERGES (main wins per
   * id) rather than replacing, so it can never wipe an entry added concurrently
   * — at app start the store is empty, so a merge equals a load.
   */
  hydrate: (entries: UndoDeleteEntry[]) => void;
}

export const useUndoDeleteStore = create<UndoDeleteStore>((set) => ({
  entries: [],
  add: (entry) =>
    set((s) => ({
      // De-dupe on id (defensive — ids are unique per delete).
      entries: [...s.entries.filter((e) => e.id !== entry.id), entry],
    })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  hydrate: (incoming) =>
    set((s) => {
      const byId = new Map(s.entries.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      return { entries: [...byId.values()] };
    }),
}));

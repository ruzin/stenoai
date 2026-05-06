import { create } from 'zustand';

/**
 * In-memory draft state for the in-progress recording. Title lives only in
 * memory until the recording finishes (we apply the rename on
 * processingComplete via useUpdateMeeting). Notes are mirrored to disk via
 * `save-meeting-notes` on a 500ms debounce in useLiveMeeting.
 *
 * Keyed by sessionName so a quick stop+start with a different name doesn't
 * leak the previous title.
 */

export interface DraftEntry {
  title: string;
  notes: string;
  startedAtMs: number;
}

interface LiveDraftStore {
  drafts: Record<string, DraftEntry>;
  ensure: (sessionName: string, defaults: { startedAtMs: number }) => void;
  setTitle: (sessionName: string, title: string) => void;
  setNotes: (sessionName: string, notes: string) => void;
}

export const useLiveDraftStore = create<LiveDraftStore>((set) => ({
  drafts: {},
  ensure: (sessionName, defaults) =>
    set((state) => {
      if (state.drafts[sessionName]) return state;
      return {
        drafts: {
          ...state.drafts,
          [sessionName]: {
            title: sessionName,
            notes: '',
            startedAtMs: defaults.startedAtMs,
          },
        },
      };
    }),
  setTitle: (sessionName, title) =>
    set((state) => {
      const existing = state.drafts[sessionName];
      if (!existing) return state;
      return {
        drafts: { ...state.drafts, [sessionName]: { ...existing, title } },
      };
    }),
  setNotes: (sessionName, notes) =>
    set((state) => {
      const existing = state.drafts[sessionName];
      if (!existing) return state;
      return {
        drafts: { ...state.drafts, [sessionName]: { ...existing, notes } },
      };
    }),
}));

/** Non-hook accessor for the current draft (use inside event handlers). */
export function getLiveDraft(sessionName: string): DraftEntry | undefined {
  return useLiveDraftStore.getState().drafts[sessionName];
}

import { create } from 'zustand';

/**
 * UI state for the inline live transcript panel on the Recording route.
 *
 * Lives outside the React tree so both LiveDock (mounted at App level) and
 * LiveTranscriptBar (mounted inside the Recording route) can coordinate
 * without a context provider — LiveDock's Transcript toggle and the bar's
 * header chevron both call the same ``toggle()``.
 *
 * Defaults to closed: the user clicks the LiveDock transcript toggle to
 * reveal the panel. Granola behaves the same way — the panel is opt-in
 * rather than always-on so the page stays calm on session start.
 */
interface LiveTranscriptOpenStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useLiveTranscriptOpen = create<LiveTranscriptOpenStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

import { create } from 'zustand';

/**
 * UI state for the inline live transcript panel on the Recording route.
 *
 * Lives outside the React tree so both LiveDock (mounted at App level) and
 * LiveTranscriptBar (mounted inside the Recording route) can coordinate
 * without a context provider — LiveDock's Transcript toggle and the bar's
 * header chevron both call the same ``toggle()``.
 *
 * Defaults to open: the transcript is the centerpiece of the recording
 * experience; users opt into hiding it rather than opting into showing it.
 */
interface LiveTranscriptOpenStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useLiveTranscriptOpen = create<LiveTranscriptOpenStore>((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

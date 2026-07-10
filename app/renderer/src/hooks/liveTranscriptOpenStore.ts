import { create } from 'zustand';

/**
 * UI state for the expanded live-transcript panel during a recording.
 *
 * Both occupants of the primary dock slot (PrimaryDock swaps the compact
 * LiveDock pill for the expanded LiveTranscriptBar on this flag) live outside
 * any shared React subtree, so this sits in a zustand store rather than a
 * context — LiveDock's expand toggle and the panel's minimize chevron both
 * call the same ``toggle()``.
 *
 * Defaults to closed: the user clicks the pill's expand toggle to reveal the
 * panel. Granola behaves the same way — the panel is opt-in rather than
 * always-on so the page stays calm on session start. App.tsx resets it to
 * closed on every new recording session.
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

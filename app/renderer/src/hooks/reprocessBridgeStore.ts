import { create } from 'zustand';

/**
 * Bridges the note-detail's "Generate notes" (reprocess) trigger to the
 * floating GenerateNotesBar mounted at App level.
 *
 * The floating button always renders on top of a mounted MeetingDetail (the
 * detail is what sets the active meeting), so instead of running its own
 * reprocess mutation — which would neither drive the detail's StreamingView
 * nor coordinate with the in-note CTA (double-fire) — it calls the detail's
 * OWN `start` and reflects the detail's `streaming` state. MeetingDetail
 * publishes here while showing a transcript-only note and clears on unmount.
 */
interface ReprocessBridge {
  /** summaryFile of the note currently offering the floating CTA. */
  summaryFile: string | null;
  /** True while that note's reprocess is analyzing/streaming (disables triggers). */
  streaming: boolean;
  /** Button label: "Generate notes" (transcript-only note) or
   *  "Regenerate notes" (a continued note marked notes_stale). */
  label: string;
  /** The detail's `startReprocess` for that note (stable wrapper). */
  start: (() => void) | null;
  publish: (b: {
    summaryFile: string;
    streaming: boolean;
    label: string;
    start: () => void;
  }) => void;
  /** Clear, but only if `summaryFile` still owns the bridge (avoids a late
   *  unmount wiping a newer detail's publish). */
  clear: (summaryFile: string) => void;
}

export const useReprocessBridge = create<ReprocessBridge>((set, get) => ({
  summaryFile: null,
  streaming: false,
  label: 'Generate notes',
  start: null,
  publish: ({ summaryFile, streaming, label, start }) =>
    set({ summaryFile, streaming, label, start }),
  clear: (summaryFile) => {
    if (get().summaryFile === summaryFile) {
      set({ summaryFile: null, streaming: false, label: 'Generate notes', start: null });
    }
  },
}));

/**
 * Module-scoped state shared between MeetingDetail (classic) and
 * MeetingDetailV2 (new design). Keeping it here means:
 *   - title-regen spinners survive cross-component navigation (classic → v2)
 *   - partial streaming text restores when remounting either variant
 *   - toggling the design flag mid-session doesn't drop pending IPC promises
 */

export type StreamPhase = 'idle' | 'analyzing' | 'generating' | 'done';

export interface StreamState {
  text: string;
  phase: StreamPhase;
}

export const streamCache = new Map<string, StreamState>();
export const pendingTitleRegens = new Map<string, Promise<void>>();

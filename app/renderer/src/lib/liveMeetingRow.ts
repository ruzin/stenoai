/**
 * Live-recording row helpers (#bug4), kept in a dependency-light module so the
 * dedup logic is unit-testable without pulling in the useMeetings hook graph.
 */

/** Sentinel summary_file path used by the synthetic in-progress recording row.
 *  Never matches a real meeting file. Consumers detect via `meeting.is_recording`. */
export const LIVE_SUMMARY_PREFIX = '__live__/';

/** The synthetic "__live__/…" row is redundant once the session's real note
 *  file exists in the list — showing both is the duplicate-note bug. main
 *  surfaces the real note's key as `liveSummaryFile` (deterministic from the
 *  audio stem, stable across record→process); this returns true when that note
 *  is already present, so the caller drops the synthetic row. */
export function liveRowRedundant(
  base: ReadonlyArray<{ session_info: { summary_file: string } }>,
  liveSummaryFile: string | null | undefined,
): boolean {
  if (!liveSummaryFile) return false;
  return base.some((m) => m.session_info.summary_file === liveSummaryFile);
}

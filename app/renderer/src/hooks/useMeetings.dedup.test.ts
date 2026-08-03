import { describe, it, expect } from 'vitest';
import { liveRowRedundant, LIVE_SUMMARY_PREFIX } from '@/lib/liveMeetingRow';

const note = (summary_file: string) => ({ session_info: { summary_file } });

describe('liveRowRedundant (#bug4 — one recording, one row)', () => {
  it('false while recording before the real note exists (no liveSummaryFile)', () => {
    expect(liveRowRedundant([note('a_summary.md')], null)).toBe(false);
    expect(liveRowRedundant([note('a_summary.md')], undefined)).toBe(false);
  });

  it('false when the real note is not yet in the list (bridges the stop gap)', () => {
    expect(liveRowRedundant([note('other_summary.md')], 'rec123_summary.md')).toBe(false);
  });

  it('true once the real note file appears — drop the synthetic live row', () => {
    const base = [note('rec123_summary.md'), note('older_summary.md')];
    expect(liveRowRedundant(base, 'rec123_summary.md')).toBe(true);
  });

  it('never matches the synthetic sentinel key against itself', () => {
    const base = [note(`${LIVE_SUMMARY_PREFIX}Note`)];
    // liveSummaryFile is always a real file path, never the sentinel, so a
    // list that somehow only holds the sentinel row is not "redundant".
    expect(liveRowRedundant(base, 'rec123_summary.md')).toBe(false);
  });

  it('empty list → not redundant', () => {
    expect(liveRowRedundant([], 'rec123_summary.md')).toBe(false);
  });
});

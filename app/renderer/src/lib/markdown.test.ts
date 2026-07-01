import { describe, test, expect } from 'vitest';
import { stripReasoning } from '@/lib/markdown';

/**
 * Unit coverage for stripReasoning — the guard that removes `<think>` /
 * `<thought>` reasoning blocks emitted by some local models before the text is
 * handed to the markdown renderer. The streaming case (an unclosed tag at the
 * end of a chunk) is the load-bearing edge: a half-streamed reasoning block
 * must not flash into the rendered summary.
 */
describe('stripReasoning', () => {
  test('strips a closed reasoning block and trims leading whitespace', () => {
    const input = '<think>deliberating about the summary</think>\n\n## Summary\nHello';
    expect(stripReasoning(input)).toBe('## Summary\nHello');
  });

  test('strips an unclosed reasoning block to the end of a streaming chunk', () => {
    const input = 'visible intro\n<think>still thinking and the chunk cut off here';
    // The closing tag never arrives, so everything from <think> onward is dropped
    // (only the trailing newline before the tag survives — strip trims leading,
    // not trailing, whitespace).
    const result = stripReasoning(input);
    expect(result).toBe('visible intro\n');
    expect(result).not.toContain('still thinking');
  });

  test('passes through text with no reasoning tags unchanged', () => {
    const input = '## Summary\nNo reasoning here, just content.';
    expect(stripReasoning(input)).toBe(input);
  });

  test('returns falsy/empty for empty input', () => {
    expect(stripReasoning('')).toBeFalsy();
    expect(stripReasoning('')).toBe('');
  });
});

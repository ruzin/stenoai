import { describe, test, expect } from 'vitest';
import { stripReasoning } from '@/lib/markdown';

/**
 * Unit coverage for stripReasoning — the guard that removes `<think>` /
 * `<thought>` / `<thinking>` / `<reasoning>` reasoning blocks emitted by some local models before the text is
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

  test('handles multiple blocks and nested/malformed tags', () => {
    const input = 'A\n<think>1</think>\nB\n<thinking>2</thinking>\nC';
    expect(stripReasoning(input)).toBe('A\nB\nC');
  });

  test('handles reasoning tags', () => {
    const input = '<reasoning>...</reasoning>content';
    expect(stripReasoning(input)).toBe('content');
  });

  test('handles different nested tags (outer tag wins)', () => {
    const input = '<think>outer<thinking>inner</thinking></think>content';
    expect(stripReasoning(input)).toBe('content');
  });

  test('preserves spaces and formatting outside blocks', () => {
    const input = '  # Hello \n\n<think>test</think>\nWorld';
    expect(stripReasoning(input)).toBe('  # Hello \n\nWorld');
  });

  test('preserves leading formatting at document start when no reasoning block is present', () => {
    const input = '  <think>test</think>\n  # Hello';
    expect(stripReasoning(input)).toBe('  # Hello');
  });

  test('handles uppercase tags', () => {
    const input = '<THINK>A</think>B';
    expect(stripReasoning(input)).toBe('B');
  });
});

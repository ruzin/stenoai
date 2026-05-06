import * as React from 'react';
import { cn } from '@/lib/utils';

// Lightweight markdown → React renderer for chat bubbles. Handles the
// formatting LLMs actually produce in answers: headings, paragraphs,
// bullet/numbered lists, bold/italic, inline code, fenced code blocks.
// Intentionally NOT a full CommonMark parser — we trade completeness for
// zero deps, predictable output, and safe-by-default React text rendering
// (no innerHTML).

export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let codeLines: string[] = [];
  let codeLang: string | null = null;
  let inCode = false;
  let key = 0;

  // Detect a markdown table starting at index i. Returns the table's row
  // index range and the parsed rows + alignment, or null if it isn't one.
  // Expected shape:
  //   | h1 | h2 |
  //   |----|:---:|
  //   | a  | b  |
  // The separator row distinguishes a real table from a bunch of pipes
  // in regular text.
  const detectTable = (
    i: number,
  ): { end: number; header: string[]; rows: string[][]; align: ('left' | 'center' | 'right' | null)[] } | null => {
    if (i + 1 >= lines.length) return null;
    const headerRaw = lines[i];
    const sepRaw = lines[i + 1];
    if (!isTableRow(headerRaw) || !isTableSeparator(sepRaw)) return null;
    const header = splitRow(headerRaw);
    const align = parseAlign(sepRaw);
    if (header.length === 0 || align.length === 0) return null;

    const rows: string[][] = [];
    let j = i + 2;
    while (j < lines.length && isTableRow(lines[j])) {
      rows.push(splitRow(lines[j]));
      j++;
    }
    // Require at least one data row — otherwise it's likely just two
    // adjacent pipe-containing lines that aren't actually a table.
    if (rows.length === 0) return null;
    return { end: j - 1, header, rows, align };
  };

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listType ?? 'ul';
    nodes.push(
      <Tag
        key={key++}
        className={cn(
          'my-1.5 space-y-0.5 pl-5',
          Tag === 'ul' ? 'list-disc' : 'list-decimal',
        )}
      >
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
    listType = null;
  };

  const flushCode = () => {
    if (!inCode) return;
    nodes.push(
      <pre
        key={key++}
        className="my-2 overflow-x-auto rounded-md px-3 py-2 text-[12.5px]"
        style={{
          background: 'var(--surface-active)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--fg-1)',
        }}
        data-lang={codeLang || undefined}
      >
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
    codeLines = [];
    codeLang = null;
    inCode = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Fenced code block: ```lang ... ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
      } else {
        flushList();
        inCode = true;
        codeLang = fence[1] || null;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Markdown table. Detect on the header row, consume through the last
    // data row, render as a real <table>. Tested before headings/lists
    // so a leading-pipe table row never gets mistaken for something else.
    if (line.trimStart().startsWith('|')) {
      const tbl = detectTable(i);
      if (tbl) {
        flushList();
        nodes.push(
          <div key={key++} className="my-2 overflow-x-auto">
            <table
              className="w-full border-collapse text-[13px]"
              style={{ fontFamily: 'var(--font-sans)' }}
            >
              <thead>
                <tr>
                  {tbl.header.map((cell, ci) => (
                    <th
                      key={ci}
                      className="border-b px-2.5 py-1.5 text-left font-semibold"
                      style={{
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--fg-1)',
                        textAlign: tbl.align[ci] ?? 'left',
                      }}
                    >
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tbl.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border-b px-2.5 py-1.5 align-top"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--fg-1)',
                          textAlign: tbl.align[ci] ?? 'left',
                        }}
                      >
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        i = tbl.end;
        continue;
      }
    }

    // Heading (# / ## / ###). h1 is reserved for page titles, so the LLM's
    // top-level heading maps to h3 inside a bubble — keeps the visual
    // hierarchy of the surrounding UI intact.
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const content = h[2];
      const sizeClass =
        level <= 1
          ? 'mt-3 mb-1.5 text-[16px] font-semibold'
          : level === 2
            ? 'mt-3 mb-1.5 text-[15px] font-semibold'
            : 'mt-2.5 mb-1 text-[14px] font-semibold';
      nodes.push(
        <div key={key++} className={sizeClass} style={{ color: 'var(--fg-1)' }}>
          {renderInline(content)}
        </div>,
      );
      continue;
    }

    // Bulleted item: -, *, • all accepted (LLMs sometimes use bullet glyph).
    const ulMatch = line.match(/^\s*[-*•]\s+(.+)/);
    const olMatch = line.match(/^\s*\d+\.\s+(.+)/);

    if (ulMatch) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listItems.push(ulMatch[1]);
      continue;
    }
    if (olMatch) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listItems.push(olMatch[1]);
      continue;
    }

    flushList();
    if (line.trim()) {
      nodes.push(
        <p key={key++} className="my-1.5">
          {renderInline(line)}
        </p>,
      );
    } else if (nodes.length > 0) {
      // Blank line between blocks — collapse runs, but preserve one as a gap.
      const last = nodes[nodes.length - 1];
      if (typeof last === 'object' && last && 'type' in (last as object) && (last as { type?: unknown }).type !== 'br') {
        nodes.push(<div key={key++} className="h-2" aria-hidden />);
      }
    }
  }
  flushList();
  flushCode();

  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// Table helpers
// ---------------------------------------------------------------------------

function isTableRow(line: string): boolean {
  // A row starts with `|` (after optional whitespace) and contains at least
  // one more `|`. Pure separator runs are excluded — those go through
  // isTableSeparator.
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  // Need at least 2 pipes to delimit a single cell.
  return (trimmed.match(/\|/g) || []).length >= 2;
}

function isTableSeparator(line: string): boolean {
  // Each cell is dashes with optional leading/trailing colons for alignment.
  // Examples: |---|---|, | :--- | :---: | ---: |
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return false;
  const cells = splitRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function splitRow(line: string): string[] {
  // Strip the outer pipes then split. Trim each cell. Empty trailing cells
  // (when the row ends with `|`) are dropped — we don't want to render a
  // ghost column.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function parseAlign(separator: string): ('left' | 'center' | 'right' | null)[] {
  return splitRow(separator).map((cell) => {
    const t = cell.trim();
    const startsColon = t.startsWith(':');
    const endsColon = t.endsWith(':');
    if (startsColon && endsColon) return 'center';
    if (endsColon) return 'right';
    if (startsColon) return 'left';
    return null;
  });
}

// Inline markdown: **bold**, *italic*/_italic_, `code`. Order matters —
// resolve code spans first so backticks inside don't get parsed as
// emphasis, then bold (greedy double-star), then italic.
export function renderInline(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let key = 0;
  // Match the next inline span: code, bold, or italic. The combined regex
  // walks left-to-right so we don't double-process overlapping ranges.
  const RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={key++}
          className="rounded px-1 py-px text-[0.9em]"
          style={{
            background: 'var(--surface-active)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--fg-1)',
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith('**')) {
      out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      // *italic* or _italic_
      out.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  if (out.length === 0) return text;
  if (out.length === 1) return out[0];
  return <>{out}</>;
}

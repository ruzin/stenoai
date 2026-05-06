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

  for (const line of lines) {
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

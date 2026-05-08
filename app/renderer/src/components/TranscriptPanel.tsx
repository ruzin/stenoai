import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMeeting } from '@/hooks/useMeetings';
import type { Meeting } from '@/lib/ipc';

interface Segment {
  speaker: 'You' | 'Others' | null;
  text: string;
}

/** Bare transcript content — no outer card or header. Used inside the dock's mv-transcript panel. */
export function TranscriptPanelContent({
  summaryFile,
}: {
  summaryFile: string;
  onClose?: () => void;
}) {
  const meeting = useMeeting(summaryFile);

  if (meeting.isLoading) {
    return <div className="px-4 py-3 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!meeting.data) {
    return <div className="px-4 py-3 text-sm text-muted-foreground">No transcript available.</div>;
  }
  return <TranscriptBody meeting={meeting.data} />;
}


function TranscriptBody({ meeting }: { meeting: Meeting }) {
  const segments = React.useMemo(() => parseTranscript(meeting), [meeting]);
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    if (!query.trim()) return segments;
    const needle = query.trim().toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(needle));
  }, [segments, query]);

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 8,
  });

  if (segments.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">No transcript available.</div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center px-3 py-1.5">
        <Input
          variant="sunken"
          size="sm"
          iconStart={<SearchIcon className="size-3.5" />}
          placeholder="Search transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
        />
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const segment = filtered[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="py-1"
              >
                <TranscriptRow segment={segment} highlight={query} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TranscriptRow({ segment, highlight }: { segment: Segment; highlight: string }) {
  // Non-diarised (mono / mic-only) — render as a single full-width line
  // without bubbles. The chat metaphor only makes sense when there are
  // actual sides to alternate between.
  if (!segment.speaker) {
    return (
      <p className="px-2 py-1 text-sm leading-[1.65] text-foreground/90">
        {renderHighlighted(segment.text, highlight)}
      </p>
    );
  }

  // Diarised — Granola-style chat bubbles. Position (right vs left) and
  // tint do the speaker-attribution work; explicit "You" / "Others" pill
  // labels are redundant once the visual cue is there. Max-width keeps
  // long monologues readable rather than spanning the whole panel.
  const isYou = segment.speaker === 'You';
  return (
    <div className={cn('flex px-1 py-0.5', isYou ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-3 py-1.5 text-sm leading-[1.5]',
          // Granola-style: olive/sage green for self, neutral grey for
          // others. Light/dark variants keep contrast in either theme.
          isYou
            ? 'bg-green-100 text-green-950 rounded-br-md dark:bg-green-900/40 dark:text-green-100'
            : 'bg-neutral-200/80 text-neutral-900 rounded-bl-md dark:bg-neutral-700/60 dark:text-neutral-100',
        )}
      >
        {renderHighlighted(segment.text, highlight)}
      </div>
    </div>
  );
}

function renderHighlighted(text: string, highlight: string): React.ReactNode {
  const needle = highlight.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const ln = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(ln, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark
        key={key++}
        className="rounded bg-yellow-200/60 px-0.5 text-foreground dark:bg-yellow-500/30"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    cursor = idx + needle.length;
    idx = lower.indexOf(ln, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function parseTranscript(meeting: Meeting): Segment[] {
  if (meeting.is_diarised && meeting.diarised_text) {
    const blocks = meeting.diarised_text.split(/(?=\[You\]|\[Others\])/);
    return blocks
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b): Segment => {
        if (b.startsWith('[You]')) return { speaker: 'You', text: b.replace('[You]', '').trim() };
        if (b.startsWith('[Others]'))
          return { speaker: 'Others', text: b.replace('[Others]', '').trim() };
        return { speaker: null, text: b };
      });
  }
  const text = (meeting.transcript ?? '').trim();
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (sentences.length > 1 ? sentences : [text]).map((s) => ({ speaker: null, text: s }));
}


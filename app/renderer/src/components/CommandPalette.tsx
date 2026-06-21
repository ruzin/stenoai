import * as React from 'react';
import { Search } from 'lucide-react';
import { useMeetings } from '@/hooks/useMeetings';
import { searchNotes, snippet } from '@/lib/noteSearch';
import { navigate } from '@/lib/router';
import type { Meeting } from '@/lib/ipc';

interface PaletteContextValue {
  open: () => void;
}

const PaletteContext = React.createContext<PaletteContextValue | null>(null);

export function useCommandPalette(): PaletteContextValue {
  const ctx = React.useContext(PaletteContext);
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider');
  return ctx;
}

const RECENT_COUNT = 8;

/**
 * Global ⌘K search. Provides `open()` to descendants (the sidebar trigger) and
 * renders the overlay itself. Searches notes (title + summary) from any screen
 * via the shared matcher and opens the selected note. See #213.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const value = React.useMemo(() => ({ open: () => setIsOpen(true) }), []);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      {isOpen && <CommandPalette onClose={() => setIsOpen(false)} />}
    </PaletteContext.Provider>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const meetings = useMeetings();
  const all = React.useMemo(
    () => (meetings.data ?? []).filter((m) => !m.is_recording),
    [meetings.data],
  );
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = React.useMemo<Meeting[]>(() => {
    if (!query.trim()) return all.slice(0, RECENT_COUNT);
    return searchNotes(all, query);
  }, [all, query]);

  // Keep selection in range as results change.
  React.useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  const openMeeting = (m: Meeting | undefined) => {
    if (!m) return;
    navigate(`/meetings/${encodeURIComponent(m.session_info.summary_file)}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openMeeting(results[selected]);
    }
  };

  return (
    <div
      data-testid="command-palette"
      className="fixed inset-0 z-[200] flex items-start justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.32)' }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search notes"
        className="relative mt-[12vh] w-[min(620px,92vw)] overflow-hidden rounded-xl shadow-[var(--shadow-md)]"
        style={{ background: 'var(--surface-raised)', border: '1px solid hsl(var(--border))' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div
          className="flex items-center gap-2 px-3.5 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Search className="size-[15px]" style={{ color: 'var(--fg-2)' }} />
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
            placeholder="Search notes…"
            aria-label="Search notes"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
        </div>

        <ul role="listbox" className="scrollbar-clean max-h-[50vh] overflow-auto py-1">
          {results.length === 0 ? (
            <li
              className="px-3.5 py-6 text-center text-[13px]"
              style={{ color: 'var(--fg-muted)' }}
            >
              {query.trim() ? `No notes match “${query.trim()}”` : 'No notes yet'}
            </li>
          ) : (
            results.map((m, i) => {
              const title = m.session_info.name || 'Untitled Meeting';
              const sub = snippet(m.summary, query);
              return (
                <li
                  key={m.session_info.summary_file}
                  role="option"
                  aria-selected={i === selected}
                  data-testid="command-palette-result"
                  className="mx-1 cursor-pointer rounded-md px-2.5 py-2"
                  style={i === selected ? { background: 'var(--surface-active)' } : undefined}
                  onMouseEnter={() => setSelected(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    openMeeting(m);
                  }}
                >
                  <div className="truncate text-[13.5px]" style={{ color: 'var(--fg-1)' }}>
                    {title}
                  </div>
                  {sub && (
                    <div className="truncate text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                      {sub}
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <div
          className="flex items-center gap-3 px-3.5 py-2 text-[11px]"
          style={{
            color: 'var(--fg-muted)',
            borderTop: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

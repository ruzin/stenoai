import * as React from 'react';
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/chat';
import { navigate } from '@/lib/router';

export interface ChatHistoryRowSession {
  id: string;
  name: string;
  updatedAt: number;
}

interface ChatHistoryRowProps {
  session: ChatHistoryRowSession;
  /** Pass the route's current sessionId to highlight the active row. */
  activeId?: string | null;
  /** Show a relative-time chip on the right. Used on the /chat entry page;
   *  the dropdown variant hides it because group headers carry the time. */
  showTime?: boolean;
  /** Fires after a successful navigate so the parent (e.g. a History
   *  popover) can close itself. No-op for non-dismissible parents. */
  onSelect?: () => void;
  onRename: (name: string) => void;
  onDelete: () => void | Promise<void>;
}

/**
 * Single row used by both the Chat entry page's Recents list and the
 * conversation page's History dropdown. Shared so the rename/delete
 * affordance behaves identically in both places.
 *
 * Hover surfaces a "..." button that opens a secondary menu with Rename
 * (pencil) and Delete (trash, --danger). Rename swaps the title for an
 * inline input — Enter saves, Escape cancels, blur auto-commits.
 */
export function ChatHistoryRow({
  session,
  activeId,
  showTime = false,
  onSelect,
  onRename,
  onDelete,
}: ChatHistoryRowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(session.name);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!renaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming]);

  const startRename = () => {
    setDraft(session.name);
    setRenaming(true);
    setMenuOpen(false);
  };

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== session.name) onRename(next);
    setRenaming(false);
  };

  const isActive = activeId === session.id;
  const navigateToChat = () => {
    navigate(`/chat/${encodeURIComponent(session.id)}`);
    onSelect?.();
  };

  return (
    <div
      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
      style={{
        color: isActive ? 'var(--fg-1)' : 'var(--fg-1)',
        background: isActive ? 'var(--surface-active)' : undefined,
      }}
    >
      <MessageSquare
        className="size-[13px] flex-shrink-0"
        style={{ color: 'var(--fg-muted)' }}
      />
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          onBlur={commitRename}
          className="flex-1 min-w-0 rounded border-0 bg-transparent px-1 py-0 text-[13px] outline-none focus:shadow-[inset_0_0_0_1px_hsl(var(--border))]"
          style={{ color: 'var(--fg-1)' }}
        />
      ) : (
        <button
          type="button"
          onClick={navigateToChat}
          className="flex-1 truncate text-left"
        >
          {session.name || 'Untitled chat'}
        </button>
      )}
      {showTime && !renaming && (
        <span
          className="shrink-0 text-[11.5px] tabular-nums opacity-100 transition-opacity group-hover:opacity-0"
          style={{ color: 'var(--fg-muted)' }}
          aria-hidden
        >
          {relativeTime(session.updatedAt)}
        </span>
      )}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label="Chat actions"
            title="Actions"
            className={cn(
              'inline-flex size-6 shrink-0 items-center justify-center rounded transition-opacity hover:bg-[color:var(--surface-active)]',
              menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
              // When showing time, the menu replaces the time on hover so
              // the row width stays stable.
              showTime && '-ml-1',
            )}
            style={{ color: 'var(--fg-2)' }}
          >
            <MoreHorizontal className="size-[14px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="right"
          className="w-[140px] p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{ color: 'var(--fg-1)' }}
          >
            <Pencil className="size-[13px]" style={{ color: 'var(--fg-2)' }} />
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              void onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 className="size-[13px]" />
            Delete
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

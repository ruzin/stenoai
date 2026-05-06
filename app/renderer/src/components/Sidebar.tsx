import * as React from 'react';
import {
  ChevronDown,
  Home as HomeIcon,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { navigate, toggleSettings } from '@/lib/router';
import { cn, shortcut } from '@/lib/utils';
import { LucideIcon, IconPicker } from '@/components/IconPicker';
import { useUpdateFolderIcon } from '@/hooks/useFolders';

export interface SidebarMeeting {
  summaryFile: string;
  title: string;
  dateLabel?: string;
  active?: boolean;
  folderId?: string | null;
}

export interface SidebarFolder {
  id: string;
  name: string;
  icon?: string;
  /** User-chosen folder color. Used to tint the sidebar icon so it
   *  matches the chip in the FolderScopePicker / FolderDetail header. */
  color?: string;
  meetings: SidebarMeeting[];
}

export interface SidebarContextAction {
  type: 'folder' | 'meeting';
  id: string;
  clientX: number;
  clientY: number;
  itemRect: DOMRectReadOnly;
}

// sessionStorage so collapsed state resets to open on every app restart
const COLLAPSED_KEY = 'steno-sidebar-collapsed';
const WIDTH_KEY = 'steno-sidebar-width';
const DEFAULT_WIDTH = 270;
const MIN_WIDTH = 220;
const MAX_WIDTH = 480;

// Module-level singleton store. useState hooks on these values are not enough:
// MeetingsShell and BottomDockSlot need to share a single source of truth, or
// the dock and the main pane drift out of sync (one collapses, the other still
// thinks the sidebar is open) and the chat bar stops aligning with the notes.
type Listener = () => void;

const collapsedStore = (() => {
  let value =
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem(COLLAPSED_KEY) === 'true';
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next: boolean) => {
      if (value === next) return;
      value = next;
      try {
        sessionStorage.setItem(COLLAPSED_KEY, String(next));
      } catch (_) {}
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

const widthStore = (() => {
  let value = DEFAULT_WIDTH;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(WIDTH_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed)) {
        value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed));
      }
    }
  }
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next: number) => {
      const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
      if (value === clamped) return;
      value = clamped;
      try {
        localStorage.setItem(WIDTH_KEY, String(clamped));
      } catch (_) {}
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

export function useSidebarCollapsed() {
  const sidebarCollapsed = React.useSyncExternalStore(
    collapsedStore.subscribe,
    collapsedStore.get,
    collapsedStore.get,
  );
  const toggleSidebar = React.useCallback(() => {
    collapsedStore.set(!collapsedStore.get());
  }, []);
  return { sidebarCollapsed, toggleSidebar };
}

export function useSidebarWidth() {
  const width = React.useSyncExternalStore(
    widthStore.subscribe,
    widthStore.get,
    widthStore.get,
  );
  const setWidth = React.useCallback((w: number) => widthStore.set(w), []);
  return { width, setWidth };
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  folders: SidebarFolder[];
  totalMeetings: number;
  onNewFolder: () => void;
  onDropMeetingOnFolder?: (summaryFile: string, folderId: string | null) => void;
  onContextAction?: (action: SidebarContextAction) => void;
  currentRoute: string;
}

export function Sidebar({
  collapsed,
  onToggleCollapsed: _onToggleCollapsed,
  width,
  onWidthChange,
  search,
  onSearchChange,
  folders,
  totalMeetings,
  onNewFolder,
  onDropMeetingOnFolder,
  onContextAction,
  currentRoute,
}: SidebarProps) {
  const [foldersOpen, setFoldersOpen] = React.useState(true);
  const [dragOverFolder, setDragOverFolder] = React.useState<string | null>(null);
  const [dragOverAllMeetings, setDragOverAllMeetings] = React.useState(false);
  const isDraggingRef = React.useRef(false);
  const [iconPicker, setIconPicker] = React.useState<{ id: string; anchorRect: DOMRect } | null>(null);
  const updateIcon = useUpdateFolderIcon();

  const isHomeActive = currentRoute === '/' || currentRoute === '';
  const isAllMeetingsActive = currentRoute === '/meetings';
  // Match /chat as well as any /chat/<id> conversation route — the same Chat
  // tab item should stay highlighted when drilling into a session.
  const isChatActive = currentRoute === '/chat' || currentRoute.startsWith('/chat/');
  // Malformed % escapes throw URIError. Guard so a bad route can't crash
  // the entire sidebar render.
  const activeFolderId = React.useMemo<string | null>(() => {
    if (!currentRoute.startsWith('/folders/')) return null;
    const raw = currentRoute.slice('/folders/'.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [currentRoute]);

  const handleFolderDrop = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    const file = e.dataTransfer.getData('application/x-steno-meeting');
    if (file && onDropMeetingOnFolder) onDropMeetingOnFolder(file, folderId);
    setDragOverFolder(null);
    setDragOverAllMeetings(false);
  };

  const handleFolderContext = (e: React.MouseEvent, id: string) => {
    if (!onContextAction) return;
    e.preventDefault();
    const itemRect = e.currentTarget.getBoundingClientRect();
    onContextAction({ type: 'folder', id, clientX: e.clientX, clientY: e.clientY, itemRect });
  };

  const onResizeMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      isDraggingRef.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        onWidthChange(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX)));
      };
      const onUp = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, onWidthChange],
  );

  const filteredFolders = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(needle));
  }, [folders, search]);

  return (
    <aside
      data-sidebar
      className="fixed inset-y-0 left-0 z-20 flex flex-col"
      style={{
        width,
        // Disable pointer events on the collapsed aside so clicks reach the
        // content behind it. sb-top overrides this below to stay interactive.
        pointerEvents: collapsed ? 'none' : undefined,
      }}
    >
      {/* Full-sidebar background + right border — fades when collapsed.
          zIndex:-1 keeps it behind sb-top and content inside the aside's
          stacking context (position:fixed creates one). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: -1,
          background: 'var(--surface-sunken)',
          borderRight: '1px solid var(--border-subtle)',
          opacity: collapsed ? 0 : 1,
          transition: 'opacity 180ms ease',
          pointerEvents: 'none',
        }}
      />

      {/* Top band — drag region for macOS traffic lights.
          The toggle button is rendered in MainToolbar instead (position:fixed,
          inside a no-drag DOM branch) so Electron's app-region logic reliably
          registers the no-drag exclusion. Spacer preserves the visual gap. */}
      {/* sb-top: drag region for traffic lights. Height spacer preserves the
          original 46px row height (14px padding-top + 26px + 6px padding-bottom)
          so the brand section clears the traffic lights. */}
      <div className="sb-top">
        <div style={{ height: 26 }} aria-hidden />
      </div>

      {/* Sidebar content — fades with the background. No explicit pointer-events
          needed: inherits none from aside when collapsed, auto when expanded. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          opacity: collapsed ? 0 : 1,
          transition: 'opacity 180ms ease',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-[9px] px-4 pb-2.5 pt-3.5">
          <span
            aria-hidden="true"
            className="inline-flex h-[22px] w-[22px] items-center justify-center"
            style={{ color: 'var(--fg-1)' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M28 7 Q29 9.5 30 12.5" />
              <path d="M36 7 Q35 9.5 34 12.5" />
              <circle cx="32" cy="15" r="3.8" />
              <circle cx="30.5" cy="15" r="0.7" fill="currentColor" stroke="none" />
              <circle cx="33.5" cy="15" r="0.7" fill="currentColor" stroke="none" />
              <path d="M30 19 Q28 19 28 21 L28 50 L32 60 L36 50 L36 21 Q36 19 34 19 Z" />
              <line x1="28" y1="32" x2="36" y2="32" />
              <line x1="28" y1="38" x2="36" y2="38" />
              <line x1="28" y1="44" x2="36" y2="44" />
              <line x1="28" y1="50" x2="36" y2="50" />
              <path d="M28 22 C18 15 8 17 4 22 C10 28 20 28 28 27 Z" />
              <path d="M36 22 C46 15 56 17 60 22 C50 28 44 28 36 27 Z" />
              <path d="M28 28 C18 30 10 35 6 40 C14 39 22 36 28 33 Z" />
              <path d="M36 28 C46 30 54 35 58 40 C50 39 42 36 36 33 Z" />
            </svg>
          </span>
          <span
            className="text-[18px] font-normal"
            style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em', color: 'var(--fg-1)' }}
          >
            Steno<span style={{ color: 'var(--fg-muted)' }}>.</span>
          </span>
        </div>

        {/* Search */}
        <div className="px-3 pb-2.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-[9px] top-1/2 -translate-y-1/2 size-[13px]"
              style={{ color: 'var(--fg-2)' }}
            />
            <input
              data-sidebar-search
              className="h-[30px] w-full rounded-md border-0 px-[10px] pl-[30px] text-[13px] outline-none transition-colors focus:shadow-[inset_0_0_0_1px_hsl(var(--border))]"
              style={{ background: 'rgba(27,27,25,0.04)', color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
              placeholder="Search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              aria-label="Search folders"
            />
            <span
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-px text-[11px] tabular-nums tracking-[0.02em]"
              style={{ color: 'var(--fg-muted)', background: 'rgba(27,27,25,0.04)', fontFamily: 'var(--font-sans)' }}
            >
              {shortcut('⌘K', 'Ctrl+K')}
            </span>
          </div>
        </div>

        <div className="mx-3 h-px" style={{ background: 'var(--border-subtle)' }} />

        {/* Nav */}
        <nav className="scrollbar-clean flex min-h-0 flex-1 flex-col gap-px overflow-auto px-2 pb-2 pt-2">
          <button
            type="button"
            className={cn('sb-row', isHomeActive && 'active')}
            onClick={() => navigate('/')}
          >
            <HomeIcon className="size-[14px]" />
            <span className="flex-1 truncate">Home</span>
          </button>

          <div
            className={cn(dragOverAllMeetings && 'rounded bg-[color:var(--surface-hover)]')}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-steno-meeting')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverAllMeetings(true);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverAllMeetings(false);
            }}
            onDrop={(e) => handleFolderDrop(e, null)}
          >
            <button
              type="button"
              className={cn('sb-row', isAllMeetingsActive && 'active')}
              onClick={() => navigate('/meetings')}
            >
              <Inbox className="size-[14px]" />
              <span className="flex-1 truncate">All notes</span>
              {totalMeetings > 0 && (
                <span className="text-xs tabular-nums" style={{ color: 'var(--fg-muted)' }}>
                  {totalMeetings}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            className={cn('sb-row', isChatActive && 'active')}
            onClick={() => navigate('/chat')}
          >
            <MessageSquare className="size-[14px]" />
            <span className="flex-1 truncate">Chat</span>
          </button>

          {/* Folders group */}
          <div className="mt-3.5">
            <div
              className="sb-group-head flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 text-[11.5px] font-medium tracking-[0.02em] transition-colors hover:text-[color:var(--fg-1)]"
              style={{ color: 'var(--fg-2)' }}
              onClick={() => setFoldersOpen((o) => !o)}
            >
              <span className="flex items-center gap-1.5">
                <ChevronDown className={cn('size-3 transition-transform', !foldersOpen && '-rotate-90')} />
                <span>Folders</span>
              </span>
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[color:var(--surface-active)] [.sb-group-head:hover_&]:opacity-100"
                onClick={(e) => { e.stopPropagation(); onNewFolder(); }}
                aria-label="New folder"
                style={{ color: 'var(--fg-2)' }}
              >
                <Plus className="size-3" />
              </button>
            </div>

            {foldersOpen &&
              filteredFolders.map((folder) => {
                const isOver = dragOverFolder === folder.id;
                const isActive = activeFolderId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={cn('rounded', isOver && 'bg-[color:var(--surface-hover)] ring-1 ring-[color:var(--focus-ring)]')}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/x-steno-meeting')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverFolder(folder.id);
                      }
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setDragOverFolder(null);
                    }}
                    onDrop={(e) => handleFolderDrop(e, folder.id)}
                    onContextMenu={(e) => handleFolderContext(e, folder.id)}
                  >
                    <button
                      type="button"
                      data-testid="sidebar-folder"
                      className={cn('sb-row', isActive && 'active')}
                      style={{ paddingLeft: 12 }}
                      onClick={() => navigate(`/folders/${encodeURIComponent(folder.id)}`)}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Change folder icon"
                        className="flex-shrink-0 rounded p-0.5 hover:bg-[color:var(--surface-active)]"
                        style={{ color: 'var(--fg-2)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIconPicker({ id: folder.id, anchorRect: e.currentTarget.getBoundingClientRect() });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setIconPicker({ id: folder.id, anchorRect: e.currentTarget.getBoundingClientRect() });
                          }
                        }}
                      >
                        <LucideIcon name={folder.icon ?? 'folder'} size={14} />
                      </span>
                      <span className="flex-1 truncate">{folder.name}</span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--fg-muted)' }}>
                        {folder.meetings.length}
                      </span>
                    </button>
                  </div>
                );
              })}
          </div>
        </nav>

        {/* Pinned to the bottom of the sidebar — small icon button like it
            was in the toolbar, not a full nav row. Toggles open/closed: a
            second click while already on /settings returns the user to the
            route they were viewing before. */}
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={() => toggleSettings(currentRoute)}
            aria-label="Settings"
            title="Settings"
            aria-pressed={currentRoute === '/settings'}
            className={cn(
              'inline-flex h-[26px] w-7 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]',
              currentRoute === '/settings'
                ? 'bg-[color:var(--surface-active)] text-[color:var(--fg-1)]'
                : 'text-[color:var(--fg-2)]',
            )}
          >
            <SettingsIcon className="size-[15px]" />
          </button>
        </div>

        {iconPicker && (
          <IconPicker
            anchorRect={iconPicker.anchorRect}
            onSelect={(icon) => updateIcon.mutate({ id: iconPicker.id, icon })}
            onClose={() => setIconPicker(null)}
          />
        )}
      </div>

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={onResizeMouseDown}
          aria-hidden
          className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-[hsl(var(--border))]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        />
      )}
    </aside>
  );
}

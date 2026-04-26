import * as React from 'react';
import {
  ChevronDown,
  Home as HomeIcon,
  Inbox,
  Plus,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { navigate } from '@/lib/router';
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

export function useSidebarCollapsed() {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(
    () => sessionStorage.getItem(COLLAPSED_KEY) === 'true',
  );

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      sessionStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }, []);

  return { sidebarCollapsed, toggleSidebar };
}

export function useSidebarWidth() {
  const [width, setWidthState] = React.useState<number>(() => {
    const stored = localStorage.getItem(WIDTH_KEY);
    if (!stored) return DEFAULT_WIDTH;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? DEFAULT_WIDTH : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed));
  });

  const setWidth = React.useCallback((w: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    setWidthState(clamped);
    localStorage.setItem(WIDTH_KEY, String(clamped));
  }, []);

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
  const activeFolderId = currentRoute.startsWith('/folders/')
    ? decodeURIComponent(currentRoute.slice('/folders/'.length))
    : null;

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
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <path d="M24 6 C16 6 10 10 10 17 C10 24 18 25 24 25 C30 25 38 26 38 33 C38 40 32 42 24 42" />
                <path d="M24 25 L24 42" strokeDasharray="1 3" opacity="0.55" />
              </g>
              <circle cx="24" cy="42" r="2" fill="currentColor" />
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
              <span className="flex-1 truncate">All meetings</span>
              {totalMeetings > 0 && (
                <span className="text-xs tabular-nums" style={{ color: 'var(--fg-muted)' }}>
                  {totalMeetings}
                </span>
              )}
            </button>
          </div>

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

        {iconPicker && (
          <IconPicker
            anchorRect={iconPicker.anchorRect}
            onSelect={(icon) => updateIcon.mutate({ id: iconPicker.id, icon })}
            onClose={() => setIconPicker(null)}
          />
        )}

        {/* Footer */}
        <div
          className="flex items-center px-2 pb-3 pt-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            title="Settings"
            className="inline-flex size-7 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
            style={{ color: 'var(--fg-2)' }}
          >
            <SettingsIcon className="size-[15px]" />
          </button>
        </div>
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

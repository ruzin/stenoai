import * as React from 'react';
import { MainToolbar } from '@/components/MainToolbar';
import { cn } from '@/lib/utils';
import type { RecordingStatus } from '@/hooks/useRecording';

interface AppShellProps {
  recordingStatus: RecordingStatus;
  recordingElapsed?: number;
  onToggleRecording: () => void;
  onToggleSidebar: () => void;
  sidebar: React.ReactNode;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  askBarSlot?: React.ReactNode;
  contentAlign?: 'top' | 'center';
  /**
   * When true, omits the MainToolbar (record button). Implies `bleed`.
   * Used by /recording where the LiveDock owns recording controls.
   */
  hideToolbar?: boolean;
  /**
   * When true, renders children directly inside the main pane without the
   * centered max-w-[820px] content wrapper. Use for routes that own their
   * own header/scroll layout (e.g. Settings). Implied by hideToolbar.
   */
  bleed?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  recordingStatus,
  recordingElapsed,
  onToggleRecording,
  onToggleSidebar,
  sidebar,
  sidebarWidth,
  sidebarCollapsed,
  askBarSlot,
  contentAlign = 'top',
  hideToolbar = false,
  bleed = false,
  children,
}: AppShellProps) {
  const effectiveWidth = sidebarCollapsed ? 0 : sidebarWidth;
  const useBleed = hideToolbar || bleed;

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{ background: 'var(--page)', color: 'var(--fg-1)' }}
    >
      {sidebar}

      <main
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ marginLeft: effectiveWidth, transition: 'margin-left 180ms ease' }}
      >
        {!hideToolbar && (
          <MainToolbar
            recordingStatus={recordingStatus}
            elapsedSeconds={recordingElapsed}
            onToggleRecording={onToggleRecording}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={onToggleSidebar}
          />
        )}

        {useBleed ? (
          children
        ) : (
          <div
            className={cn(
              'scrollbar-clean flex-1 min-h-0 overflow-auto',
              contentAlign === 'center' && 'flex items-center justify-center',
            )}
            /* scrollbar-gutter: stable reserves space for the scrollbar even
               when content fits, so the notes column's centerline is the same
               whether or not the scrollbar is visible. The dock below mirrors
               this (no asymmetric padding needed) and stays aligned with the
               notes column. */
            style={{ scrollbarGutter: 'stable' }}
          >
            <div className="mx-auto w-full max-w-[720px] px-10 pb-36 pt-7">
              {children}
            </div>
          </div>
        )}

        {askBarSlot && (
          <div
            id="ask-bar-slot"
            className="mv-dock"
            /* Mirror the 10px scrollbar gutter reserved by the sibling scroll
               container so the dock's centerline matches the notes column's
               centerline. Without this, the dock sits 5px right of the notes. */
            style={{ paddingRight: 10 }}
          >
            <div
              className="mv-dock-inner"
              /* Match the notes column: same max-width and side padding so the
                 composer pill is centered to the notes content. */
              style={{ maxWidth: 720, width: '100%', margin: '0 auto', padding: '0 40px' }}
            >
              {askBarSlot}
            </div>
          </div>
        )}
      </main>

      <div id="dialog-host" />
      <div
        id="toast-host"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      />
    </div>
  );
}

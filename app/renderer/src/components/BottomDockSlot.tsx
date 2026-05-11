import * as React from 'react';
import { useSidebarCollapsed, useSidebarWidth } from '@/components/Sidebar';

interface BottomDockSlotProps {
  children: React.ReactNode;
  /** Distance from bottom in px. 0 for the primary dock, 72 for the floater above it. */
  bottomOffset?: number;
}

/**
 * Canonical fixed-bottom anchor used by AskBar, LiveDock, and ProcessingDock.
 * Ensures all three states sit in the exact same screen slot so transitions
 * between recording → processing → meeting feel like a content swap, not a
 * layout reshuffle. Width tracks the sidebar like AskBar does today.
 */
export function BottomDockSlot({ children, bottomOffset = 0 }: BottomDockSlotProps) {
  const { sidebarCollapsed } = useSidebarCollapsed();
  const { width: sidebarWidth } = useSidebarWidth();
  // Match AppShell's main-pane left edge: 0 when sidebar is collapsed (main
  // has marginLeft:0), sidebarWidth when expanded. Anything else shifts the
  // dock's centerline off the notes column's centerline.
  const left = sidebarCollapsed ? 0 : sidebarWidth;

  // Only the primary dock (bottomOffset === 0, sitting at the screen bottom)
  // gets the fade backdrop — the floater above it would double-stack.
  const showFade = bottomOffset === 0;

  return (
    <div
      className="pointer-events-none fixed z-40"
      style={{
        left,
        // Mirror the 10px scrollbar gutter the sibling scroll container reserves
        // (scrollbar-gutter: stable in AppShell) so the dock's centerline matches
        // the notes column's centerline regardless of overflow.
        right: 10,
        bottom: bottomOffset,
        paddingBottom: bottomOffset === 0 ? 16 : 0,
        transition: 'left 180ms ease',
      }}
    >
      {showFade && (
        // Narrower, lighter fade — just enough to soften scrolling content as
        // it approaches the pill. The solid band below keeps content from
        // peeking out around the pill. The pill sits on its own opaque raised
        // surface and renders above both layers.
        <>
          <div
            aria-hidden
            className="absolute inset-x-0"
            style={{
              top: -80,
              height: 80,
              background:
                'linear-gradient(to bottom, ' +
                'color-mix(in srgb, var(--page) 0%, transparent) 0%, ' +
                'color-mix(in srgb, var(--page) 35%, transparent) 60%, ' +
                'var(--page) 100%)',
              pointerEvents: 'none',
              zIndex: -1,
            }}
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0"
            style={{
              top: 0,
              background: 'var(--page)',
              pointerEvents: 'none',
              zIndex: -1,
            }}
          />
        </>
      )}
      <div className="mx-auto w-full max-w-[720px] px-10">{children}</div>
    </div>
  );
}

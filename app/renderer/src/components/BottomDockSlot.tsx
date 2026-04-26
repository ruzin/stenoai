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
  const left = sidebarCollapsed ? 68 : sidebarWidth;

  return (
    <div
      className="pointer-events-none fixed right-0 z-40"
      style={{ left, bottom: bottomOffset, paddingBottom: bottomOffset === 0 ? 16 : 0 }}
    >
      <div className="mx-auto w-full max-w-[820px] px-14">{children}</div>
    </div>
  );
}

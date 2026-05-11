import * as React from 'react';
import type { SidebarContextAction } from '@/components/Sidebar';

export interface MeetingsListActions {
  /**
   * Trigger the rename/delete context menu for a meeting. Hosted by
   * MeetingsShellV2; called from any list row that wants to expose a
   * right-click menu.
   */
  openMeetingContextMenu: (
    meetingSummaryFile: string,
    event: React.MouseEvent,
  ) => void;
  /**
   * Begin a meeting drag. Sets the application/x-steno-meeting payload
   * on the dataTransfer so SidebarV2 folder rows can pick it up.
   */
  startMeetingDrag: (
    meetingSummaryFile: string,
    event: React.DragEvent,
  ) => void;
}

const MeetingsListContext = React.createContext<MeetingsListActions | null>(null);

interface ProviderProps {
  onContextAction: (action: SidebarContextAction) => void;
  children: React.ReactNode;
}

export function MeetingsListProvider({ onContextAction, children }: ProviderProps) {
  const value = React.useMemo<MeetingsListActions>(
    () => ({
      openMeetingContextMenu: (id, e) => {
        e.preventDefault();
        const itemRect = e.currentTarget.getBoundingClientRect();
        onContextAction({
          type: 'meeting',
          id,
          clientX: e.clientX,
          clientY: e.clientY,
          itemRect,
        });
      },
      startMeetingDrag: (id, e) => {
        e.dataTransfer.setData('application/x-steno-meeting', id);
        e.dataTransfer.effectAllowed = 'move';
      },
    }),
    [onContextAction],
  );

  return (
    <MeetingsListContext.Provider value={value}>{children}</MeetingsListContext.Provider>
  );
}

/**
 * Returns null when used outside MeetingsListProvider — list-row primitives
 * should degrade gracefully (e.g. drag/context become no-ops).
 */
export function useMeetingsList(): MeetingsListActions | null {
  return React.useContext(MeetingsListContext);
}

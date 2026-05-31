import * as React from 'react';

export interface ActiveOrgMeeting {
  id: string;
  title: string;
  body: string;
  ownerEmail: string;
  /** When the shared note was uploaded with a transcript, the adapter
   *  inlines it on GET /meetings/{id}. The AskBar's transcript toggle
   *  surfaces only when this is non-empty. */
  transcript?: string;
}

interface AskBarContextValue {
  activeSummaryFile: string | null;
  activeMeetingName: string | null;
  setActiveMeeting: (summaryFile: string | null, name: string | null) => void;
  /** Set when the user is viewing a shared note (`/org/shared/:id`).
   *  Mutually exclusive with activeSummaryFile in practice. */
  activeOrgMeeting: ActiveOrgMeeting | null;
  setActiveOrgMeeting: (meeting: ActiveOrgMeeting | null) => void;
  transcriptOpen: boolean;
  setTranscriptOpen: (open: boolean) => void;
}

const AskBarContext = React.createContext<AskBarContextValue | null>(null);

export function AskBarProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<{
    summaryFile: string | null;
    name: string | null;
  }>({ summaryFile: null, name: null });
  const [activeOrgMeeting, setActiveOrgMeetingState] = React.useState<ActiveOrgMeeting | null>(null);
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);

  React.useEffect(() => {
    if (!active.summaryFile) setTranscriptOpen(false);
  }, [active.summaryFile]);

  const setActiveMeeting = React.useCallback(
    (summaryFile: string | null, name: string | null) =>
      setActive((prev) =>
        prev.summaryFile === summaryFile && prev.name === name ? prev : { summaryFile, name },
      ),
    [],
  );

  const setActiveOrgMeeting = React.useCallback((meeting: ActiveOrgMeeting | null) => {
    setActiveOrgMeetingState((prev) => {
      if (!prev && !meeting) return prev;
      if (
        prev &&
        meeting &&
        prev.id === meeting.id &&
        prev.title === meeting.title &&
        prev.body === meeting.body &&
        prev.ownerEmail === meeting.ownerEmail &&
        prev.transcript === meeting.transcript
      ) {
        return prev;
      }
      return meeting;
    });
  }, []);

  const value = React.useMemo<AskBarContextValue>(
    () => ({
      activeSummaryFile: active.summaryFile,
      activeMeetingName: active.name,
      setActiveMeeting,
      activeOrgMeeting,
      setActiveOrgMeeting,
      transcriptOpen,
      setTranscriptOpen,
    }),
    [active, transcriptOpen, setActiveMeeting, activeOrgMeeting, setActiveOrgMeeting],
  );

  return <AskBarContext.Provider value={value}>{children}</AskBarContext.Provider>;
}

export function useAskBar(): AskBarContextValue {
  const ctx = React.useContext(AskBarContext);
  if (!ctx) throw new Error('useAskBar must be used inside AskBarProvider');
  return ctx;
}

export function useActiveMeeting(
  summaryFile: string | null,
  name: string | null,
) {
  const { setActiveMeeting } = useAskBar();
  React.useEffect(() => {
    setActiveMeeting(summaryFile, name);
    return () => setActiveMeeting(null, null);
  }, [summaryFile, name, setActiveMeeting]);
}

/** Register the currently-viewed shared note with AskBar, so its composer
 *  can route questions through the org adapter against this note's body.
 *  Pass null to clear (e.g. when leaving the route). */
export function useActiveOrgMeeting(meeting: ActiveOrgMeeting | null) {
  const { setActiveOrgMeeting } = useAskBar();
  React.useEffect(() => {
    setActiveOrgMeeting(meeting);
    return () => setActiveOrgMeeting(null);
  }, [meeting, setActiveOrgMeeting]);
}

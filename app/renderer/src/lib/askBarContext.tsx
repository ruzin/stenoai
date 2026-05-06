import * as React from 'react';

interface AskBarContextValue {
  activeSummaryFile: string | null;
  activeMeetingName: string | null;
  setActiveMeeting: (summaryFile: string | null, name: string | null) => void;
  transcriptOpen: boolean;
  setTranscriptOpen: (open: boolean) => void;
}

const AskBarContext = React.createContext<AskBarContextValue | null>(null);

export function AskBarProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<{
    summaryFile: string | null;
    name: string | null;
  }>({ summaryFile: null, name: null });
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

  const value = React.useMemo<AskBarContextValue>(
    () => ({
      activeSummaryFile: active.summaryFile,
      activeMeetingName: active.name,
      setActiveMeeting,
      transcriptOpen,
      setTranscriptOpen,
    }),
    [active, transcriptOpen, setActiveMeeting],
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

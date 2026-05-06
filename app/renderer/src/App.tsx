import * as React from 'react';
import { Sandbox } from '@/routes/Sandbox';
import { Settings } from '@/routes/Settings';
import { Setup } from '@/routes/Setup';
import { Chat } from '@/routes/Chat';
import { ChatConversation } from '@/routes/ChatConversation';
import { StreamingProvider } from '@/hooks/useStreamingQuery';
import { Home } from '@/routes/Home';
import { MeetingDetail } from '@/routes/MeetingDetail';
import { FolderDetail } from '@/routes/FolderDetail';
import { Recording } from '@/routes/Recording';
import { Processing, ProcessingDock } from '@/routes/Processing';
import { AskBar, TranscriptBar } from '@/components/AskBar';
import { BottomDockSlot } from '@/components/BottomDockSlot';
import { LiveDock } from '@/components/LiveDock';
import { QuitDialog } from '@/components/QuitDialog';
import { AskBarProvider } from '@/lib/askBarContext';
import {
  useRecording,
  useRecordingEvents,
  useRecordingProcessingEffects,
} from '@/hooks/useRecording';
import { navigate, useRoute, rememberNonSettingsRoute } from '@/lib/router';
import { ipc } from '@/lib/ipc';
import { primeDebugLogs } from '@/lib/debugLogs';

export function App() {
  const route = useRoute();

  React.useLayoutEffect(() => {
    if (typeof window !== 'undefined' && window.stenoai) {
      ipc().window.readyToShow();
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.stenoai) return;
    const off = [
      ipc().on.trayOpenSettings(() => navigate('/settings')),
      ipc().on.setupFlowTriggered(() => navigate('/setup')),
      // Capture backend debug-log lines from app start (not just when Settings
      // → Developer is open) so the console always has the full session.
      primeDebugLogs((cb) => ipc().on.debugLog(cb)),
    ];
    return () => off.forEach((fn) => fn());
  }, []);

  useRecordingEvents();
  useRecordingProcessingEffects();

  // Track the last non-settings route so the sidebar Settings toggle and the
  // Settings page's Back button can return the user to where they came from
  // (e.g. a meeting they were viewing) instead of dropping them on Home.
  React.useEffect(() => {
    rememberNonSettingsRoute(route);
  }, [route]);

  // Cold-reload mid-processing: if we restart the app while the backend is
  // still summarizing, drop the user on /meetings/processing so they don't
  // sit on Home wondering what happened. Only fires once on first render.
  const recording = useRecording();
  const didAutoRouteRef = React.useRef(false);
  React.useEffect(() => {
    if (didAutoRouteRef.current) return;
    if (recording.isLoading) return;
    didAutoRouteRef.current = true;
    if (
      recording.status === 'processing' &&
      (route === '/' || route === '' || route === '/meetings')
    ) {
      navigate('/meetings/processing');
    } else if (
      (recording.status === 'recording' || recording.status === 'paused') &&
      (route === '/' || route === '' || route === '/meetings')
    ) {
      navigate('/recording');
    }
  }, [recording.isLoading, recording.status, route]);

  // ⌘K — focus sidebar search. Capture-phase listener so it wins over nested
  // handlers; fires even when focus is in a form control (the search input
  // itself is exempt by the data-sidebar-search check).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      const search = document.querySelector<HTMLInputElement>(
        '[data-sidebar-search]',
      );
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const isRecordingRoute = route === '/recording';
  const isProcessingRoute = route === '/meetings/processing';
  // The /chat page has its own large composer, so the floating AskBar dock
  // would just stack a second redundant input below the same page. The
  // sub-route /chat/<id> (conversation view) also owns its own composer.
  const isChatRoute = route === '/chat' || route.startsWith('/chat/');
  const showAskBar = !isRecordingRoute && !isProcessingRoute && !isChatRoute;

  return (
    <StreamingProvider>
      <AskBarProvider>
        <RouteView route={route} />
        <QuitDialog />

        {/* Bottom dock — shared anchor across recording → processing → meeting. */}
        <BottomDockSlot>
          {isRecordingRoute && <LiveDock />}
          {isProcessingRoute && <ProcessingDock />}
          {showAskBar && <AskBar />}
        </BottomDockSlot>

        {/* Transcript — floats above the chat bar (only on real meeting routes). */}
        {showAskBar && (
          <BottomDockSlot bottomOffset={72}>
            <TranscriptBar />
          </BottomDockSlot>
        )}
      </AskBarProvider>
    </StreamingProvider>
  );
}

function RouteView({ route }: { route: string }) {
  if (route === '/dev' || route.startsWith('/dev/')) return <Sandbox />;
  if (route === '/settings') return <Settings />;
  if (route === '/setup') return <Setup />;
  if (route === '/recording') return <Recording />;
  if (route === '/chat') return <Chat />;
  if (route.startsWith('/chat/')) {
    const sessionId = safeDecode(route.slice('/chat/'.length));
    return <ChatConversation sessionId={sessionId} />;
  }
  if (route === '/meetings/processing') return <Processing />;
  if (route.startsWith('/meetings/')) {
    const summaryFile = safeDecode(route.slice('/meetings/'.length));
    return <MeetingDetail summaryFile={summaryFile} />;
  }
  if (route.startsWith('/folders/')) {
    const folderId = safeDecode(route.slice('/folders/'.length));
    return <FolderDetail folderId={folderId} />;
  }
  if (route === '/meetings') return <Home mode="meetings" />;
  return <Home mode="home" />;
}

// Tolerate malformed % escapes — a bad route shouldn't crash the renderer.
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

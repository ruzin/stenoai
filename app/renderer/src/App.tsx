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
import { OrgShared, OrgSharedDetail } from '@/routes/OrgShared';
import { useOrgSession, useSharedNotesGate } from '@/hooks/useOrg';
import { Recording } from '@/routes/Recording';
import { Processing, ProcessingDock } from '@/routes/Processing';
import { AskBar, TranscriptBar } from '@/components/AskBar';
import { GenerateNotesBar } from '@/components/GenerateNotesBar';
import { BottomDockSlot } from '@/components/BottomDockSlot';
import { LiveDock } from '@/components/LiveDock';
import { LiveTranscriptBar } from '@/components/LiveTranscriptBar';
import { useLiveTranscriptOpen } from '@/hooks/liveTranscriptOpenStore';
import { useTranscriptionEngine } from '@/hooks/useModels';
import { QuitDialog } from '@/components/QuitDialog';
import { ImportDropZone } from '@/components/ImportDropZone';
import { CommandPaletteProvider, useCommandPalette } from '@/components/CommandPalette';
import { AskBarProvider } from '@/lib/askBarContext';
import {
  useRecording,
  useRecordingEvents,
  useRecordingProcessingEffects,
} from '@/hooks/useRecording';
import { useSystemAudioCapture } from '@/hooks/useSystemAudioCapture';
import { useCalendarEvents, useCalendarAuthBus } from '@/hooks/useCalendarEvents';
import { navigate, useRoute, rememberNonSettingsRoute } from '@/lib/router';
import { ipc } from '@/lib/ipc';
import { primeDebugLogs } from '@/lib/debugLogs';

export function App() {
  const route = useRoute();

  React.useLayoutEffect(() => {
    if (typeof window !== 'undefined' && window.stenoai) {
      ipc().window.readyToShow();
      // Deterministic launch gate for e2e: the suite waits on [data-app-ready]
      // instead of a fixed timeout. Set alongside the existing readiness signal
      // so there is one readiness path with two observers (main + Playwright).
      document.documentElement.dataset.appReady = '1';
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
  useSystemAudioCapture();
  // Mount the calendar query at the App level so its 2 min polling and
  // window-focus refetch keep ticking across route changes. Without this
  // the subscription unmounts whenever the user navigates away from Home
  // (or Settings, which is the other consumer), and the user comes back
  // to a cache that's only as fresh as the last visit. Home.tsx /
  // Settings.tsx still call useCalendarEvents() — React Query shares the
  // observer + cache, so this is one query, not three.
  useCalendarEvents();
  // Auth-change → cache-invalidate bus. Mounted ONCE here at App level
  // so we have one set of googleAuthChanged + outlookAuthChanged
  // subscribers, not one per useCalendarEvents() caller (App + Home +
  // Settings would otherwise each register their own pair and fire
  // invalidateQueries N times per auth event).
  useCalendarAuthBus();

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

  // Reset the inline transcript panel to closed on every new recording
  // session. Without this, a user who opened the panel in session A would
  // start session B with the panel already expanded — the store survives
  // session boundaries by design (zustand isn't React-tree-scoped), so we
  // explicitly reset it here at the App level when sessionName changes.
  const setLiveTranscriptOpen = useLiveTranscriptOpen((s) => s.setOpen);
  const lastSessionRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (recording.sessionName !== lastSessionRef.current) {
      lastSessionRef.current = recording.sessionName ?? null;
      setLiveTranscriptOpen(false);
    }
  }, [recording.sessionName, setLiveTranscriptOpen]);

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

  // First-run onboarding: auto-open the setup wizard when no transcription
  // model is installed yet (Parakeet or any Whisper). This was wired in the
  // pre-React renderer and dropped in the rewrite. parakeet-status /
  // whisper-list read on-disk state (no running service needed), so it's a
  // reliable "needs setup" signal. We only redirect from a neutral landing
  // route and never while recording/processing, so we don't yank the user out
  // of anything in flight. Runs once.
  const didSetupGateRef = React.useRef(false);
  React.useEffect(() => {
    if (didSetupGateRef.current) return;
    if (recording.isLoading) return;
    const onNeutralRoute = route === '/' || route === '' || route === '/meetings';
    const busy =
      recording.status === 'recording' ||
      recording.status === 'paused' ||
      recording.status === 'processing';
    if (!onNeutralRoute || busy) return;
    didSetupGateRef.current = true;
    (async () => {
      try {
        const [parakeet, whisper] = await Promise.all([
          ipc().parakeetModels.status(),
          ipc().whisperModels.list(),
        ]);
        const parakeetInstalled = parakeet.success && parakeet.installed === true;
        const anyWhisperInstalled =
          whisper.success &&
          Object.values(whisper.supported_models ?? {}).some(
            (m) => (m as { installed?: boolean }).installed === true,
          );
        if (!parakeetInstalled && !anyWhisperInstalled) {
          navigate('/setup');
        }
      } catch {
        // Best-effort onboarding gate; never block the app on it.
      }
    })();
  }, [recording.isLoading, recording.status, route]);

  const isRecordingRoute = route === '/recording';
  const isProcessingRoute = route === '/meetings/processing';
  // The /chat page has its own large composer, so the floating AskBar dock
  // would just stack a second redundant input below the same page. The
  // sub-route /chat/<id> (conversation view) also owns its own composer.
  const isChatRoute = route === '/chat' || route.startsWith('/chat/');
  const showAskBar = !isRecordingRoute && !isProcessingRoute && !isChatRoute;

  return (
    <CommandPaletteProvider>
      <CommandPaletteHotkey />
      <StreamingProvider>
      <AskBarProvider>
        <RouteView route={route} />
        <QuitDialog />
        <ImportDropZone />

        {/* Bottom dock — shared anchor across recording → processing → meeting.
            During recording the slot swaps between the compact LiveDock pill
            and the larger LiveTranscriptBar (which owns Pause/Stop + the
            Multi language selector when expanded). Either occupies the slot;
            never both at once. */}
        <BottomDockSlot>
          {isRecordingRoute && <LiveRecordingDock />}
          {isProcessingRoute && <ProcessingDock />}
          {showAskBar && <AskBar />}
        </BottomDockSlot>

        {/* Transcript — floats above the chat bar (only on real meeting routes). */}
        {showAskBar && (
          <BottomDockSlot bottomOffset={72}>
            <TranscriptBar />
          </BottomDockSlot>
        )}

        {/* Generate-notes CTA — floats just above the chat bar for a
            transcript-only note (auto-summarise off). Self-hides when notes
            exist or the transcript panel is open. */}
        {showAskBar && (
          <BottomDockSlot bottomOffset={72}>
            <GenerateNotesBar />
          </BottomDockSlot>
        )}
      </AskBarProvider>
      </StreamingProvider>
    </CommandPaletteProvider>
  );
}

/** Global ⌘K → open the command palette. Capture-phase so it fires even when
 *  focus is in a form control. */
function CommandPaletteHotkey() {
  const { open } = useCommandPalette();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      open();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  return null;
}

/**
 * Recording-mode dock-slot child. Switches between the compact LiveDock pill
 * (transcript closed) and the expanded LiveTranscriptBar (transcript open).
 * They share the slot rather than stacking so the bottom of the page has a
 * single anchor at any moment.
 */
function LiveRecordingDock() {
  const open = useLiveTranscriptOpen((s) => s.open);
  const engineQuery = useTranscriptionEngine();
  // Whisper has no live transcript. Belt-and-braces vs the LiveDock toggle
  // being hidden: the store could already be open from a prior Parakeet
  // session, and zustand survives across recordings. Force LiveDock for
  // whisper regardless of stored state.
  const liveAvailable = (engineQuery.data ?? 'parakeet') === 'parakeet';
  return open && liveAvailable ? <LiveTranscriptBar /> : <LiveDock />;
}

function RouteView({ route }: { route: string }) {
  // Enterprise can hide the Shared notes feature. Gate the /org/shared
  // routes on it so a stale nav or deep-link can't reach the browse view
  // or its detail (the detail is what wires the cross-folder AskBar chat).
  const orgSession = useOrgSession();
  const sharedNotes = useSharedNotesGate(orgSession.data?.signedIn ?? false);

  // If we're sitting on a Shared notes route that policy has now resolved as
  // disabled, redirect to Home rather than rendering Home in place — keeps
  // the URL and content in agreement (and the sidebar active-state correct).
  // Gated on `resolved` so this only fires once we *know* it's disabled, not
  // during the initial load. Effect, never navigate() during render.
  const onOrgSharedRoute = route === '/org/shared' || route.startsWith('/org/shared/');
  React.useEffect(() => {
    if (onOrgSharedRoute && sharedNotes.resolved && !sharedNotes.enabled) {
      navigate('/');
    }
  }, [onOrgSharedRoute, sharedNotes.resolved, sharedNotes.enabled]);

  if (route === '/dev' || route.startsWith('/dev/')) return <Sandbox />;
  // Match deep-links like /settings?tab=organisation too — the Settings
  // component reads the tab param off the route on mount.
  if (route === '/settings' || route.startsWith('/settings?')) return <Settings />;
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
  if (route === '/org/shared' || route.startsWith('/org/shared/')) {
    // Not yet known-enabled (still loading, or disabled): show Home. The
    // effect above redirects to '/' once the policy resolves to disabled.
    if (!sharedNotes.enabled) return <Home mode="home" />;
    if (route === '/org/shared') return <OrgShared />;
    const id = safeDecode(route.slice('/org/shared/'.length));
    return <OrgSharedDetail id={id} />;
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

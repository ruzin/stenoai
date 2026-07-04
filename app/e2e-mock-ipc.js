/**
 * Deterministic mock IPC for the T1 (renderer-only) e2e tier.
 *
 * Installed from app/main.js when STENOAI_E2E_MOCK_IPC=1, BEFORE any of the
 * real `ipcMain.handle(...)` registrations run. Its job is to make the renderer
 * suite fully hermetic: no Python bundle, no Ollama, no adapter, no network.
 *
 * Mechanism — why a shim and not just pre-registering handlers:
 *   Electron's `ipcMain.handle` throws "second handler for '<channel>'" on a
 *   duplicate registration. main.js registers ~60 real handlers further down
 *   the file, so we can't simply register our own first. Instead we replace
 *   `ipcMain.handle` with a shim: when main.js later registers a channel, the
 *   shim swaps in a mock (or a permissive default) instead of the real,
 *   Python-spawning handler. Net result: exactly one registration per channel
 *   and not a single invoke() ever reaches the backend.
 *
 * Fidelity is intentionally renderer-shape only (see the plan's mock-IPC-drift
 * risk): T2 with the real backend is the cross-check for wire-shape truth. The
 * stateful handlers below model just enough of the org-lock state machine for
 * the T1 spec to drive UI sign-in and watch the provider flip.
 */

const fs = require('fs');
const { EXPORT_CANCELED } = require('./ipc-sentinels');

// A deterministic meeting the transcript-export T1 spec navigates to. Seeded
// only when STENOAI_E2E_SEED_MEETING=1 so the other T1 specs keep an empty Home.
// Shape mirrors the renderer's Meeting (session_info + transcript/notes/etc.);
// the fields here are exactly what buildTranscriptBundle reads plus the minimum
// DetailContent renders without a backend.
const SEED_MEETING = {
  session_info: {
    name: 'Epsilon Planning',
    summary_file: 'epsilon_summary.json',
    processed_at: '2026-06-19T12:00:00Z',
    duration_seconds: 1500,
    transcription_failed: false,
  },
  transcript: 'Alice: we ship Friday.\nBob: I will prep the release notes.',
  is_diarised: false,
  // The real backend (list-meetings -> _parse_meeting_markdown) returns the
  // user's notes under `user_notes`, not `notes`; mirror that here so the spec
  // exercises the same key buildTranscriptBundle reads for saved meetings.
  user_notes: 'Remember to send the deck.',
  participants: ['Alice', 'Bob'],
  summary: '',
  key_points: [],
  action_items: [],
  discussion_areas: [],
};

function install({ ipcMain }) {
  // In-memory stand-in for the org session + provider config that the real
  // handlers persist to disk. Mutated by the org-login / org-logout / set-ai
  // mocks so a test can assert the UI reacts to its own actions.
  const state = {
    provider: 'local', // 'local' | 'remote' | 'cloud' | 'adapter'
    orgSession: null, // { adapterUrl, email, name, orgId, exp } when signed in
    everSignedIn: false,
    model: 'gemma4:e2b-it-qat', // local/remote Ollama model (config.model)
    cloudProvider: 'openai',
    cloudModel: 'gpt-4o',
    remoteUrl: '', // remote Ollama URL (empty = not configured)
  };

  // Channels with behaviour a test depends on. Each is (event, ...args) like a
  // real ipcMain.handle callback. Mirror the real handlers' return shapes from
  // app/main.js (get-ai-provider ~5950, org-* ~7990).
  const MOCKS = {
    'get-ai-provider': async () => ({
      success: true,
      ai_provider: state.provider,
      cloud_provider: state.cloudProvider,
      cloud_model: state.cloudModel,
      model: state.model,
      remote_ollama_url: state.remoteUrl,
      cloud_api_key_set: false,
    }),

    // Mirror the real hard-lock: while a valid session exists the provider is
    // managed by the org and can only be 'adapter' (app/main.js set-ai-provider).
    'set-ai-provider': async (_event, provider) => {
      if (state.orgSession && provider !== 'adapter') {
        return { success: true, locked: true, ai_provider: 'adapter' };
      }
      state.provider = provider;
      return { success: true, ai_provider: provider };
    },

    // Seed meetings for the specs that need them, gated per env so the
    // org/shared-notes specs keep an empty Home. STENOAI_E2E_SEED_MEETING (one
    // known meeting) drives the transcript-export T1; STENOAI_E2E_SEED_MEETINGS
    // (the recency-sorted trio) drives the command-palette T1. This handler
    // lives in MOCKS, which shadows DEFAULTS, so it is the single source for the
    // channel.
    'list-meetings': async () => {
      if (process.env.STENOAI_E2E_SEED_MEETING === '1') {
        return { success: true, meetings: [SEED_MEETING] };
      }
      return { success: true, meetings: SEEDED_MEETINGS };
    },

    // The detail route loads via get-meeting (the lazy per-meeting fetch), not
    // by filtering list-meetings — answer it with the same seeded meeting so the
    // transcript-export detail route resolves and renders the transcript actions.
    'get-meeting': async (_event, summaryFile) => {
      if (process.env.STENOAI_E2E_SEED_MEETING === '1') {
        return { success: true, meeting: SEED_MEETING };
      }
      const m = SEEDED_MEETINGS.find(
        (x) => x.session_info && x.session_info.summary_file === summaryFile,
      );
      return m ? { success: true, meeting: m } : { success: false, error: 'meeting not found' };
    },

    // Mirror the real export-transcript handler's seam: with STENOAI_E2E_EXPORT_PATH
    // set, write the renderer-built bundle there so a T1 spec can read back exactly
    // what the Save action passed (the real handler is never installed under mock
    // IPC). Without the seam there's no dialog here, so report a cancel.
    'export-transcript': async (_event, _defaultFilename, content) => {
      if (typeof content !== 'string' || content.length === 0) {
        return { success: false, error: 'No transcript content to export.' };
      }
      const seamPath = process.env.STENOAI_E2E_EXPORT_PATH;
      if (!seamPath) return { success: false, error: EXPORT_CANCELED };
      fs.writeFileSync(seamPath, content, 'utf-8');
      return { success: true, path: seamPath };
    },

    // Mirror the real save-diagnostics handler's seam: with
    // STENOAI_E2E_DIAGNOSTICS_PATH set, write the renderer-built (redacted)
    // bundle there so a T1 spec can read back exactly what Save passed. Without
    // the seam there's no dialog here, so report a cancel.
    'save-diagnostics': async (_event, _defaultFilename, content) => {
      if (typeof content !== 'string' || content.length === 0) {
        return { success: false, error: 'No diagnostics content to save.' };
      }
      const seamPath = process.env.STENOAI_E2E_DIAGNOSTICS_PATH;
      if (!seamPath) return { success: false, error: EXPORT_CANCELED };
      fs.writeFileSync(seamPath, content, 'utf-8');
      return { success: true, path: seamPath };
    },

    'org-status': async () => {
      if (!state.orgSession) {
        return { signedIn: false, everSignedIn: state.everSignedIn };
      }
      const s = state.orgSession;
      return {
        signedIn: true,
        everSignedIn: true,
        exp: s.exp,
        adapterUrl: s.adapterUrl,
        email: s.email,
        name: s.name,
        orgId: s.orgId,
      };
    },

    // Accept the same { adapterUrl, email, password } envelope the renderer
    // sends. No network — synthesise a session and lock the provider, the way
    // a successful real login + autoSwitchToAdapterOnSignIn would.
    'org-login': async (_event, payload) => {
      const { adapterUrl, email, password } = payload || {};
      if (!adapterUrl) return { success: false, error: 'adapter URL is required' };
      if (!email || !password) {
        return { success: false, error: 'email and password are required' };
      }
      state.orgSession = {
        adapterUrl,
        email,
        name: email.includes('@') ? email.split('@')[0] : 'Org User',
        orgId: 'org-e2e',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      state.everSignedIn = true;
      state.provider = 'adapter';
      return {
        success: true,
        signedIn: true,
        adapterUrl,
        email,
        name: state.orgSession.name,
        orgId: state.orgSession.orgId,
      };
    },

    'org-logout': async () => {
      state.orgSession = null;
      state.provider = 'local';
      return { success: true };
    },
  };

  // Static shapes for the channels that fire on first paint and would throw in
  // render if the shape is wrong (consumers that .map / .filter / for-of over
  // the result). Everything not listed here and not in MOCKS falls through to a
  // permissive { success: true } — enough to keep invoke() from rejecting.
  // Optional seeded notes for specs that exercise note lists / search
  // (e.g. the command-palette T1). Gated so other specs keep the empty list.
  const seedMeeting = (name, summaryFile, summary, processedAt) => ({
    session_info: { name, summary_file: summaryFile, processed_at: processedAt },
    summary,
    transcript: '',
  });
  // Inserted oldest-first on purpose: distinct processed_at timestamps let the
  // command-palette spec prove the recency sort actually reorders them (without
  // timestamps every row tied at epoch 0 and insertion order masked a missing sort).
  const SEEDED_MEETINGS =
    process.env.STENOAI_E2E_SEED_MEETINGS === '1'
      ? [
          seedMeeting('Standup notes', 'standup.json', 'No blockers today.', '2026-06-18T10:00:00Z'),
          seedMeeting('Marketing sync', 'marketing.json', 'Budget owner is now Sarah.', '2026-06-19T10:00:00Z'),
          seedMeeting('Q3 Budget review', 'q3-budget.json', 'We revised the budget numbers for Q3.', '2026-06-20T10:00:00Z'),
        ]
      : [];

  const DEFAULTS = {
    'get-app-version': '0.0.0-e2e',
    // Fires on first paint once signed in (Sidebar + RouteView gate the
    // Shared notes feature on it). Default to feature-enabled to match the
    // adapter's default and keep the org-lock spec's UI unchanged. A spec can
    // drive the hidden path by launching with STENOAI_E2E_SHARED_NOTES=0.
    'org-get-policy': {
      success: true,
      policy: {
        auto_share_default: true,
        shared_notes_enabled: process.env.STENOAI_E2E_SHARED_NOTES !== '0',
      },
    },
    'list-folders': { success: true, folders: [] },
    'get-calendar-events': { success: true, events: [] },
    'parakeet-status': { success: true, model: '', installed: false },
    // Transcribe tab reads these on first paint. Default to Parakeet (the new
    // default engine) + auto so the language picker renders enabled and shows
    // the Parakeet language set (parakeet-language-picker.t1).
    'get-transcription-engine': { success: true, engine: 'parakeet' },
    'get-language': { success: true, language: 'auto' },
    'list-whisper-models': {
      success: true,
      supported_models: {},
      current_model: '',
      provider: 'whisper',
    },
    'get-queue-status': {
      success: true,
      isProcessing: false,
      queueSize: 0,
      currentJob: null,
      currentReprocesses: [],
      hasRecording: false,
      isPaused: false,
      elapsedSeconds: 0,
      sessionName: null,
    },
  };

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, realFn) => {
    let fn;
    if (MOCKS[channel]) {
      fn = MOCKS[channel];
    } else if (Object.prototype.hasOwnProperty.call(DEFAULTS, channel)) {
      const value = DEFAULTS[channel];
      fn = async () => value;
    } else {
      // Unknown channel — resolve permissively so no renderer invoke() rejects
      // with "no handler registered". The real (backend-spawning) handler is
      // never installed under mock IPC.
      fn = async () => ({ success: true });
    }
    return originalHandle(channel, fn);
  };
}

module.exports = { install };

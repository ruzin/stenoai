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

function install({ ipcMain }) {
  // In-memory stand-in for the org session + provider config that the real
  // handlers persist to disk. Mutated by the org-login / org-logout / set-ai
  // mocks so a test can assert the UI reacts to its own actions.
  const state = {
    provider: 'local', // 'local' | 'remote' | 'cloud' | 'adapter'
    orgSession: null, // { adapterUrl, email, name, orgId, exp } when signed in
    everSignedIn: false,
  };

  // Channels with behaviour a test depends on. Each is (event, ...args) like a
  // real ipcMain.handle callback. Mirror the real handlers' return shapes from
  // app/main.js (get-ai-provider ~5950, org-* ~7990).
  const MOCKS = {
    'get-ai-provider': async () => ({
      success: true,
      ai_provider: state.provider,
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
  const DEFAULTS = {
    'get-app-version': '0.0.0-e2e',
    'list-meetings': { success: true, meetings: [] },
    'list-folders': { success: true, folders: [] },
    'get-calendar-events': { success: true, events: [] },
    'parakeet-status': { success: true, model: '', installed: false },
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

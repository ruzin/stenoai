const { app, BrowserWindow, ipcMain, dialog, shell, systemPreferences, globalShortcut, safeStorage, Tray, Menu, nativeImage, Notification, powerMonitor } = require('electron');

// Prevent EPIPE crashes when stdout/stderr pipe is broken (e.g. launching terminal closed)
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});

// --- Early crash logger ---------------------------------------------------
// Packaged Electron apps on Windows surface no stderr/console, so a main-process
// exception during startup just looks like "nothing happens" (silent exit 1).
// Persist any uncaught error to a file we can read afterwards. Registered before
// the first heavy require so it also catches module-load failures. We log then
// exit(1) to preserve the original crash behaviour.
function _logStartupCrash(kind, err) {
  try {
    const _fs = require('fs');
    const _os = require('os');
    const _path = require('path');
    const stamp = new Date().toISOString();
    const detail = (err && (err.stack || err.message)) || String(err);
    const line = `[${stamp}] ${kind}: ${detail}\n`;
    for (const dir of [_os.tmpdir(), process.env.APPDATA, _os.homedir()]) {
      if (!dir) continue;
      try { _fs.appendFileSync(_path.join(dir, 'steno-crash.log'), line); break; } catch (_) {}
    }
  } catch (_) {}
}
// Windows/Linux only: packaged Electron apps surface no stderr there, so this
// file-based crash log is the only way to see a main-process startup failure.
// macOS keeps its default behaviour (Electron's error dialog + console) — we
// don't want to change the signed/notarised mac build's error handling.
if (process.platform !== 'darwin') {
  process.on('uncaughtException', (err) => { _logStartupCrash('uncaughtException', err); process.exit(1); });
  process.on('unhandledRejection', (reason) => { _logStartupCrash('unhandledRejection', reason); });
}

const path = require('path');
const { spawn: _spawnRaw, exec } = require('child_process');

// Wrap spawn so every backend / ollama launch defaults to windowsHide:true.
// The PyInstaller backend (stenoai.exe) and bundled ollama.exe are console
// subsystem binaries; without this Electron pops a visible console window on
// Windows for every recording, live-transcribe, query, and the long-lived
// `ollama serve` keeps one open for the whole session. No-op on macOS/Linux.
// Callers can still override by passing an explicit windowsHide.
function spawn(command, args, options) {
  if (Array.isArray(args) || args === undefined || args === null) {
    return _spawnRaw(command, args, { windowsHide: true, ...(options || {}) });
  }
  // 2-arg form: spawn(command, options)
  return _spawnRaw(command, { windowsHide: true, ...args });
}

// Terminate a process AND its child processes. On Windows `process.kill(pid)`
// only kills the named process, orphaning its children — `ollama serve` spawns
// per-model "runner" subprocesses that would leak after quit. `taskkill /T`
// walks the whole tree. On POSIX we keep the existing SIGTERM -> SIGKILL
// escalation (ollama tears its runners down on SIGTERM there). Synchronous on
// Windows (execFileSync) so it completes during the app's will-quit handler.
function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      require('child_process').execFileSync(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
    } catch (_) {}
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  }, 1000);
}
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const { URL, URLSearchParams } = require('url');
const crypto = require('crypto');
const { PostHog } = require('posthog-node');
const { initMain } = require('electron-audio-loopback');
const { autoUpdater } = require('electron-updater');

// E2E test-harness hooks. Set via env vars; production sees none of these.
//   STENOAI_USER_DATA_DIR — per-test temp userData dir (must be set before app.whenReady)
//   STENOAI_E2E=1         — skip tray, auto-updater, PostHog telemetry
//   STENOAI_E2E_MOCK_IPC=1 — install deterministic mock IPC handlers
if (process.env.STENOAI_USER_DATA_DIR) {
  app.setPath('userData', process.env.STENOAI_USER_DATA_DIR);
}
const IS_E2E = process.env.STENOAI_E2E === '1';
const IS_E2E_MOCK_IPC = process.env.STENOAI_E2E_MOCK_IPC === '1';
if (IS_E2E_MOCK_IPC) {
  require('./e2e-mock-ipc').install({ ipcMain, BrowserWindow });
}

// Distinguish dev runs from the packaged "Steno" app in the dock, About menu,
// and Cmd+Tab. Production keeps the productName from package.json untouched.
if (!app.isPackaged) {
  app.setName('Steno Dev');
}

// Initialize electron-audio-loopback before app is ready.
// forceCoreAudioTap drives Chromium to use macOS 14.4+ CoreAudio Process Taps
// (NSAudioCaptureUsageDescription) rather than ScreenCaptureKit. SCK was
// returning silent right channels in our tests on macOS 26; CoreAudio Tap
// matches Meetily's default and is the path our Info.plist + entitlements
// are prepared for. Older macOS (< 14.4) is gated out at the UI layer.
// Only force the macOS CoreAudio tap on darwin. forceCoreAudioTap appends a
// macOS-only Chromium feature flag (MacCatapSystemAudioLoopbackCapture) — on
// Windows that's irrelevant (Chromium uses WASAPI loopback) and passing it is
// at best a no-op, so we don't.
initMain({ forceCoreAudioTap: process.platform === 'darwin' });

// Windows taskbar identity. Without an explicit AppUserModelID matching the
// installer's, the taskbar shows a default/Electron icon (and groups the window
// separately) even when the window icon is correct — it keys off the AUMID, not
// the window icon. Must match the NSIS shortcut's id (build.appId).
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.stenoai.recorder'); } catch (_) {}
}

// CoreAudio Process Taps require macOS 14.4+. Returns false on non-macOS or
// older versions so the renderer can disable the system-audio toggle rather
// than silently producing dead-channel recordings.
function isCoreAudioTapSupported() {
  if (process.platform !== 'darwin') return false;
  try {
    const v = process.getSystemVersion();
    const [maj, min = 0] = v.split('.').map((n) => parseInt(n, 10) || 0);
    return maj > 14 || (maj === 14 && min >= 4);
  } catch (_) {
    return false;
  }
}

// Whether system-audio (loopback) capture is available on this OS at all.
// macOS: CoreAudio Process Tap (14.4+). Windows: electron-audio-loopback uses
// Chromium's WASAPI loopback on Windows 10+ (both Win10 and Win11 report major
// version 10). Linux: not wired. Drives the Settings/MainToolbar toggle.
function isSystemAudioSupported() {
  if (process.platform === 'darwin') return isCoreAudioTapSupported();
  if (process.platform === 'win32') {
    try {
      const maj = parseInt(process.getSystemVersion().split('.')[0], 10) || 0;
      return maj >= 10;
    } catch (_) {
      return true; // assume a modern Windows if the version probe fails
    }
  }
  return false;
}

// Per-OS user data dir, mirroring src/config.get_user_data_dir(). Used by the
// few synchronous config reads on the Electron side so they resolve the right
// path on Windows/Linux instead of the macOS literal.
function getUserDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai');
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'stenoai');
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'stenoai');
}

let mainWindow;
let pythonProcess;
let tray = null;
let isQuitting = false;
// true once the window has been shown for the first time (React mounted).
// Prevents activate/focus handlers from showing the window before it's ready.
let windowReadyToShow = false;
let shortcutQueue = [];
let pendingShortcutUrls = [];
let rendererShortcutReady = false;
let launchedByShortcut = false;

const SHORTCUT_PROTOCOL = 'stenoai';
const SHORTCUT_HOST = 'record';
const SHORTCUT_SESSION_NAME_MAX_LENGTH = 120;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

function extractShortcutUrlFromArgv(argv = []) {
  return argv.find(arg => typeof arg === 'string' && arg.startsWith(`${SHORTCUT_PROTOCOL}://`));
}

function sanitizeShortcutUrlForLogs(incomingUrl) {
  try {
    const parsed = new URL(incomingUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  } catch (error) {
    return '[invalid-shortcut-url]';
  }
}

function sanitizeShortcutSessionName(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  // Keep user-visible names readable while stripping unsupported characters.
  // Preserve Unicode letters (including diacritics) and common punctuation.
  const sanitized = rawValue
    .replace(/[^\p{L}\p{M}\p{N}_\s.,()@&'!+#-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHORTCUT_SESSION_NAME_MAX_LENGTH);

  return sanitized || null;
}

function registerShortcutProtocolClient() {
  if (process.platform !== 'darwin') {
    return false;
  }

  // In development (electron .), macOS protocol registration needs executable + app args.
  if (!app.isPackaged) {
    return app.setAsDefaultProtocolClient(
      SHORTCUT_PROTOCOL,
      process.execPath,
      [path.resolve(process.argv[1])]
    );
  }

  return app.setAsDefaultProtocolClient(SHORTCUT_PROTOCOL);
}

// Backend executable path - always use bundled stenoai
function getBackendPath() {
  const exe = process.platform === 'win32' ? 'stenoai.exe' : 'stenoai';
  if (app.isPackaged) {
    // Production: bundled in app resources
    return path.join(process.resourcesPath, 'stenoai', exe);
  } else {
    // Development: use local build
    return path.join(__dirname, '..', 'dist', 'stenoai', exe);
  }
}

function getBackendCwd() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'stenoai');
  } else {
    return path.join(__dirname, '..', 'dist', 'stenoai');
  }
}

// Path to the mic-in-use helper. Keeps the .exe suffix branch ready for a
// future Windows port — the JSON-line stdout contract is platform-agnostic,
// so swapping in a Windows binary at this path is the only required change.
function getMicMonitorPath() {
  const binName = process.platform === 'win32' ? 'mic-monitor.exe' : 'mic-monitor';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, binName);
  } else {
    return path.join(__dirname, '..', 'bin', binName);
  }
}

function parseShortcutUrl(incomingUrl) {
  try {
    const parsed = new URL(incomingUrl);
    if (parsed.protocol !== `${SHORTCUT_PROTOCOL}:`) {
      return { type: 'invalid', reason: 'invalid-protocol' };
    }

    if (parsed.hostname !== SHORTCUT_HOST) {
      return { type: 'invalid', reason: 'invalid-host' };
    }

    const cleanPath = (parsed.pathname || '').replace(/\/+$/, '');
    if (cleanPath === '/start') {
      const sessionName = sanitizeShortcutSessionName(parsed.searchParams.get('name') || '');
      return {
        type: 'start',
        sessionName
      };
    }

    if (cleanPath === '/stop') {
      return { type: 'stop' };
    }

    return { type: 'invalid', reason: 'invalid-path' };
  } catch (error) {
    return { type: 'invalid', reason: 'parse-error' };
  }
}

function ensureMainWindow() {
  if (!app.isReady()) {
    sendDebugLog('Shortcut action received before app ready; deferring window creation');
    return false;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  return true;
}

function dispatchShortcutAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (action.type === 'start') {
    mainWindow.webContents.send('shortcut-start-recording', {
      sessionName: action.sessionName || null
    });
    launchedByShortcut = false;
    return true;
  }

  if (action.type === 'stop') {
    mainWindow.webContents.send('shortcut-stop-recording');
    launchedByShortcut = false;
    return true;
  }

  return false;
}

function flushShortcutQueue() {
  if (!rendererShortcutReady || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  while (shortcutQueue.length > 0) {
    const nextAction = shortcutQueue.shift();
    const dispatched = dispatchShortcutAction(nextAction);
    if (!dispatched) {
      shortcutQueue.unshift(nextAction);
      break;
    }
  }
}

function enqueueShortcutAction(action) {
  if (shortcutQueue.length >= 5) {
    sendDebugLog('Shortcut queue overflow, dropping oldest action');
    shortcutQueue.shift();
  }
  shortcutQueue.push(action);
  flushShortcutQueue();
}

async function shouldShowShortcutNotifications() {
  return notificationsEnabled();
}

// Single source of truth for "is the user's Desktop notifications toggle
// on?". Reads the persisted Python config via handleGetNotifications.
// Falls back to `true` on any read error so a transient config issue
// never silently swallows notifications the user expects. Used by every
// notification handler (shortcut, silence auto-stop, note ready) — keeps
// the gate consistent rather than re-implementing it per call site.
async function notificationsEnabled() {
  try {
    const settings = await handleGetNotifications();
    if (!settings.success) return true;
    return settings.notifications_enabled !== false;
  } catch (_) {
    return true;
  }
}

async function showShortcutNotification(body) {
  if (process.platform !== 'darwin') {
    return;
  }

  try {
    const enabled = await shouldShowShortcutNotifications();
    if (!enabled || !Notification.isSupported()) {
      return;
    }

    new Notification({
      title: 'StenoAI Shortcuts',
      body
    }).show();
  } catch (error) {
    console.error('Failed to show shortcut notification:', error.message);
  }
}

const BACKEND_STATUS_RETRY_ATTEMPTS = 3;
const BACKEND_STATUS_RETRY_DELAY_MS = 250;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isBackendRecording() {
  for (let attempt = 1; attempt <= BACKEND_STATUS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const status = await handleGetStatus();
      if (status.success) {
        return status.status.includes('STATUS: RECORDING');
      }
    } catch (error) {
      if (attempt === BACKEND_STATUS_RETRY_ATTEMPTS) {
        console.error('Error checking recording status for shortcut action:', error.message);
      }
    }

    if (attempt < BACKEND_STATUS_RETRY_ATTEMPTS) {
      await wait(BACKEND_STATUS_RETRY_DELAY_MS);
    }
  }

  console.warn('Backend status unavailable after retries; assuming not recording for shortcut action');
  return false;
}

async function handleShortcutUrl(incomingUrl) {
  const parsedAction = parseShortcutUrl(incomingUrl);
  const safeShortcutUrl = sanitizeShortcutUrlForLogs(incomingUrl);

  if (parsedAction.type === 'invalid') {
    sendDebugLog(`Ignored invalid shortcut URL (${parsedAction.reason}): ${safeShortcutUrl}`);
    await showShortcutNotification('Invalid shortcut URL');
    launchedByShortcut = false;
    return;
  }

  const backendRecording = await isBackendRecording();
  const recording = backendRecording || systemAudioRecordingActive;

  if (parsedAction.type === 'start') {
    if (recording) {
      await showShortcutNotification('Recording already in progress');
      launchedByShortcut = false;
      return;
    }

    if (!ensureMainWindow()) {
      launchedByShortcut = true;
      pendingShortcutUrls.push(incomingUrl);
      return;
    }
    enqueueShortcutAction(parsedAction);
    await showShortcutNotification('Start recording requested');
    return;
  }

  if (!recording) {
    await showShortcutNotification('Recording already stopped');
    launchedByShortcut = false;
    return;
  }

  if (!ensureMainWindow()) {
    launchedByShortcut = true;
    pendingShortcutUrls.push(incomingUrl);
    return;
  }
  enqueueShortcutAction(parsedAction);
  await showShortcutNotification('Stop recording requested');
}

// Telemetry state
let posthogClient = null;
let telemetryEnabled = false;
let anonymousId = null;

const POSTHOG_API_KEY = 'phc_U2cnTyIyKGNSVaK18FyBMltd8nmN7uHxhhm21fAHwqb';
const POSTHOG_HOST = 'https://us.i.posthog.com';

// Google Calendar OAuth2 configuration
const GOOGLE_CLIENT_ID = '281073275073-20da4u5t9luk2366vd5ai0a2r55d5pf5.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Outlook Calendar OAuth2 configuration (PKCE public client — no client secret)
const OUTLOOK_CLIENT_ID = '53a8ba1f-3a2e-4fc9-afb1-b9b8ff13de19';
const OUTLOOK_SCOPES = 'Calendars.Read offline_access';
const OUTLOOK_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

/**
 * Return a privacy-safe duration bucket string.
 */
function durationBucket(seconds) {
  if (seconds < 60) return '<1m';
  if (seconds < 300) return '1-5m';
  if (seconds < 900) return '5-15m';
  if (seconds < 1800) return '15-30m';
  if (seconds < 3600) return '30-60m';
  return '60m+';
}

/**
 * Initialize PostHog telemetry by reading config from Python backend.
 */
async function initTelemetry() {
  if (IS_E2E) {
    telemetryEnabled = false;
    return;
  }
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(getBackendPath(), ['get-telemetry'], {
        cwd: getBackendCwd()
      });
      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`get-telemetry exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    const config = JSON.parse(result.trim());
    telemetryEnabled = config.telemetry_enabled;
    anonymousId = config.anonymous_id;

    if (telemetryEnabled) {
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      // Identify user for DAU tracking
      posthogClient.identify({
        distinctId: anonymousId,
        properties: {
          platform: process.platform,
          arch: process.arch
        }
      });
      console.log('Telemetry initialized (anonymous analytics enabled)');
    } else {
      console.log('Telemetry disabled by user preference');
    }
  } catch (error) {
    console.error('Failed to initialize telemetry:', error.message);
    telemetryEnabled = false;
  }
}

// Cache the app version at module load. trackEvent fires from ~35 call sites
// across the recording lifecycle; re-reading + JSON.parsing package.json each
// time burns 0.5 ms of main-thread time per call for a value that's immutable
// for the lifetime of the process. `require` already caches transitively, so
// we get the parsed object once.
const APP_VERSION = (() => {
  try {
    return require('./package.json').version || '';
  } catch (_) {
    return '';
  }
})();

/**
 * Track an analytics event. Silent fail -- never throws.
 */
function trackEvent(eventName, properties = {}) {
  try {
    if (!telemetryEnabled || !posthogClient || !anonymousId) return;

    posthogClient.capture({
      distinctId: anonymousId,
      event: eventName,
      properties: {
        app_version: APP_VERSION,
        platform: process.platform,
        arch: process.arch,
        ...properties
      }
    });
  } catch (error) {
    // Silent fail -- telemetry must never break the app
  }
}

/**
 * Flush and shut down the PostHog client.
 */
async function shutdownTelemetry() {
  try {
    if (posthogClient) {
      await posthogClient.shutdown();
      posthogClient = null;
      console.log('Telemetry shut down');
    }
  } catch (error) {
    // Silent fail
  }
}

/**
 * Get the list of allowed base directories, including any custom storage path.
 */
let _cachedCustomStoragePath = null;
function getAllowedBaseDirs() {
  const projectRoot = path.join(__dirname, '..');
  const dirs = [
    projectRoot,
    path.join(os.homedir(), 'Library', 'Application Support', 'stenoai')
  ];
  if (_cachedCustomStoragePath) {
    dirs.push(_cachedCustomStoragePath);
  }
  return dirs;
}

// Sync resolver for the audio recordings folder. Mirrors the path order used
// by the async `get-recordings-dir` handler (custom storage > packaged data
// dir > dev scratch). Use this anywhere we need the path inside an IPC
// handler that can't `await runPythonScript`.
function resolveRecordingsDir() {
  let dir;
  if (_cachedCustomStoragePath) {
    dir = path.join(_cachedCustomStoragePath, 'recordings');
  } else if (app.isPackaged) {
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', 'recordings');
  } else {
    dir = path.join(__dirname, '..', 'recordings');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validate that a file path is within allowed directories (security)
 * Prevents path traversal attacks by ensuring files are only accessed
 * within the app's designated data directories
 */
function validateSafeFilePath(filepath, allowedBaseDirs) {
  if (!filepath) return false;

  try {
    // Resolve to absolute path and normalize
    const resolvedPath = path.resolve(filepath);

    // Ensure it's within one of the allowed base directories
    for (const baseDir of allowedBaseDirs) {
      const resolvedBase = path.resolve(baseDir);
      if (resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error validating file path:', error);
    return false;
  }
}

function createWindow(options = {}) {
  rendererShortcutReady = false;

  const windowOpts = {
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    // Explicit window/taskbar icon on Windows. Relying on the exe-embedded icon
    // is unreliable (Windows icon cache shows a stale/default icon), so we point
    // at the bundled .ico directly. macOS uses its .icns via the app bundle.
    ...(process.platform === 'win32'
      ? {
          icon: app.isPackaged
            ? path.join(process.resourcesPath, 'icon.ico')
            : path.join(__dirname, 'build', 'icon.ico'),
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
      scrollBounce: true,
    },
    titleBarStyle: 'hiddenInset',
    // Windows/Linux render the Electron application menu as an in-window menu
    // bar (File/Edit/View/…); macOS puts it in the global bar. Hide it off-mac
    // so the app keeps its clean custom-toolbar look (Alt still reveals it).
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#FAF9F5',
    // React UI renders the macOS traffic lights inside the sidebar's top
    // band rather than floating above a fixed titlebar.
    trafficLightPosition: { x: 18, y: 18 },
  };
  if (options.bounds && typeof options.bounds.x === 'number') {
    Object.assign(windowOpts, options.bounds);
  }

  mainWindow = new BrowserWindow(windowOpts);

  const rendererDist = path.join(__dirname, 'renderer', 'dist', 'index.html');
  const hash = process.env.STENOAI_RENDERER_HASH;
  if (hash) {
    mainWindow.loadFile(rendererDist, { hash });
  } else {
    mainWindow.loadFile(rendererDist);
  }

  windowReadyToShow = false;

  const showWhenReady = () => {
    windowReadyToShow = true;
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };

  mainWindow.once('ready-to-show', () => {
    if (launchedByShortcut) {
      return;
    }
    // Wait until React signals it has mounted. Fall back to showing after
    // 4s in case the signal never arrives.
    const fallback = setTimeout(showWhenReady, 4000);
    ipcMain.once('renderer-ready-to-show', () => {
      clearTimeout(fallback);
      showWhenReady();
    });
  });



  // On macOS, hide to tray instead of destroying (like Slack, Spotify)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Returning to the window is the strongest "about to record" signal — keep
  // the Parakeet model hot. Throttled + recording-guarded inside rewarmParakeet.
  mainWindow.on('focus', () => rewarmParakeet('window-focus'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererShortcutReady = false;
    // Abort any in-flight org SSE streams so they don't keep consuming
    // network/CPU after the renderer is gone.
    if (typeof orgStreamAborters !== 'undefined') {
      for (const ctrl of orgStreamAborters.values()) {
        try { ctrl.abort(); } catch (_) {}
      }
      orgStreamAborters.clear();
    }
    if (pythonProcess) {
      pythonProcess.kill();
    }
  });
}

function getTrayIconPath(recording) {
  const iconName = recording ? 'trayIconRecordingTemplate' : 'trayIconTemplate';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', `${iconName}.png`);
  }
  return path.join(__dirname, 'assets', `${iconName}.png`);
}

function createTray() {
  const icon = nativeImage.createFromPath(getTrayIconPath(false));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('StenoAI');

  updateTrayMenu();
}

function updateTrayIcon(recording) {
  if (!tray) return;
  const icon = nativeImage.createFromPath(getTrayIconPath(recording));
  icon.setTemplateImage(true);
  tray.setImage(icon);
  tray.setToolTip(recording ? 'StenoAI - Recording' : 'StenoAI');
  updateTrayMenu();
}

function showAndFocusWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const isRecording = currentRecordingProcess !== null || systemAudioRecordingActive;

  const appVersion = require('./package.json').version;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open StenoAI',
      click: showAndFocusWindow
    },
    {
      label: isRecording ? 'Stop Recording' : 'Start Recording',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send(isRecording ? 'tray-stop-recording' : 'tray-start-recording');
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        showAndFocusWindow();
        if (mainWindow) {
          mainWindow.webContents.send('tray-open-settings');
        }
      }
    },
    {
      label: 'Hide StenoAI',
      click: () => {
        if (mainWindow) mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: `StenoAI v${appVersion}`,
      enabled: false
    },
    {
      label: 'Report a Bug',
      click: () => {
        shell.openExternal('https://discord.gg/DZ6vcQnxxu');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit StenoAI',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Parakeet warm-up ────────────────────────────────────────────────────
// The backend is stateless, so the model is reloaded once per recording
// subprocess. We pre-load it into the OS page cache at launch and again at
// recording-intent moments — the page cache can be evicted hours after
// launch, which is a big part of "first record is sometimes slow." Re-warming
// on window focus / activate / a renderer hint keeps it hot right before the
// user records. Module-scoped so createWindow's focus handler can reach it.
let lastParakeetWarmupAt = 0;
const PARAKEET_REWARM_THROTTLE_MS = 5 * 60 * 1000;
// Stamped when a live transcription subprocess spawns; logged against
// LIVE_READY to measure real model-load latency in the field.
let parakeetLoadStartedAt = 0;

function spawnParakeetWarmup() {
  try {
    const warmupProc = spawn(getBackendPath(), ['warmup-parakeet'], {
      cwd: getBackendCwd(),
      stdio: 'ignore',
      windowsHide: true,
    });
    warmupProc.unref();
    warmupProc.on('error', (err) => {
      sendDebugLog(`[parakeet-warmup] spawn failed (non-fatal): ${err.message}`);
    });
  } catch (e) {
    sendDebugLog(`[parakeet-warmup] startup error (non-fatal): ${e.message}`);
  }
}

function rewarmParakeet(reason) {
  // Cheap in-memory guards first, so a throttled or mid-recording focus event
  // doesn't pay the loadTranscriptionEngine() file read. Don't compete with an
  // active recording — the model is already resident in the recording
  // subprocess, so a re-warm would only duplicate the mmap.
  if (currentRecordingProcess !== null || systemAudioRecordingActive || liveTranscribeProcess) return;
  const now = Date.now();
  if (now - lastParakeetWarmupAt < PARAKEET_REWARM_THROTTLE_MS) return;
  if (loadTranscriptionEngine() !== 'parakeet') return;
  lastParakeetWarmupAt = now;
  sendDebugLog(`[parakeet-warmup] re-warm (${reason})`);
  spawnParakeetWarmup();
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  ipcMain.on('warmup-parakeet-hint', () => rewarmParakeet('renderer-hint'));
  app.on('second-instance', (event, argv) => {
    const shortcutUrl = extractShortcutUrlFromArgv(argv);
    if (shortcutUrl) {
      if (app.isReady()) {
        handleShortcutUrl(shortcutUrl).catch(err => {
          sendDebugLog(`Error handling shortcut URL: ${err.message}`);
        });
      } else {
        launchedByShortcut = true;
        pendingShortcutUrls.push(shortcutUrl);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Sends the custom in-app quit dialog to the renderer and waits for a response.
  // Falls back to true (allow quit) if the window is unavailable. A 5s timeout
  // guards against a wedged React tree — on timeout we resolve false to
  // preserve any active recording rather than killing it silently.
  async function showCustomQuitDialog(type, jobCount) {
    if (!mainWindow || mainWindow.isDestroyed()) return true;
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('show-quit-dialog', { type, jobCount });
    return new Promise((resolve) => {
      const handler = (_event, data) => {
        clearTimeout(timer);
        resolve(data && data.confirmed === true);
      };
      const timer = setTimeout(() => {
        ipcMain.removeListener('quit-dialog-response', handler);
        resolve(false);
      }, 5000);
      ipcMain.once('quit-dialog-response', handler);
    });
  }

  app.on('before-quit', async (event) => {
    if (isQuitting) return;

    // Use synchronous flag -- systemAudioRecordingActive is updated via IPC on each state change
    if (currentRecordingProcess || systemAudioRecordingActive) {
      event.preventDefault();
      const confirmed = await showCustomQuitDialog('recording');
      if (confirmed) {
        if (currentRecordingProcess) {
          currentRecordingProcess.kill('SIGTERM');
          currentRecordingProcess = null;
          currentRecordingSessionName = null;
          // Intentionally do NOT clear the sidecar here. SIGTERM is async;
          // if the subprocess doesn't honour it before Electron exits, we
          // need the sidecar to survive so the next launch can detect and
          // reap the orphan. The 'close' event handler clears the sidecar
          // when the process actually exits — that's the right moment.
        }
        if (systemAudioRecordingActive && mainWindow && !mainWindow.isDestroyed()) {
          try {
            await mainWindow.webContents.executeJavaScript('stopSystemAudioRecording("quit")');
          } catch (e) {
            // Best effort -- file is saved even if processing doesn't start
          }
        }
        systemAudioRecordingActive = false;
        updateTrayIcon(false);
        isQuitting = true;
        app.quit();
      }
    } else if (isProcessing || processingQueue.length > 0) {
      event.preventDefault();
      const jobCount = processingQueue.length + (isProcessing ? 1 : 0);
      const confirmed = await showCustomQuitDialog('processing', jobCount);
      if (confirmed) {
        isQuitting = true;
        app.quit();
      }
    } else {
      isQuitting = true;
    }
  });

  app.on('open-url', (event, incomingUrl) => {
    if (process.platform !== 'darwin') {
      return;
    }

    event.preventDefault();
    sendDebugLog(`Received shortcut URL via open-url: ${sanitizeShortcutUrlForLogs(incomingUrl)}`);

    if (!app.isReady()) {
      launchedByShortcut = true;
      pendingShortcutUrls.push(incomingUrl);
      return;
    }

    handleShortcutUrl(incomingUrl).catch(err => {
      sendDebugLog(`Error handling shortcut URL: ${err.message}`);
    });
  });

  app.whenReady().then(async () => {
    // Application menu. macOS uses the global menu bar with mac-only roles
    // (services/hide/unhide). Windows/Linux get a slimmer, platform-correct
    // menu — kept (editing accelerators, Settings, Help) but hidden by default
    // via autoHideMenuBar so it doesn't clash with the app's custom toolbar;
    // Alt reveals it (standard Windows behaviour).
    const settingsItem = {
      label: 'Settings…',
      accelerator: 'CmdOrCtrl+,',
      click: () => {
        showAndFocusWindow();
        if (mainWindow) {
          mainWindow.webContents.send('tray-open-settings');
        }
      }
    };
    const helpSubmenu = {
      role: 'help',
      submenu: [
        { label: 'Learn More', click: () => shell.openExternal('https://github.com/ruzin/stenoai') },
        { label: 'Report a Bug', click: () => shell.openExternal('https://discord.gg/DZ6vcQnxxu') }
      ]
    };
    const appMenu = Menu.buildFromTemplate(
      process.platform === 'darwin'
        ? [
            {
              // Custom appMenu to add Settings… with the conventional ⌘,
              // shortcut (the default `{ role: 'appMenu' }` omits Settings).
              label: app.name,
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                settingsItem,
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
              ]
            },
            { role: 'fileMenu' },
            { role: 'editMenu' },
            { role: 'viewMenu' },
            { role: 'windowMenu' },
            helpSubmenu
          ]
        : [
            { label: '&File', submenu: [settingsItem, { type: 'separator' }, { role: 'quit' }] },
            { role: 'editMenu' },
            { role: 'viewMenu' },
            { role: 'windowMenu' },
            helpSubmenu
          ]
    );
    Menu.setApplicationMenu(appMenu);

    if (process.platform === 'darwin') {
      try {
        const osVer = process.getSystemVersion();
        const tapOk = isCoreAudioTapSupported();
        sendDebugLog(`[sysaudio] macOS ${osVer} — CoreAudio Tap supported=${tapOk}`);
      } catch (e) {
        sendDebugLog(`[sysaudio] startup probe failed: ${e.message}`);
      }
    }

    // Reap any orphan recording subprocess left over from a prior crash
    // before creating the window. We don't want to surface "Recording in
    // progress" UI while the prior orphan still holds the mic / writes to
    // disk. Failures here are non-fatal — the helper logs and returns.
    try {
      await cleanupOrphanRecording();
    } catch (e) {
      sendDebugLog(`[orphan-cleanup] unexpected error during startup cleanup: ${e.message}`);
    }

    // Dev runs otherwise show the default Electron dock icon. Packaged builds
    // already get this icon via electron-builder's `mac.icon` setting.
    if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
      try {
        app.dock.setIcon(path.join(__dirname, 'build', 'icon-dragonfly.icns'));
      } catch (e) {
        console.error('Failed to set dev dock icon:', e.message);
      }
    }

    // Pre-load Parakeet weights in a background subprocess so the first
    // recording's `record --live` / `transcribe-stream` spawn sees the
    // model file already in the OS page cache. Saves ~1 s off the
    // visible "first record after launch" latency. Fire-and-forget —
    // never block window creation on it. Skipped for Whisper users
    // (Parakeet model would be downloading or absent) and gated on
    // model presence by the CLI command itself (no-ops when missing).
    if (loadTranscriptionEngine() === 'parakeet') {
      lastParakeetWarmupAt = Date.now();
      spawnParakeetWarmup();
    }

    createWindow();
    if (!IS_E2E) createTray();
    setupAutoUpdater();
    setupAutoMeetingDetector();

    // Hard lock: reconcile ai_provider with the org session once at startup
    // (belt-and-braces for tray-only starts; the sidebar's org-status call
    // triggers the same coalesced reconcile). Fire-and-forget.
    reconcileAiProviderWithOrgSession().catch(() => {});

    // Auto-pause active recordings when the machine sleeps (lid close etc.)
    // and offer a Resume prompt on wake — see autoPauseForSleep. Processing
    // watchdogs are frozen across the sleep so their deadline can't elapse
    // while the subprocess is suspended — see makeInactivityWatchdog.
    powerMonitor.on('suspend', autoPauseForSleep);
    powerMonitor.on('suspend', freezeInactivityWatchdogsForSleep);
    powerMonitor.on('resume', promptResumeAfterWake);
    powerMonitor.on('resume', thawInactivityWatchdogsAfterWake);
    const protocolRegistered = registerShortcutProtocolClient();
    sendDebugLog(`Protocol handler registration (${SHORTCUT_PROTOCOL}): ${protocolRegistered}`);

    // Load hide-dock-icon preference and apply
    if (process.platform === 'darwin' && app.dock) {
      try {
        const dockResult = await new Promise((resolve, reject) => {
          const proc = spawn(getBackendPath(), ['get-dock-icon'], {
            cwd: getBackendCwd()
          });
          let stdout = '';
          proc.stdout.on('data', (data) => { stdout += data.toString(); });
          proc.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`get-dock-icon exited with code ${code}`));
          });
          proc.on('error', reject);
        });

        const dockConfig = JSON.parse(dockResult.trim());
        if (dockConfig.hide_dock_icon) {
          app.dock.hide();
          console.log('Dock icon hidden (menu bar only mode)');
        }
      } catch (e) {
        console.error('Failed to load dock icon preference:', e.message);
      }
    }

    // Initialize telemetry and track app open
    await initTelemetry();
    trackEvent('app_opened');

    // Load custom storage path for file validation
    try {
      const spResult = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
      const spData = JSON.parse(spResult.trim());
      if (spData.storage_path) {
        _cachedCustomStoragePath = spData.storage_path;
        console.log('Custom storage path loaded:', _cachedCustomStoragePath);
      }
    } catch (e) {
      // Non-fatal - custom path just won't be cached
    }

    // Register global hotkey for toggle recording (Cmd+Shift+R on macOS, Ctrl+Shift+R on Windows/Linux)
    const hotkeyModifier = process.platform === 'darwin' ? 'Command+Shift+R' : 'Ctrl+Shift+R';
    const registered = globalShortcut.register(hotkeyModifier, () => {
      console.log('Global hotkey triggered: toggle recording');
      if (mainWindow) {
        mainWindow.webContents.send('toggle-recording-hotkey');
      }
    });

    if (registered) {
      console.log(`Global hotkey registered: ${hotkeyModifier}`);
    } else {
      console.error(`Failed to register global hotkey: ${hotkeyModifier}`);
    }

    if (pendingShortcutUrls.length > 0) {
      const urlsToProcess = [...pendingShortcutUrls];
      pendingShortcutUrls = [];

      for (const shortcutUrl of urlsToProcess) {
        await handleShortcutUrl(shortcutUrl);
      }
    }
  });

  // Fallback for launch contexts where deep-link may arrive via argv instead of open-url.
  if (process.platform === 'darwin') {
    const argvShortcutUrl = extractShortcutUrlFromArgv(process.argv);
    if (argvShortcutUrl) {
      pendingShortcutUrls.push(argvShortcutUrl);
      launchedByShortcut = true;
    }
  }

  app.on('will-quit', async () => {
    globalShortcut.unregisterAll();
    if (tray) {
      tray.destroy();
      tray = null;
    }
    // Kill Ollama on quit. The process may have been started by Electron or
    // the Python backend — both write the PID to ollama.pid in _internal/.
    // killProcessTree tears down ollama's child runner subprocesses too, so
    // they don't orphan on Windows.
    const pidFile = path.join(getBackendCwd(), '_internal', 'ollama.pid');
    try {
      const pid = parseInt(require('fs').readFileSync(pidFile, 'utf8').trim(), 10);
      if (pid) killProcessTree(pid);
      require('fs').unlinkSync(pidFile);
    } catch (_) {}
    // Also kill if Electron spawned it directly
    if (ollamaPid) {
      killProcessTree(ollamaPid);
      ollamaPid = null;
    }
    await shutdownTelemetry();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    rewarmParakeet('activate');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // Only show if the window has finished its initial load.
      // On first launch, windowReadyToShow is false until React mounts.
      if (windowReadyToShow) {
        mainWindow.show();
        mainWindow.focus();
      }
      launchedByShortcut = false;
    } else {
      launchedByShortcut = false;
      createWindow();
    }
  });
}

// Focus window handler (used by notification click to bring app to foreground)
ipcMain.on('focus-window', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

ipcMain.on('shortcut-renderer-ready', () => {
  rendererShortcutReady = true;
  flushShortcutQueue();
});

// Microphone permission handlers.
// systemPreferences.getMediaAccessStatus / askForMediaAccess are macOS-only.
// On Windows and Linux the OS handles mic permission at the WASAPI/ALSA layer
// and there is no programmatic prompt — report 'granted' so the renderer
// stops gating recording on a permission that doesn't exist.
ipcMain.handle('check-microphone-permission', async () => {
  try {
    if (process.platform !== 'darwin') {
      return { success: true, status: 'granted' };
    }
    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log('Microphone permission status:', status);
    return { success: true, status };
  } catch (error) {
    console.error('Error checking microphone permission:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('request-microphone-permission', async () => {
  try {
    if (process.platform !== 'darwin') {
      return { success: true, granted: true };
    }
    console.log('Requesting microphone permission...');
    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log('Microphone permission granted:', granted);
    return { success: true, granted };
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    return { success: false, error: error.message };
  }
});

// Reports whether system-audio capture is available on this OS. Used by
// Settings to disable the toggle on unsupported macOS / non-mac platforms.
ipcMain.handle('get-system-audio-support', async () => {
  try {
    const supported = isSystemAudioSupported();
    // Windows loopback works but is pending hardware verification, so the UI
    // labels it experimental and ships it opt-in (default off).
    const experimental = process.platform === 'win32';
    let screenPermission = 'unknown';
    let osVersion = '';
    if (process.platform === 'darwin') {
      try { osVersion = process.getSystemVersion(); } catch (_) {}
      try { screenPermission = systemPreferences.getMediaAccessStatus('screen'); } catch (_) {}
    } else {
      try { osVersion = process.getSystemVersion(); } catch (_) {}
    }
    return { success: true, supported, experimental, platform: process.platform, osVersion, screenPermission };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Debug functionality handled by side panel now

// Backend communication - always uses bundled stenoai executable
function runPythonScript(script, args = [], silent = false, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();

    // Log the command being executed (unless silent)
    console.log('Running:', `${backendPath} ${args.join(' ')}`);
    if (!silent) {
      sendDebugLog(`$ stenoai ${args.join(' ')}`);
    }

    const process = spawn(backendPath, args, {
      cwd: getBackendCwd(),
      env: Object.keys(extraEnv).length > 0 ? { ...require('process').env, ...extraEnv } : undefined
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('Python stdout:', output);
      // Stream stdout to debug panel in real-time (unless silent)
      if (!silent) {
        output.split('\n').forEach(line => {
          if (line.trim()) sendDebugLog(line.trim());
        });
      }
    });

    process.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('Python stderr:', output);
      // Stream stderr to debug panel in real-time (unless silent)
      if (!silent) {
        output.split('\n').forEach(line => {
          if (line.trim()) sendDebugLog('STDERR: ' + line.trim());
        });
      }
    });

    process.on('close', (code) => {
      if (!silent) {
        sendDebugLog(`Command completed with exit code: ${code}`);
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      sendDebugLog(`Command error: ${error.message}`);
      reject(error);
    });
  });
}

async function getBackendStatusInternal(silent = true) {
  const result = await runPythonScript('simple_recorder.py', ['status'], silent);
  return { success: true, status: result };
}

async function handleGetStatus() {
  try {
    return await getBackendStatusInternal(true); // Silent mode
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleGetNotifications() {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-notifications']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting notification settings: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// IPC Handlers - Separate start/stop with better error handling
ipcMain.handle('start-recording', async (event, sessionName) => {
  try {
    sendDebugLog(`Starting recording session: ${sessionName || 'Note'}`);
    sendDebugLog('$ python simple_recorder.py start');

    // Start recording (removed clear-state to prevent race conditions)
    const result = await runPythonScript('simple_recorder.py', ['start', sessionName || 'Note']);

    if (result.includes('SUCCESS')) {
      sendDebugLog('Recording started successfully');
      trackEvent('recording_started');
      return { success: true, message: result };
    } else {
      sendDebugLog(`Recording failed: ${result}`);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Start recording error:', error.message);
    sendDebugLog(`Recording error: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'start_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-recording', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['stop']);

    if (result.includes('SUCCESS') || result.includes('Recording saved')) {
      trackEvent('recording_stopped');
      return { success: true, message: result };
    } else {
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('Stop recording error:', error.message);
    trackEvent('error_occurred', { error_type: 'stop_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', handleGetStatus);

ipcMain.handle('process-recording', async (event, audioFile, sessionName) => {
  try {
    const env = getAiEnv();
    const result = await runPythonScript('simple_recorder.py', ['process', audioFile, '--name', sessionName], false, env);
    trackEvent('transcription_completed', { success: true });
    trackEvent('summarization_completed', { success: true });
    return { success: true, result: result };
  } catch (error) {
    trackEvent('error_occurred', { error_type: 'process_recording' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-system', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['test']);
    return { success: true, result: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-audio-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'aac', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  
  return { success: false, error: 'No file selected' };
});

ipcMain.handle('list-meetings', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-meetings'], true); // Silent mode
    return { success: true, meetings: JSON.parse(result) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-state', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['clear-state']);
    return { success: true, message: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reprocess-meeting', async (event, summaryFile, regenerateTitle, sessionName) => {
  try {
    const args = ['reprocess', summaryFile];
    if (regenerateTitle) args.push('--regenerate-title');

    sendDebugLog(`🔄 Reprocessing meeting: ${summaryFile}`);
    sendDebugLog(`$ stenoai ${args.join(' ')}`);

    // Surface this reprocess as in-flight on the queue payload so the
    // renderer can show the existing meeting row with a processing badge
    // even when the user navigates away from MeetingDetail mid-reprocess.
    // Keyed by summaryFile in the activeReprocessJobs map so overlapping
    // reprocess calls (e.g. user reprocesses A then navigates and
    // reprocesses B before A finishes) coexist. Removed in the finally
    // block below so a Python crash or spawn error doesn't leave it
    // stuck.
    activeReprocessJobs.set(summaryFile, { summaryFile, sessionName: sessionName || null });

    const aiEnv = getAiEnv();
    const reprocessEnv = Object.keys(aiEnv).length > 0 ? { ...require('process').env, ...aiEnv } : undefined;

    await new Promise((resolve, reject) => {
      const proc = spawn(getBackendPath(), args, {
        cwd: getBackendCwd(),
        env: reprocessEnv
      });

      let stderrBuf = '';

      // Liveness watchdog — see makeInactivityWatchdog. Summary CHUNK:
      // lines (and HEARTBEAT: lines if a retranscribe is ever added here)
      // keep resetting it, so only a genuinely hung process gets killed.
      const watchdog = makeInactivityWatchdog(proc, TRANSCRIBE_INACTIVITY_MS, 'reprocess');

      proc.on('error', (err) => {
        watchdog.clear();
        reject(new Error(`reprocess spawn error: ${err.message}`));
      });

      proc.stdout.on('data', (data) => {
        watchdog.reset();
        const text = data.toString();
        text.split('\n').forEach(line => {
          if (line.startsWith('CHUNK:')) {
            try {
              const encoded = line.slice(6);
              const chunk = Buffer.from(encoded, 'base64').toString('utf-8');
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('summary-chunk', { chunk, sessionName });
              }
            } catch (e) { console.log('CHUNK decode error:', e.message); }
          } else if (line.startsWith('TITLE:')) {
            const title = line.slice(6);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('summary-title', { title, sessionName });
            }
          } else if (line === 'STREAM_COMPLETE') {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('summary-complete', { success: true, sessionName });
            }
          } else if (line.trim()) {
            sendDebugLog(line.trim());
          }
        });
      });

      proc.stderr.on('data', (data) => {
        watchdog.reset();
        const msg = data.toString().trim();
        if (msg) {
          stderrBuf += msg + '\n';
          sendDebugLog(`STDERR: ${msg}`);
        }
      });

      proc.on('close', (code) => {
        watchdog.clear();
        if (code === 0) {
          console.log(`✅ Completed reprocessing: ${sessionName}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('processing-complete', {
              success: true,
              sessionName,
              summaryFile,
              message: 'Reprocessing completed successfully'
            });
          }
          resolve();
        } else {
          reject(new Error(`reprocess exited with code ${code}: ${stderrBuf.slice(-500)}`));
        }
      });
    });

    sendDebugLog('✅ Meeting reprocessed successfully');
    return { success: true };
  } catch (error) {
    sendDebugLog(`❌ Reprocessing failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    activeReprocessJobs.delete(summaryFile);
  }
});

ipcMain.handle('regen-meeting-title', async (event, summaryFile, sessionName) => {
  try {
    const aiEnv = getAiEnv();
    const regenEnv = Object.keys(aiEnv).length > 0 ? { ...require('process').env, ...aiEnv } : undefined;

    await new Promise((resolve, reject) => {
      const proc = spawn(getBackendPath(), ['regen-title', summaryFile], {
        cwd: getBackendCwd(),
        env: regenEnv,
      });

      let stderrBuf = '';
      const procTimeout = setTimeout(() => { proc.kill(); }, 2 * 60 * 1000);

      proc.on('error', (err) => { clearTimeout(procTimeout); reject(new Error(err.message)); });

      proc.stdout.on('data', (data) => {
        data.toString().split('\n').forEach((line) => {
          if (line.startsWith('TITLE:')) {
            const title = line.slice(6);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('summary-title', { title, sessionName });
            }
          }
        });
      });

      proc.stderr.on('data', (data) => { stderrBuf += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(procTimeout);
        if (code === 0) resolve();
        else reject(new Error(`regen-title exited with code ${code}: ${stderrBuf.slice(-300)}`));
      });
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('query-transcript', async (event, summaryFile, question) => {
  try {
    sendDebugLog(`🤖 Querying transcript: ${question.substring(0, 50)}...`);

    // Run the query command — getAiEnv supplies the right env for whichever
    // provider is active (cloud key for cloud, adapter url+token for org).
    const env = getAiEnv();
    const result = await runPythonScript('simple_recorder.py', ['query', summaryFile, '-q', question], false, env);

    // Parse the JSON response
    try {
      const jsonResponse = JSON.parse(result.trim());
      if (jsonResponse.success) {
        sendDebugLog('✅ Query answered successfully');
        trackEvent('ai_query_used', { success: true });
        return { success: true, answer: jsonResponse.answer };
      } else {
        sendDebugLog(`❌ Query failed: ${jsonResponse.error}`);
        trackEvent('ai_query_used', { success: false });
        return { success: false, error: jsonResponse.error };
      }
    } catch (parseError) {
      // If parsing fails, check if the result contains any JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonResponse = JSON.parse(jsonMatch[0]);
        if (jsonResponse.success) {
          trackEvent('ai_query_used', { success: true });
          return { success: true, answer: jsonResponse.answer };
        } else {
          trackEvent('ai_query_used', { success: false });
          return { success: false, error: jsonResponse.error };
        }
      }
      sendDebugLog(`❌ Failed to parse query response: ${parseError.message}`);
      trackEvent('ai_query_used', { success: false });
      return { success: false, error: 'Failed to parse AI response' };
    }
  } catch (error) {
    sendDebugLog(`❌ Query failed: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'query_transcript' });
    return { success: false, error: error.message };
  }
});

const activeQueryProcs = new Map();

ipcMain.on('query-cancel', (_event, queryId) => {
  const proc = activeQueryProcs.get(queryId);
  if (proc) {
    console.log(`[QUERY] Cancelling queryId=${queryId}`);
    proc.kill();
    activeQueryProcs.delete(queryId);
  }
  // Org-chat streams use AbortController instead of a child process; share
  // the same query-cancel channel so the renderer doesn't have to know which
  // backend a given streamId belongs to.
  const ctrl = orgStreamAborters.get(queryId);
  if (ctrl) {
    console.log(`[ORG] Cancelling streamId=${queryId}`);
    try { ctrl.abort(); } catch (_) {}
    orgStreamAborters.delete(queryId);
  }
});

ipcMain.on('query-transcript-stream', (event, queryId, summaryFile, question) => {
  console.log(`[QUERY] IPC received: question="${question.substring(0, 50)}" file="${summaryFile}"`);
  sendDebugLog(`🤖 Streaming query: ${question.substring(0, 50)}...`);
  const env = { ...process.env, ...getAiEnv() };

  let proc;
  try {
    const backendPath = getBackendPath();
    proc = require('child_process').spawn(backendPath, ['query-streaming', summaryFile, '-q', question], {
      env,
      cwd: getBackendCwd(),
      windowsHide: true,
    });
  } catch (err) {
    event.sender.send('query-done', { queryId, success: false, error: err.message });
    return;
  }

  activeQueryProcs.set(queryId, proc);
  // Kill the spawned proc if the renderer sender goes away before the query
  // finishes. Keep a reference so we can remove the listener on normal close
  // (otherwise repeated queries on a long-lived sender leak one-time listeners).
  const onSenderDestroyed = () => {
    if (activeQueryProcs.has(queryId)) {
      proc.kill();
      activeQueryProcs.delete(queryId);
    }
  };
  event.sender.once('destroyed', onSenderDestroyed);
  let buf = '';
  let chunkCount = 0;
  proc.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('CHAT_CHUNK:') || line.startsWith('CHUNK:')) {
        const prefixLen = line.startsWith('CHAT_CHUNK:') ? 11 : 6;
        try {
          const chunk = Buffer.from(line.slice(prefixLen), 'base64').toString('utf-8');
          chunkCount++;
          if (chunkCount === 1) console.log(`[QUERY] First chunk received (queryId=${queryId})`);
          if (!event.sender.isDestroyed()) event.sender.send('query-chunk', { queryId, chunk });
          else {
            console.log(`[QUERY] Sender destroyed, killing process queryId=${queryId}`);
            proc.kill();
            activeQueryProcs.delete(queryId);
          }
        } catch (e) { console.log(`[QUERY] Chunk decode error: ${e.message}`); }
      } else if (line === 'CHAT_STREAM_COMPLETE' || line === 'STREAM_COMPLETE') {
        console.log(`[QUERY] STREAM_COMPLETE received, ${chunkCount} chunks sent`);
        if (!event.sender.isDestroyed()) event.sender.send('query-done', { queryId, success: true });
        else console.log(`[QUERY] Sender destroyed at STREAM_COMPLETE`);
      } else if (line.startsWith('CHAT_STREAM_ERROR:') || line.startsWith('STREAM_ERROR:')) {
        const errMsg = line.startsWith('CHAT_STREAM_ERROR:') ? line.slice(18) : line.slice(13);
        console.log(`[QUERY] STREAM_ERROR: ${errMsg}`);
        if (!event.sender.isDestroyed()) event.sender.send('query-done', { queryId, success: false, error: errMsg });
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[QUERY stderr] ${msg.substring(0, 200)}`);
  });

  proc.on('close', (code) => {
    activeQueryProcs.delete(queryId);
    if (!event.sender.isDestroyed()) {
      event.sender.removeListener('destroyed', onSenderDestroyed);
    }
    console.log(`[QUERY] Process closed, code=${code}, chunks=${chunkCount}, bufRemainder=${buf.length > 0 ? JSON.stringify(buf.substring(0, 100)) : 'empty'}`);
    if (buf.trim() === 'CHAT_STREAM_COMPLETE' || buf.trim() === 'STREAM_COMPLETE') {
      console.log(`[QUERY] STREAM_COMPLETE was in buf remainder — sending done now`);
      if (!event.sender.isDestroyed()) event.sender.send('query-done', { queryId, success: true });
    } else if (code !== 0 && code !== null && !event.sender.isDestroyed()) {
      // code === null means killed (cancelled) — renderer already handles that case
      event.sender.send('query-done', { queryId, success: false, error: `Process exited with code ${code}` });
    }
  });

  proc.on('error', (err) => {
    activeQueryProcs.delete(queryId);
    if (!event.sender.isDestroyed()) event.sender.send('query-done', { queryId, success: false, error: err.message });
  });
});

// Cross-note chat (Chat tab). Same wire protocol as query-transcript-stream
// (CHAT_CHUNK / CHAT_STREAM_COMPLETE / CHAT_STREAM_ERROR -> query-chunk /
// query-done) so the renderer can reuse useStreamingQuery. Cloud-only —
// the Python CLI rejects local providers because we don't have retrieval
// yet and a full-corpus prompt blows local context windows.
ipcMain.on('chat-global-stream', (event, queryId, question, folderId) => {
  sendDebugLog(`💬 Global chat query: ${String(question || '').slice(0, 80)}... (folder: ${folderId || 'all'})`);
  const env = { ...process.env, ...getAiEnv() };

  const args = ['chat-global-streaming', '-q', question];
  if (folderId && typeof folderId === 'string' && folderId !== 'all') {
    args.push('-f', folderId);
  }

  let proc;
  try {
    proc = require('child_process').spawn(
      getBackendPath(),
      args,
      { env, cwd: getBackendCwd(), windowsHide: true },
    );
  } catch (err) {
    event.sender.send('query-done', { queryId, success: false, error: err.message });
    return;
  }

  activeQueryProcs.set(queryId, proc);
  const onSenderDestroyed = () => {
    if (activeQueryProcs.has(queryId)) {
      proc.kill();
      activeQueryProcs.delete(queryId);
    }
  };
  event.sender.once('destroyed', onSenderDestroyed);

  let buf = '';
  let chunkCount = 0;
  proc.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('CHAT_CHUNK:')) {
        try {
          const chunk = Buffer.from(line.slice(11), 'base64').toString('utf-8');
          chunkCount++;
          if (!event.sender.isDestroyed()) {
            event.sender.send('query-chunk', { queryId, chunk });
          } else {
            proc.kill();
            activeQueryProcs.delete(queryId);
          }
        } catch (e) { /* ignore decode errors */ }
      } else if (line === 'CHAT_STREAM_COMPLETE') {
        if (!event.sender.isDestroyed()) {
          event.sender.send('query-done', { queryId, success: true });
        }
      } else if (line.startsWith('CHAT_STREAM_ERROR:')) {
        const errMsg = line.slice(18);
        if (!event.sender.isDestroyed()) {
          event.sender.send('query-done', { queryId, success: false, error: errMsg });
        }
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) sendDebugLog(`[chat-global stderr] ${msg.slice(0, 200)}`);
  });

  proc.on('close', (code) => {
    activeQueryProcs.delete(queryId);
    if (!event.sender.isDestroyed()) {
      event.sender.removeListener('destroyed', onSenderDestroyed);
    }
    if (buf.trim() === 'CHAT_STREAM_COMPLETE') {
      if (!event.sender.isDestroyed()) event.sender.send('query-done', { queryId, success: true });
    } else if (code !== 0 && code !== null && !event.sender.isDestroyed()) {
      event.sender.send('query-done', { queryId, success: false, error: `Process exited with code ${code}` });
    }
  });

  proc.on('error', (err) => {
    activeQueryProcs.delete(queryId);
    if (!event.sender.isDestroyed()) {
      event.sender.send('query-done', { queryId, success: false, error: err.message });
    }
  });
});

// Chat sessions persistence.
//
// The legacy renderer reads/writes `chat_sessions.json` as a flat array.
// The new renderer uses an enriched `{ sessions: [...] }` shape. To avoid
// silently breaking the legacy UI when a user toggles between renderers, we
// store the new shape in a separate file (`chat_sessions_v2.json`) and never
// modify the legacy file. On first load, if v2 is absent we read the legacy
// file once for migration; subsequent saves only touch v2.
//
// Writes use tmp+rename to keep the file atomic across crashes / power loss
// (a truncated chat_sessions file is hard to recover and would lose all
// chat history on next launch).
const CHAT_SESSIONS_V2_FILENAME = 'chat_sessions_v2.json';
const CHAT_SESSIONS_LEGACY_FILENAME = 'chat_sessions.json';

function chatSessionsV2Path() {
  return path.join(app.getPath('userData'), CHAT_SESSIONS_V2_FILENAME);
}

function chatSessionsLegacyPath() {
  return path.join(app.getPath('userData'), CHAT_SESSIONS_LEGACY_FILENAME);
}

ipcMain.handle('save-chat-sessions', async (event, data) => {
  const filePath = chatSessionsV2Path();
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return { success: true };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-chat-sessions', async () => {
  const v2Path = chatSessionsV2Path();
  // Prefer v2 file when present
  if (fs.existsSync(v2Path)) {
    try {
      const raw = fs.readFileSync(v2Path, 'utf-8');
      return { success: true, data: JSON.parse(raw) };
    } catch (err) {
      // Corrupt v2 file — quarantine it so we don't keep failing on every load,
      // then fall through to legacy migration / empty state.
      const corruptPath = `${v2Path}.corrupt-${Date.now()}`;
      try { fs.renameSync(v2Path, corruptPath); } catch (_) {}
      console.error(`[chat-sessions] v2 file unreadable, quarantined to ${corruptPath}:`, err.message);
    }
  }
  // First run on the new renderer: try to migrate from the legacy file.
  // Legacy file is read but never modified, so legacy renderer remains intact.
  const legacyPath = chatSessionsLegacyPath();
  if (fs.existsSync(legacyPath)) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      return { success: true, data: JSON.parse(raw), migratedFromLegacy: true };
    } catch (err) {
      console.error('[chat-sessions] legacy file unreadable:', err.message);
    }
  }
  return { success: true, data: null };
});

ipcMain.handle('save-meeting-notes', async (event, sessionName, notes) => {
  try {
    const outputDir = path.join(getBackendCwd(), '_internal', 'output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const notesFile = path.join(outputDir, `${safeName}_notes.txt`);
    fs.writeFileSync(notesFile, notes, 'utf-8');
    return { success: true, path: notesFile };
  } catch (error) {
    console.error('Failed to save meeting notes:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-meeting', async (event, summaryFilePath, updates) => {
  try {
    const projectRoot = path.join(__dirname, '..');

    // Define allowed base directories for file operations (includes custom storage)
    const allowedBaseDirs = getAllowedBaseDirs();

    // Convert to absolute path if needed
    const absolutePath = path.isAbsolute(summaryFilePath)
      ? summaryFilePath
      : path.join(projectRoot, summaryFilePath);

    // Security: Validate file path is within allowed directories
    if (!validateSafeFilePath(absolutePath, allowedBaseDirs)) {
      console.error(`Security: Blocked attempt to update file outside allowed directories: ${absolutePath}`);
      return {
        success: false,
        error: 'Invalid file path'
      };
    }

    // Read existing data
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: 'Meeting file not found'
      };
    }

    const isMarkdown = absolutePath.endsWith('.md');
    let data;

    if (isMarkdown) {
      const raw = fs.readFileSync(absolutePath, 'utf8');
      // Escape a string for a YAML double-quoted scalar. Backslash MUST be
      // escaped before the quote, and embedded newlines must become literal
      // \n so they don't end the scalar mid-line.
      const yamlQuote = (s) =>
        '"' + String(s)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '')
        + '"';

      // Strip the outer quotes only — the simple frontmatter we read here is
      // for the response shape (data.session_info.name) and doesn't need to
      // reverse YAML escapes for its sole consumer (the renderer).
      const readTitle = (rawValue) => rawValue.trim().replace(/^"|"$/g, '');

      // Line-based rewrite: only mutate the keys we're updating, leave every
      // other line (including non-string values like arrays/booleans) byte-
      // identical so we don't corrupt structured fields like `folders: [...]`.
      let title = '';
      let updatedAt = new Date().toISOString();
      let body = raw;
      let updatedRaw = raw;

      if (raw.startsWith('---')) {
        const parts = raw.split('---', 3);
        if (parts.length >= 3) {
          const fmText = parts[1];
          body = parts[2];
          const lines = fmText.split('\n');
          let titleSeen = false;
          let updatedAtSeen = false;
          const newLines = lines.map((line) => {
            const colon = line.indexOf(':');
            if (colon === -1) return line;
            const key = line.slice(0, colon).trim();
            if (key === 'title') {
              titleSeen = true;
              const original = line.slice(colon + 1);
              if (updates.name !== undefined) {
                return `title: ${yamlQuote(updates.name)}`;
              }
              title = readTitle(original);
              return line;
            }
            if (key === 'updated_at') {
              updatedAtSeen = true;
              return `updated_at: ${yamlQuote(updatedAt)}`;
            }
            return line;
          });
          if (!titleSeen && updates.name !== undefined) {
            // Insert before the trailing blank line (if any) for readability.
            const insertIdx = newLines[newLines.length - 1] === '' ? newLines.length - 1 : newLines.length;
            newLines.splice(insertIdx, 0, `title: ${yamlQuote(updates.name)}`);
            title = updates.name;
          } else if (updates.name !== undefined) {
            title = updates.name;
          }
          if (!updatedAtSeen) {
            const insertIdx = newLines[newLines.length - 1] === '' ? newLines.length - 1 : newLines.length;
            newLines.splice(insertIdx, 0, `updated_at: ${yamlQuote(updatedAt)}`);
          }
          updatedRaw = `---${newLines.join('\n')}---${body}`;
        }
      }

      fs.writeFileSync(absolutePath, updatedRaw, 'utf8');

      data = {
        session_info: {
          name: updates.name !== undefined ? updates.name : title,
          summary_file: absolutePath,
          updated_at: updatedAt,
        },
      };
    } else {
      data = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

      if (updates.name !== undefined) {
        data.session_info.name = updates.name;
      }
      if (updates.summary !== undefined) {
        data.summary = updates.summary;
      }
      if (updates.participants !== undefined) {
        data.participants = updates.participants;
      }
      if (updates.key_points !== undefined) {
        data.key_points = updates.key_points;
      }
      if (updates.action_items !== undefined) {
        data.action_items = updates.action_items;
      }

      data.session_info.updated_at = new Date().toISOString();
      fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), 'utf8');
    }

    console.log(`Updated meeting: ${absolutePath}`);

    return {
      success: true,
      message: 'Meeting updated successfully'
    };
  } catch (error) {
    console.error('Update meeting error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reveal-meeting-folder', async (event, filePath) => {
  try {
    const projectRoot = path.join(__dirname, '..');
    const allowedBaseDirs = getAllowedBaseDirs();
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
    if (!validateSafeFilePath(absolutePath, allowedBaseDirs)) {
      return { success: false, error: 'Invalid file path: outside allowed directories' };
    }
    shell.showItemInFolder(absolutePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-meeting', async (event, meetingData) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // meetingData is the actual meeting object, not a file path
    const meeting = meetingData;

    // Build correct file paths from the meeting data - convert to absolute paths
    const projectRoot = path.join(__dirname, '..');

    // Define allowed base directories for file operations (includes custom storage)
    const allowedBaseDirs = getAllowedBaseDirs();

    const summaryFile = meeting.session_info?.summary_file;
    const transcriptFile = meeting.session_info?.transcript_file;
    const audioFile = meeting.session_info?.audio_file;
    const sessionName = meeting.session_info?.name;

    // Convert relative paths to absolute paths
    const absolutePaths = [];
    if (summaryFile) {
      absolutePaths.push(path.isAbsolute(summaryFile) ? summaryFile : path.join(projectRoot, summaryFile));
    }
    if (transcriptFile) {
      absolutePaths.push(path.isAbsolute(transcriptFile) ? transcriptFile : path.join(projectRoot, transcriptFile));
    }
    if (audioFile) {
      absolutePaths.push(path.isAbsolute(audioFile) ? audioFile : path.join(projectRoot, audioFile));
    }
    if (summaryFile && sessionName) {
      const outputDir = path.dirname(path.isAbsolute(summaryFile) ? summaryFile : path.join(projectRoot, summaryFile));
      const safeName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
      absolutePaths.push(path.join(outputDir, `${safeName}_notes.txt`));
    }

    console.log('Attempting to delete files:', absolutePaths);

    let deletedCount = 0;
    let validationErrors = 0;

    // Delete all related files with path validation
    for (const file of absolutePaths) {
      try {
        // Security: Validate file path is within allowed directories
        if (!validateSafeFilePath(file, allowedBaseDirs)) {
          console.error(`Security: Blocked attempt to delete file outside allowed directories: ${file}`);
          validationErrors++;
          continue;
        }

        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          deletedCount++;
          console.log(`Deleted: ${file}`);
        } else {
          console.log(`File not found (already deleted?): ${file}`);
        }
      } catch (err) {
        console.warn(`Could not delete ${file}:`, err.message);
      }
    }

    if (validationErrors > 0) {
      return {
        success: false,
        error: `Blocked ${validationErrors} file deletion(s) due to security validation`
      };
    }
    
    return { 
      success: true, 
      message: `Deleted meeting and ${deletedCount} associated files` 
    };
  } catch (error) {
    console.error('Delete meeting error:', error);
    return { success: false, error: error.message };
  }
});

// Queue status handler
ipcMain.handle('get-queue-status', async () => {
  return {
    success: true,
    isProcessing,
    queueSize: processingQueue.length,
    currentJob: currentProcessingJob?.sessionName || null,
    currentReprocesses: Array.from(activeReprocessJobs.values()),
    hasRecording: currentRecordingProcess !== null || systemAudioRecordingActive,
    isPaused: recordingRuntimeState.isPaused,
    elapsedSeconds: (currentRecordingProcess !== null || systemAudioRecordingActive) ? getRecordingElapsedSeconds() : 0,
    sessionName: currentRecordingSessionName
  };
});

// Push a chunk of raw 16 kHz mono float32 audio to the live transcribe
// sidecar's stdin. Renderer downsamples its Web Audio mix and calls this
// every ~256 ms. We expect either a Node Buffer or a TypedArray; both
// stringify safely to bytes via the same write() call. No-op if the
// sidecar isn't running (e.g. spawn failed, or recording ended).
ipcMain.on('live-transcribe-chunk', (event, payload) => {
  const proc = liveTranscribeProcess;
  if (!proc || proc.killed) return;
  if (!payload) return;
  // Teardown race: on stop we end/kill the sidecar, but the renderer may push
  // one more in-flight chunk → an async "write after end" error. Skip the write
  // once stdin is no longer writable so we don't log a spurious error on every
  // recording stop.
  const stdin = proc.stdin;
  if (!stdin || stdin.destroyed || stdin.writableEnded || !stdin.writable) return;
  // Renderer side sends an ArrayBuffer; Electron's IPC layer hands us a
  // Buffer here. If a TypedArray slipped through, normalise.
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  try {
    stdin.write(buf);
  } catch (e) {
    // EPIPE means Python exited (e.g. crashed). Drop silently; the exit
    // handler will null out the process ref.
    sendDebugLog(`live-transcribe-chunk write failed: ${e.message}`);
  }
});

// Optional explicit stop signal (mirrors live-transcribe-chunk on the
// send channel). stop-recording-ui already calls stopLiveTranscribe, so
// this is mostly defensive — e.g. if the renderer wants to tear down the
// sidecar without ending the recording (it doesn't today, but a future
// "pause live transcription" toggle could).
ipcMain.on('live-transcribe-stop', () => {
  stopLiveTranscribe();
});

// Returns the current live transcript buffer for the in-flight recording.
// Used by LiveTranscriptPanel after a late mount (e.g. user navigated away
// and back during recording) to backfill segments before subscribing to
// `live-transcript-chunk` for the tail. Returns an empty array when no
// recording is active.
ipcMain.handle('get-live-transcript-state', async () => {
  return {
    success: true,
    sessionName: liveTranscriptState.sessionName,
    segments: liveTranscriptState.segments.slice(),
    ready: liveTranscriptState.ready,
    error: liveTranscriptState.error,
  };
});

// Synchronously read system_audio_enabled from the user config so
// start-recording-ui can decide whether to spawn the Python `record`
// subprocess (off) or let the renderer drive the dual-stream capture (on).
//
// Always returns false on macOS without CoreAudio Process Tap support
// (< 14.4 or non-darwin), regardless of the user's config setting — the
// Python pipeline is the only working capture path there. Without this
// gate, a user on older macOS with the new default `true` config would
// produce no audio at all (Python skipped by main.js, renderer skipped
// by useSystemAudioCapture's own OS check). Falls through to the config
// default (currently true on a missing/empty config) when the OS does
// support CoreAudio Tap so new installs get system audio out of the box.
// Spawn the Python transcribe-stream sidecar for the system-audio path.
// Wires stdout NDJSON to the same live-transcript-{ready,chunk,error}
// IPC events the in-process `record --live` consumer uses, so the
// renderer doesn't care which path produced the events.
function spawnLiveTranscribe(sessionName) {
  if (liveTranscribeProcess) {
    // Race-safe restart: a quick stop→start can land here while the
    // previous subprocess is still draining its stdin. Skipping the
    // spawn would silently leave the new session with no live
    // transcription. Force-stop the old one and reset state so we
    // always end up with a fresh sidecar.
    sendDebugLog('Live transcribe sidecar still present at new start; forcing restart');
    stopLiveTranscribe();
    liveTranscribeProcess = null;
    liveTranscribeSessionName = null;
    liveTranscribeStdoutBuf = '';
  }
  const aiEnv = getAiEnv();
  const env = Object.keys(aiEnv).length > 0
    ? { ...require('process').env, ...aiEnv }
    : undefined;
  parakeetLoadStartedAt = Date.now();
  liveTranscribeProcess = spawn(getBackendPath(), ['transcribe-stream'], {
    cwd: getBackendCwd(),
    env,
    // Default {pipe, pipe, pipe} — we need stdin to push audio in and
    // stdout to parse the LIVE_* protocol.
  });
  liveTranscribeSessionName = sessionName;
  liveTranscribeStdoutBuf = '';

  liveTranscribeProcess.stdout.on('data', (data) => {
    // Stdout arrives in arbitrary-sized chunks; concatenate then split on
    // newlines so a multi-line frame straddling reads is handled.
    liveTranscribeStdoutBuf += data.toString();
    let nl;
    while ((nl = liveTranscribeStdoutBuf.indexOf('\n')) !== -1) {
      const line = liveTranscribeStdoutBuf.slice(0, nl);
      liveTranscribeStdoutBuf = liveTranscribeStdoutBuf.slice(nl + 1);
      handleLiveTranscribeLine(line);
    }
  });

  liveTranscribeProcess.stderr.on('data', (data) => {
    // Python logger output goes to stderr — bubble through debug log
    // without spamming the renderer.
    sendDebugLog(`[live-transcribe] ${data.toString().trim()}`);
  });

  liveTranscribeProcess.on('exit', (code, signal) => {
    sendDebugLog(`Live transcribe sidecar exited code=${code} signal=${signal}`);
    liveTranscribeProcess = null;
    liveTranscribeSessionName = null;
    liveTranscribeStdoutBuf = '';
    // Clear the load clock if the sidecar died before LIVE_READY, so a later
    // path can't log a duration against this stale stamp.
    parakeetLoadStartedAt = 0;
  });

  liveTranscribeProcess.on('error', (err) => {
    sendDebugLog(`Live transcribe sidecar error: ${err.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-transcript-error', {
        sessionName,
        stage: 'spawn',
        message: err.message,
      });
    }
  });

  // stdin emits 'error' asynchronously when a write completes against a
  // closed pipe (the sync try/catch around stdin.write only catches
  // immediate errors). Without a listener, EPIPE bubbles to uncaught and
  // crashes the main process. Race window: chunks queued in the IPC
  // pipeline land here after the sidecar exited (stop, crash, kill).
  liveTranscribeProcess.stdin.on('error', (err) => {
    if (err && err.code === 'EPIPE') {
      // Expected when Python exited mid-write. The exit handler will
      // null the ref so subsequent chunks short-circuit at the guard.
      return;
    }
    sendDebugLog(`Live transcribe stdin error: ${err.message}`);
  });
}

// Shared LIVE_* line handler used by the transcribe-stream stdout parser.
// Keeps the per-line semantics (buffer mutation + IPC emit) in one place
// so the legacy `record --live` path and this sidecar path stay in lock
// step if we ever extend the protocol.
function handleLiveTranscribeLine(line) {
  const sessionName = liveTranscribeSessionName;
  if (line.startsWith('LIVE_READY:')) {
    if (parakeetLoadStartedAt) {
      sendDebugLog(`[parakeet-load] model ready in ${Date.now() - parakeetLoadStartedAt}ms (transcribe-stream)`);
      parakeetLoadStartedAt = 0;
    }
    liveTranscriptState.ready = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-transcript-ready', { sessionName });
    }
    return;
  }
  if (line.startsWith('LIVE_SEG:')) {
    try {
      const seg = JSON.parse(line.slice('LIVE_SEG:'.length));
      const segment = {
        text: seg.text,
        start: seg.start,
        end: seg.end,
        isFinal: !!seg.is_final,
      };
      if (segment.isFinal) {
        liveTranscriptState.segments.push(segment);
      } else {
        const tail = liveTranscriptState.segments[liveTranscriptState.segments.length - 1];
        if (tail && !tail.isFinal) {
          liveTranscriptState.segments[liveTranscriptState.segments.length - 1] = segment;
        } else {
          liveTranscriptState.segments.push(segment);
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('live-transcript-chunk', { sessionName, segment });
      }
    } catch (e) {
      sendDebugLog(`LIVE_SEG parse error (sidecar): ${e.message}`);
    }
    return;
  }
  if (line.startsWith('LIVE_ERROR:')) {
    try {
      const payload = JSON.parse(line.slice('LIVE_ERROR:'.length));
      liveTranscriptState.error = payload;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('live-transcript-error', {
          sessionName, ...payload,
        });
      }
    } catch (e) {
      sendDebugLog(`LIVE_ERROR parse error (sidecar): ${e.message}`);
    }
  }
}

// Tear down the live transcribe sidecar. Closing stdin is the clean
// shutdown signal — Python's read loop hits EOF, drains the VAD, exits.
// Falls back to SIGTERM after a short wait if it doesn't exit on its own.
function stopLiveTranscribe() {
  const proc = liveTranscribeProcess;
  if (!proc) return;
  try {
    proc.stdin.end();
  } catch (_) { /* already closed */ }
  // Watchdog: if Python hasn't exited in 5 s, force kill.
  setTimeout(() => {
    if (liveTranscribeProcess === proc && !proc.killed) {
      try { proc.kill('SIGTERM'); } catch (_) {}
    }
  }, 5000);
}

function loadSystemAudioEnabled() {
  if (!isSystemAudioSupported()) return false;
  // Default differs by platform: macOS ships system audio ON (CoreAudio tap is
  // verified); Windows ships it OFF (opt-in/experimental — see src/config.py).
  const defaultOn = process.platform === 'darwin';
  try {
    const cfgPath = path.join(getUserDataDir(), 'config.json');
    if (!fs.existsSync(cfgPath)) return defaultOn; // new install
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    // Honour an explicit boolean; an absent key means "haven't been asked
    // yet" → fall back to the platform default.
    return typeof cfg.system_audio_enabled === 'boolean'
      ? cfg.system_audio_enabled
      : defaultOn;
  } catch (_) {
    return defaultOn;
  }
}

// Sync read of the active ASR engine. Mirrors loadSystemAudioEnabled —
// reading the JSON directly so we don't spawn a Python subprocess on
// every recording start just to ask. Default 'parakeet' matches the
// Python migration (fresh installs default to Parakeet); existing users
// will have had transcription_engine written on their first launch by
// Config._migrate_transcription_engine.
function loadTranscriptionEngine() {
  try {
    const cfgPath = path.join(getUserDataDir(), 'config.json');
    if (!fs.existsSync(cfgPath)) return 'parakeet';
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const engine = cfg.transcription_engine;
    return engine === 'whisper' ? 'whisper' : 'parakeet';
  } catch (_) {
    return 'parakeet';
  }
}

// Sync read of the auto-detect-meetings setting; default ON. Mirrors
// loadSystemAudioEnabled — we avoid spawning Python during startup just
// to read a boolean. Wire any new defaults through the Python config so
// the truth lives in one place.
function loadAutoDetectMeetingsEnabled() {
  try {
    const cfgPath = path.join(getUserDataDir(), 'config.json');
    if (!fs.existsSync(cfgPath)) return true;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return cfg.auto_detect_meetings_enabled !== false;
  } catch (_) {
    return true;
  }
}

// Global recording state management
let systemAudioRecordingActive = false;  // Track system audio recording for tray/quit
let currentRecordingProcess = null;
let currentRecordingSessionName = null;  // Surfaced in get-queue-status so renderer knows which meeting is live
let processingQueue = [];

// ── Orphan-recording cleanup ────────────────────────────────────────────
//
// When the user starts a recording, we spawn the Python `record` subprocess
// as a child of Electron. If Electron crashes between start and stop (renderer
// OOM, native module segfault, force-quit), the OS *usually* tears the child
// down via broken stdio pipes — but not always, and not immediately. To
// guarantee the next launch ends any orphan rather than leaving it writing
// audio in the background, we persist the spawned PID + backend path to a
// sidecar file. On startup we read the sidecar and, if the recorded PID is
// still alive AND still looks like our backend, signal it to exit and remove
// the sidecar.
//
// Lives in its own sidecar file rather than `recorder_state.json` so it stays
// purely a renderer/main-side concern — the Python state file format doesn't
// change.
const RECORD_PID_SIDECAR_FILENAME = 'last-record.json';
function recordPidSidecarPath() {
  return path.join(app.getPath('userData'), RECORD_PID_SIDECAR_FILENAME);
}

function writeRecordPidSidecarSync(info) {
  const filePath = recordPidSidecarPath();
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(info), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    sendDebugLog(`[orphan-cleanup] Failed to write PID sidecar: ${e.message}`);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

function clearRecordPidSidecarSync() {
  try {
    const filePath = recordPidSidecarPath();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    sendDebugLog(`[orphan-cleanup] Failed to clear PID sidecar: ${e.message}`);
  }
}

// Returns true only when (a) the PID is alive and (b) it looks like our
// backend binary. The `ps` check guards against PID reuse — a long-since-dead
// orphan whose PID was recycled to an unrelated process must not be killed.
function isOrphanedRecordProcess(pid, expectedBackendPath) {
  try {
    process.kill(pid, 0); // throws ESRCH if no such process
  } catch (_) {
    return false;
  }
  try {
    const { execSync } = require('child_process');
    const cmd = execSync(`ps -p ${pid} -o command=`, { timeout: 1500 }).toString().trim();
    // The first whitespace-separated token in `ps -o command=` is argv[0]
    // — the executable path. Match its basename against ours so dev
    // (`dist/stenoai/stenoai`) and packaged (`<resourcesPath>/stenoai/stenoai`)
    // both resolve, but a stranger that merely *mentions* "stenoai" in its
    // arguments doesn't get killed.
    const binaryName = path.basename(expectedBackendPath);
    if (!binaryName) return false;
    const argv0 = cmd.split(/\s+/)[0] || '';
    return path.basename(argv0) === binaryName;
  } catch (_) {
    // ps unavailable or pid disappeared between the kill(0) and the ps;
    // err on the side of "not orphan" rather than signalling a stranger.
    return false;
  }
}

async function cleanupOrphanRecording() {
  const filePath = recordPidSidecarPath();
  if (!fs.existsSync(filePath)) return;

  let info;
  try {
    info = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    sendDebugLog(`[orphan-cleanup] PID sidecar unreadable, removing: ${e.message}`);
    try { fs.unlinkSync(filePath); } catch (_) {}
    return;
  }

  const pid = info && info.pid;
  const backendPath = info && info.backendPath;
  const sessionName = (info && info.sessionName) || '';
  if (!Number.isInteger(pid) || !backendPath) {
    try { fs.unlinkSync(filePath); } catch (_) {}
    return;
  }

  if (!isOrphanedRecordProcess(pid, backendPath)) {
    sendDebugLog(`[orphan-cleanup] pid=${pid} is not our backend; clearing sidecar`);
    try { fs.unlinkSync(filePath); } catch (_) {}
    return;
  }

  sendDebugLog(`[orphan-cleanup] Orphan record subprocess detected pid=${pid} session="${sessionName}"; sending SIGTERM`);
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}

  // Wait up to 5s for clean exit, then escalate to SIGKILL.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (_) {
      sendDebugLog(`[orphan-cleanup] pid=${pid} exited cleanly`);
      try { fs.unlinkSync(filePath); } catch (_) {}
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  sendDebugLog(`[orphan-cleanup] pid=${pid} still alive after SIGTERM; sending SIGKILL`);
  try { process.kill(pid, 'SIGKILL'); } catch (_) {}
  try { fs.unlinkSync(filePath); } catch (_) {}
}
// ── End orphan-recording cleanup ────────────────────────────────────────
// Live-transcript ring buffer for the in-flight recording. Populated by the
// Python `record --live` subprocess's LIVE_SEG: stdout lines. The renderer
// subscribes to `live-transcript-chunk` for new entries and calls
// `liveTranscript.getState()` after a late mount to backfill. Reset on every
// fresh recording start so a previous session's segments don't leak into
// the next note. ``ready`` flips true once the Python side has loaded the
// Parakeet model; ``error`` carries the last failure reason (model failed
// to load, MLX missing, etc.) for the UI to surface.
let liveTranscriptState = {
  sessionName: null,
  segments: [],
  ready: false,
  error: null,
};

// Sidecar Python `transcribe-stream` subprocess used by the system-audio
// path. The renderer captures + mixes in Web Audio, downsamples to 16 kHz
// mono float32, and pushes chunks here via `live-transcribe-chunk`; we
// pipe them into this process's stdin. Its stdout is parsed the same way
// the in-process `record --live` stdout is — same LIVE_READY / LIVE_SEG /
// LIVE_ERROR protocol, same liveTranscriptState mutations, same IPC
// events emitted to the renderer.
let liveTranscribeProcess = null;
let liveTranscribeSessionName = null;
let liveTranscribeStdoutBuf = '';
let isProcessing = false;
let currentProcessingJob = null;
// Reprocess runs as a side-channel from the main processing queue (different
// Python command, started directly from the reprocess-meeting IPC). Tracked
// here so the renderer can show "this note is being regenerated" on Home
// without confusing it with a queued recording. Map keyed by summaryFile so
// overlapping reprocess calls coexist — earlier a single global raced: B's
// IPC overwrote A's entry, and A's finally would null the state out while
// B was still running, hiding B's badge. Entries are removed in each IPC's
// finally so a Python crash or spawn error doesn't leave them stuck.
const activeReprocessJobs = new Map();
let recordingRuntimeState = {
  startedAtMs: null,
  pausedAtMs: null,
  pausedTotalMs: 0,
  isPaused: false
};
let ollamaProcess = null;  // Track spawned Ollama process for cleanup on quit
let ollamaPid = null;      // Store PID separately since unref() disconnects the process
let ollamaStartedByUs = false;

function resetRecordingRuntimeState() {
  recordingRuntimeState = {
    startedAtMs: null,
    pausedAtMs: null,
    pausedTotalMs: 0,
    isPaused: false
  };
}

function startRecordingRuntimeState() {
  recordingRuntimeState = {
    startedAtMs: Date.now(),
    pausedAtMs: null,
    pausedTotalMs: 0,
    isPaused: false
  };
}

function markRecordingPaused() {
  if (!recordingRuntimeState.startedAtMs || recordingRuntimeState.isPaused) {
    return;
  }
  recordingRuntimeState.isPaused = true;
  recordingRuntimeState.pausedAtMs = Date.now();
}

function markRecordingResumed() {
  if (!recordingRuntimeState.isPaused) {
    return;
  }
  if (recordingRuntimeState.pausedAtMs) {
    recordingRuntimeState.pausedTotalMs += Date.now() - recordingRuntimeState.pausedAtMs;
  }
  recordingRuntimeState.isPaused = false;
  recordingRuntimeState.pausedAtMs = null;
}

function getRecordingElapsedSeconds() {
  if (!recordingRuntimeState.startedAtMs) {
    return 0;
  }

  let pausedMs = recordingRuntimeState.pausedTotalMs;
  if (recordingRuntimeState.isPaused && recordingRuntimeState.pausedAtMs) {
    pausedMs += Date.now() - recordingRuntimeState.pausedAtMs;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - recordingRuntimeState.startedAtMs - pausedMs) / 1000)
  );
}

// Inactivity watchdog for long-running backend subprocesses (transcribe +
// summarise). A fixed kill-timeout punishes slow-but-alive work — a 3-hour
// meeting transcribing on a cold or CPU-only machine can legitimately run
// past 30 minutes — while no timeout at all wedges the processing queue
// forever behind a hung process. Instead we kill only after a window with
// zero stdout/stderr activity. The Python pipeline emits HEARTBEAT: lines
// per transcription chunk precisely so this timer keeps resetting while
// real work is happening. 8 minutes covers a cold model load plus a stalled
// chunk with margin, and still reaps a truly hung process ~4x faster than
// the old fixed 30-minute timer.
const TRANSCRIBE_INACTIVITY_MS = 8 * 60 * 1000;

// Live watchdogs, frozen across system sleep. Node's timer clock advances
// during sleep on Apple Silicon and Windows, so a lid-close while processing
// would otherwise fire the inactivity deadline the moment the machine wakes —
// killing a suspended-but-healthy subprocess before it gets a chance to emit
// its next heartbeat. Freezing on 'suspend' (before sleep, so there's no race
// with an already-expired timer on wake) and re-arming on 'resume' gives the
// resumed process a full fresh window.
const activeInactivityWatchdogs = new Set();
// True between powerMonitor 'suspend' and 'resume'. A watchdog created in
// the suspend→sleep gap (the queue can start its next job there) must not
// arm — its deadline would include the slept wall-clock and fire on wake.
let systemSuspendedForWatchdogs = false;

function makeInactivityWatchdog(proc, ms, label) {
  let timer = null;
  const arm = () => {
    timer = setTimeout(() => {
      timer = null;
      activeInactivityWatchdogs.delete(watchdog);
      console.error(`${label} produced no output for ${Math.round(ms / 60000)} minutes, killing`);
      sendDebugLog(`${label} inactive for ${Math.round(ms / 60000)} minutes — killing process`);
      try { proc.kill(); } catch (e) { /* process already gone */ }
    }, ms);
  };
  const watchdog = {
    // Any stdout/stderr activity proves liveness — push the deadline out.
    reset() {
      if (timer === null) return; // fired, cleared, or frozen — don't re-arm
      clearTimeout(timer);
      arm();
    },
    // System sleep: stop the clock entirely (keeps membership in the set).
    freeze() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    // System wake: restart with a full window. Unconditional re-arm for set
    // members (an already-armed timer just gets a fresh, generous window);
    // a cleared/fired watchdog left the set and stays dead.
    thaw() {
      if (!activeInactivityWatchdogs.has(watchdog)) return;
      if (timer !== null) clearTimeout(timer);
      arm();
    },
    clear() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      activeInactivityWatchdogs.delete(watchdog);
    }
  };
  if (!systemSuspendedForWatchdogs) arm(); // else thaw() arms on wake
  activeInactivityWatchdogs.add(watchdog);
  return watchdog;
}

function freezeInactivityWatchdogsForSleep() {
  systemSuspendedForWatchdogs = true;
  if (activeInactivityWatchdogs.size === 0) return;
  sendDebugLog(`[power] system suspending — freezing ${activeInactivityWatchdogs.size} inactivity watchdog(s)`);
  for (const wd of activeInactivityWatchdogs) wd.freeze();
}

function thawInactivityWatchdogsAfterWake() {
  systemSuspendedForWatchdogs = false;
  if (activeInactivityWatchdogs.size === 0) return;
  sendDebugLog(`[power] system resumed — re-arming ${activeInactivityWatchdogs.size} inactivity watchdog(s)`);
  for (const wd of activeInactivityWatchdogs) wd.thaw();
}

// Processing queue management
async function processNextInQueue() {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  currentProcessingJob = processingQueue.shift();
  
  console.log(`🔄 Processing queued job: ${currentProcessingJob.sessionName}`);
  
  try {
    const queueAiEnv = getAiEnv();
    const queueEnv = Object.keys(queueAiEnv).length > 0 ? { ...require('process').env, ...queueAiEnv } : undefined;
    const processArgs = ['process-streaming', currentProcessingJob.audioFile, '--name', currentProcessingJob.sessionName];
    if (currentProcessingJob.notesFile && fs.existsSync(currentProcessingJob.notesFile)) {
      processArgs.push('--notes', currentProcessingJob.notesFile);
    }

    await new Promise((resolve, reject) => {
      const proc = spawn(getBackendPath(), processArgs, {
        cwd: getBackendCwd(),
        env: queueEnv
      });

      let stderrBuf = '';
      // Captured from `SAVED:<path>` so processing-complete can include
      // meetingData and the renderer can auto-navigate to the new note.
      // Without this the renderer-driven (system audio) flow leaves the
      // user stranded on /meetings/processing after the summary streams in.
      let savedSummaryFile = null;
      // Captured from `TRANSCRIPTION_FAILED:<msg>` — the Python pipeline
      // gracefully marks a transcription crash (e.g. an OOM on a long file),
      // preserves the audio, and still emits SAVED: for a reprocessable
      // meeting. We thread the flag into processing-complete so the renderer
      // surfaces the failure honestly instead of as a normal saved note.
      let transcriptionFailedMsg = null;
      // Last time a HEARTBEAT: line was forwarded to the debug log (the
      // watchdog reset itself is unconditional). 0 → log the first one.
      let lastHeartbeatLogAt = 0;

      // Liveness watchdog: kills the process only after a window of zero
      // output. HEARTBEAT:/CHUNK: lines from the backend keep it alive, so
      // a long transcription on a slow machine is never killed mid-work.
      const watchdog = makeInactivityWatchdog(proc, TRANSCRIBE_INACTIVITY_MS, 'process-streaming');

      proc.on('error', (err) => {
        watchdog.clear();
        reject(new Error(`process-streaming spawn error: ${err.message}`));
      });

      proc.stdout.on('data', (data) => {
        watchdog.reset();
        const text = data.toString();
        // Parse protocol lines
        text.split('\n').forEach(line => {
          if (line.startsWith('CHUNK:')) {
            try {
              const encoded = line.slice(6);
              const chunk = Buffer.from(encoded, 'base64').toString('utf-8');
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('summary-chunk', { chunk, sessionName: currentProcessingJob.sessionName });
              }
            } catch (e) { console.log('CHUNK decode error:', e.message); }
          } else if (line.startsWith('TRANSCRIPTION_COMPLETE:')) {
            sendDebugLog(`Transcription complete (${line.split(':')[1]} chars)`);
            trackEvent('transcription_completed', { success: true });
          } else if (line.startsWith('TITLE:')) {
            const title = line.slice(6);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('summary-title', { title, sessionName: currentProcessingJob.sessionName });
            }
          } else if (line === 'STREAM_COMPLETE') {
            trackEvent('summarization_completed', { success: true });
          } else if (line.startsWith('SAVED:')) {
            savedSummaryFile = line.slice(6).trim();
            sendDebugLog(`Summary saved: ${savedSummaryFile}`);
          } else if (line.startsWith('TRANSCRIPTION_FAILED:')) {
            transcriptionFailedMsg = line.slice('TRANSCRIPTION_FAILED:'.length).trim();
            sendDebugLog(`Transcription failed (audio preserved): ${transcriptionFailedMsg}`);
            trackEvent('transcription_completed', { success: false });
          } else if (line.startsWith('HEARTBEAT:')) {
            // Liveness signal — its real job (resetting the watchdog) already
            // happened at the top of this handler. Throttle debug-log output
            // by TIME, not beat value: the MLX backend reports sample counts
            // and whisper.cpp reports segment counts, so any value-based
            // filter floods on at least one backend. One line per ~30 s keeps
            // a 3-hour meeting to a handful of entries.
            const now = Date.now();
            if (now - lastHeartbeatLogAt >= 30_000) {
              lastHeartbeatLogAt = now;
              sendDebugLog(line.trim());
            }
          } else if (line.trim()) {
            sendDebugLog(line.trim());
          }
        });
      });

      proc.stderr.on('data', (data) => {
        watchdog.reset();
        const msg = data.toString().trim();
        if (msg) {
          stderrBuf += msg + '\n';
          sendDebugLog(`STDERR: ${msg}`);
        }
      });

      proc.on('close', (code) => {
        watchdog.clear();
        if (code === 0) {
          console.log(`✅ Completed streaming processing: ${currentProcessingJob.sessionName}`);
          const sessionNameAtClose = currentProcessingJob.sessionName;
          // Notify frontend that streaming is done and meeting is saved
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('summary-complete', {
              success: true,
              sessionName: sessionNameAtClose
            });
          }
          // Look up the saved meeting so we can include meetingData in the
          // processing-complete event. The renderer's processing-complete
          // handler navigates to /meetings/<file> only when meetingData is
          // present — without this the user gets stuck on the processing
          // page after the summary streams in.
          runPythonScript('simple_recorder.py', ['list-meetings'], true)
            .then(meetingsResult => {
              const allMeetings = JSON.parse(meetingsResult);
              let processedMeeting = null;
              if (savedSummaryFile) {
                processedMeeting = allMeetings.find(
                  m => m.session_info?.summary_file === savedSummaryFile
                );
              }
              if (!processedMeeting) {
                processedMeeting = allMeetings.find(
                  m => m.session_info?.name === sessionNameAtClose
                );
              }
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('processing-complete', {
                  success: true,
                  sessionName: sessionNameAtClose,
                  message: transcriptionFailedMsg
                    ? 'Transcription failed; recording preserved (not deleted)'
                    : 'Processing completed successfully',
                  meetingData: processedMeeting,
                  transcriptionFailed: Boolean(transcriptionFailedMsg),
                  transcriptionError: transcriptionFailedMsg || undefined
                });
              }
            })
            .catch(error => {
              console.error('Error fetching processed meeting:', error);
              // Fall back to firing without meetingData — frontend will
              // refresh the list but skip the auto-navigation.
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('processing-complete', {
                  success: true,
                  sessionName: sessionNameAtClose,
                  message: transcriptionFailedMsg
                    ? 'Transcription failed; recording preserved (not deleted)'
                    : 'Processing completed successfully',
                  transcriptionFailed: Boolean(transcriptionFailedMsg),
                  transcriptionError: transcriptionFailedMsg || undefined
                });
              }
            });
          resolve();
        } else {
          reject(new Error(`process-streaming exited with code ${code}: ${stderrBuf.slice(-500)}`));
        }
      });
    });

  } catch (error) {
    console.error(`❌ Processing failed for ${currentProcessingJob.sessionName}:`, error);
    trackEvent('error_occurred', { error_type: 'processing_queue' });

    // A processing crash (e.g. a metal::malloc OOM that SIGABRTs the
    // subprocess with a non-zero exit before Python can mark the failure)
    // means the transcript was never produced. DO NOT delete the source
    // audio here — it's the only copy and the user's retry material.
    // Preserving it regardless of keep_recordings mirrors the Python
    // failure path, which also keeps the audio.
    if (currentProcessingJob.audioFile && fs.existsSync(currentProcessingJob.audioFile)) {
      sendDebugLog(`Preserved audio after processing failure: ${currentProcessingJob.audioFile}`);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('processing-complete', {
        success: false,
        sessionName: currentProcessingJob.sessionName,
        error: error.message
      });
    }
  } finally {
    isProcessing = false;
    currentProcessingJob = null;
    // Process next job in queue
    setTimeout(processNextInQueue, 1000);
  }
}

function addToProcessingQueue(audioFile, sessionName, notesFile) {
  processingQueue.push({ audioFile, sessionName, notesFile });
  console.log(`📋 Added to processing queue: ${sessionName} (Queue size: ${processingQueue.length})`);
  processNextInQueue();
}

ipcMain.handle('start-recording-ui', async (_, sessionName) => {
  try {
    if (currentRecordingProcess) {
      return { success: false, error: 'Recording already in progress' };
    }
    if (systemAudioRecordingActive) {
      return { success: false, error: 'Recording already in progress' };
    }

    const actualSessionName = sessionName || 'Note';
    // Whisper recordings use the post-stop pipeline (no live drawer, no
    // sidecar). Parakeet recordings spawn the VAD-gated live consumer
    // so the renderer can show real-time text. Cached read — avoids a
    // Python subprocess on every recording start.
    const engine = loadTranscriptionEngine();
    const liveEnabled = engine === 'parakeet';

    // Renderer-driven dual-stream path: when system audio is enabled the
    // renderer (useSystemAudioCapture) captures mic + system loopback and
    // mixes them in Web Audio. We MUST NOT spawn the Python `record`
    // subprocess here or we'd produce two parallel recordings → two notes.
    // The renderer will write its mixed WebM and queue it through the
    // existing process-system-audio-recording IPC.
    if (loadSystemAudioEnabled()) {
      sendDebugLog(`Starting renderer-driven recording (system audio mode): ${actualSessionName}`);
      currentRecordingSessionName = actualSessionName;
      startRecordingRuntimeState();
      // Flip the active flag immediately so the queue handler reports
      // hasRecording=true on the very next poll. Without this the renderer
      // hook would see status='idle' (queue says no recording) at the
      // moment we want it to fire startCapture, and the dual-stream
      // capture would never start. The renderer's reportSystemAudioState
      // IPC is then idempotent on success and clears the flag on failure.
      systemAudioRecordingActive = true;
      // Reset live transcript buffer for this session before the live
      // sidecar spawns and starts emitting events.
      liveTranscriptState = {
        sessionName: actualSessionName,
        segments: [],
        ready: false,
        error: null,
      };
      // Spawn the Parakeet+Silero transcribe-stream subprocess. Whisper
      // recordings skip this entirely — the renderer's useSystemAudioCapture
      // gates its IPC writes on the same engine, so no chunks are produced
      // when the sidecar isn't running.
      if (liveEnabled) {
        try {
          spawnLiveTranscribe(actualSessionName);
        } catch (e) {
          sendDebugLog(`Failed to spawn live transcribe sidecar: ${e.message}`);
        }
      } else {
        sendDebugLog(`Live transcription off — engine=${engine}`);
      }
      updateTrayIcon(true);
      trackEvent('recording_started', { recording_mode: 'system_audio' });
      return {
        success: true,
        sessionName: actualSessionName,
        message: 'Renderer-driven recording started'
      };
    }

    // Legacy mic-only path: spawn Python `record` subprocess.
    console.log('Starting long recording process...');
    sendDebugLog(`Starting recording process: ${actualSessionName} (engine=${engine})`);
    sendDebugLog('$ stenoai record 7200' + (liveEnabled ? ' --live' : ''));

    // Start background recording with 2-hour limit
    // Pass AI env (cloud key and/or org-adapter url+token) so the
    // recorder subprocess can summarise via whichever provider is active.
    const recordEnv = getAiEnv();

    // --live engages the Parakeet streaming consumer thread inside the
    // record subprocess. Whisper recordings record without --live so the
    // subprocess captures audio only — the post-stop pipeline transcribes
    // the WAV via WhisperTranscriber.
    const recordArgs = ['record', '7200', actualSessionName];
    if (liveEnabled) recordArgs.push('--live');
    // Only the --live (Parakeet) path emits LIVE_READY; stamp the load clock
    // so we can log model-load latency against it below.
    if (liveEnabled) parakeetLoadStartedAt = Date.now();
    currentRecordingProcess = spawn(getBackendPath(), recordArgs, {
      cwd: getBackendCwd(),
      env: Object.keys(recordEnv).length > 0 ? { ...require('process').env, ...recordEnv } : undefined
    });
    currentRecordingSessionName = actualSessionName;
    // Persist {pid, sessionName, backendPath} so the next launch can detect
    // an orphan if Electron crashes between here and the close handler.
    writeRecordPidSidecarSync({
      pid: currentRecordingProcess.pid,
      sessionName: actualSessionName,
      startedAt: Date.now(),
      backendPath: getBackendPath(),
    });
    // Reset the live transcript buffer for this session. We do it here
    // (before spawn parses anything) so a late-mounting LiveTranscriptPanel
    // can never see a stale segments array from a previous recording.
    liveTranscriptState = {
      sessionName: actualSessionName,
      segments: [],
      ready: false,
      error: null,
    };
    startRecordingRuntimeState();

    let hasStarted = false;
    let processingSucceeded = false;
    let recordedAudioFile = null;
    // Authoritative pointer to the final summary file once Python finishes
    // auto-renaming + writing it (emitted as `SAVED:<path>`). Use this in
    // preference to the name/audio fallbacks since it can't drift.
    let savedSummaryFile = null;

    currentRecordingProcess.stdout.on('data', (data) => {
      const output = data.toString();

      // Capture the audio file path when the recording is saved
      const audioMatch = output.match(/Recording saved:\s*(.+\.wav)/);
      if (audioMatch) {
        recordedAudioFile = audioMatch[1].trim();
      }
      console.log('Recording stdout:', output);

      // Parse streaming protocol + send to debug panel
      output.split('\n').forEach(line => {
        if (line.startsWith('CHUNK:')) {
          const encoded = line.slice(6);
          try {
            const chunk = Buffer.from(encoded, 'base64').toString('utf-8');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('summary-chunk', { chunk, sessionName: actualSessionName });
            }
          } catch (e) { /* ignore decode errors */ }
        } else if (line.startsWith('TITLE:')) {
          const title = line.slice(6);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('summary-title', { title, sessionName: actualSessionName });
          }
        } else if (line === 'STREAM_COMPLETE') {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('summary-complete', { success: true, sessionName: actualSessionName });
          }
        } else if (line.startsWith('LIVE_READY:')) {
          // Model finished loading — UI uses this to swap "Loading…" for
          // the empty consent-only state.
          if (parakeetLoadStartedAt) {
            sendDebugLog(`[parakeet-load] model ready in ${Date.now() - parakeetLoadStartedAt}ms (record --live)`);
            parakeetLoadStartedAt = 0;
          }
          liveTranscriptState.ready = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('live-transcript-ready', {
              sessionName: actualSessionName,
            });
          }
        } else if (line.startsWith('LIVE_SEG:')) {
          try {
            const seg = JSON.parse(line.slice('LIVE_SEG:'.length));
            // Map snake_case wire shape to camelCase for the renderer.
            const segment = {
              text: seg.text,
              start: seg.start,
              end: seg.end,
              isFinal: !!seg.is_final,
            };
            // Final segments append. Partials overwrite the trailing entry
            // when it was also a partial; otherwise they're appended as
            // the new tail.
            if (segment.isFinal) {
              liveTranscriptState.segments.push(segment);
            } else {
              const tail = liveTranscriptState.segments[liveTranscriptState.segments.length - 1];
              if (tail && !tail.isFinal) {
                liveTranscriptState.segments[liveTranscriptState.segments.length - 1] = segment;
              } else {
                liveTranscriptState.segments.push(segment);
              }
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('live-transcript-chunk', {
                sessionName: actualSessionName,
                segment,
              });
            }
          } catch (e) {
            sendDebugLog(`LIVE_SEG parse error: ${e.message}`);
          }
        } else if (line.startsWith('LIVE_ERROR:')) {
          try {
            const payload = JSON.parse(line.slice('LIVE_ERROR:'.length));
            liveTranscriptState.error = payload;
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('live-transcript-error', {
                sessionName: actualSessionName,
                ...payload,
              });
            }
          } catch (e) {
            sendDebugLog(`LIVE_ERROR parse error: ${e.message}`);
          }
        } else if (line.startsWith('SAVED:')) {
          savedSummaryFile = line.slice(6).trim();
        } else if (line.trim()) {
          sendDebugLog(line.trim());
        }
      });

      // Background recording process handles complete pipeline - just notify when done
      if (output.includes('✅ Complete processing finished!')) {
        processingSucceeded = true;
        console.log(`🎉 Recording and processing completed for: ${actualSessionName}`);
        // Notify frontend that everything is done
        if (mainWindow) {
          // Get the processed meeting data to send to frontend
          runPythonScript('simple_recorder.py', ['list-meetings'], true)
            .then(meetingsResult => {
              const allMeetings = JSON.parse(meetingsResult);
              // Prefer the SAVED:<path> pointer Python emits — that's the
              // exact summary file written this session and survives the
              // auto-rename. Fall back to name match (only if user kept the
              // placeholder), then to audio-file basename.
              let processedMeeting = null;
              if (savedSummaryFile) {
                processedMeeting = allMeetings.find(
                  m => m.session_info?.summary_file === savedSummaryFile,
                );
              }
              if (!processedMeeting) {
                processedMeeting = allMeetings.find(m => m.session_info?.name === actualSessionName);
              }
              if (!processedMeeting && recordedAudioFile) {
                const audioBasename = path.basename(recordedAudioFile);
                processedMeeting = allMeetings.find(m =>
                  m.session_info?.audio_file && path.basename(m.session_info.audio_file) === audioBasename
                );
              }

              mainWindow.webContents.send('processing-complete', {
                success: true,
                sessionName: actualSessionName,
                message: 'Recording and processing completed successfully',
                meetingData: processedMeeting
              });
            })
            .catch(error => {
              console.error('Error getting processed meeting data:', error);
              // Fallback - send without meetingData, frontend will refresh
              mainWindow.webContents.send('processing-complete', {
                success: true,
                sessionName: actualSessionName,
                message: 'Recording and processing completed successfully'
              });
            });
        }
      }

      // Detect explicit processing failure from backend
      if (output.includes('❌ Processing pipeline failed')) {
        processingSucceeded = true; // Prevent duplicate notification from close handler
        console.error(`Processing failed for: ${actualSessionName}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('processing-complete', {
            success: false,
            sessionName: actualSessionName,
            message: 'Processing failed: summarization error (check that Ollama and a model are available)'
          });
        }
      }

      // Don't queue background recordings for additional processing - they handle it themselves!

      if (output.includes('Recording to:') && !hasStarted) {
        hasStarted = true;
      }
    });

    currentRecordingProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('Recording stderr:', output);

      // Send real-time stderr to debug panel (same as runPythonScript)
      output.split('\n').forEach(line => {
        if (line.trim()) sendDebugLog('STDERR: ' + line.trim());
      });
    });

    currentRecordingProcess.on('close', (code) => {
      console.log(`Recording process closed with code ${code}`);
      sendDebugLog(`Recording process completed with exit code: ${code}`);
      // Normal exit — drop the orphan-detection sidecar so the next launch
      // doesn't try to kill a long-dead PID (or worse, a recycled one).
      clearRecordPidSidecarSync();
      currentRecordingProcess = null;
      currentRecordingSessionName = null;
      resetRecordingRuntimeState();
      updateTrayIcon(false);

      // If process exited without a success or failure message, notify the user
      if (!processingSucceeded && hasStarted && mainWindow && !mainWindow.isDestroyed()) {
        console.error(`Recording process exited (code ${code}) without completing processing`);
        mainWindow.webContents.send('processing-complete', {
          success: false,
          sessionName: actualSessionName,
          message: `Processing failed unexpectedly (exit code ${code})`
        });
      }
    });

    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (currentRecordingProcess) {
      trackEvent('recording_started');
      updateTrayIcon(true);
      return { success: true, message: 'Recording started successfully' };
    } else {
      return { success: false, error: 'Failed to start recording process' };
    }
  } catch (error) {
    console.error('Start recording UI error:', error.message);
    currentRecordingProcess = null;
    currentRecordingSessionName = null;
    resetRecordingRuntimeState();
    updateTrayIcon(false);
    trackEvent('error_occurred', { error_type: 'start_recording_ui' });
    return { success: false, error: error.message };
  }
});

// ── Auto-pause on system sleep ──
// Closing the laptop lid (or any suspend) used to leave an active recording
// "running" with a broken audio stream. We pause on suspend and deliberately
// do NOT auto-resume on wake — waking the machine doesn't mean the meeting
// is still going. Instead a notification offers Resume, reusing the same
// auto-resume-requested renderer affordance as meeting-end auto-pause.
//
// Mode × platform matrix:
// - backend (mic-only) mode, macOS/Linux: SIGUSR1 to the record subprocess
//   (same as pause-recording-ui) + markRecordingPaused.
// - backend mode, Windows: SIGUSR1 is unsupported (mirrors the
//   pause-recording-ui gate) — log and skip; acceptable for alpha.
// - system-audio mode, both OSes: markRecordingPaused + auto-pause-requested
//   to the renderer, which pauses its MediaRecorder (possibly only after
//   wake — the renderer is suspended too — but nothing records during sleep
//   either way).
let pausedBySleep = false;
// Live "Recording paused / Resume" notification, so a manual resume/stop can
// dismiss it — a stale banner clicked later would fire auto-resume-requested
// at a recording in a different state.
let sleepPausedNotif = null;

function closeSleepPausedNotification() {
  if (sleepPausedNotif) {
    try { sleepPausedNotif.close(); } catch (_) {}
    sleepPausedNotif = null;
  }
}

function autoPauseForSleep() {
  try {
    if (recordingRuntimeState.isPaused) return;
    const hasBackendRecording = currentRecordingProcess !== null;
    if (!hasBackendRecording && !systemAudioRecordingActive) return;

    if (hasBackendRecording) {
      if (process.platform === 'win32') {
        sendDebugLog('[power] suspend during recording — pause unsupported on Windows backend mode, skipping');
        return;
      }
      sendDebugLog('[power] system suspend — pausing recording (SIGUSR1)');
      currentRecordingProcess.kill('SIGUSR1');
      markRecordingPaused();
    } else {
      sendDebugLog('[power] system suspend — pausing system-audio recording');
      markRecordingPaused();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-pause-requested');
      }
    }
    pausedBySleep = true;
  } catch (e) {
    sendDebugLog(`[power] auto-pause on suspend failed: ${e.message}`);
  }
}

function promptResumeAfterWake() {
  if (!pausedBySleep) return;
  pausedBySleep = false;
  if (!recordingRuntimeState.isPaused) return;
  sendDebugLog('[power] system resumed — recording stays paused, offering Resume');
  showSleepPausedNotification();
}

function showSleepPausedNotification() {
  closeSleepPausedNotification();
  // Deliberately NOT gated on notificationsEnabled(): unlike the
  // convenience notifications (meeting detected, note ready), this one is
  // state-critical — the user believes they're capturing and they are not.
  const notif = new Notification({
    title: 'Recording paused',
    body: 'Paused while your computer was asleep. Resume to keep capturing.',
    // `actions` renders on macOS only; the click handler below covers
    // Windows, where the whole notification is the affordance.
    actions: [{ type: 'button', text: 'Resume' }],
  });
  const resume = () => {
    sleepPausedNotif = null;
    sendDebugLog('[power] user chose to resume after wake');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-resume-requested');
    }
  };
  notif.on('action', (_evt, _index) => resume());
  notif.on('click', resume);
  notif.show();
  sleepPausedNotif = notif;
}

ipcMain.handle('pause-recording-ui', async () => {
  try {
    // Mic-only mode: signal the Python `record` subprocess directly.
    if (currentRecordingProcess) {
      if (process.platform === 'win32') {
        return { success: false, error: 'Pause not supported on Windows' };
      }
      sendDebugLog('Sending SIGUSR1 to pause recording...');
      currentRecordingProcess.kill('SIGUSR1');
      markRecordingPaused();
      return { success: true, message: 'Recording paused' };
    }
    // System-audio mode: capture is renderer-driven (MediaRecorder via
    // useSystemAudioCapture). Just flip the runtime-state flag — the queue
    // endpoint reports isPaused=true, status becomes 'paused', and the
    // renderer effect pauses the MediaRecorder.
    if (systemAudioRecordingActive) {
      sendDebugLog('Pause (system-audio mode): marking paused, renderer will pause MediaRecorder');
      markRecordingPaused();
      return { success: true, message: 'Recording paused' };
    }
    sendDebugLog('Pause failed: No recording in progress');
    return { success: false, error: 'No recording in progress' };
  } catch (error) {
    console.error('Pause recording UI error:', error.message);
    sendDebugLog(`Pause error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('resume-recording-ui', async () => {
  try {
    // Any resume (manual or notification-driven) ends the sleep-pause state.
    pausedBySleep = false;
    closeSleepPausedNotification();
    if (currentRecordingProcess) {
      if (process.platform === 'win32') {
        return { success: false, error: 'Resume not supported on Windows' };
      }
      sendDebugLog('Sending SIGUSR2 to resume recording...');
      currentRecordingProcess.kill('SIGUSR2');
      markRecordingResumed();
      return { success: true, message: 'Recording resumed' };
    }
    if (systemAudioRecordingActive) {
      sendDebugLog('Resume (system-audio mode): marking resumed, renderer will resume MediaRecorder');
      markRecordingResumed();
      return { success: true, message: 'Recording resumed' };
    }
    sendDebugLog('Resume failed: No recording in progress');
    return { success: false, error: 'No recording in progress' };
  } catch (error) {
    console.error('Resume recording UI error:', error.message);
    sendDebugLog(`Resume error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-recording-ui', async () => {
  try {
    // Stopping ends any sleep-pause state — don't prompt Resume on a
    // recording that no longer exists.
    pausedBySleep = false;
    closeSleepPausedNotification();
    // Always clear system-audio active state. The renderer's stopCapture flow
    // also reports false, but races (renderer already torn down, recorder
    // errored before reportSystemAudioState) can leave this stuck true and
    // the UI thinks a recording is still in progress.
    systemAudioRecordingActive = false;
    // Shut down the live transcribe sidecar if it's running (system-audio
    // path). Closing stdin lets Python drain any final utterance before
    // exiting; a watchdog SIGTERM in stopLiveTranscribe covers stuck cases.
    stopLiveTranscribe();

    if (!currentRecordingProcess) {
      // Idempotent: clicking stop with no active recording is not an error
      // (it's a stale-state race). Reset everything and report success so
      // the renderer can finish its own cleanup.
      currentRecordingSessionName = null;
      resetRecordingRuntimeState();
      updateTrayIcon(false);
      return { success: true, message: 'No active recording to stop' };
    }

    console.log('Stopping recording process...');

    // Send SIGTERM to trigger graceful stop and processing
    currentRecordingProcess.kill('SIGTERM');

    // Don't wait - let the process complete independently
    // The process will handle: stop recording → transcribe → summarize → exit
    currentRecordingProcess = null;
    currentRecordingSessionName = null;
    resetRecordingRuntimeState();
    updateTrayIcon(false);

    trackEvent('recording_stopped');
    return {
      success: true,
      message: 'Recording stopped - processing will complete in background'
    };
  } catch (error) {
    console.error('Stop recording UI error:', error.message);
    currentRecordingProcess = null;
    currentRecordingSessionName = null;
    resetRecordingRuntimeState();
    updateTrayIcon(false);
    trackEvent('error_occurred', { error_type: 'stop_recording_ui' });
    return { success: false, error: error.message };
  }
});

// Setup IPC handlers

ipcMain.handle('startup-setup-check', async () => {
  try {
    console.log('Running startup setup check...');
    
    // Use Python backend to check setup
    const result = await runPythonScript('simple_recorder.py', ['setup-check']);
    console.log('Setup check result:', result);
    
    // Parse the output to determine if setup is complete
    const allGood = result.includes('🎉 System check passed!');
    
    // Extract check results for UI display
    const lines = result.split('\n');
    const checks = [];
    
    lines.forEach(line => {
      if (line.includes('✅') || line.includes('❌') || line.includes('⚠️')) {
        const parts = line.split(/\s{2,}/); // Split on multiple spaces
        if (parts.length >= 2) {
          checks.push([parts[0].trim(), parts[1].trim()]);
        }
      }
    });
    
    console.log('Parsed checks:', checks);
    console.log('All good:', allGood);
    
    return { 
      success: true, 
      allGood,
      checks
    };
  } catch (error) {
    console.error('Setup check error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-system-check', async () => {
  try {
    // Check Python installation
    const pythonResult = await new Promise((resolve) => {
      exec('python3 --version', (error, stdout, stderr) => {
        if (error) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
    
    if (!pythonResult) {
      return { success: false, error: 'Python 3 not found. Please install Python 3.8+' };
    }
    
    // Create required directories. Mirror src/config.get_user_data_dir() so the
    // Electron and Python sides agree on the storage root on every OS.
    //   macOS:   ~/Library/Application Support/stenoai
    //   Windows: %APPDATA%/stenoai
    //   Linux:   ~/.config/stenoai (electron's appData)
    let baseDir;
    if (app.isPackaged) {
      baseDir = path.join(app.getPath('appData'), 'stenoai');
    } else {
      // Development: Use project relative paths
      baseDir = path.join(__dirname, '..');
    }
    
    const dirs = ['recordings', 'transcripts', 'output'];
    
    for (const dir of dirs) {
      const dirPath = path.join(baseDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
    
    // Create venv directory if it doesn't exist  
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, 'venv');
    if (!fs.existsSync(venvPath)) {
      await new Promise((resolve, reject) => {
        const process = spawn('python3', ['-m', 'venv', 'venv'], {
          cwd: projectRoot
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('Failed to create virtual environment'));
          }
        });
        
        process.on('error', reject);
      });
    }
    
    trackEvent('setup_completed', { step: 'system_check' });
    return { success: true, message: 'System setup complete - Python and directories ready' };
  } catch (error) {
    trackEvent('setup_failed', { step: 'system_check' });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-ffmpeg', async () => {
  try {
    sendDebugLog('$ Checking for existing ffmpeg installation...');

    // Check bundled ffmpeg first (shipped with the app), then system paths
    const bundledFfmpeg = app.isPackaged
      ? path.join(process.resourcesPath, 'stenoai', 'ffmpeg')
      : path.join(__dirname, '..', 'dist', 'stenoai', 'ffmpeg');
    const ffmpegPaths = [bundledFfmpeg, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
    sendDebugLog(`$ Checking: ${ffmpegPaths.join(', ')}`);
    let ffmpegPath = null;

    for (const testPath of ffmpegPaths) {
      try {
        const found = await new Promise((resolve) => {
          const proc = spawn(testPath, ['-version'], { timeout: 5000 });
          proc.on('error', () => resolve(false));
          proc.on('close', (code) => resolve(code === 0));
        });

        if (found) {
          ffmpegPath = testPath;
          sendDebugLog(`Found ffmpeg at: ${testPath}`);
          break;
        }
      } catch (error) {
        // Try next path
        continue;
      }
    }

    if (!ffmpegPath) {
      sendDebugLog('ffmpeg not found in any common locations');
    }
    
    // Install ffmpeg if not present
    if (!ffmpegPath) {
      sendDebugLog('ffmpeg not found, checking for Homebrew...');
      sendDebugLog('$ Checking: brew, /opt/homebrew/bin/brew, /usr/local/bin/brew');

      // First check if Homebrew is installed and get its path
      const brewPaths = ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
      let brewPath = null;

      for (const testPath of brewPaths) {
        try {
          const found = await new Promise((resolve) => {
            const proc = spawn(testPath, ['--version'], { timeout: 5000 });
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
          });

          if (found) {
            brewPath = testPath;
            sendDebugLog(`Found Homebrew at: ${testPath}`);
            break;
          }
        } catch (error) {
          // Try next path
          continue;
        }
      }

      if (!brewPath) {
        sendDebugLog('Homebrew not found in any common locations');
      }
      
      // Install Homebrew if missing
      if (!brewPath) {
        sendDebugLog('Homebrew not found, installing...');
        sendDebugLog('$ /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');

        // Note: This uses the official Homebrew installation script
        // Using exec here is intentional as this is the documented installation method
        // The URL is hardcoded and not user-controlled
        await new Promise((resolve, reject) => {
          const process = exec('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
               { timeout: 600000 });

          process.stdout.on('data', (data) => {
            sendDebugLog(data.toString().trim());
          });

          process.stderr.on('data', (data) => {
            sendDebugLog('STDERR: ' + data.toString().trim());
          });

          process.on('close', (code) => {
            if (code === 0) {
              sendDebugLog('Homebrew installation completed successfully');
              resolve();
            } else {
              sendDebugLog(`Homebrew installation failed with exit code: ${code}`);
              reject(new Error('Failed to install Homebrew automatically'));
            }
          });
        });

        // After installing, set brewPath to the default location
        brewPath = '/opt/homebrew/bin/brew';
      } else {
        sendDebugLog('Homebrew found, proceeding with ffmpeg installation...');
      }

      // Now install ffmpeg via Homebrew using spawn for security
      sendDebugLog(`$ ${brewPath} install ffmpeg`);
      await new Promise((resolve, reject) => {
        const process = spawn(brewPath, ['install', 'ffmpeg'], { timeout: 300000 });

        process.stdout.on('data', (data) => {
          sendDebugLog(data.toString().trim());
        });

        process.stderr.on('data', (data) => {
          sendDebugLog('STDERR: ' + data.toString().trim());
        });

        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog('ffmpeg installation completed successfully');
            resolve();
          } else {
            sendDebugLog(`ffmpeg installation failed with exit code: ${code}`);
            reject(new Error('Failed to install ffmpeg via Homebrew'));
          }
        });

        process.on('error', (error) => {
          sendDebugLog(`ffmpeg installation error: ${error.message}`);
          reject(error);
        });
      });
    } else {
      sendDebugLog('ffmpeg already installed, skipping installation');
    }
    
    return { success: true, message: 'ffmpeg ready' };
  } catch (error) {
    sendDebugLog(`ffmpeg setup failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-python', async () => {
  try {
    // Python backend is bundled via PyInstaller - no setup needed
    sendDebugLog('Python backend is bundled, skipping setup');
    return { success: true, message: 'Python backend bundled' };

    // Legacy code below - kept for reference but never runs
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, 'venv');

    sendDebugLog(`Working directory: ${projectRoot}`);
    
    // Create virtual environment if it doesn't exist
    if (!fs.existsSync(venvPath)) {
      sendDebugLog('Python virtual environment not found, creating...');
      sendDebugLog('$ python3 -m venv venv');
      
      await new Promise((resolve, reject) => {
        const process = spawn('python3', ['-m', 'venv', 'venv'], {
          cwd: projectRoot,
          stdio: 'pipe'
        });
        
        process.stdout.on('data', (data) => {
          sendDebugLog(data.toString().trim());
        });
        
        process.stderr.on('data', (data) => {
          sendDebugLog('STDERR: ' + data.toString().trim());
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            sendDebugLog('Virtual environment created successfully');
            resolve();
          } else {
            sendDebugLog(`Virtual environment creation failed with exit code: ${code}`);
            reject(new Error('Failed to create virtual environment'));
          }
        });
        
        process.on('error', (error) => {
          sendDebugLog(`Process error: ${error.message}`);
          reject(error);
        });
      });
    } else {
      sendDebugLog('Python virtual environment already exists');
    }
    
    // Install requirements including Whisper
    sendDebugLog('Installing Python dependencies...');
    sendDebugLog('$ pip install -r requirements.txt openai-whisper');
    
    return new Promise((resolve) => {
      const pythonPath = path.join(venvPath, 'bin', 'python');
      const process = spawn(pythonPath, ['-m', 'pip', 'install', '-r', 'requirements.txt', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog(text);
          output += text;
        }
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog('STDERR: ' + text);
          output += text;
        }
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Python dependencies installation completed successfully');
          trackEvent('setup_completed', { step: 'python_dependencies' });
          resolve({ success: true, message: 'Python dependencies and Whisper installed' });
        } else {
          sendDebugLog(`Python dependencies installation failed with exit code: ${code}`);
          trackEvent('setup_failed', { step: 'python_dependencies' });
          resolve({ success: false, error: `Installation failed: ${output}` });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: `Process error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Auto-updater ──
function setupAutoUpdater() {
  if (IS_E2E) {
    sendDebugLog('Auto-updater: skipped (E2E mode)');
    return;
  }
  // Don't check for updates in dev mode
  if (!app.isPackaged) {
    sendDebugLog('Auto-updater: skipped (dev mode)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendDebugLog('Auto-updater: checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    sendDebugLog(`Auto-updater: update available (v${info.version})`);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { version: info.version });
    }
  });

  autoUpdater.on('update-not-available', () => {
    sendDebugLog('Auto-updater: up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendDebugLog(`Auto-updater: downloading ${Math.round(progress.percent)}%`);
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', { percent: Math.round(progress.percent) });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendDebugLog(`Auto-updater: v${info.version} ready to install`);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', { version: info.version });
    }
  });

  autoUpdater.on('error', (err) => {
    const msg = (err && err.message) || String(err);
    // Until a release carrying this platform's update feed (latest.yml on
    // Windows) is published, the updater 404s on the feed file. That's an
    // expected transitional state, not a real failure — log it quietly so it
    // doesn't read as a scary stack trace for alpha testers.
    if (/latest(-mac)?\.yml/i.test(msg) && /(404|cannot find)/i.test(msg)) {
      sendDebugLog('Auto-updater: no update feed published for this release yet — skipping.');
      return;
    }
    sendDebugLog(`Auto-updater error: ${msg}`);
  });

  // Check on launch (after a short delay to not block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);

  // Re-check every 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

ipcMain.on('install-update', () => {
  // Bypass the mainWindow 'close' handler's preventDefault+hide so that
  // quitAndInstall's window-close step actually quits the app. Without this
  // the app just minimises and Squirrel never gets to apply the update.
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
});

// ── Auto-detect meetings (mic-monitor) ──
// Spawns the bundled mic-monitor helper and reacts to its JSON-line events.
// When any non-Steno app starts capturing the microphone, we surface a native
// macOS notification ("Meeting detected — App") with a Take Notes action.
// The actual recording start is delegated back to the renderer's existing
// startRecording flow via the auto-record-requested event, so we don't have
// to duplicate any of the recording lifecycle code.
const STENO_BUNDLE_ID = 'com.stenoai.recorder';
const AUTO_DETECT_ENV = 'STENOAI_AUTO_DETECT';
const MIC_NOTIFICATION_DEBOUNCE_MS = 60_000;
const MIC_MONITOR_BACKOFF_BASE_MS = 1000;
const MIC_MONITOR_BACKOFF_MAX_MS = 30_000;
const MIC_MONITOR_HEALTHY_RESET_MS = 30_000;

// Browsers route media capture through helper sub-processes (Safari →
// com.apple.WebKit.GPU, Chrome → com.google.Chrome.helper, etc.), so the raw
// app_name reads as "Safari Graphics and Media" / "Google Chrome Helper".
// Translate those back to the user-recognisable parent app name.
const APP_NAME_OVERRIDES = [
  { match: /^com\.apple\.WebKit/, name: 'Safari' },
  { match: /^com\.google\.Chrome/, name: 'Google Chrome' },
  { match: /^org\.chromium\./, name: 'Chromium' },
  { match: /^com\.microsoft\.edgemac/, name: 'Microsoft Edge' },
  { match: /^company\.thebrowser\.Browser/, name: 'Arc' },
  { match: /^com\.brave\.Browser/, name: 'Brave' },
  { match: /^org\.mozilla\./, name: 'Firefox' },
];

// Allowlist of bundle-id patterns we treat as "meeting apps". Anything not
// matching is ignored — without this filter, dictation tools (Wispr Flow,
// Superwhisper, MacWhisper, Apple Dictation, VoiceInk) and music apps that
// open the mic would all trigger "Meeting detected".
// Browsers are included as a class because most web meetings (Meet, Teams
// web, Whereby, Around, etc.) route mic capture through the browser bundle
// id or a helper sub-process (see APP_NAME_OVERRIDES). Tradeoff: in-browser
// dictation extensions also match, but browser meetings are far more common.
const MEETING_APP_ALLOWLIST = [
  // Native videoconf / meeting apps (prefix match catches helper sub-processes)
  /^us\.zoom\.xos/,                    // Zoom
  /^com\.microsoft\.teams/,            // Microsoft Teams (classic + new "teams2")
  /^com\.cisco\.webexmeetingsapp/,     // Cisco Webex
  /^com\.webex\.meetingmanager/,       // Cisco Webex (alt id)
  /^com\.apple\.FaceTime/,             // FaceTime
  /^com\.hnc\.Discord/,                // Discord
  /^com\.tinyspeck\.slackmacgap/,      // Slack (huddles)
  /^com\.logmein\.GoToMeeting/,        // GoToMeeting
  /^com\.bluejeansnet\.BlueJeans/,     // BlueJeans
  /^co\.pop\.desktop/,                 // Pop
  /^com\.google\.meetings/,            // Google Meet (standalone PWA)
  /^com\.apple\.VoiceMemos/,           // Apple Voice Memos
  // Browsers — most web meetings route mic capture through here
  /^com\.apple\.WebKit/,               // Safari (helper)
  /^com\.apple\.Safari/,               // Safari (main)
  /^com\.google\.Chrome/,              // Chrome (+ helpers)
  /^org\.chromium\./,                  // Chromium
  /^com\.microsoft\.edgemac/,          // Edge
  /^company\.thebrowser\.Browser/,     // Arc
  /^com\.brave\.Browser/,              // Brave
  /^org\.mozilla\./,                   // Firefox
];

function isMeetingApp(evt) {
  // macOS 12/13 fallback emits no app_id (device-level signal). We can't
  // filter there, so preserve legacy behaviour and notify regardless.
  if (!evt.app_id) return true;
  return MEETING_APP_ALLOWLIST.some((re) => re.test(evt.app_id));
}

// Wait this long after the meeting app releases the mic before triggering
// auto-pause + "Meeting ended" prompt. Verified empirically that Zoom/Meet/
// Teams use software-mute (keep the OS-level stream open while muted), so
// muting in-meeting does NOT emit a stop event and won't trip this debounce
// — the only remaining false-positive source is a brief device switch.
// 3s feels near-instant after a real meeting end; auto-resume handles any
// rare device-switch case if the mic comes back within the window.
const MEETING_END_DEBOUNCE_MS = 3_000;

let micMonitorProc = null;
let micMonitorRespawnTimer = null;
let micMonitorRespawnDelay = MIC_MONITOR_BACKOFF_BASE_MS;
const lastNotifiedAt = new Map();
// When the user accepts a "Meeting detected" notification we remember the
// originating app so we can pair its subsequent mic-stop with the recording
// and offer a "Summarise" prompt.
let autoStartedSession = null; // { pid, app_id, appName, paused, pauseTimer, endNotif }

function humanizeAppName(evt) {
  for (const o of APP_NAME_OVERRIDES) {
    if (evt.app_id && o.match.test(evt.app_id)) return o.name;
  }
  return evt.app_name || 'an app';
}

function startMicMonitor() {
  if (micMonitorProc) return;
  if (micMonitorRespawnTimer) {
    clearTimeout(micMonitorRespawnTimer);
    micMonitorRespawnTimer = null;
  }
  const binPath = getMicMonitorPath();
  if (!fs.existsSync(binPath)) {
    sendDebugLog(`[auto-detect] mic-monitor missing at ${binPath}; auto-detect disabled`);
    return;
  }
  sendDebugLog(`[auto-detect] spawning ${binPath}`);
  const proc = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  micMonitorProc = proc;

  // Reset backoff once the process has stayed alive for a while.
  const healthyTimer = setTimeout(() => {
    if (micMonitorProc === proc) micMonitorRespawnDelay = MIC_MONITOR_BACKOFF_BASE_MS;
  }, MIC_MONITOR_HEALTHY_RESET_MS);

  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) handleMicEvent(line);
    }
  });
  proc.stderr.on('data', (chunk) => {
    sendDebugLog(`[auto-detect] stderr: ${String(chunk).trim()}`);
  });
  proc.on('exit', (code, signal) => {
    clearTimeout(healthyTimer);
    sendDebugLog(`[auto-detect] mic-monitor exited (code=${code}, signal=${signal})`);
    if (micMonitorProc === proc) {
      micMonitorProc = null;
      micMonitorRespawnTimer = setTimeout(() => {
        micMonitorRespawnTimer = null;
        startMicMonitor();
      }, micMonitorRespawnDelay);
      micMonitorRespawnDelay = Math.min(micMonitorRespawnDelay * 2, MIC_MONITOR_BACKOFF_MAX_MS);
    }
  });
  proc.on('error', (err) => {
    sendDebugLog(`[auto-detect] spawn error: ${err.message}`);
  });
}

function stopMicMonitor() {
  if (micMonitorRespawnTimer) {
    clearTimeout(micMonitorRespawnTimer);
    micMonitorRespawnTimer = null;
  }
  if (micMonitorProc) {
    sendDebugLog('[auto-detect] stopping mic-monitor');
    const proc = micMonitorProc;
    micMonitorProc = null;
    try { proc.kill(); } catch (_) {}
  }
  lastNotifiedAt.clear();
  clearAutoStartedSession();
}

async function handleMicEvent(line) {
  let evt;
  try {
    evt = JSON.parse(line);
  } catch (_) {
    sendDebugLog(`[auto-detect] bad json: ${line.slice(0, 200)}`);
    return;
  }
  if (evt.app_id === STENO_BUNDLE_ID) return; // never react to our own recording

  if (evt.event === 'stop') {
    handleMicStop(evt);
    return;
  }
  if (evt.event !== 'start') return;

  // Meeting briefly went silent then came back — same app resuming. Cancel
  // any pending pause / dismiss the "Meeting ended" prompt / auto-resume the
  // recording so the user doesn't have to do anything.
  if (autoStartedSession && evt.app_id === autoStartedSession.app_id) {
    if (autoStartedSession.pauseTimer) {
      clearTimeout(autoStartedSession.pauseTimer);
      autoStartedSession.pauseTimer = null;
      sendDebugLog(`[auto-detect] meeting resumed before pause fired: ${autoStartedSession.appName}`);
    }
    if (autoStartedSession.paused) {
      autoStartedSession.paused = false;
      if (autoStartedSession.endNotif) {
        try { autoStartedSession.endNotif.close(); } catch (_) {}
        autoStartedSession.endNotif = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-resume-requested');
      }
      sendDebugLog(`[auto-detect] auto-resumed: ${autoStartedSession.appName}`);
    }
    return;
  }

  if (!isMeetingApp(evt)) {
    sendDebugLog(`[auto-detect] ignoring non-meeting app: ${evt.app_name || evt.app_id}`);
    return;
  }

  if (currentRecordingProcess || systemAudioRecordingActive) {
    sendDebugLog(`[auto-detect] ignoring start (${evt.app_name || evt.app_id || 'unknown'}) — already recording`);
    return;
  }

  const debounceKey = evt.app_id || `pid:${evt.pid || 'unknown'}`;
  const lastAt = lastNotifiedAt.get(debounceKey) || 0;
  if (Date.now() - lastAt < MIC_NOTIFICATION_DEBOUNCE_MS) return;
  lastNotifiedAt.set(debounceKey, Date.now());

  const appName = humanizeAppName(evt);
  sendDebugLog(`[auto-detect] meeting detected: ${appName} (${evt.app_id || 'no-bundle-id'})`);
  const calEvent = await getCalendarEventForNow();
  if (calEvent) {
    sendDebugLog(`[auto-detect] matched calendar event: ${calEvent.title}`);
  }
  showMeetingDetectedNotification(appName, evt, calEvent);
}

function handleMicStop(evt) {
  if (!autoStartedSession) return;
  // Recording may have been stopped manually (Stop button, hotkey, shortcut)
  // since we accepted the auto-start. The autoStartedSession isn't notified
  // of that today, so without this guard the mic-stop event would schedule
  // a phantom pause + "Meeting ended" notification for a recording that's
  // already gone. Drop the session here so the next start is clean.
  if (!currentRecordingProcess && !systemAudioRecordingActive) {
    clearAutoStartedSession();
    return;
  }
  const matches = evt.pid === autoStartedSession.pid || evt.app_id === autoStartedSession.app_id;
  if (!matches) return;

  if (autoStartedSession.pauseTimer) clearTimeout(autoStartedSession.pauseTimer);
  autoStartedSession.pauseTimer = setTimeout(() => {
    autoStartedSession.pauseTimer = null;
    autoStartedSession.paused = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-pause-requested');
    }
    sendDebugLog(`[auto-detect] meeting ended (paused): ${autoStartedSession.appName}`);
    autoStartedSession.endNotif = showMeetingEndedNotification(autoStartedSession.appName);
  }, MEETING_END_DEBOUNCE_MS);
}

function showMeetingDetectedNotification(appName, originatingEvt, calEvent) {
  // Notification rendering quirk: setting `closeButtonText` alongside a single
  // `actions` entry causes macOS to collapse everything into an "Options"
  // dropdown instead of showing the action inline. Leaving closeButtonText
  // unset gives us Granola's layout — single inline button to the right.
  const notif = new Notification({
    title: 'Meeting detected',
    body: calEvent?.title || appName,
    actions: [{ type: 'button', text: 'Take Notes' }],
  });
  const trigger = () => requestAutoRecord(appName, originatingEvt, calEvent);
  notif.on('action', (_evt, _index) => trigger()); // shown when banner style = Alerts
  notif.on('click', trigger);                       // body tap (always available)
  notif.show();
}

function showMeetingEndedNotification(appName) {
  const notif = new Notification({
    title: 'Meeting ended',
    body: appName,
    actions: [{ type: 'button', text: 'Summarise' }],
  });
  // Only the explicit Summarise button commits — body click just opens
  // Steno so the user can decide (summarise / resume / leave paused) from
  // the in-app UI. Once summarised the meeting is finalised and AI
  // processing has begun, so a stray body tap shouldn't trigger it.
  notif.on('action', (_evt, _index) => requestAutoSummarise());
  notif.on('click', () => {
    sendDebugLog('[auto-detect] Meeting ended notif body clicked — opening Steno (no commit)');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
  notif.show();
  return notif;
}

function requestAutoRecord(appName, originatingEvt, calEvent) {
  // Prefer the calendar event title when we matched one — it's user-authored
  // and recognisable weeks later. Otherwise fall back to the neutral
  // 'Note' placeholder that simple_recorder.py recognises in
  // _AUTO_NAMED_PATTERN and lets the post-summary LLM-title step rewrite.
  // The previous "<App> — YYYY-MM-DD HH:MM" format leaked the internal
  // app-detection string (e.g. "an app — 2026-06-01 17:00") to the user
  // whenever title regeneration produced nothing.
  const sessionName = calEvent?.title || 'Note';
  sendDebugLog(`[auto-detect] user requested record: ${sessionName}`);

  // Track the originating app so we can pair its mic-stop with this recording
  // and offer a "Summarise" prompt when the meeting ends.
  autoStartedSession = {
    pid: originatingEvt?.pid ?? null,
    app_id: originatingEvt?.app_id ?? null,
    appName,
    paused: false,
    pauseTimer: null,
    endNotif: null,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('auto-record-requested', { sessionName, appName });
  }
}

function requestAutoSummarise() {
  sendDebugLog('[auto-detect] user requested summarise from end notification');
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('auto-summarise-requested');
  }
  clearAutoStartedSession();
}

function clearAutoStartedSession() {
  if (!autoStartedSession) return;
  if (autoStartedSession.pauseTimer) clearTimeout(autoStartedSession.pauseTimer);
  if (autoStartedSession.endNotif) {
    try { autoStartedSession.endNotif.close(); } catch (_) {}
  }
  autoStartedSession = null;
}

function setupAutoMeetingDetector() {
  if (IS_E2E) return;
  // Dev mode still requires the env var so a developer running `npm start`
  // doesn't get notification spam — they have to opt in. Packaged builds
  // honour the persisted user setting.
  if (!app.isPackaged && !process.env[AUTO_DETECT_ENV]) {
    sendDebugLog(`[auto-detect] dev mode without ${AUTO_DETECT_ENV}=1; not starting`);
    return;
  }
  if (!loadAutoDetectMeetingsEnabled()) {
    sendDebugLog('[auto-detect] disabled in settings; not starting');
    return;
  }
  startMicMonitor();
}

app.on('before-quit', () => {
  stopMicMonitor();
});

// Add IPC handler for sending debug logs to frontend
function sendDebugLog(message) {
  // Send to main window (both setup console and debug panel)
  if (mainWindow) {
    mainWindow.webContents.send('debug-log', message);
  }
}

ipcMain.handle('setup-ollama-and-model', async () => {
  try {
    // Check AI provider -- skip local Ollama setup for remote/cloud
    try {
      const providerResult = await runPythonScript('simple_recorder.py', ['get-ai-provider'], true);
      const providerConfig = JSON.parse(providerResult.trim());
      if (providerConfig.ai_provider === 'remote' || providerConfig.ai_provider === 'cloud') {
        sendDebugLog(`AI provider is "${providerConfig.ai_provider}" -- skipping local Ollama setup`);
        return { success: true, skipped: true };
      }
    } catch (e) {
      sendDebugLog(`Could not read AI provider, proceeding with local setup: ${e.message}`);
    }

    // Check macOS version — bundled Ollama requires macOS 14 (Sonoma) or later.
    // os.release() reports the kernel version, which is Darwin on mac but the
    // Windows NT build on Windows; gate the version check to darwin so a non-mac
    // OS doesn't get rejected by the < 23 comparison.
    if (process.platform === 'darwin') {
      const macosRelease = os.release(); // e.g. "23.1.0" for macOS 14.1
      const darwinMajor = parseInt(macosRelease.split('.')[0], 10);
      // Darwin 23 = macOS 14 (Sonoma), Darwin 22 = macOS 13 (Ventura), etc.
      if (darwinMajor < 23) {
        const macosVersion = darwinMajor >= 22 ? '13 (Ventura)' : darwinMajor >= 21 ? '12 (Monterey)' : `(Darwin ${darwinMajor})`;
        sendDebugLog(`macOS ${macosVersion} detected — Ollama requires macOS 14 (Sonoma) or later`);
        return { success: false, error: 'StenoAI requires macOS 14 (Sonoma) or later for local AI summarization. Please update your macOS or use a remote Ollama server in Settings.' };
      }
    }

    sendDebugLog('Locating bundled Ollama...');
    const finalOllamaPath = await findOllamaExecutable();
    if (!finalOllamaPath) {
      sendDebugLog('Error: Bundled Ollama not found');
      return { success: false, error: 'Bundled Ollama not found. Please reinstall StenoAI.' };
    }
    sendDebugLog(`Found bundled Ollama at: ${finalOllamaPath}`);

    // Reuse already-running Ollama if its API is reachable on 11434.
    // Avoids "address already in use" when the user (or a previous launch)
    // already has Ollama up.
    const httpProbe = require('http');
    const ollamaAlreadyRunning = await new Promise((resolve) => {
      const req = httpProbe.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ollamaAlreadyRunning) {
      sendDebugLog('Ollama already running on 127.0.0.1:11434 — reusing existing instance');
    }

    let ollamaExited = false;
    let ollamaExitCode = null;
    let ollamaDyldError = false;
    if (!ollamaAlreadyRunning) {
      sendDebugLog('Starting Ollama service...');
      sendDebugLog(`$ ${finalOllamaPath} serve`);
      ollamaProcess = spawn(finalOllamaPath, ['serve'], { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: getOllamaEnv() });
      ollamaPid = ollamaProcess.pid;
      // Write PID file so quit handler can find the process
      try { require('fs').writeFileSync(path.join(getBackendCwd(), '_internal', 'ollama.pid'), String(ollamaPid)); } catch (_) {}
      ollamaProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) sendDebugLog(`Ollama: ${msg}`);
        if (msg.includes('Symbol not found') || msg.includes('dyld')) ollamaDyldError = true;
      });
      ollamaProcess.on('exit', (code) => {
        ollamaExited = true;
        ollamaExitCode = code;
        ollamaPid = null;
        if (code !== 0 && code !== null) {
          sendDebugLog(`Ollama process exited with code ${code}`);
        }
      });
      ollamaProcess.unref();
      ollamaStartedByUs = true;
    }

    // Wait for Ollama to be ready (poll with early exit detection).
    // When we reused an existing instance, skip the wait — it's already up.
    sendDebugLog('Waiting for Ollama service to be ready...');
    const maxAttempts = ollamaAlreadyRunning ? 1 : 30;
    let ready = ollamaAlreadyRunning;
    for (let i = 0; i < maxAttempts && !ready; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (ollamaExited) {
        sendDebugLog(`Ollama process died during startup (exit code: ${ollamaExitCode})`);
        break;
      }
      try {
        const http = require('http');
        ready = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 }, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (ready) {
          sendDebugLog(`Ollama ready after ${i + 1} seconds`);
          break;
        }
      } catch (e) {
        // Continue polling
      }
    }

    if (!ready) {
      if (ollamaExited) {
        if (ollamaDyldError) {
          return { success: false, error: 'Ollama crashed due to incompatible macOS version. StenoAI requires macOS 14 (Sonoma) or later for local AI. Please update macOS or use a remote Ollama server in Settings.' };
        }
        return { success: false, error: `Ollama failed to start (exit code: ${ollamaExitCode}). Check debug logs for details.` };
      }
      sendDebugLog('Warning: Ollama may not be fully ready, attempting pull anyway...');
    }
    
    sendDebugLog('Downloading AI model (this may take several minutes)...');
    sendDebugLog('POST http://127.0.0.1:11434/api/pull {name: "llama3.2:3b"}');

    const http = require('http');
    return new Promise((resolve) => {
      const postData = JSON.stringify({ name: 'llama3.2:3b' });
      const req = http.request({
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/pull',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 600000
      }, (res) => {
        let lastStatus = '';
        res.on('data', (chunk) => {
          // Ollama streams newline-delimited JSON
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.error) {
                sendDebugLog(`Pull error: ${json.error}`);
                return;
              }
              // Log progress without spamming duplicate status
              const status = json.status || '';
              if (json.total && json.completed) {
                const pct = Math.round((json.completed / json.total) * 100);
                const msg = `${status} ${pct}%`;
                if (msg !== lastStatus) {
                  sendDebugLog(msg);
                  lastStatus = msg;
                }
              } else if (status !== lastStatus) {
                sendDebugLog(status);
                lastStatus = status;
              }
            } catch (e) {
              // Non-JSON line, log as-is
              sendDebugLog(chunk.toString().trim());
            }
          }
        });

        res.on('end', async () => {
          if (res.statusCode === 200) {
            sendDebugLog('AI model download completed successfully');
            try {
              await runPythonScript('simple_recorder.py', ['set-model', 'llama3.2:3b'], true);
            } catch (e) {
              // Non-fatal -- config reset is best-effort
            }
            trackEvent('setup_completed', { step: 'ollama_and_model' });
            resolve({ success: true, message: 'Ollama and AI model ready' });
          } else {
            sendDebugLog(`AI model download failed with status: ${res.statusCode}`);
            trackEvent('setup_failed', { step: 'ollama_and_model' });
            resolve({ success: false, error: 'Failed to download AI model', details: `HTTP ${res.statusCode}` });
          }
        });
      });

      req.on('error', (error) => {
        sendDebugLog(`Pull request error: ${error.message}`);
        resolve({ success: false, error: 'Failed to download AI model', details: error.message });
      });

      req.on('timeout', () => {
        req.destroy();
        sendDebugLog('Model pull timed out after 10 minutes');
        resolve({ success: false, error: 'Model download timed out' });
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-parakeet', async () => {
  try {
    // Download Parakeet TDT v3 (~572 MB) via the bundled backend. Used by
    // the Setup wizard's step 2 for fresh installs. Emits coarse stage
    // lines (PARAKEET_PULL_STAGE:downloading / :loading) rather than
    // byte-level progress — see src/parakeet_models.py for why.
    const backendPath = getBackendPath();
    sendDebugLog('Downloading Parakeet TDT v3 (~572 MB)...');
    sendDebugLog(`$ ${backendPath} download-parakeet-model`);

    return new Promise((resolve) => {
      const proc = spawn(backendPath, ['download-parakeet-model'], { stdio: 'pipe' });
      let lastStdoutLine = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          sendDebugLog(trimmed);
          if (trimmed.startsWith('PARAKEET_PULL_STAGE:')) {
            const stage = trimmed.slice('PARAKEET_PULL_STAGE:'.length);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('parakeet-pull-progress', { stage });
            }
          } else {
            lastStdoutLine = trimmed;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog('STDERR: ' + text);
      });

      proc.on('close', (code) => {
        let parsed = null;
        try { parsed = JSON.parse(lastStdoutLine); } catch (_) { /* not JSON */ }
        const ok = code === 0 && (!parsed || parsed.success !== false);
        if (ok) {
          sendDebugLog('Parakeet model ready');
          resolve({ success: true, message: 'Parakeet model ready' });
        } else {
          const err = (parsed && parsed.error) || `Parakeet download exited with code ${code}`;
          sendDebugLog(err);
          resolve({ success: false, error: err });
        }
      });

      proc.on('error', (error) => {
        sendDebugLog(`Process error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-whisper', async () => {
  try {
    // Download whisper model using the bundled backend
    const backendPath = getBackendPath();
    sendDebugLog('Downloading Whisper transcription model (~500MB)...');
    sendDebugLog(`$ ${backendPath} download-whisper-model`);

    return new Promise((resolve) => {
      const process = spawn(backendPath, ['download-whisper-model'], {
        stdio: 'pipe'
      });

      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog(text);
      });

      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog('STDERR: ' + text);
      });

      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Whisper model downloaded successfully');
          resolve({ success: true, message: 'Whisper model ready' });
        } else {
          sendDebugLog(`Whisper model download failed with exit code: ${code}`);
          resolve({ success: false, error: 'Failed to download Whisper model' });
        }
      });

      process.on('error', (error) => {
        sendDebugLog(`Process error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });
    });

    // Legacy code below - kept for reference but never runs
    const projectRoot = path.join(__dirname, '..');
    const pythonPath = path.join(projectRoot, 'venv', 'bin', 'python');

    sendDebugLog('Installing Whisper speech recognition...');
    sendDebugLog(`$ ${pythonPath} -m pip install openai-whisper`);
    
    return new Promise((resolve) => {
      const process = spawn(pythonPath, ['-m', 'pip', 'install', 'openai-whisper'], {
        cwd: projectRoot,
        stdio: 'pipe'
      });
      
      let output = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog(text);
          output += text;
        }
      });
      
      process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          sendDebugLog('STDERR: ' + text);
          output += text;
        }
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          sendDebugLog('Whisper installation completed successfully');
          resolve({ success: true, message: 'Whisper installed successfully' });
        } else {
          sendDebugLog(`Whisper installation failed with exit code: ${code}`);
          resolve({ success: false, error: `Whisper installation failed: ${output}` });
        }
      });
      
      process.on('error', (error) => {
        resolve({ success: false, error: `Process error: ${error.message}` });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('setup-test', async () => {
  try {
    sendDebugLog('Running system test...');
    sendDebugLog('$ python simple_recorder.py test');
    
    // Test the complete system
    const result = await runPythonScript('simple_recorder.py', ['test']);
    
    // Log the full result to debug console
    result.split('\n').forEach(line => {
      if (line.trim()) sendDebugLog(line.trim());
    });
    
    if (result.includes('System check passed') || result.includes('SUCCESS')) {
      sendDebugLog('System test completed successfully');
      trackEvent('setup_completed', { step: 'system_test' });
      return { success: true, message: 'System test passed' };
    } else {
      // Extract specific error details from the output
      const errorLines = result.split('\n').filter(line => line.includes('ERROR:'));
      const specificError = errorLines.length > 0 ? errorLines[errorLines.length - 1].replace('ERROR: ', '') : 'Unknown error';
      sendDebugLog(`System test failed: ${specificError}`);
      trackEvent('setup_failed', { step: 'system_test' });
      return { success: false, error: `System test failed: ${specificError}`, details: result };
    }
  } catch (error) {
    sendDebugLog(`System test error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Settings window IPC handlers  
ipcMain.handle('trigger-setup-wizard', async () => {
  try {
    console.log('🔧 Starting setup wizard from settings...');
    
    // Trigger the main window's setup flow
    if (mainWindow) {
      mainWindow.webContents.send('trigger-setup-flow');
    }
    
    return { success: true, message: 'Setup wizard triggered in main window' };
  } catch (error) {
    console.error('Setup wizard failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', async () => {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return {
      success: true,
      version: packageContent.version,
      name: packageContent.productName || packageContent.name
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Storage path handlers
ipcMain.handle('get-storage-path', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
    const jsonData = JSON.parse(result.trim());
    // Python only returns the user's custom path (empty string when not set).
    // Augment with the platform default so the renderer can show "where your
    // data actually lives" without hardcoding the path. custom_path mirrors
    // storage_path but is null when empty for cleaner conditionals.
    const customPath = jsonData.storage_path && jsonData.storage_path.trim()
      ? jsonData.storage_path
      : null;
    const defaultPath = path.join(os.homedir(), 'Library', 'Application Support', 'stenoai');
    return {
      success: true,
      storage_path: customPath || defaultPath,
      custom_path: customPath,
      default_path: defaultPath,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-storage-path', async (event, storagePath) => {
  try {
    const args = ['set-storage-path'];
    if (storagePath) {
      args.push(storagePath);
    }
    const result = await runPythonScript('simple_recorder.py', args);
    // Update cached custom path for file validation
    _cachedCustomStoragePath = storagePath || null;
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, storage_path: storagePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-storage-folder', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose storage location for StenoAI data',
      buttonLabel: 'Select Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, folderPath: result.filePaths[0] };
    }
    return { success: false, error: 'No folder selected' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Folder management handlers
ipcMain.handle('list-folders', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-folders'], true);
    return { success: true, ...JSON.parse(result.trim()) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-folder', async (event, name, color) => {
  try {
    const args = ['create-folder', name];
    if (color) args.push('--color', color);
    const result = await runPythonScript('simple_recorder.py', args);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-folder', async (event, folderId, name) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['rename-folder', folderId, name]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-folder-icon', async (event, folderId, icon) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['update-folder-icon', folderId, icon]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-folder', async (event, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['delete-folder', folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('reorder-folders', async (event, folderIds) => {
  try {
    const args = ['reorder-folders', ...folderIds];
    const result = await runPythonScript('simple_recorder.py', args);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-meeting-to-folder', async (event, summaryFile, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['add-meeting-to-folder', summaryFile, folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('remove-meeting-from-folder', async (event, summaryFile, folderId) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['remove-meeting-from-folder', summaryFile, folderId]);
    const jsonMatch = result.match(/\{.*\}/s);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ai-prompts', async () => {
  try {
    // Read the summarization prompt from the Python backend
    const summarizerPath = path.join(__dirname, '..', 'src', 'summarizer.py');
    
    if (fs.existsSync(summarizerPath)) {
      const content = fs.readFileSync(summarizerPath, 'utf8');
      
      // Extract the full prompt from the _create_permissive_prompt method
      const promptMatch = content.match(/def _create_permissive_prompt[\s\S]*?return f"""([\s\S]*?)"""/);
      
      if (promptMatch) {
        return {
          success: true,
          summarization: promptMatch[1].trim()
        };
      }
    }
    
    return {
      success: true,
      summarization: 'Prompt not found in summarizer.py'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function to ensure Ollama service is running
async function ensureOllamaRunning() {
  try {
    // Check if Ollama service is responding
    const http = require('http');
    const response = await new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:11434/api/version', { timeout: 3000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    if (response) {
      return true; // Service is running
    }

    // Service not running, try to start it.
    // The macOS-14 gate only applies to mac (os.release() is the NT build on
    // Windows, which would always trigger the < 23 check).
    if (process.platform === 'darwin') {
      const macRelease = os.release();
      if (parseInt(macRelease.split('.')[0], 10) < 23) {
        sendDebugLog('macOS version too old for bundled Ollama — requires macOS 14 (Sonoma) or later');
        return false;
      }
    }

    const ollamaPath = await findOllamaExecutable();
    if (!ollamaPath) {
      return false;
    }

    // Start Ollama service in background with proper env vars for dylibs
    ollamaProcess = spawn(ollamaPath, ['serve'], { detached: true, stdio: 'ignore', env: getOllamaEnv() });
    ollamaPid = ollamaProcess.pid;
    try { require('fs').writeFileSync(path.join(getBackendCwd(), '_internal', 'ollama.pid'), String(ollamaPid)); } catch (_) {}
    ollamaProcess.on('exit', () => { ollamaPid = null; });
    ollamaProcess.unref();
    ollamaStartedByUs = true;

    // Wait for service to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    console.error('Error ensuring Ollama is running:', error);
    return false;
  }
}

// Check if Ollama is installed (for setup wizard)
ipcMain.handle('check-ollama-installed', async () => {
  try {
    const ollamaPath = await findOllamaExecutable();
    if (!ollamaPath) {
      return { success: true, installed: false };
    }
    return { success: true, installed: true, path: ollamaPath };
  } catch (error) {
    return { success: false, installed: false, error: error.message };
  }
});

// Model management handlers
ipcMain.handle('check-model-installed', async (event, modelName) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['check-model', modelName]);
    // Parse the last JSON line from output (skip any log lines)
    const lines = result.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(lines[i]);
        return { success: true, installed: data.installed };
      } catch (e) {
        continue;
      }
    }
    return { success: false, installed: false, error: 'Could not parse backend response' };
  } catch (error) {
    return { success: false, installed: false, error: error.message };
  }
});

ipcMain.handle('list-models', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-models']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error listing models: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-current-model', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-model']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting current model: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-model', async (event, modelName) => {
  try {
    sendDebugLog(`Setting model to: ${modelName}`);
    const result = await runPythonScript('simple_recorder.py', ['set-model', modelName]);

    // Extract JSON from output (might have other text before it)
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      trackEvent('model_changed', { model: modelName });
      return jsonData;
    }

    trackEvent('model_changed', { model: modelName });
    return { success: true, model: modelName };
  } catch (error) {
    sendDebugLog(`Error setting model: ${error.message}`);
    return { success: false, error: error.message };
  }
});



ipcMain.handle('get-transcription-engine', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-transcription-engine'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-transcription-engine', async (event, engine) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-transcription-engine', engine]);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('list-parakeet-models', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-parakeet-models'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('parakeet-status', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['parakeet-status'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-whisper-model', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-whisper-model'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-whisper-model', async (event, modelSize) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-whisper-model', modelSize]);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('list-whisper-models', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['list-whisper-models'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('pull-whisper-model', async (event, modelName) => {
  try {
    sendDebugLog(`Pulling whisper model: ${modelName}`);
    return new Promise((resolve) => {
      const proc = spawn(getBackendPath(), ['pull-whisper-model', modelName], {
        cwd: getBackendCwd(),
      });
      let lastStdoutLine = '';
      let timedOut = false;
      // Single settle-gate so SIGKILL-escalation / 'close' / 'error' /
      // force-settle can all race without double-resolving or double-sending
      // whisper-pull-complete. Critical for the timeout path: if the child
      // ignores SIGTERM we must still resolve the Promise eventually,
      // otherwise the renderer spinner hangs forever.
      let settled = false;
      let sigkillTimer = null;
      let forceSettleTimer = null;
      const finishOnce = (result, completeEvent) => {
        if (settled) return;
        settled = true;
        clearTimeout(procTimeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (forceSettleTimer) clearTimeout(forceSettleTimer);
        if (mainWindow && !mainWindow.isDestroyed() && completeEvent) {
          mainWindow.webContents.send('whisper-pull-complete', completeEvent);
        }
        resolve(result);
      };

      // The 3.1 GB large-v3 weights take 5-10 min on a typical home
      // connection. 30 min covers everything short of a stalled socket,
      // matching the process-streaming timeout. Without this, a hung HF
      // download leaves the spinner spinning indefinitely with no recovery.
      const procTimeout = setTimeout(() => {
        timedOut = true;
        sendDebugLog('pull-whisper-model timed out after 30 minutes, killing');
        try { proc.kill('SIGTERM'); } catch (_) { /* already exited */ }
        // SIGTERM can be ignored (signal handler, uninterruptible syscall).
        // Escalate to SIGKILL which the kernel cannot block.
        sigkillTimer = setTimeout(() => {
          sendDebugLog('SIGTERM unresponsive, escalating to SIGKILL');
          try { proc.kill('SIGKILL'); } catch (_) { /* already exited */ }
        }, 5000);
        // Final guarantee: even if 'close' never fires (zombie / uninterruptible
        // wait), settle the Promise so the renderer's whisper-pull-complete
        // listener flushes the progress map and the spinner clears.
        forceSettleTimer = setTimeout(() => {
          sendDebugLog('Force-settling pull-whisper-model Promise after kill grace');
          finishOnce(
            { success: false, error: 'Download timed out after 30 minutes' },
            { model: modelName, success: false, error: 'Download timed out after 30 minutes' },
          );
        }, 15000);
      }, 30 * 60 * 1000);
      const relayProgress = (output) => {
        if (!output) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whisper-pull-progress', {
            model: modelName,
            progress: output,
          });
        }
      };
      proc.stdout.on('data', (data) => {
        const output = data.toString().trim();
        sendDebugLog(output);
        if (output) lastStdoutLine = output;
        relayProgress(output);
      });
      proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) sendDebugLog(`STDERR: ${output}`);
        relayProgress(output);
      });
      proc.on('close', (code) => {
        let pullResult = null;
        try { pullResult = JSON.parse(lastStdoutLine); } catch (_) { /* not JSON */ }
        const succeeded = !timedOut && code === 0 && (!pullResult || pullResult.success !== false);
        if (succeeded) {
          finishOnce(
            { success: true, model: modelName },
            { model: modelName, success: true },
          );
        } else {
          const errorMsg = timedOut
            ? 'Download timed out after 30 minutes'
            : (pullResult && pullResult.error) || `Process exited with code ${code}`;
          finishOnce(
            { success: false, error: errorMsg },
            { model: modelName, success: false, error: errorMsg },
          );
        }
      });
      proc.on('error', (error) => {
        finishOnce(
          { success: false, error: error.message },
          { model: modelName, success: false, error: error.message },
        );
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('pull-parakeet-model', async (event, modelId) => {
  // Mirrors pull-whisper-model: settle-gate + SIGTERM-then-SIGKILL escalation
  // so a stalled HF download can never leave the renderer spinner hanging.
  // Progress is coarse — we relay PARAKEET_PULL_STAGE:<stage> lines from the
  // Python child rather than byte counts. See src/parakeet_models.py for why.
  try {
    sendDebugLog(`Pulling Parakeet model: ${modelId || '<default>'}`);
    return new Promise((resolve) => {
      const args = ['download-parakeet-model'];
      if (modelId) args.push(modelId);
      const proc = spawn(getBackendPath(), args, { cwd: getBackendCwd() });
      let lastStdoutLine = '';
      let timedOut = false;
      let settled = false;
      let sigkillTimer = null;
      let forceSettleTimer = null;
      const finishOnce = (result, completeEvent) => {
        if (settled) return;
        settled = true;
        clearTimeout(procTimeout);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        if (forceSettleTimer) clearTimeout(forceSettleTimer);
        if (mainWindow && !mainWindow.isDestroyed() && completeEvent) {
          mainWindow.webContents.send('parakeet-pull-complete', completeEvent);
        }
        resolve(result);
      };
      const procTimeout = setTimeout(() => {
        timedOut = true;
        sendDebugLog('pull-parakeet-model timed out after 30 minutes, killing');
        try { proc.kill('SIGTERM'); } catch (_) { /* already exited */ }
        sigkillTimer = setTimeout(() => {
          sendDebugLog('SIGTERM unresponsive, escalating to SIGKILL');
          try { proc.kill('SIGKILL'); } catch (_) { /* already exited */ }
        }, 5000);
        forceSettleTimer = setTimeout(() => {
          sendDebugLog('Force-settling pull-parakeet-model Promise after kill grace');
          finishOnce(
            { success: false, error: 'Download timed out after 30 minutes' },
            { model: modelId, success: false, error: 'Download timed out after 30 minutes' },
          );
        }, 15000);
      }, 30 * 60 * 1000);
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          sendDebugLog(trimmed);
          if (trimmed.startsWith('PARAKEET_PULL_STAGE:')) {
            const stage = trimmed.slice('PARAKEET_PULL_STAGE:'.length);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('parakeet-pull-progress', { model: modelId, stage });
            }
          } else {
            lastStdoutLine = trimmed;
          }
        }
      });
      proc.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) sendDebugLog(`STDERR: ${text}`);
      });
      proc.on('close', (code) => {
        let pullResult = null;
        try { pullResult = JSON.parse(lastStdoutLine); } catch (_) { /* not JSON */ }
        const succeeded = !timedOut && code === 0 && (!pullResult || pullResult.success !== false);
        if (succeeded) {
          finishOnce(
            { success: true, model: modelId },
            { model: modelId, success: true },
          );
        } else {
          const errorMsg = timedOut
            ? 'Download timed out after 30 minutes'
            : (pullResult && pullResult.error) || `Process exited with code ${code}`;
          finishOnce(
            { success: false, error: errorMsg },
            { model: modelId, success: false, error: errorMsg },
          );
        }
      });
      proc.on('error', (error) => {
        finishOnce(
          { success: false, error: error.message },
          { model: modelId, success: false, error: error.message },
        );
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-keep-recordings', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-keep-recordings'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-keep-recordings', async (event, enabled) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-keep-recordings', enabled.toString()]);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-silence-auto-stop', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-silence-auto-stop'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-silence-auto-stop-enabled', async (_event, enabled) => {
  try {
    const result = await runPythonScript(
      'simple_recorder.py',
      ['set-silence-auto-stop-enabled', enabled ? 'True' : 'False']
    );
    const jsonData = JSON.parse(result.trim());
    return jsonData;
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-silence-auto-stop-minutes', async (_event, minutes) => {
  try {
    const result = await runPythonScript(
      'simple_recorder.py',
      ['set-silence-auto-stop-minutes', String(minutes)]
    );
    const jsonData = JSON.parse(result.trim());
    return jsonData;
  } catch (e) { return { success: false, error: e.message }; }
});

// Fired by the renderer's silence detector. The renderer has already
// asked main to stop the recording via pause/stop; this just surfaces
// the reason to the user via a system-tray notification so they know
// what happened when they come back to the laptop. sessionName matches
// what they'll see in the sidebar — calendar event title for
// auto-detect recordings, "Note" for the default placeholder.
ipcMain.handle('show-silence-auto-stop-notification', async (_event, payload) => {
  try {
    if (!(await notificationsEnabled())) return { success: true };
    // Back-compat: earlier callers passed `minutes` as a number directly.
    // Accept both shapes so older renderer bundles don't crash this handler
    // until they're rebuilt.
    const minutes = typeof payload === 'number' ? payload : payload?.minutes;
    const sessionName = typeof payload === 'object' ? payload?.sessionName : null;
    const body = sessionName
      ? `${sessionName} — ${minutes} minutes of silence`
      : `${minutes} minutes of silence — your note is being processed.`;
    const notif = new Notification({
      title: 'Recording stopped',
      body,
    });
    notif.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
    return { success: true };
  } catch (e) {
    sendDebugLog(`Failed to show silence auto-stop notification: ${e.message}`);
    return { success: false, error: e.message };
  }
});

// Fired by the renderer's processing-complete handler when we skipped
// auto-navigate (user was on a route other than /meetings/processing).
// Click just focuses Steno — same predictable behaviour as the auto-stop
// notification. We don't navigate anywhere: the new note appears at the
// top of the sidebar / Home list, so once Steno is focused the user
// can see it instantly. Navigating away (especially when the user is
// recording another note back-to-back) is worse than no navigation.
ipcMain.handle('show-note-ready-notification', async (_event, payload) => {
  try {
    if (!(await notificationsEnabled())) return { success: true };
    const { title, failed } = payload || {};
    // Be honest when transcription crashed: don't tell the user their note
    // is "ready". The recording was preserved (not deleted) and the note
    // explains the failure on open.
    const notif = new Notification({
      title: failed ? 'Transcription failed' : 'Note ready',
      body: failed
        ? 'Your recording was preserved — open the note for details.'
        : (title || 'Your note has finished processing'),
    });
    notif.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
    return { success: true };
  } catch (e) {
    sendDebugLog(`Failed to show note-ready notification: ${e.message}`);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-notifications', handleGetNotifications);

ipcMain.handle('set-notifications', async (event, enabled) => {
  try {
    sendDebugLog(`Setting notifications to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-notifications', enabled ? 'True' : 'False']);

    // Extract JSON from output
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      return jsonData;
    }

    return { success: true, notifications_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting notifications: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-telemetry', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-telemetry']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting telemetry settings: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-telemetry', async (event, enabled) => {
  try {
    sendDebugLog(`Setting telemetry to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-telemetry', enabled ? 'True' : 'False']);

    // Update in-memory state
    telemetryEnabled = enabled;

    if (enabled && !posthogClient) {
      posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
      console.log('Telemetry re-enabled');
    } else if (!enabled && posthogClient) {
      await shutdownTelemetry();
      console.log('Telemetry disabled');
    }

    // Extract JSON from output
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      return jsonData;
    }

    return { success: true, telemetry_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting telemetry: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Hide dock icon IPC handlers
ipcMain.handle('get-dock-icon', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-dock-icon']);
    const jsonData = JSON.parse(result);

    return {
      success: true,
      ...jsonData
    };
  } catch (error) {
    sendDebugLog(`Error getting dock icon settings: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-dock-icon', async (event, hidden) => {
  try {
    sendDebugLog(`Setting hide dock icon to: ${hidden}`);
    const result = await runPythonScript('simple_recorder.py', ['set-dock-icon', hidden ? 'True' : 'False']);

    // Apply immediately
    if (process.platform === 'darwin' && app.dock) {
      if (hidden) {
        app.dock.hide();
      } else {
        app.dock.show();
      }
    }

    // Extract JSON from output
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      return jsonData;
    }

    return { success: true, hide_dock_icon: hidden };
  } catch (error) {
    sendDebugLog(`Error setting dock icon: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// System audio capture IPC handlers
ipcMain.handle('get-system-audio', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-system-audio'], true);
    const jsonData = JSON.parse(result);
    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting system audio setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-system-audio', async (event, enabled) => {
  try {
    sendDebugLog(`Setting system audio to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-system-audio', enabled ? 'True' : 'False']);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, system_audio_enabled: enabled };
  } catch (error) {
    sendDebugLog(`Error setting system audio: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-auto-detect-meetings', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-auto-detect-meetings'], true);
    const jsonData = JSON.parse(result);
    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting auto-detect setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-auto-detect-meetings', async (_event, enabled) => {
  try {
    sendDebugLog(`Setting auto-detect to: ${enabled}`);
    const result = await runPythonScript('simple_recorder.py', ['set-auto-detect-meetings', enabled ? 'True' : 'False']);
    const jsonMatch = result.match(/\{.*\}/s);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true, auto_detect_meetings_enabled: enabled };
    // Apply the change live — spin the mic-monitor up or kill it without
    // making the user restart. Mirror all the same gates as
    // setupAutoMeetingDetector(): E2E mode and dev-without-env-var both
    // skip the spawn so toggling the setting during tests / dev work
    // doesn't accidentally start the watcher.
    if (parsed.success) {
      if (enabled) {
        if (IS_E2E) {
          sendDebugLog('[auto-detect] E2E mode; setting saved but watcher not started');
        } else if (!app.isPackaged && !process.env[AUTO_DETECT_ENV]) {
          sendDebugLog(`[auto-detect] dev mode without ${AUTO_DETECT_ENV}=1; setting saved but watcher not started`);
        } else {
          startMicMonitor();
        }
      } else {
        stopMicMonitor();
      }
    }
    return parsed;
  } catch (error) {
    sendDebugLog(`Error setting auto-detect: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Language IPC handlers
ipcMain.handle('get-language', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-language'], true);
    const jsonData = JSON.parse(result);
    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting language setting: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-language', async (event, languageCode) => {
  try {
    sendDebugLog(`Setting language to: ${languageCode}`);
    const result = await runPythonScript('simple_recorder.py', ['set-language', languageCode]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { success: true, language: languageCode };
  } catch (error) {
    sendDebugLog(`Error setting language: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-user-name', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-user-name'], true);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-user-name', async (event, name) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-user-name', String(name ?? '')]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true, user_name: String(name ?? '').trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// AI Provider IPC handlers

function getCloudKeyPath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', '.cloud-api-key');
}

function saveCloudApiKey(key) {
  try {
    const keyDir = path.dirname(getCloudKeyPath());
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }
    const encrypted = safeStorage.encryptString(key);
    fs.writeFileSync(getCloudKeyPath(), encrypted);
    return true;
  } catch (error) {
    console.error('Failed to save cloud API key:', error.message);
    return false;
  }
}

function loadCloudApiKey() {
  try {
    const keyPath = getCloudKeyPath();
    if (!fs.existsSync(keyPath)) return null;
    const encrypted = fs.readFileSync(keyPath);
    return safeStorage.decryptString(encrypted);
  } catch (error) {
    console.error('Failed to load cloud API key:', error.message);
    return null;
  }
}

function hasCloudApiKey() {
  return fs.existsSync(getCloudKeyPath());
}

// Build the env additions a Python AI-driven subprocess needs. Merges
// the encrypted-on-disk cloud key (decrypted only here, never written
// to the env if absent) AND the org adapter URL+JWT when a session
// exists. Either or both may be empty — the Python summariser picks
// the right path based on the configured ai_provider, and we just
// surface whatever's available.
function getAiEnv() {
  const env = {};
  const cloudKey = loadCloudApiKey();
  if (cloudKey) env.STENOAI_CLOUD_API_KEY = cloudKey;
  const session = loadOrgSession();
  if (session && session.adapterUrl && session.token && !isJwtExpired(session.token)) {
    env.STENOAI_ADAPTER_URL = session.adapterUrl;
    env.STENOAI_ADAPTER_TOKEN = session.token;
  }
  return env;
}

// Read the Python-side ai_provider config so we can react to it on sign-in
// / sign-out events. Returns 'local' on any error so an unreadable config
// can't accidentally keep us in 'adapter' mode after logout.
async function readAiProvider() {
  try {
    const raw = await runPythonScript('simple_recorder.py', ['get-ai-provider'], true);
    const data = JSON.parse(raw.trim());
    return typeof data.ai_provider === 'string' ? data.ai_provider : 'local';
  } catch (e) {
    sendDebugLog(`readAiProvider failed, treating as 'local': ${e.message}`);
    return 'local';
  }
}

// Tiny on-disk marker so the auto-switch can remember which provider
// the user was on before we flipped them to 'adapter'. Restored on
// sign-out so a user previously on 'cloud' goes back to 'cloud' rather
// than getting silently downgraded to 'local'. Cleared whenever the
// user manually picks a non-adapter provider — at that point there's
// no longer a stale value to restore to.
function getPreAdapterProviderPath() {
  return path.join(getUserDataDir(), '.pre-adapter-provider');
}

function loadPreAdapterProvider() {
  try {
    const p = getPreAdapterProviderPath();
    if (!fs.existsSync(p)) return null;
    const value = fs.readFileSync(p, 'utf8').trim();
    return value || null;
  } catch (_) {
    return null;
  }
}

function savePreAdapterProvider(provider) {
  try {
    const p = getPreAdapterProviderPath();
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(provider || ''));
  } catch (e) {
    sendDebugLog(`savePreAdapterProvider failed: ${e.message}`);
  }
}

function clearPreAdapterProvider() {
  try {
    const p = getPreAdapterProviderPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

// Bidirectional reconciliation between the org session and the Python-side
// ai_provider. Hard-lock policy: while a valid org session exists the
// provider must be 'adapter' — the adapter brokers AI for org users
// (zero-config was the customer ask), and any drift (a wiped config.json,
// a hand edit, a CLI call) self-heals on the next check. The reverse
// direction keeps the old stale-adapter recovery: config says 'adapter'
// but the session file is genuinely gone → restore the remembered
// pre-adapter provider so the next AI call doesn't die with "adapter not
// configured".
//
// A safeStorage decrypt failure (locked keychain right after wake, denied
// prompt) is transient and changes NOTHING — acting on it is how signed-in
// users used to end up silently summarising on local llama. Expired-but-
// present sessions are also left alone here: expiry is owned by org-status
// and adapterFetch's 401 path (clear session + restore provider), and
// acting on it from two places would race.
//
// Serialized, not merely coalesced: every provider-state mutation (this
// reconcile AND the sign-out restore) runs through one queue, so a sign-out's
// restore can never interleave with an in-flight reconcile's write — the
// race that could strand ai_provider='adapter' with no session, or clobber
// the restore marker. Late callers get a FRESH run that starts after the
// previous one finishes, so a sign-in that lands while a pre-sign-in run is
// in flight still gets post-sign-in truth.
let providerStateQueue = Promise.resolve();
function enqueueProviderStateOp(op) {
  const run = providerStateQueue.then(op);
  // Keep the chain alive whether the op resolves or rejects.
  providerStateQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Bumped whenever the org session file changes (save or clear) so a queued
// reconcile can detect that the session it read mid-run is no longer
// current and abort its write instead of acting on stale state.
let orgSessionGeneration = 0;

// Memo of the last reconcile that confirmed session/provider consistency.
// org-status is refetched on focus/mount by the sidebar; without this every
// refetch would spawn a Python subprocess (~100-300ms PyInstaller startup)
// for a no-op check. The memoed fast path returns null ("nothing to
// change") so callers never patch their response from a possibly-stale memo.
let lastConsistentCheck = { generation: -1, at: 0 };
const RECONCILE_CONSISTENT_TTL_MS = 30_000;

function reconcileAiProviderWithOrgSession() {
  if (
    lastConsistentCheck.generation === orgSessionGeneration &&
    Date.now() - lastConsistentCheck.at < RECONCILE_CONSISTENT_TTL_MS
  ) {
    return Promise.resolve(null);
  }
  return enqueueProviderStateOp(async () => {
    // Re-check the memo now that we actually run: a burst of callers with a
    // cold memo enqueues several runs, and by the time the later ones
    // execute, the first has already confirmed consistency — skip their
    // subprocess spawns instead of repeating the full check serially.
    if (
      lastConsistentCheck.generation === orgSessionGeneration &&
      Date.now() - lastConsistentCheck.at < RECONCILE_CONSISTENT_TTL_MS
    ) {
      return null;
    }
    const genAtRead = orgSessionGeneration;
    const { session, exists, decryptFailed } = loadOrgSessionEx();
    if (decryptFailed) return null; // transient — never act on it
    const current = await readAiProvider();
    const sessionValid = Boolean(
      session && session.adapterUrl && session.token && !isJwtExpired(session.token)
    );
    if (sessionValid && current !== 'adapter') {
      if (orgSessionGeneration !== genAtRead) {
        sendDebugLog('Org lock: session changed mid-reconcile; aborting relock');
        return null;
      }
      // Seed the restore marker only when none exists: in a drift repair
      // `current` may be a wiped-to-default 'local' while the marker still
      // holds the user's true pre-sign-in choice (e.g. 'cloud').
      const hadMarker = loadPreAdapterProvider() !== null;
      if (!hadMarker) savePreAdapterProvider(current);
      sendDebugLog(`Org lock: switching ai_provider from ${current} to adapter (org session active)`);
      try {
        const out = await runPythonScript('simple_recorder.py', ['set-ai-provider', 'adapter']);
        // The CLI prints {"success": false} with exit 0 on a failed config
        // save — surface that as a failure too, not just spawn errors.
        const jsonMatch = out.match(/\{.*\}/s);
        if (jsonMatch && JSON.parse(jsonMatch[0]).success === false) {
          throw new Error('set-ai-provider reported a failed config save');
        }
      } catch (e) {
        sendDebugLog(`Org lock: switch to adapter failed: ${e.message}`);
        // Don't leave a marker WE created if the switch never landed; a
        // pre-existing marker stays — it still describes the user's choice.
        if (!hadMarker) clearPreAdapterProvider();
        return await readAiProvider();
      }
      const settled = await readAiProvider();
      if (orgSessionGeneration === genAtRead && settled === 'adapter') {
        lastConsistentCheck = { generation: orgSessionGeneration, at: Date.now() };
      }
      return settled;
    }
    if (!exists && current === 'adapter') {
      if (orgSessionGeneration !== genAtRead) return null;
      sendDebugLog('Org lock: ai_provider=adapter but no org session backing it; restoring pre-adapter provider');
      // Direct call, not the queued wrapper — we already hold the queue.
      await doRestorePreAdapterProvider();
      return await readAiProvider();
    }
    if (orgSessionGeneration === genAtRead) {
      lastConsistentCheck = { generation: orgSessionGeneration, at: Date.now() };
    }
    return current;
  });
}

// Wired into the org sign-in flows (password + Google SSO). Kept as a named
// wrapper so the call sites read as intent; the reconcile does the work.
async function autoSwitchToAdapterOnSignIn() {
  await reconcileAiProviderWithOrgSession();
}

// On sign-out (or stale-session clear), restore the pre-adapter provider
// if we still have it. Falls back to 'local' if the marker is missing
// (e.g. user manually switched to adapter without coming via auto-switch).
// Serialized on the same queue as the reconcile so the two state machines
// can't interleave; doRestorePreAdapterProvider is the unqueued body, used
// by the reconcile when it already holds the queue.
function restorePreAdapterProvider() {
  return enqueueProviderStateOp(doRestorePreAdapterProvider);
}

async function doRestorePreAdapterProvider() {
  lastConsistentCheck = { generation: -1, at: 0 }; // state is changing
  const current = await readAiProvider();
  if (current !== 'adapter') {
    clearPreAdapterProvider(); // tidy: if not on adapter, the marker is stale
    return;
  }
  const restored = loadPreAdapterProvider() || 'local';
  sendDebugLog(`Org sign-out: restoring ai_provider from adapter to ${restored}`);
  let restoreLanded = true;
  try {
    const out = await runPythonScript('simple_recorder.py', ['set-ai-provider', restored]);
    // The CLI prints {"success": false} with exit 0 on a failed config
    // save — treat that as a failure, same as the relock path does.
    const jsonMatch = out.match(/\{.*\}/s);
    if (jsonMatch && JSON.parse(jsonMatch[0]).success === false) {
      throw new Error('set-ai-provider reported a failed config save');
    }
  } catch (e) {
    restoreLanded = false;
    sendDebugLog(`restore to ${restored} failed: ${e.message}`);
  }
  // Keep the marker when the restore didn't land — it's the only record
  // of the user's pre-adapter choice, and a later retry needs it.
  if (restoreLanded) clearPreAdapterProvider();
}

ipcMain.handle('get-ai-provider', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-ai-provider'], true);
    const jsonData = JSON.parse(result.trim());
    // Override cloud_api_key_set with safeStorage check
    jsonData.cloud_api_key_set = hasCloudApiKey();

    // Reconcile the provider with org-session reality before answering, so
    // the renderer's first paint already reflects a working provider:
    //  - valid session but provider drifted (wiped config, hand edit, CLI
    //    call) → relock to 'adapter' (hard-lock policy)
    //  - provider says 'adapter' but the session file is gone (manually
    //    deleted, crashed mid-sign-out) → restore the pre-adapter provider
    // Decrypt failures (locked keychain) deliberately change nothing. The
    // reconcile re-reads the provider from disk after any write, so the
    // patched response never diverges from what Python persisted.
    try {
      const reconciled = await reconcileAiProviderWithOrgSession();
      if (reconciled && reconciled !== jsonData.ai_provider) {
        jsonData.ai_provider = reconciled;
      }
    } catch (e) {
      sendDebugLog(`AI provider reconcile failed: ${e.message}`);
      // Return the unreconciled value — pre-fix behaviour, not a regression.
    }

    return { success: true, ...jsonData };
  } catch (error) {
    sendDebugLog(`Error getting AI provider: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-ai-provider', async (event, provider) => {
  try {
    sendDebugLog(`Setting AI provider to: ${provider}`);
    // Queued so a manual write can't interleave with an in-flight
    // reconcile or sign-out restore (last-writer-wins races on the same
    // config value); the org-lock gate is evaluated inside the op so it
    // sees post-queue session state.
    return await enqueueProviderStateOp(async () => {
      if (provider !== 'adapter') {
        // Hard lock: while a valid org session exists the provider is
        // managed by the organisation. The Settings picker is disabled
        // too — this backstops any other IPC caller and future UI paths,
        // and it leaves the restore marker untouched. Fail closed on a
        // decrypt failure (locked keychain): the user IS signed in, the
        // session is just transiently unreadable, and letting the switch
        // through would have the next reconcile fight them.
        const { session, decryptFailed } = loadOrgSessionEx();
        const sessionValid = Boolean(
          session && session.adapterUrl && session.token && !isJwtExpired(session.token)
        );
        if (sessionValid || decryptFailed) {
          sendDebugLog(`Org lock: rejecting set-ai-provider ${provider} (${decryptFailed ? 'session unreadable' : 'org session active'})`);
          return {
            success: false,
            managedByOrg: true,
            error: 'AI provider is managed by your organisation while you are signed in.',
          };
        }
        // A manual switch away from 'adapter' invalidates the pre-adapter
        // marker — without this, a user who auto-switched on sign-in and
        // then manually moved to a different provider would still be
        // restored to the stale "before adapter" value on sign-out.
        clearPreAdapterProvider();
      }
      // Provider state is changing under the memo's feet.
      lastConsistentCheck = { generation: -1, at: 0 };
      const result = await runPythonScript('simple_recorder.py', ['set-ai-provider', provider]);
      const jsonMatch = result.match(/\{.*\}/s);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return { success: true, ai_provider: provider };
    });
  } catch (error) {
    sendDebugLog(`Error setting AI provider: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-remote-ollama-url', async (event, url) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-remote-ollama-url', url]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-cloud-api-url', async (event, url) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-cloud-api-url', url]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-cloud-api-key', async (event, key) => {
  try {
    const saved = saveCloudApiKey(key);
    return { success: saved, cloud_api_key_set: saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-cloud-provider', async (event, provider) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-cloud-provider', provider]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-cloud-model', async (event, model) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-cloud-model', model]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-bedrock-region', async (event, region) => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['set-bedrock-region', region]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-bedrock-inference-profile', async (event, profile) => {
  try {
    // Click's required=False + default='' lets us clear the field by passing
    // the empty string; pass through as a single positional arg.
    const result = await runPythonScript(
      'simple_recorder.py',
      ['set-bedrock-inference-profile', profile || ''],
    );
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-remote-ollama', async (event, url) => {
  try {
    sendDebugLog(`Testing remote Ollama at: ${url}`);
    const result = await runPythonScript('simple_recorder.py', ['test-remote-ollama', url]);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: false, error: 'No response' };
  } catch (error) {
    sendDebugLog(`Remote Ollama test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-cloud-api', async () => {
  try {
    sendDebugLog('Testing cloud API connection...');
    const apiKey = loadCloudApiKey();
    const env = apiKey ? { STENOAI_CLOUD_API_KEY: apiKey } : {};
    const result = await runPythonScript('simple_recorder.py', ['test-cloud-api'], false, env);
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: false, error: 'No response' };
  } catch (error) {
    sendDebugLog(`Cloud API test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recordings-dir', async () => {
  try {
    // Get recordings directory from Python config
    const result = await runPythonScript('simple_recorder.py', ['get-storage-path'], true);
    const jsonData = JSON.parse(result.trim());

    let recordingsDir;
    if (jsonData.storage_path) {
      recordingsDir = path.join(jsonData.storage_path, 'recordings');
    } else if (app.isPackaged) {
      recordingsDir = path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', 'recordings');
    } else {
      recordingsDir = path.join(__dirname, '..', 'recordings');
    }

    // Ensure directory exists
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    return { success: true, path: recordingsDir };
  } catch (error) {
    sendDebugLog(`Error getting recordings dir: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Renderer-driven system audio capture writes its WebM/Opus blob into the
// same recordings/ folder the mic path uses. Keeping both capture paths in
// one folder means `keep_recordings` semantics + cleanup are symmetric, and
// users have a single canonical place to find saved audio.
ipcMain.handle('write-system-audio-blob', async (_event, payload, sessionName) => {
  try {
    const dir = resolveRecordingsDir();
    const safeName = String(sessionName || 'Note').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const filename = `sysaudio-${Date.now()}-${safeName}.webm`;
    const filePath = path.join(dir, filename);
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    fs.writeFileSync(filePath, buf);
    sendDebugLog(`[sysaudio] wrote blob ${filename} (${buf.length} bytes)`);
    return { success: true, filePath };
  } catch (error) {
    sendDebugLog(`Error writing system audio blob: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('process-system-audio-recording', async (event, audioFilePath, sessionName) => {
  try {
    sendDebugLog(`Queuing system audio recording for processing: ${audioFilePath}`);

    // Validate file path
    const allowedBaseDirs = getAllowedBaseDirs();
    if (!validateSafeFilePath(audioFilePath, allowedBaseDirs)) {
      return { success: false, error: 'Invalid file path' };
    }

    if (!fs.existsSync(audioFilePath)) {
      return { success: false, error: 'Audio file not found' };
    }

    const actualSessionName = sessionName || 'Note';

    // Check for user notes file
    const safeName = actualSessionName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const notesFile = path.join(getBackendCwd(), '_internal', 'output', `${safeName}_notes.txt`);
    const notesPath = fs.existsSync(notesFile) ? notesFile : undefined;

    // Use the existing processing queue to avoid concurrent Ollama/Whisper runs
    addToProcessingQueue(audioFilePath, actualSessionName, notesPath);

    trackEvent('recording_stopped', { recording_mode: 'system_audio' });
    return { success: true, message: 'Added to processing queue' };
  } catch (error) {
    sendDebugLog(`Error queuing system audio: ${error.message}`);
    trackEvent('error_occurred', { error_type: 'process_system_audio' });
    return { success: false, error: error.message };
  }
});

// Track system audio recording state for tray icon. Also resets the elapsed
// counter when the renderer reports inactive without a Python process —
// covers the case where startCapture failed (permission denied) and we'd
// otherwise leak recordingRuntimeState.startedAtMs.
ipcMain.on('system-audio-recording-state', (event, isRecording) => {
  sendDebugLog(`[sysaudio] state -> ${isRecording ? 'true' : 'false'} (was ${systemAudioRecordingActive})`);
  systemAudioRecordingActive = isRecording;
  if (!isRecording && !currentRecordingProcess) {
    resetRecordingRuntimeState();
    currentRecordingSessionName = null;
  }
  updateTrayIcon(isRecording);
  updateTrayMenu();
});

ipcMain.handle('pull-model', async (event, modelName) => {
  try {
    sendDebugLog(`Pulling model: ${modelName}`);
    sendDebugLog('This may take several minutes...');

    return new Promise((resolve) => {
      const proc = spawn(getBackendPath(), ['pull-model', modelName], {
        cwd: getBackendCwd()
      });

      let lastStdoutLine = '';

      proc.stdout.on('data', (data) => {
        const output = data.toString().trim();
        sendDebugLog(output);
        if (output) lastStdoutLine = output;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-progress', {
            model: modelName,
            progress: output
          });
        }
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        sendDebugLog(output);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-progress', {
            model: modelName,
            progress: output
          });
        }
      });

      proc.on('close', (code) => {
        // The backend prints a JSON result as the last stdout line.
        // Check it even on exit code 0, since the Python CLI may
        // catch errors and still exit cleanly.
        let pullResult = null;
        try { pullResult = JSON.parse(lastStdoutLine); } catch (_) {}

        const succeeded = code === 0 && (!pullResult || pullResult.success !== false);

        if (succeeded) {
          sendDebugLog(`Successfully pulled model: ${modelName}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-complete', {
              model: modelName,
              success: true
            });
          }

          resolve({ success: true, model: modelName });
        } else {
          const errorMsg = (pullResult && pullResult.error) || `Process exited with code ${code}`;
          sendDebugLog(`Failed to pull model: ${modelName} - ${errorMsg}`);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('model-pull-complete', {
              model: modelName,
              success: false,
              error: errorMsg
            });
          }

          resolve({ success: false, error: errorMsg });
        }
      });

      proc.on('error', (error) => {
        sendDebugLog(`Error pulling model: ${error.message}`);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('model-pull-complete', {
            model: modelName,
            success: false,
            error: error.message
          });
        }

        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    sendDebugLog(`Error in pull-model handler: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Helper to build env vars for running the bundled Ollama binary directly.
// Mirrors src/ollama_manager.get_ollama_env() so the dylib/DLL search path
// is set correctly per-OS.
function getOllamaEnv() {
  let ollamaDir;
  if (app.isPackaged) {
    ollamaDir = path.join(process.resourcesPath, 'stenoai', '_internal', 'ollama');
  } else {
    ollamaDir = path.join(__dirname, '..', 'bin');
  }
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    const existing = env.DYLD_LIBRARY_PATH || '';
    env.DYLD_LIBRARY_PATH = existing ? `${ollamaDir}:${existing}` : ollamaDir;
    env.MLX_METAL_PATH = path.join(ollamaDir, 'mlx.metallib');
  } else if (process.platform === 'win32') {
    const existing = env.PATH || '';
    env.PATH = existing ? `${ollamaDir};${existing}` : ollamaDir;
  } else {
    const existing = env.LD_LIBRARY_PATH || '';
    env.LD_LIBRARY_PATH = existing ? `${ollamaDir}:${existing}` : ollamaDir;
  }
  return env;
}

// Helper function to find Ollama executable (bundled only)
async function findOllamaExecutable() {
  const exe = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  let bundledOllamaPath;
  if (app.isPackaged) {
    // Production: bundled inside PyInstaller _internal directory
    bundledOllamaPath = path.join(process.resourcesPath, 'stenoai', '_internal', 'ollama', exe);
  } else {
    // Development: in project bin/ directory
    bundledOllamaPath = path.join(__dirname, '..', 'bin', exe);
  }

  if (fs.existsSync(bundledOllamaPath)) {
    console.log(`Using bundled Ollama: ${bundledOllamaPath}`);
    return bundledOllamaPath;
  }

  console.error(`Bundled Ollama not found at: ${bundledOllamaPath}`);
  return null;
}

// Update checking functionality
async function checkForUpdates() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/ruzin/stenoai/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'StenoAI-Updater'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name.replace(/^v/, ''); // Remove 'v' prefix if present
          
          // Get current version from package.json
          const packagePath = path.join(__dirname, 'package.json');
          const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
          const currentVersion = packageContent.version;
          
          console.log(`Current version: ${currentVersion}, Latest version: ${latestVersion}`);
          
          // Simple version comparison (works for semantic versioning)
          const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0;
          
          resolve({
            success: true,
            updateAvailable: isUpdateAvailable,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            releaseUrl: release.html_url,
            releaseName: release.name || `Version ${latestVersion}`,
            downloadUrl: getDownloadUrl(release.assets)
          });
        } catch (error) {
          console.error('Error parsing GitHub API response:', error);
          resolve({ success: false, error: 'Failed to parse update data' });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Error checking for updates:', error);
      resolve({ success: false, error: error.message });
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Update check timeout' });
    });
    
    req.end();
  });
}

function compareVersions(current, latest) {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    
    if (currentPart < latestPart) return -1;
    if (currentPart > latestPart) return 1;
  }
  
  return 0;
}

function getDownloadUrl(assets) {
  // Find the appropriate download URL based on platform/architecture
  const platform = process.platform;
  const arch = process.arch;
  
  if (platform === 'darwin') {
    // Look for macOS DMG files
    const armAsset = assets.find(asset => 
      asset.name.includes('arm64') && asset.name.includes('dmg')
    );
    const intelAsset = assets.find(asset => 
      asset.name.includes('x64') && asset.name.includes('dmg')
    );
    
    // Prefer ARM64 for Apple Silicon, fallback to Intel
    if (arch === 'arm64' && armAsset) return armAsset.browser_download_url;
    if (intelAsset) return intelAsset.browser_download_url;
    if (armAsset) return armAsset.browser_download_url;
  }
  
  // Fallback to first asset or releases page
  return assets.length > 0 ? assets[0].browser_download_url : null;
}

ipcMain.handle('check-for-updates', async () => {
  return await checkForUpdates();
});

ipcMain.handle('check-announcements', async () => {
  const packagePath = path.join(__dirname, 'package.json');
  const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageContent.version;

  // Try local file first (for development/testing)
  const localPath = path.join(__dirname, '..', 'announcements.json');
  if (fs.existsSync(localPath)) {
    try {
      const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      console.log('Loaded announcements from local file');
      return {
        success: true,
        announcements: localData.announcements || [],
        currentVersion
      };
    } catch (error) {
      console.error('Error reading local announcements.json:', error);
    }
  }

  // Fall back to remote
  return new Promise((resolve) => {
    const options = {
      hostname: 'raw.githubusercontent.com',
      path: '/ruzin/stenoai/main/announcements.json',
      method: 'GET',
      headers: {
        'User-Agent': 'StenoAI-App'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            success: true,
            announcements: parsed.announcements || [],
            currentVersion
          });
        } catch (error) {
          console.error('Error parsing announcements:', error);
          resolve({ success: false, error: 'Failed to parse announcements' });
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error fetching announcements:', error);
      resolve({ success: false, error: error.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, error: 'Announcements fetch timeout' });
    });

    req.end();
  });
});

ipcMain.handle('open-release-page', async (event, url) => {
  try {
    if (typeof url !== 'string' || !url) {
      return { success: false, error: 'invalid url' };
    }
    let parsed;
    try { parsed = new URL(url); } catch {
      return { success: false, error: 'invalid url' };
    }
    // Release pages live on github.com -- restrict to that origin so a
    // compromised renderer cannot launch arbitrary external URLs through
    // this channel.
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
      return { success: false, error: 'unsupported url' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generic external-URL opener for renderer-triggered links (e.g. meeting
// join URLs on Home). Http/https only — rejects custom schemes so a
// compromised renderer cannot launch arbitrary protocol handlers.
ipcMain.handle('open-external', async (event, url) => {
  try {
    if (typeof url !== 'string' || !url) {
      return { success: false, error: 'invalid url' };
    }
    let parsed;
    try { parsed = new URL(url); } catch {
      return { success: false, error: 'invalid url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'unsupported scheme' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
// ── Google Calendar: Token Storage ──────────────────────────────────────

function getTokenFilePath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', '.google-tokens');
}

function saveGoogleTokens(tokens) {
  try {
    const tokenDir = path.dirname(getTokenFilePath());
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(getTokenFilePath(), encrypted);
    console.log('Google tokens saved');
  } catch (error) {
    console.error('Failed to save Google tokens:', error.message);
  }
}

function loadGoogleTokens() {
  try {
    const tokenPath = getTokenFilePath();
    if (!fs.existsSync(tokenPath)) return null;
    const encrypted = fs.readFileSync(tokenPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to load Google tokens:', error.message);
    return null;
  }
}

function deleteGoogleTokens() {
  try {
    const tokenPath = getTokenFilePath();
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('Google tokens deleted');
    }
  } catch (error) {
    console.error('Failed to delete Google tokens:', error.message);
  }
}

// ── Outlook Calendar: Token Storage ─────────────────────────────────────

function getOutlookTokenFilePath() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'stenoai', '.outlook-tokens');
}

function saveOutlookTokens(tokens) {
  try {
    const tokenDir = path.dirname(getOutlookTokenFilePath());
    if (!fs.existsSync(tokenDir)) {
      fs.mkdirSync(tokenDir, { recursive: true });
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(getOutlookTokenFilePath(), encrypted);
    console.log('Outlook tokens saved');
  } catch (error) {
    console.error('Failed to save Outlook tokens:', error.message);
  }
}

function loadOutlookTokens() {
  try {
    const tokenPath = getOutlookTokenFilePath();
    if (!fs.existsSync(tokenPath)) return null;
    const encrypted = fs.readFileSync(tokenPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to load Outlook tokens:', error.message);
    return null;
  }
}

function deleteOutlookTokens() {
  try {
    const tokenPath = getOutlookTokenFilePath();
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      console.log('Outlook tokens deleted');
    }
  } catch (error) {
    console.error('Failed to delete Outlook tokens:', error.message);
  }
}

// ── Google Calendar: OAuth2 Flow with PKCE ──────────────────────────────

// Tracks an in-flight OAuth handshake so `google-auth-cancel` can close
// the loopback server and reject the pending promise — otherwise the
// user is stuck on "Connecting…" until the timeout fires.
let activeGoogleAuth = null;

function cancelActiveGoogleAuth() {
  if (!activeGoogleAuth) return false;
  const handle = activeGoogleAuth;
  activeGoogleAuth = null;
  if (handle.timeoutId) clearTimeout(handle.timeoutId);
  // Flip the closure flag first so an in-flight token exchange knows to
  // throw away its result instead of saving tokens.
  if (handle.markCancelled) handle.markCancelled();
  try { handle.server.close(); } catch (_) {}
  handle.reject(new Error('Cancelled'));
  return true;
}

function startGoogleAuth() {
  return new Promise((resolve, reject) => {
    // If a previous click is still pending, abort it before starting a
    // new flow — keeps state from desyncing if the user double-clicks.
    cancelActiveGoogleAuth();

    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    let timeoutId = null;
    let isCancelled = false;
    const clearActive = () => {
      if (activeGoogleAuth && activeGoogleAuth.server === server) {
        activeGoogleAuth = null;
      }
    };

    // Start temporary HTTP server on loopback for OAuth redirect
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1`);
        if (!reqUrl.pathname.startsWith('/callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid state parameter</h2><p>Possible CSRF attack. Please try again.</p></body></html>');
          return;
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied</h2><p>You can close this tab.</p></body></html>');
          server.close();
          if (timeoutId) clearTimeout(timeoutId);
          clearActive();
          reject(new Error(`Auth denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing authorization code</h2></body></html>');
          return;
        }

        // Exchange code for tokens
        const port = server.address().port;
        const tokens = await exchangeCodeForTokens(code, codeVerifier, port);
        // The user may have cancelled while we were waiting on Google's
        // /token endpoint. Discard the tokens rather than silently
        // persist them — otherwise the next calendar poll would surface
        // a "ghost" connection seconds after the user said "Cancel".
        // Still respond to the open browser tab so it doesn't spin
        // forever — the request only ends when we write a body.
        if (isCancelled) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Cancelled</h2><p>You can close this tab.</p></body></html>');
          return;
        }
        saveGoogleTokens(tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Connected to Google Calendar</h2><p>You can close this tab and return to StenoAI.</p></body></html>');

        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        clearActive();

        // Notify renderer and bring app to foreground
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('google-auth-changed');
          mainWindow.show();
          mainWindow.focus();
        }

        resolve({ success: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>Please try again.</p></body></html>');
        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        clearActive();
        reject(err);
      }
    });

    // Listen on loopback only (security: not 0.0.0.0)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const authParams = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${GOOGLE_AUTH_URL}?${authParams.toString()}`;
      shell.openExternal(authUrl);
    });

    // 60s, not 5min. A real Google OAuth flow (consent + maybe MFA)
    // completes in seconds. The old 5-minute ceiling left users staring
    // at "Connecting…" for 5 full minutes if they closed the browser tab
    // — the inline Cancel button in the nudge mitigates this, but the
    // tighter ceiling is the safety net for users who walk away. The
    // org-SSO flow elsewhere in this file is a different beast and keeps
    // its own (longer) timeout.
    timeoutId = setTimeout(() => {
      if (server.listening) {
        // Set the closure flag BEFORE close+clear+reject so an in-flight
        // request handler (mid-await on exchangeCodeForTokens) sees the
        // cancellation when it resumes and discards the tokens instead
        // of writing them to disk. Without this, a race between Google's
        // /token response and our 60 s timeout produces a "ghost"
        // connection seconds after the user was told it timed out.
        isCancelled = true;
        server.close();
        clearActive();
        reject(new Error('Timed out — no response from Google.'));
      }
    }, 60 * 1000);
    activeGoogleAuth = {
      server,
      reject,
      timeoutId,
      markCancelled: () => { isCancelled = true; },
    };
  });
}

function exchangeCodeForTokens(code, codeVerifier, port) {
  return new Promise((resolve, reject) => {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const postData = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Token exchange failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          // Store expiry as absolute timestamp
          parsed.expires_at = Date.now() + (parsed.expires_in * 1000);
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Google Calendar: Token Refresh ──────────────────────────────────────

async function getValidAccessToken() {
  const tokens = loadGoogleTokens();
  if (!tokens) return null;

  // Check if token is expired or about to expire (5-min buffer)
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expires_at && Date.now() < tokens.expires_at - bufferMs) {
    return tokens.access_token;
  }

  // Token expired, try to refresh
  if (!tokens.refresh_token) {
    deleteGoogleTokens();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google-auth-changed');
    }
    return null;
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    // Preserve the refresh token (Google may not return it again)
    newTokens.refresh_token = newTokens.refresh_token || tokens.refresh_token;
    newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);
    saveGoogleTokens(newTokens);
    return newTokens.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    if (error.message && (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked'))) {
      deleteGoogleTokens();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('google-auth-changed');
      }
    }
    return null;
  }
}

function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Refresh failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse refresh response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Google Calendar: Fetch Events ───────────────────────────────────────

// 50 covers a busy week (~7/day) without bloating the response. The previous
// cap of 7 was set when the carousel showed top-3 today only — but a single
// all-day block + a few morning meetings would burn through the cap before
// noon, hiding everything past lunch. Renderer-side pagination + the "today
// only" filter handle the visual slicing; the fetch just needs to return
// enough raw events to draw from.
function fetchCalendarEvents(accessToken, maxResults = 50, signal) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: weekAhead.toISOString(),
      maxResults: String(maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
      fields: 'items(id,status,summary,description,start,end,attendees,htmlLink,conferenceData)'
    });

    const options = {
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/primary/events?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };
    if (signal) options.signal = signal;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Calendar API error: ${parsed.error.message || parsed.error}`));
            return;
          }
          resolve(parsed.items || []);
        } catch (err) {
          reject(new Error('Failed to parse calendar response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ── Outlook Calendar: OAuth2 Flow with PKCE ─────────────────────────────

// Mirror of activeGoogleAuth — see comment there.
let activeOutlookAuth = null;

function cancelActiveOutlookAuth() {
  if (!activeOutlookAuth) return false;
  const handle = activeOutlookAuth;
  activeOutlookAuth = null;
  if (handle.timeoutId) clearTimeout(handle.timeoutId);
  if (handle.markCancelled) handle.markCancelled();
  try { handle.server.close(); } catch (_) {}
  handle.reject(new Error('Cancelled'));
  return true;
}

function startOutlookAuth() {
  return new Promise((resolve, reject) => {
    cancelActiveOutlookAuth();

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    let timeoutId = null;
    let isCancelled = false;
    const clearActive = () => {
      if (activeOutlookAuth && activeOutlookAuth.server === server) {
        activeOutlookAuth = null;
      }
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost`);
        // Ignore favicon and other noise — only handle the root path
        if (reqUrl.pathname !== '/') {
          res.writeHead(404);
          res.end();
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        const returnedState = reqUrl.searchParams.get('state');

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Invalid state parameter</h2><p>Possible CSRF attack. Please try again.</p></body></html>');
          return;
        }

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied</h2><p>You can close this tab.</p></body></html>');
          server.close();
          if (timeoutId) clearTimeout(timeoutId);
          clearActive();
          reject(new Error(`Auth denied: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Missing authorization code</h2></body></html>');
          return;
        }

        const port = server.address().port;
        const tokens = await exchangeOutlookCodeForTokens(code, codeVerifier, port);
        // See the Google counterpart — discard tokens if the user
        // cancelled while we awaited Microsoft's /token endpoint, and
        // still send a response so the open browser tab doesn't hang.
        if (isCancelled) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Cancelled</h2><p>You can close this tab.</p></body></html>');
          return;
        }
        saveOutlookTokens(tokens);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family: -apple-system, sans-serif; text-align: center; padding: 60px;"><h2>Connected to Outlook Calendar</h2><p>You can close this tab and return to StenoAI.</p></body></html>');

        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        clearActive();

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('outlook-auth-changed');
          mainWindow.show();
          mainWindow.focus();
        }

        resolve({ success: true });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authentication failed</h2><p>Please try again.</p></body></html>');
        server.close();
        if (timeoutId) clearTimeout(timeoutId);
        clearActive();
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      // Use the literal IP we listen on. `localhost` resolves via the host
      // resolver, which a tampered /etc/hosts or local DNS could point
      // elsewhere — a low-but-not-zero risk for OAuth callback hijack on
      // shared dev machines. 127.0.0.1 bypasses name resolution entirely.
      const redirectUri = `http://127.0.0.1:${port}`;

      const authParams = new URLSearchParams({
        client_id: OUTLOOK_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: OUTLOOK_SCOPES,
        response_mode: 'query',
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `${OUTLOOK_AUTH_URL}?${authParams.toString()}`;
      shell.openExternal(authUrl);
    });

    // See the Google counterpart for the 60s-vs-5min rationale AND the
    // isCancelled-before-clearActive race fix.
    timeoutId = setTimeout(() => {
      if (server.listening) {
        isCancelled = true;
        server.close();
        clearActive();
        reject(new Error('Timed out — no response from Outlook.'));
      }
    }, 60 * 1000);
    activeOutlookAuth = {
      server,
      reject,
      timeoutId,
      markCancelled: () => { isCancelled = true; },
    };
  });
}

function exchangeOutlookCodeForTokens(code, codeVerifier, port) {
  return new Promise((resolve, reject) => {
    // Must match the redirect_uri used in startOutlookAuth's auth request.
    // See the comment there — bypass name resolution by using the IP literal.
    const redirectUri = `http://127.0.0.1:${port}`;
    const postData = new URLSearchParams({
      code,
      client_id: OUTLOOK_CLIENT_ID,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    }).toString();

    const tokenUrl = new URL(OUTLOOK_TOKEN_URL);
    const options = {
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Token exchange failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          parsed.expires_at = Date.now() + (parsed.expires_in * 1000);
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse token response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Outlook Calendar: Token Refresh ─────────────────────────────────────

async function getValidOutlookAccessToken() {
  const tokens = loadOutlookTokens();
  if (!tokens) return null;

  const bufferMs = 5 * 60 * 1000;
  if (tokens.expires_at && Date.now() < tokens.expires_at - bufferMs) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    deleteOutlookTokens();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('outlook-auth-changed');
    }
    return null;
  }

  try {
    const newTokens = await refreshOutlookAccessToken(tokens.refresh_token);
    newTokens.refresh_token = newTokens.refresh_token || tokens.refresh_token;
    newTokens.expires_at = Date.now() + (newTokens.expires_in * 1000);
    saveOutlookTokens(newTokens);
    return newTokens.access_token;
  } catch (error) {
    console.error('Outlook token refresh failed:', error.message);
    // Only delete tokens for irrecoverable errors (revoked/expired grant)
    // Transient network errors should not force re-authentication
    if (error.message && (error.message.includes('invalid_grant') || error.message.includes('interaction_required'))) {
      deleteOutlookTokens();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('outlook-auth-changed');
      }
    }
    return null;
  }
}

function refreshOutlookAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: OUTLOOK_SCOPES
    }).toString();

    const tokenUrl = new URL(OUTLOOK_TOKEN_URL);
    const options = {
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Refresh failed: ${parsed.error_description || parsed.error}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error('Failed to parse refresh response'));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ── Outlook Calendar: Fetch Events ──────────────────────────────────────

// Mirrors fetchCalendarEvents — 50 events to comfortably cover a week without
// clipping mid-day. See that function's comment for rationale.
function fetchOutlookCalendarEvents(accessToken, maxResults = 50, signal) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);

    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: weekAhead.toISOString(),
      $top: String(maxResults),
      $orderby: 'start/dateTime',
      $select: 'id,subject,body,start,end,attendees,webLink,onlineMeeting,isOnlineMeeting,isAllDay,isCancelled,responseStatus'
    });

    const options = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/me/calendarView?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'outlook.timezone="UTC"'
      }
    };
    if (signal) options.signal = signal;

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Outlook Calendar API error: ${parsed.error.message || parsed.error}`));
            return;
          }
          const events = (parsed.value || []).map(normalizeOutlookEvent);
          resolve(events);
        } catch (err) {
          reject(new Error('Failed to parse Outlook calendar response'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function normalizeOutlookEvent(event) {
  // Map Microsoft Graph event shape to Google Calendar shape for renderer compatibility
  const stripHtml = (html) => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|p|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/(\s*\n){3,}/g, '\n\n')
      .trim();
  };

  const ensureUtcSuffix = (dt) => {
    if (!dt) return undefined;
    return dt.endsWith('Z') ? dt : dt + 'Z';
  };

  // Map Outlook responseStatus.response → the common enum used downstream.
  // 'tentativelyAccepted' is the Outlook wire name for what Google calls 'tentative';
  // 'notResponded' maps to Google's 'needsAction'. 'none' / missing → 'unknown'
  // so the downstream filter defaults to "show" rather than guessing.
  const mapOutlookResponse = (r) => {
    switch (r) {
      case 'accepted': return 'accepted';
      case 'declined': return 'declined';
      case 'tentativelyAccepted': return 'tentative';
      case 'notResponded': return 'needsAction';
      case 'organizer': return 'organizer';
      default: return 'unknown';
    }
  };

  return {
    id: event.id,
    summary: event.subject || 'No title',
    description: stripHtml(event.body?.content),
    start: {
      dateTime: ensureUtcSuffix(event.start?.dateTime),
      timeZone: 'UTC'
    },
    end: {
      dateTime: ensureUtcSuffix(event.end?.dateTime),
      timeZone: 'UTC'
    },
    attendees: (event.attendees || []).map(a => ({
      email: a.emailAddress?.address || '',
      displayName: a.emailAddress?.name || '',
      responseStatus: a.status?.response || ''
    })),
    htmlLink: event.webLink,
    conferenceData: event.isOnlineMeeting && event.onlineMeeting ? {
      entryPoints: [{ uri: event.onlineMeeting.joinUrl, entryPointType: 'video' }]
    } : undefined,
    // Carried forward for normalizeCalendarEvent — Outlook reports these at the
    // top level so we don't need to inspect attendees to find "self".
    isAllDay: event.isAllDay === true,
    isCancelled: event.isCancelled === true,
    selfResponseStatus: mapOutlookResponse(event.responseStatus?.response)
  };
}

// ── Google Calendar: IPC Handlers ───────────────────────────────────────

ipcMain.handle('google-auth-start', async () => {
  try {
    await startGoogleAuth();
    // Only disconnect Outlook after Google auth succeeds
    deleteOutlookTokens();
    return { success: true };
  } catch (error) {
    console.error('Google auth failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('google-auth-status', async () => {
  try {
    const tokens = loadGoogleTokens();
    return { success: true, connected: !!tokens };
  } catch (error) {
    return { success: false, connected: false };
  }
});

ipcMain.handle('google-auth-cancel', async () => {
  const cancelled = cancelActiveGoogleAuth();
  return { success: true, cancelled };
});

ipcMain.handle('google-auth-disconnect', async () => {
  try {
    // Best-effort token revocation
    const tokens = loadGoogleTokens();
    if (tokens && tokens.access_token) {
      try {
        await new Promise((resolve) => {
          const revokeParams = new URLSearchParams({ token: tokens.access_token });
          const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path: `/revoke?${revokeParams.toString()}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }, () => resolve());
          req.on('error', () => resolve()); // Best-effort
          req.end();
        });
      } catch (e) {
        // Best-effort revocation -- ignore errors
      }
    }

    deleteGoogleTokens();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('google-auth-changed');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Map Google attendee.responseStatus → the common enum. Google uses the same
// strings as our enum for the four "real" states, so this is mostly identity.
function mapGoogleResponse(r) {
  switch (r) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'tentative': return 'tentative';
    case 'needsAction': return 'needsAction';
    default: return 'unknown';
  }
}

// Returns null for cancelled events so the caller can drop them. Google marks
// them with status === 'cancelled'; Outlook with isCancelled === true (carried
// through from normalizeOutlookEvent). Declined events are also dropped here —
// the renderer used to filter them client-side, but that left any new surface
// (notifications, auto-detection, future features) one bug away from showing
// a meeting the user explicitly said "no" to. Dropping at the IPC boundary
// makes "events" the authoritative "things the user is attending" list.
function normalizeCalendarEvent(event) {
  if (event.status === 'cancelled' || event.isCancelled === true) return null;

  const start =
    event.start?.dateTime ||
    event.start?.date ||
    (typeof event.start === 'string' ? event.start : '');
  const end =
    event.end?.dateTime ||
    event.end?.date ||
    (typeof event.end === 'string' ? event.end : '');

  // All-day events have date-only start/end ("YYYY-MM-DD") on Google. Outlook
  // carries an explicit flag through normalizeOutlookEvent.
  const isAllDay =
    event.isAllDay === true ||
    (!event.start?.dateTime && !!event.start?.date);

  // Self response. Outlook hands us the answer directly (top-level
  // responseStatus → carried through as selfResponseStatus). Google requires
  // finding the attendee with self === true; if there's no attendees list at
  // all the event is calendar-only (e.g. a self-blocked focus block) so treat
  // it as 'organizer' — show it, never label it as declined.
  let responseStatus = event.selfResponseStatus;
  if (!responseStatus) {
    if (Array.isArray(event.attendees) && event.attendees.length > 0) {
      const self = event.attendees.find((a) => a && a.self === true);
      if (self) {
        // A declined response wins over the organizer flag — if the user
        // organised a meeting and then later declined their own attendance
        // (Google lets you do this), we want the event dropped just like
        // any other declined invite. The previous short-circuit
        // (`self.organizer ? 'organizer' : …`) silently kept declined-by-
        // organizer events in the carousel.
        const raw = mapGoogleResponse(self.responseStatus);
        if (raw === 'declined') {
          responseStatus = 'declined';
        } else {
          responseStatus = self.organizer ? 'organizer' : raw;
        }
      } else {
        responseStatus = 'unknown';
      }
    } else {
      responseStatus = 'organizer';
    }
  }

  // Drop events the user explicitly declined — see function header comment.
  if (responseStatus === 'declined') return null;

  return {
    id: event.id,
    title: event.summary || event.title || 'No title',
    start,
    end,
    meeting_url:
      event.hangoutLink ||
      event.onlineMeeting?.joinUrl ||
      event.meeting_url ||
      undefined,
    is_all_day: isAllDay,
    response_status: responseStatus,
  };
}

ipcMain.handle('get-calendar-events', async () => {
  try {
    // Check which provider is connected (only one at a time)
    const googleToken = await getValidAccessToken();
    if (googleToken) {
      const raw = await fetchCalendarEvents(googleToken);
      return { success: true, events: raw.map(normalizeCalendarEvent).filter(Boolean) };
    }

    const outlookToken = await getValidOutlookAccessToken();
    if (outlookToken) {
      const raw = await fetchOutlookCalendarEvents(outlookToken);
      return { success: true, events: raw.map(normalizeCalendarEvent).filter(Boolean) };
    }

    return { success: false, needsAuth: true };
  } catch (error) {
    console.error('Failed to fetch calendar events:', error.message);
    return { success: false, error: error.message };
  }
});

// Pick the calendar event most likely to be the one the user is joining now.
// Match window:
//   - opens 5 min before the scheduled start (early-join grace)
//   - closes at the scheduled end, OR 10 min after start, whichever is later
// The 10-min floor only matters for meetings shorter than 10 min: a 5-min
// standup that overruns by a couple of minutes still matches when the user
// joins late. Long meetings are unaffected (their end is past start+10).
// Priority:
//   1. Genuinely in-progress (now within real [start, end))
//   2. Upcoming (start is still in the future) — soonest first
//   3. Recently ended but still within the late-floor — most recently ended
// (2) beats (3) so a short event that overran the floor cannot block the next
// real upcoming meeting.
// All-day events are skipped — their start is a date-only string ("YYYY-MM-DD")
// with no 'T' separator, spans midnight to midnight, and would mistag every
// meeting that day (e.g. "On vacation" appearing in every recording's title).
function pickCurrentCalendarEvent(events, now = new Date()) {
  const EARLY_GRACE_MS = 5 * 60 * 1000;
  const LATE_FLOOR_MS = 10 * 60 * 1000;
  const nowMs = now.getTime();
  const candidates = [];
  for (const e of events) {
    if (!e || typeof e.start !== 'string' || typeof e.end !== 'string') continue;
    if (!e.start.includes('T') || !e.end.includes('T')) continue;
    if (e.is_all_day === true) continue;
    if (e.response_status === 'declined') continue;
    const startMs = new Date(e.start).getTime();
    const endMs = new Date(e.end).getTime();
    if (!isFinite(startMs) || !isFinite(endMs)) continue;
    const closesAt = Math.max(endMs, startMs + LATE_FLOOR_MS);
    if (nowMs >= startMs - EARLY_GRACE_MS && nowMs < closesAt) {
      candidates.push({ event: e, startMs, endMs });
    }
  }
  if (candidates.length === 0) return null;

  const inProgress = candidates.filter((c) => c.startMs <= nowMs && nowMs < c.endMs);
  if (inProgress.length > 0) {
    inProgress.sort((a, b) => b.startMs - a.startMs);
    return inProgress[0].event;
  }
  const upcoming = candidates.filter((c) => c.startMs > nowMs);
  if (upcoming.length > 0) {
    upcoming.sort((a, b) => a.startMs - b.startMs);
    return upcoming[0].event;
  }
  candidates.sort((a, b) => b.endMs - a.endMs);
  return candidates[0].event;
}

// Fetches from whichever provider is connected, applies a hard timeout so a
// slow API never blocks the "Meeting detected" notification. The timeout
// aborts the in-flight request (via AbortController) so we don't leak the
// HTTPS request after fallback. Returns the matched event or null.
async function getCalendarEventForNow(timeoutMs = 1500) {
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let events = null;
    const googleToken = await getValidAccessToken();
    if (googleToken) {
      const raw = await fetchCalendarEvents(googleToken, 7, signal);
      events = raw.map(normalizeCalendarEvent).filter(Boolean);
    } else {
      const outlookToken = await getValidOutlookAccessToken();
      if (outlookToken) {
        const raw = await fetchOutlookCalendarEvents(outlookToken, 7, signal);
        events = raw.map(normalizeCalendarEvent).filter(Boolean);
      }
    }
    if (!events) return null;
    return pickCurrentCalendarEvent(events);
  } catch (err) {
    if (signal.aborted) {
      sendDebugLog(`[auto-detect] calendar lookup timed out after ${timeoutMs}ms`);
    } else {
      sendDebugLog(`[auto-detect] calendar lookup failed: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Outlook Calendar: IPC Handlers ──────────────────────────────────────

ipcMain.handle('outlook-auth-start', async () => {
  try {
    await startOutlookAuth();
    // Only disconnect Google after Outlook auth succeeds
    deleteGoogleTokens();
    return { success: true };
  } catch (error) {
    console.error('Outlook auth failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('outlook-auth-status', async () => {
  try {
    const tokens = loadOutlookTokens();
    return { success: true, connected: !!tokens };
  } catch (error) {
    return { success: false, connected: false };
  }
});

ipcMain.handle('outlook-auth-cancel', async () => {
  const cancelled = cancelActiveOutlookAuth();
  return { success: true, cancelled };
});

ipcMain.handle('outlook-auth-disconnect', async () => {
  try {
    deleteOutlookTokens();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('outlook-auth-changed');
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ─── Organisation adapter (enterprise mode) ──────────────────────────────────
// Talks to the customer's self-hosted Steno adapter for shared notes, AI
// proxying, and S3-backed artifacts. Session token + adapter URL are
// persisted with safeStorage; the renderer never sees the JWT directly,
// it goes through these IPC handlers.

function getOrgSessionPath() {
  return path.join(getUserDataDir(), '.org-session');
}

// Decode the JWT's payload segment and check whether it's already past its
// `exp` claim. The adapter signs with HS256 so we *cannot* verify the
// signature client-side, but the `exp` timestamp is the part the adapter
// itself enforces — if it's in the past, the next authenticated request
// will get a 401 anyway. Checking here lets org-status and the sidebar
// reflect reality without first having to make a request and watch it fail.
//
// We treat malformed/unparseable tokens as expired (defensive) so a corrupt
// session file kicks the user back to sign-in instead of leaving them in a
// "signed in but every request fails" limbo.
function decodeJwtExp(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch (_) {
    return null;
  }
}

function isJwtExpired(token) {
  const exp = decodeJwtExp(token);
  if (exp === null) return true;
  // 30-second skew buffer so a request fired right at the boundary doesn't
  // race the adapter to "valid → expired" mid-flight.
  return exp <= Math.floor(Date.now() / 1000) + 30;
}

function saveOrgSession(session) {
  try {
    const dir = path.dirname(getOrgSessionPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(session));
    fs.writeFileSync(getOrgSessionPath(), encrypted);
    orgSessionGeneration++;
    return true;
  } catch (e) {
    console.error('Failed to save org session:', e.message);
    return false;
  }
}

// Read the org session distinguishing the three states callers care about:
//   file missing        → { session: null, exists: false, decryptFailed: false }
//   present, unreadable → { session: null, exists: true,  decryptFailed: true  }
//   present, readable   → { session,      exists: true,  decryptFailed: false }
// The middle state matters: safeStorage.decryptString throws while the
// keychain is locked (right after wake / login, or a denied prompt after an
// app re-sign) — treating that like "signed out" is exactly what used to
// downgrade signed-in users to local AI via the stale-adapter recovery.
function loadOrgSessionEx() {
  const p = getOrgSessionPath();
  if (!fs.existsSync(p)) return { session: null, exists: false, decryptFailed: false };
  try {
    const encrypted = fs.readFileSync(p);
    return {
      session: JSON.parse(safeStorage.decryptString(encrypted)),
      exists: true,
      decryptFailed: false,
    };
  } catch (e) {
    console.error('Failed to load org session:', e.message);
    sendDebugLog(`org session present but unreadable (keychain locked?): ${e.message}`);
    return { session: null, exists: true, decryptFailed: true };
  }
}

function loadOrgSession() {
  return loadOrgSessionEx().session;
}

function clearOrgSession() {
  try {
    const p = getOrgSessionPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    orgSessionGeneration++;
    return true;
  } catch (e) {
    return false;
  }
}

// Persistent marker — survives sign-out, gets written on the FIRST successful
// org sign-in (password OR Google SSO). Used by the sidebar to decide whether
// to surface the "Sign in to org" CTA: personal users who never sign in see
// nothing; enterprise users get a one-click recovery path after their first
// connection. Empty file content; existence is the only signal.
function getOrgKnownMarkerPath() {
  return path.join(getUserDataDir(), '.org-known');
}

function markOrgKnown() {
  try {
    const p = getOrgKnownMarkerPath();
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
    return true;
  } catch (e) {
    console.error('Failed to write org-known marker:', e.message);
    return false;
  }
}

function hasOrgEverBeenSignedIn() {
  try {
    return fs.existsSync(getOrgKnownMarkerPath());
  } catch (_) {
    return false;
  }
}

// Tracks which summary files we've already auto-backed-up so an unshare
// sticks: once a note has been shared (manually or automatically), we never
// re-upload it. The state lives outside the meeting JSON so the meeting
// files stay byte-stable and the share/unshare cycle leaves no residue in
// the user's notes.
function getOrgBackupStatePath() {
  return path.join(getUserDataDir(), '.org-backup-state.json');
}

function loadOrgBackupState() {
  try {
    const p = getOrgBackupStatePath();
    if (!fs.existsSync(p)) return { attempts: {} };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' && raw.attempts ? raw : { attempts: {} };
  } catch (e) {
    console.error('Failed to load org backup state:', e.message);
    return { attempts: {} };
  }
}

function saveOrgBackupState(state) {
  try {
    const p = getOrgBackupStatePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save org backup state:', e.message);
    return false;
  }
}

function isOrgBackupAttempted(summaryFile) {
  const state = loadOrgBackupState();
  return Boolean(state.attempts[summaryFile]);
}

function recordOrgBackupAttempt(summaryFile, meetingId) {
  const state = loadOrgBackupState();
  state.attempts[summaryFile] = {
    attempted_at: new Date().toISOString(),
    meeting_id: meetingId || null,
  };
  return saveOrgBackupState(state);
}

function clearOrgBackupAttempt(summaryFile) {
  const state = loadOrgBackupState();
  if (!state.attempts[summaryFile]) return true;
  delete state.attempts[summaryFile];
  return saveOrgBackupState(state);
}

function getOrgBackupEntry(summaryFile) {
  const state = loadOrgBackupState();
  const entry = state.attempts[summaryFile];
  if (!entry) return { shared: false, meeting_id: null, attempted_at: null };
  return {
    shared: true,
    meeting_id: entry.meeting_id || null,
    attempted_at: entry.attempted_at || null,
  };
}

// Matches anything that looks like a loopback authority — covers
// `localhost`, `127.0.0.1`, IPv6 `::1` (bare or bracketed), with or
// without a port and/or path. Used to pick the right default scheme
// when the user types a hostname without one.
const _LOOPBACK_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)?(?:\/|$)/i;

function normaliseAdapterUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) {
    // No scheme provided. Default to https — the adapter is the holder of
    // org JWTs, AWS credentials, and the AI provider key; sending its
    // bearer tokens over plain http would expose them on the wire to any
    // network observer. Loopback addresses are the one documented dev
    // exception where http is fine because the traffic never leaves the
    // machine.
    const isLoopback = _LOOPBACK_HOST_RE.test(u);
    u = (isLoopback ? 'http://' : 'https://') + u;
  }
  return u.replace(/\/+$/, '');
}

async function adapterFetch(pathname, opts = {}) {
  const session = loadOrgSession();
  if (!session) throw new Error('not signed in to org adapter');
  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer ' + session.token,
    ...(opts.headers || {}),
  };
  const res = await fetch(session.adapterUrl + pathname, { ...opts, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text };
  }
  if (!res.ok) {
    if (res.status === 401) {
      // Server-side session revocation / token reuse / org removed our
      // user. Same response surface as a sign-out: clear the local
      // session AND restore the pre-adapter provider. Without the
      // restore, ai_provider stays on 'adapter' with no session, and
      // the next summarisation call errors out with "adapter not
      // configured". Fire-and-forget — the awaiting caller already
      // has an HTTP error to handle and shouldn't block on a Python
      // subprocess.
      clearOrgSession();
      restorePreAdapterProvider().catch(() => {});
    }
    const err = new Error(body.detail || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return body;
}

ipcMain.handle('org-status', async () => {
  const session = loadOrgSession();
  // Backfill the marker on first org-status hit when a session already
  // exists from before the marker code shipped — without this, anyone
  // who signed in on a previous build would lose the sidebar CTA on
  // their next sign-out / expiry because their session predates the
  // marker file. `everSignedIn` therefore treats "has live session OR
  // marker file" as equivalent past-sign-in proof.
  const knownBefore = hasOrgEverBeenSignedIn();
  if (session && !knownBefore) markOrgKnown();
  const everSignedIn = knownBefore || Boolean(session);
  if (!session) {
    // The session file may have vanished without a sign-out/expiry trigger
    // (crashed mid-sign-out, manual delete) while Python still says
    // 'adapter' — heal that here too, not just in get-ai-provider. The
    // reconcile no-ops on decrypt failures, so a locked keychain landing
    // in this branch changes nothing.
    reconcileAiProviderWithOrgSession().catch(() => {});
    return { signedIn: false, everSignedIn };
  }
  // Previously this returned signedIn:true as long as the session file
  // existed, even if the JWT had long since expired. The renderer would
  // happily show a "signed in" sticker until the user actually triggered
  // an authenticated request and got booted by a 401. Validate the JWT's
  // exp claim here so the UI reflects truth at startup.
  if (isJwtExpired(session.token)) {
    clearOrgSession();
    // If the user was on 'adapter', drop them back to 'local' so the next
    // summary attempt doesn't error out with "adapter not configured".
    // Same reasoning as the explicit-logout path; both end the session.
    restorePreAdapterProvider().catch(() => {});
    return { signedIn: false, everSignedIn };
  }
  // Hard lock: heal any provider drift while the session is valid.
  // Fire-and-forget — this handler is hot (the sidebar refetches it on
  // focus/mount) and must not block on a Python subprocess; the memoed
  // fast path makes repeated consistent checks free.
  reconcileAiProviderWithOrgSession().catch(() => {});
  return {
    signedIn: true,
    everSignedIn,
    // Surfaced so the renderer can schedule a precise setTimeout to
    // invalidate this query the instant the JWT expires — no polling,
    // no stale UI in the "app left open all day" case.
    exp: decodeJwtExp(session.token) ?? undefined,
    adapterUrl: session.adapterUrl,
    email: session.email,
    name: session.name,
    orgId: session.orgId,
  };
});

ipcMain.handle('org-login', async (_event, payload) => {
  try {
    const { adapterUrl, email, password } = payload || {};
    const url = normaliseAdapterUrl(adapterUrl);
    if (!url) return { success: false, error: 'adapter URL is required' };
    if (!email || !password) return { success: false, error: 'email and password are required' };
    const res = await fetch(url + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { detail: text };
    }
    if (!res.ok) return { success: false, error: body.detail || ('HTTP ' + res.status) };
    const session = {
      adapterUrl: url,
      token: body.token,
      email: body.email,
      name: body.name,
      orgId: body.org_id,
    };
    if (!saveOrgSession(session)) return { success: false, error: 'failed to persist session' };
    markOrgKnown();
    // Fire-and-forget — sign-in shouldn't wait on a config write.
    autoSwitchToAdapterOnSignIn().catch(() => {});
    return {
      success: true,
      signedIn: true,
      adapterUrl: url,
      email: body.email,
      name: body.name,
      orgId: body.org_id,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-logout', async () => {
  clearOrgSession();
  // Await the restore — the user just clicked sign-out and expects the
  // app to settle into the signed-out state before returning. If we
  // fire-and-forget here there's a race window where Python config
  // still says 'adapter' but the env vars are already gone, and any
  // AI op triggered in that window fails with "adapter not configured".
  // org-status's stale-session path stays fire-and-forget because that
  // handler is called frequently and any blocking would slow the UI.
  try {
    await restorePreAdapterProvider();
  } catch (_) {}
  return { success: true };
});

// ─── Google OIDC sign-in ─────────────────────────────────────────────────────
// Loopback-redirect OAuth flow for installed apps (RFC 8252):
//   1. Generate state + PKCE code_verifier locally.
//   2. Start a one-shot HTTP server on a random localhost port.
//   3. Ask the adapter to mint the Google authorize_url (it knows the
//      client_id; the client_secret never leaves the adapter).
//   4. Open the user's system browser. They sign in with Google; Google
//      redirects back to http://127.0.0.1:<port>/callback?code=...&state=...
//   5. Capture code + state, verify state, send (code, code_verifier,
//      redirect_uri) to the adapter's /callback. The adapter exchanges +
//      verifies the ID token + mints a session JWT in the same shape as
//      /auth/login.
//   6. Persist the session via the existing saveOrgSession path.
//
// Times out after 5 minutes of inactivity to avoid stranded servers.

function _ssoRandUrlSafe(bytes) {
  return crypto.randomBytes(bytes).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function _ssoCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function _ssoOpenLoopback() {
  // Returns { server, port, waitForCallback(state, timeoutMs) }. The callback
  // promise resolves with the validated `code`, or rejects on state mismatch /
  // user denial / timeout. Always closes the server on resolution.
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      let resolved = false;
      const waitForCallback = (state, timeoutMs = 5 * 60 * 1000) =>
        new Promise((res, rej) => {
          const timer = setTimeout(() => {
            cleanup();
            rej(new Error('SSO timed out waiting for browser callback'));
          }, timeoutMs);
          const cleanup = () => {
            clearTimeout(timer);
            if (!resolved) {
              resolved = true;
              try { server.close(); } catch (_) {}
            }
          };
          server.on('request', (req, sres) => {
            // We only care about the /callback path; ignore favicon etc.
            const u = new URL(req.url, `http://127.0.0.1:${port}`);
            if (u.pathname !== '/callback') {
              sres.writeHead(404).end('not found');
              return;
            }
            const code = u.searchParams.get('code');
            const cbState = u.searchParams.get('state');
            const error = u.searchParams.get('error');
            sres.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            if (error) {
              sres.end(
                `<html><body style="font:14px -apple-system;padding:40px">` +
                `Sign-in failed: <code>${String(error).slice(0, 80)}</code>. ` +
                `You can close this window.</body></html>`,
              );
              cleanup();
              rej(new Error(`Google returned error: ${error}`));
              return;
            }
            if (!code || cbState !== state) {
              sres.end(
                `<html><body style="font:14px -apple-system;padding:40px">` +
                `Sign-in failed: bad state or missing code. Close this window and retry.` +
                `</body></html>`,
              );
              cleanup();
              rej(new Error('Bad state or missing code on callback'));
              return;
            }
            sres.end(
              `<html><body style="font:14px -apple-system;padding:40px;color:#1B1B19;background:#FAF9F5">` +
              `<h2 style="font-family:Georgia,serif;font-weight:400;margin:0 0 8px">Signed in.</h2>` +
              `You can close this window and return to Steno.</body></html>`,
            );
            cleanup();
            res(code);
          });
        });
      resolve({ server, port, waitForCallback });
    });
  });
}

ipcMain.handle('org-sso-google-start', async (_event, payload) => {
  let loopback = null;
  try {
    const adapterUrl = normaliseAdapterUrl(payload && payload.adapterUrl);
    if (!adapterUrl) return { success: false, error: 'adapter URL is required' };

    // 1. PKCE + state.
    const codeVerifier = _ssoRandUrlSafe(64);
    const codeChallenge = _ssoCodeChallenge(codeVerifier);
    const state = _ssoRandUrlSafe(16);

    // 2. Open the loopback server. Keep the handle so any pre-callback
    //    failure (adapter /start 4xx, openExternal throws) can close it
    //    immediately instead of waiting for the 5-minute timeout to fire.
    loopback = await _ssoOpenLoopback();
    const { port, waitForCallback } = loopback;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    // 3. Ask the adapter to mint the authorize URL.
    const startRes = await fetch(adapterUrl + '/auth/sso/google/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        state,
      }),
    });
    const startBody = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      try { loopback.server.close(); } catch (_) {}
      return { success: false, error: startBody.detail || `HTTP ${startRes.status}` };
    }

    // 4. Open browser.
    await shell.openExternal(startBody.authorize_url);

    // 5. Wait for the callback (5-minute hard cap). waitForCallback closes
    //    the server itself on resolve/reject.
    const code = await waitForCallback(state, 5 * 60 * 1000);

    // 6. Exchange via the adapter.
    const cbRes = await fetch(adapterUrl + '/auth/sso/google/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    const cbBody = await cbRes.json().catch(() => ({}));
    if (!cbRes.ok) {
      return { success: false, error: cbBody.detail || `HTTP ${cbRes.status}` };
    }

    // 7. Persist + return same envelope as /org-login.
    const session = {
      adapterUrl,
      token: cbBody.token,
      email: cbBody.email,
      name: cbBody.name,
      orgId: cbBody.org_id,
    };
    if (!saveOrgSession(session)) return { success: false, error: 'failed to persist session' };
    markOrgKnown();
    // Fire-and-forget — sign-in shouldn't wait on a config write.
    autoSwitchToAdapterOnSignIn().catch(() => {});
    return {
      success: true,
      signedIn: true,
      adapterUrl,
      email: cbBody.email,
      name: cbBody.name,
      orgId: cbBody.org_id,
    };
  } catch (e) {
    // Any other throw (openExternal failed, etc.) — make sure the loopback
    // server isn't orphaned.
    if (loopback && loopback.server && loopback.server.listening) {
      try { loopback.server.close(); } catch (_) {}
    }
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-list-meetings', async () => {
  try {
    const body = await adapterFetch('/meetings');
    return { success: true, meetings: body.meetings || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-get-meeting', async (_event, id) => {
  try {
    const meeting = await adapterFetch('/meetings/' + encodeURIComponent(String(id)));
    return { success: true, meeting };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-create-meeting', async (_event, payload) => {
  try {
    const meeting = await adapterFetch('/meetings', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    return { success: true, meeting };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-delete-meeting', async (_event, id) => {
  try {
    const body = await adapterFetch('/meetings/' + encodeURIComponent(String(id)), {
      method: 'DELETE',
    });
    return { success: true, id: body.id };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Per-note share state lookup for the meeting detail page's Share/Unshare
// toggle. Reads the persistent `.org-backup-state.json` flag rather than
// transient UI state — so a note that was auto-backed-up at processing
// time, or shared from a different window, still reads as `shared: true`.
ipcMain.handle('org-get-backup-state', async (_event, summaryFile) => {
  try {
    if (!summaryFile) return { success: false, error: 'summaryFile is required' };
    return { success: true, ...getOrgBackupEntry(summaryFile) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Unshare by summary file. Reads the local backup-state for `summaryFile`,
// deletes the org-side meeting via the adapter (best-effort — 404 means
// it's already gone), then clears the local attempt flag so a subsequent
// Share / auto-share re-uploads instead of being skipped as already-attempted.
// Any non-404 adapter error aborts before we touch the local flag so the
// two stores can't desync (local says "not shared", org still has the
// meeting). If the local clear fails (disk full / permissions), we surface
// the failure rather than reporting success — otherwise the toggle would
// keep showing "Unshare" against an org that's already empty and the user
// would have no signal that they need to retry.
ipcMain.handle('org-unshare-by-summary', async (_event, summaryFile) => {
  try {
    if (!summaryFile) return { success: false, error: 'summaryFile is required' };
    const entry = getOrgBackupEntry(summaryFile);
    let adapterStatus = 'no-meeting-id';
    if (entry.meeting_id) {
      try {
        await adapterFetch('/meetings/' + encodeURIComponent(String(entry.meeting_id)), {
          method: 'DELETE',
        });
        adapterStatus = 'deleted';
      } catch (e) {
        if (e && e.status === 404) {
          adapterStatus = 'already-gone';
        } else {
          return { success: false, error: e.message };
        }
      }
    }
    if (!clearOrgBackupAttempt(summaryFile)) {
      return {
        success: false,
        error: 'unshared on the org but could not clear the local share flag — retry',
      };
    }
    return { success: true, meeting_id: entry.meeting_id, adapter_status: adapterStatus };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Three-step upload reused by both org-share-meeting and org-try-auto-backup:
// presign → PUT bytes to S3 → register meeting metadata with the s3_key.
// Throws on any failure; callers shape the IPC return value and persist
// attempt state. Centralised in main so the renderer doesn't have to do
// raw PUT (and so we can keep the bytes off the renderer when the bucket
// has stricter CORS).
async function uploadMeetingToOrg({ title, body, transcript = '', visibility = 'org' }) {
  const safeTitle = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';
  const filename = `${safeTitle}.md`;

  // Step 1: presign — adapter returns a 15-minute PUT URL + s3_key
  const presign = await adapterFetch('/uploads/presign', {
    method: 'POST',
    body: JSON.stringify({ filename, content_type: 'text/markdown' }),
  });

  // Step 2: PUT the markdown bytes straight to S3. Bucket has SSE-AES256
  // by default; the upload inherits that.
  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'content-type': 'text/markdown' },
    body,
  });
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '');
    throw new Error(`s3 upload failed (${putRes.status}): ${detail.slice(0, 200)}`);
  }

  // Step 2b (optional): second presign+PUT for the transcript when one was
  // supplied. Kept as a separate S3 object (rather than appended to the
  // markdown body) so the desktop can lazily render it in the floating
  // transcript panel instead of inline below the summary — matches the
  // local-note UX. Failure here is non-fatal: the body upload already
  // succeeded, so we POST /meetings without a transcript_s3_key rather
  // than orphan an S3 object after rolling everything back.
  let transcriptKey = null;
  const transcriptText = String(transcript || '').trim();
  if (transcriptText) {
    try {
      const tPresign = await adapterFetch('/uploads/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: `${safeTitle}.transcript.txt`,
          content_type: 'text/plain',
        }),
      });
      const tPut = await fetch(tPresign.upload_url, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: transcriptText,
      });
      if (tPut.ok) {
        transcriptKey = tPresign.s3_key;
      } else {
        const detail = await tPut.text().catch(() => '');
        console.warn(`transcript upload failed (${tPut.status}): ${detail.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(
        'transcript upload skipped:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Step 3: register metadata in the adapter. The body field is empty —
  // the adapter holds only the s3_key (+ optional transcript_s3_key) and
  // serves a presigned GET / inlined body when someone in the org opens
  // the note.
  const meeting = await adapterFetch('/meetings', {
    method: 'POST',
    body: JSON.stringify({
      title,
      body: '',
      visibility,
      s3_key: presign.s3_key,
      ...(transcriptKey ? { transcript_s3_key: transcriptKey } : {}),
    }),
  });

  return { meeting, s3_key: presign.s3_key, transcript_s3_key: transcriptKey };
}

ipcMain.handle('org-share-meeting', async (_event, payload) => {
  try {
    const { title, body, transcript, visibility = 'org', summaryFile } = payload || {};
    if (!title) return { success: false, error: 'title is required' };
    if (typeof body !== 'string') return { success: false, error: 'body is required' };

    const { meeting, s3_key } = await uploadMeetingToOrg({ title, body, transcript, visibility });
    // Mark this note as having been attempted so a later auto-backup
    // trigger (e.g. a reprocess that re-fires processing-complete)
    // doesn't push a second copy into the org.
    if (summaryFile) recordOrgBackupAttempt(summaryFile, meeting?.id);
    return { success: true, meeting, s3_key };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-get-auto-backup', async () => {
  try {
    const result = await runPythonScript('simple_recorder.py', ['get-org-auto-backup']);
    const jsonData = JSON.parse(result.trim());
    return { success: true, ...jsonData };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('org-set-auto-backup', async (_event, enabled) => {
  try {
    const result = await runPythonScript(
      'simple_recorder.py',
      ['set-org-auto-backup', enabled ? 'True' : 'False'],
    );
    const jsonMatch = result.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { success: true, org_auto_backup_enabled: enabled };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Single-shot auto-backup gateway. The renderer fires this once per
// processing-complete event; main does all the gating (signed in + toggle
// on + not previously attempted) so the renderer doesn't have to chain
// three IPC calls. Records the attempt only on a successful upload so a
// transient failure can self-heal next time. After a successful upload we
// mark the summary as attempted *permanently* — that's what makes unshare
// stick (the user pressed unshare, we won't re-push it without an explicit
// manual Share).
ipcMain.handle('org-try-auto-backup', async (_event, payload) => {
  try {
    const { summaryFile, title, body, transcript, visibility = 'org' } = payload || {};
    if (!summaryFile) return { attempted: false, reason: 'missing-summary-file' };
    if (!title) return { attempted: false, reason: 'missing-title' };
    if (typeof body !== 'string') return { attempted: false, reason: 'missing-body' };

    const session = loadOrgSession();
    if (!session) return { attempted: false, reason: 'not-signed-in' };

    // Fail closed: any error / unparseable output treats the toggle as
    // disabled. A privacy + sharing setting should never default ON via a
    // transient read failure — if the user enabled it, they can do so
    // again explicitly. The regex match guards against stray Python
    // stderr/stdout noise around the JSON payload.
    let enabled = false;
    try {
      const cfg = await runPythonScript('simple_recorder.py', ['get-org-auto-backup']);
      const jsonMatch = cfg.match(/\{.*\}/s);
      enabled = jsonMatch
        ? JSON.parse(jsonMatch[0])?.org_auto_backup_enabled !== false
        : false;
    } catch (_) {
      sendDebugLog('org-try-auto-backup: failed to read auto-backup pref, treating as disabled');
    }
    if (!enabled) return { attempted: false, reason: 'disabled' };

    if (isOrgBackupAttempted(summaryFile)) {
      return { attempted: false, reason: 'already-attempted' };
    }

    // Reuse the proven manual-share path verbatim. On failure we do NOT
    // record the attempt — leaves the door open for a retry next time
    // something pokes this path.
    try {
      const { meeting, s3_key } = await uploadMeetingToOrg({ title, body, transcript, visibility });
      recordOrgBackupAttempt(summaryFile, meeting?.id);
      return { attempted: true, meeting, s3_key };
    } catch (e) {
      return { attempted: false, reason: 'upload-failed', error: e.message };
    }
  } catch (e) {
    return { attempted: false, reason: 'error', error: e.message };
  }
});

ipcMain.handle('org-ai-chat', async (_event, payload) => {
  try {
    const body = await adapterFetch('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    return { success: true, ...body };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Streaming variant of /ai/chat. Renderer hands us a streamId; we forward
// chunks via the same query-chunk / query-done events the local Python
// stream uses, so the existing useStreamingQuery infra works unchanged.
const orgStreamAborters = new Map();

ipcMain.on('org-chat-stream', async (event, streamId, payload) => {
  const sender = event.sender;
  // Wrap every send through this guard — the renderer can be destroyed
  // (window close, hard reload) mid-stream, after which sender.send() will
  // throw "Object has been destroyed". We also abort the upstream HTTP
  // stream when the sender goes away so we stop pulling bytes from the
  // adapter for a renderer that no longer exists.
  const safeSend = (channel, payload) => {
    if (sender.isDestroyed()) return;
    try { sender.send(channel, payload); } catch (_) { /* destroyed mid-send */ }
  };

  const session = loadOrgSession();
  if (!session) {
    safeSend('query-done', { queryId: streamId, success: false, error: 'not signed in to org adapter' });
    return;
  }
  const controller = new AbortController();
  orgStreamAborters.set(streamId, controller);
  const onDestroyed = () => {
    try { controller.abort(); } catch (_) {}
  };
  sender.once('destroyed', onDestroyed);

  try {
    const res = await fetch(session.adapterUrl + '/ai/chat/stream', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + session.token,
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      if (res.status === 401) {
        // Same reasoning as the orgFetch 401 path above — clear the
        // session AND restore pre-adapter provider so future processing
        // doesn't hit "adapter not configured".
        clearOrgSession();
        restorePreAdapterProvider().catch(() => {});
      }
      safeSend('query-done', { queryId: streamId, success: false, error: `HTTP ${res.status}: ${detail.slice(0, 200)}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let success = true;
    let errorMsg = null;
    while (true) {
      if (sender.isDestroyed()) {
        try { controller.abort(); } catch (_) {}
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj;
        try { obj = JSON.parse(trimmed); } catch (_) { continue; }
        if (obj.type === 'chunk' && obj.text) {
          safeSend('query-chunk', { queryId: streamId, chunk: obj.text });
        } else if (obj.type === 'error') {
          success = false;
          errorMsg = obj.error;
        }
        // 'done' lines carry usage info; we don't surface it for now.
      }
    }
    safeSend('query-done', { queryId: streamId, success, error: errorMsg });
  } catch (e) {
    if (e.name === 'AbortError') {
      safeSend('query-done', { queryId: streamId, success: false, error: 'cancelled' });
    } else {
      safeSend('query-done', { queryId: streamId, success: false, error: e.message });
    }
  } finally {
    orgStreamAborters.delete(streamId);
    try { sender.removeListener('destroyed', onDestroyed); } catch (_) {}
  }
});

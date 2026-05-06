/**
 * Preload — contextBridge boundary for the React renderer.
 *
 * This is the only surface the renderer gets. Every function here is a thin
 * wrapper over ipcRenderer.invoke / .send / .on, whitelisted to the channels
 * listed in app/docs/ipc-contract.md. Any drift between this file and that
 * doc is a contract break — update both in the same commit.
 */

const { contextBridge, ipcRenderer } = require('electron');

const VERSION = 1;

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

// Every M→R event uses the same pattern: subscribe and return an unsubscribe
// fn. The wrapper strips the IpcRendererEvent so the renderer only sees the
// payload — that's an intentional part of the contract (renderer code must
// stay unaware of Electron internals).
const subscribe = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// Streaming helper. query-chunk + query-done are both multiplexed across
// every in-flight query; the helper filters by queryId so the caller only
// gets events for the stream they asked for. Returns an unsubscribe fn
// that also sends query-cancel to the main process.
const subscribeQueryStream = (queryId, { onChunk, onDone, onError } = {}) => {
  const chunkHandler = (_event, payload) => {
    if (payload && payload.queryId === queryId && onChunk) onChunk(payload.chunk);
  };
  const doneHandler = (_event, payload) => {
    if (!payload || payload.queryId !== queryId) return;
    cleanup();
    if (payload.success) {
      if (onDone) onDone();
    } else {
      if (onError) onError(new Error(payload.error || 'query failed'));
    }
  };
  const cleanup = () => {
    ipcRenderer.removeListener('query-chunk', chunkHandler);
    ipcRenderer.removeListener('query-done', doneHandler);
  };
  ipcRenderer.on('query-chunk', chunkHandler);
  ipcRenderer.on('query-done', doneHandler);
  return () => {
    cleanup();
    ipcRenderer.send('query-cancel', queryId);
  };
};

const stenoai = {
  version: VERSION,

  app: {
    getVersion: () => invoke('get-app-version'),
  },

  window: {
    focus: () => send('focus-window'),
    readyToShow: () => send('renderer-ready-to-show'),
  },

  shell: {
    openExternal: (url) => invoke('open-external', url),
  },

  system: {
    getStatus: () => invoke('get-status'),
    test: () => invoke('test-system'),
    clearState: () => invoke('clear-state'),
  },

  setup: {
    check: () => invoke('startup-setup-check'),
    systemCheck: () => invoke('setup-system-check'),
    ffmpeg: () => invoke('setup-ffmpeg'),
    python: () => invoke('setup-python'),
    ollamaAndModel: () => invoke('setup-ollama-and-model'),
    whisper: () => invoke('setup-whisper'),
    test: () => invoke('setup-test'),
    triggerWizard: () => invoke('trigger-setup-wizard'),
  },

  perm: {
    checkMicrophone: () => invoke('check-microphone-permission'),
    requestMicrophone: () => invoke('request-microphone-permission'),
  },

  recording: {
    start: (name) => invoke('start-recording-ui', name),
    stop: () => invoke('stop-recording-ui'),
    pause: () => invoke('pause-recording-ui'),
    resume: () => invoke('resume-recording-ui'),
    reportSystemAudioState: (active) => send('system-audio-recording-state', active),
    processSystemAudio: (filePath, name) => invoke('process-system-audio-recording', filePath, name),
    processFile: (filePath, name) => invoke('process-recording', filePath, name),
    pickAudioFile: () => invoke('select-audio-file'),
    getQueue: () => invoke('get-queue-status'),
    getDir: () => invoke('get-recordings-dir'),
  },

  meetings: {
    list: () => invoke('list-meetings'),
    update: (summaryFile, patch) => invoke('update-meeting', summaryFile, patch),
    revealFolder: (filePath) => invoke('reveal-meeting-folder', filePath),
    delete: (meeting) => invoke('delete-meeting', meeting),
    reprocess: (summaryFile, regenTitle, name) => invoke('reprocess-meeting', summaryFile, regenTitle, name),
    regenTitle: (summaryFile, name) => invoke('regen-meeting-title', summaryFile, name),
    saveNotes: (name, notes) => invoke('save-meeting-notes', name, notes),
  },

  query: {
    ask: (file, q) => invoke('query-transcript', file, q),
    askStream: (id, file, q) => send('query-transcript-stream', id, file, q),
    chatGlobalStream: (id, q, folderId) => send('chat-global-stream', id, q, folderId ?? null),
    cancel: (id) => send('query-cancel', id),
  },

  chat: {
    save: (data) => invoke('save-chat-sessions', data),
    load: () => invoke('load-chat-sessions'),
  },

  folders: {
    list: () => invoke('list-folders'),
    create: (name, color) => invoke('create-folder', name, color),
    rename: (id, name) => invoke('rename-folder', id, name),
    updateIcon: (id, icon) => invoke('update-folder-icon', id, icon),
    delete: (id) => invoke('delete-folder', id),
    reorder: (ids) => invoke('reorder-folders', ids),
    addMeeting: (summaryFile, folderId) => invoke('add-meeting-to-folder', summaryFile, folderId),
    removeMeeting: (summaryFile, folderId) => invoke('remove-meeting-from-folder', summaryFile, folderId),
  },

  models: {
    checkOllama: () => invoke('check-ollama-installed'),
    list: () => invoke('list-models'),
    getCurrent: () => invoke('get-current-model'),
    set: (name) => invoke('set-model', name),
    checkInstalled: (name) => invoke('check-model-installed', name),
    pull: (name) => invoke('pull-model', name),
  },

  settings: {
    getNotifications: () => invoke('get-notifications'),
    setNotifications: (v) => invoke('set-notifications', v),
    getTelemetry: () => invoke('get-telemetry'),
    setTelemetry: (v) => invoke('set-telemetry', v),
    getDockIcon: () => invoke('get-dock-icon'),
    setDockIcon: (v) => invoke('set-dock-icon', v),
    getSystemAudio: () => invoke('get-system-audio'),
    setSystemAudio: (v) => invoke('set-system-audio', v),
    getLanguage: () => invoke('get-language'),
    setLanguage: (code) => invoke('set-language', code),
    getUserName: () => invoke('get-user-name'),
    setUserName: (name) => invoke('set-user-name', name),
    getStoragePath: () => invoke('get-storage-path'),
    setStoragePath: (p) => invoke('set-storage-path', p),
    pickStorageFolder: () => invoke('select-storage-folder'),
    getAiPrompts: () => invoke('get-ai-prompts'),
  },

  ai: {
    getProvider: () => invoke('get-ai-provider'),
    setProvider: (p) => invoke('set-ai-provider', p),
    setRemoteOllamaUrl: (url) => invoke('set-remote-ollama-url', url),
    testRemoteOllama: (url) => invoke('test-remote-ollama', url),
    setCloudApiUrl: (url) => invoke('set-cloud-api-url', url),
    setCloudApiKey: (key) => invoke('set-cloud-api-key', key),
    setCloudProvider: (p) => invoke('set-cloud-provider', p),
    setCloudModel: (m) => invoke('set-cloud-model', m),
    testCloudApi: () => invoke('test-cloud-api'),
  },

  calendar: {
    google: {
      connect: () => invoke('google-auth-start'),
      status: () => invoke('google-auth-status'),
      disconnect: () => invoke('google-auth-disconnect'),
    },
    outlook: {
      connect: () => invoke('outlook-auth-start'),
      status: () => invoke('outlook-auth-status'),
      disconnect: () => invoke('outlook-auth-disconnect'),
    },
    getEvents: () => invoke('get-calendar-events'),
  },

  updates: {
    check: () => invoke('check-for-updates'),
    announcements: () => invoke('check-announcements'),
    openReleasePage: (url) => invoke('open-release-page', url),
    install: () => send('install-update'),
  },

  shortcuts: {
    rendererReady: () => send('shortcut-renderer-ready'),
  },

  dialog: {
    respondQuit: (confirmed) => send('quit-dialog-response', { confirmed }),
  },

  // All main-driven events. Every subscribe returns an unsubscribe fn.
  on: {
    debugLog: (cb) => subscribe('debug-log', cb),
    setupFlowTriggered: (cb) => subscribe('trigger-setup-flow', cb),
    toggleRecordingHotkey: (cb) => subscribe('toggle-recording-hotkey', cb),
    summaryChunk: (cb) => subscribe('summary-chunk', cb),
    summaryTitle: (cb) => subscribe('summary-title', cb),
    summaryComplete: (cb) => subscribe('summary-complete', cb),
    processingComplete: (cb) => subscribe('processing-complete', cb),
    queryChunk: (cb) => subscribe('query-chunk', cb),
    queryDone: (cb) => subscribe('query-done', cb),
    modelPullProgress: (cb) => subscribe('model-pull-progress', cb),
    modelPullComplete: (cb) => subscribe('model-pull-complete', cb),
    updateAvailable: (cb) => subscribe('update-available', cb),
    updateDownloadProgress: (cb) => subscribe('update-download-progress', cb),
    updateDownloaded: (cb) => subscribe('update-downloaded', cb),
    googleAuthChanged: (cb) => subscribe('google-auth-changed', cb),
    outlookAuthChanged: (cb) => subscribe('outlook-auth-changed', cb),
    shortcutStartRecording: (cb) => subscribe('shortcut-start-recording', cb),
    shortcutStopRecording: (cb) => subscribe('shortcut-stop-recording', cb),
    trayStartRecording: (cb) => subscribe('tray-start-recording', cb),
    trayStopRecording: (cb) => subscribe('tray-stop-recording', cb),
    trayOpenSettings: (cb) => subscribe('tray-open-settings', cb),
    showQuitDialog: (cb) => subscribe('show-quit-dialog', cb),
  },

  subscribeQueryStream,
};

contextBridge.exposeInMainWorld('stenoai', stenoai);

/**
 * Typed wrapper over `window.stenoai` — the contextBridge surface defined in
 * `app/preload.js`. All hooks/components talk to this module; no direct
 * `ipcRenderer` usage in renderer code.
 *
 * The source of truth for the shape is `app/docs/ipc-contract.md` + the
 * preload itself. When you change one, change the other in the same commit.
 */

// ---------- shared result envelope ----------
export type Result<T> = ({ success: true } & T) | { success: false; error: string };

// ---------- domain types ----------
export interface SessionInfo {
  name: string;
  summary_file: string;
  transcript_file?: string;
  audio_file?: string;
  processed_at?: string;
  updated_at?: string;
  duration_seconds?: number;
  folders?: string[];
}

export interface Meeting {
  session_info: SessionInfo;
  summary: string;
  participants?: unknown[];
  discussion_areas?: unknown[];
  key_points?: string[];
  action_items?: unknown[];
  transcript: string;
  is_diarised?: boolean;
  diarised_text?: string | null;
  folders?: string[];
  notes?: string;
  /** Synthetic flag set by the renderer for the in-progress recording. Never sent by backend. */
  is_recording?: boolean;
  /** Synthetic flag set by the renderer when a recording is in the processing pipeline (post-stop, pre-summary). */
  is_processing?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  order: number;
  icon?: string;
}

export interface ListedModel {
  name: string;
  displayName?: string;
  size_gb?: number;
  installed: boolean;
  current?: boolean;
  deprecated?: boolean;
  description?: string;
  speed?: string;
  quality?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees?: Array<{ email: string; name?: string }>;
  location?: string;
  meeting_url?: string;
  description?: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  action_url?: string;
  action_label?: string;
  min_version?: string;
  max_version?: string;
  dismissible?: boolean;
}

export interface UpdateMeetingPatch {
  name?: string;
  summary?: string;
  participants?: unknown[];
  key_points?: string[];
  action_items?: unknown[];
}

export interface ChatSessionsBlob {
  sessions: Array<{
    id: string;
    name: string;
    summaryFile?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
    createdAt: number;
    updatedAt: number;
  }>;
}

export type MicPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown';

export type AiProvider = 'local' | 'remote' | 'cloud';
export type CloudProvider = 'openai' | 'anthropic' | 'custom';

// ---------- response envelopes ----------
export type AppVersionResponse = Result<{ version: string; name: string }>;
export type StatusResponse = Result<{ status: string; details?: unknown }>;
export type SetupCheckResponse = Result<{
  allGood: boolean;
  checks: Array<[icon: string, label: string]>;
}>;

export type MicPermissionResponse = Result<{ status: MicPermissionStatus }>;
export type MicPermissionGrantResponse = Result<{ granted: boolean }>;

export type StartRecordingResponse = Result<{ message: string; sessionName?: string }>;
export type StopRecordingResponse = Result<{ message: string; sessionName?: string }>;
export type PauseRecordingResponse = Result<{ message: string }>;
export type ResumeRecordingResponse = Result<{ message: string }>;

export interface QueueStatus {
  success: true;
  isProcessing: boolean;
  queueSize: number;
  currentJob: string | null;
  hasRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  sessionName: string | null;
}

export type PickAudioFileResponse = Result<{ filePath: string }>;
export type RecordingsDirResponse = Result<{ path: string }>;

export type ListMeetingsResponse = Result<{ meetings: Meeting[] }>;
export type UpdateMeetingResponse = Result<{ message: string; updatedData: Meeting }>;
export type DeleteMeetingResponse = Result<{ message: string }>;
export type SaveMeetingNotesResponse = Result<{ path: string }>;

export type QueryResponse = Result<{ answer: string }>;
export type LoadChatSessionsResponse = Result<{ data: ChatSessionsBlob | null }>;

export type ListFoldersResponse = Result<{ folders: Folder[] }>;
export type CreateFolderResponse = Result<{ folder: Folder }>;

export type CheckOllamaResponse = Result<{ installed: boolean; path?: string }>;
export type CheckModelInstalledResponse = Result<{ installed: boolean }>;
export interface RawSupportedModel {
  name?: string;
  size?: string;
  params?: string;
  description?: string;
  speed?: string;
  quality?: string;
  deprecated?: boolean;
  installed?: boolean;
}

export type ListModelsResponse = Result<{
  supported_models: Record<string, RawSupportedModel>;
  current_model: string;
  provider: string;
}>;
export type GetCurrentModelResponse = Result<{ model: string }>;

export type GetNotificationsResponse = Result<{ notifications_enabled: boolean }>;
export type GetTelemetryResponse = Result<{ telemetry_enabled: boolean }>;
export type GetDockIconResponse = Result<{ hide_dock_icon: boolean }>;
export type GetSystemAudioResponse = Result<{ system_audio_enabled: boolean }>;
export type GetLanguageResponse = Result<{ language: string }>;
export type StoragePathResponse = Result<{
  storage_path: string | null;
  custom_path: string | null;
  default_path: string;
}>;
export type PickStorageFolderResponse = Result<{ folderPath: string }>;
export type GetAiPromptsResponse = Result<{ summarization: string }>;

export type GetAiProviderResponse = Result<{
  ai_provider: AiProvider;
  remote_ollama_url: string;
  cloud_api_url: string;
  cloud_provider: CloudProvider;
  cloud_model: string;
  cloud_api_key_set: boolean;
}>;

export type AuthStatusResponse = Result<{ connected: boolean }>;
export type GetCalendarEventsResponse =
  | { success: true; events: CalendarEvent[] }
  | { success: false; needsAuth: true }
  | { success: false; error: string };

export type CheckForUpdatesResponse = Result<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  downloadUrl: string | null;
}>;
export type CheckAnnouncementsResponse = Result<{
  announcements: Announcement[];
  currentVersion: string;
}>;

// ---------- event payloads ----------
export interface SummaryChunkEvent {
  chunk: string;
  sessionName: string;
}
export interface SummaryTitleEvent {
  title: string;
  sessionName: string;
}
export interface SummaryCompleteEvent {
  success: boolean;
  sessionName: string;
}
export interface ProcessingCompleteEvent {
  success: boolean;
  sessionName: string;
  message: string;
  meetingData?: Meeting;
}
export interface QueryChunkEvent {
  queryId: string;
  chunk: string;
}
export interface QueryDoneEvent {
  queryId: string;
  success: boolean;
  error?: string;
}
export interface ModelPullProgressEvent {
  model: string;
  progress: string;
}
export interface ModelPullCompleteEvent {
  model: string;
  success: boolean;
  error?: string;
}
export interface UpdateAvailableEvent {
  version: string;
}
export interface UpdateProgressEvent {
  percent: number;
}
export interface UpdateDownloadedEvent {
  version: string;
}
export interface ShortcutStartRecordingEvent {
  sessionName: string | null;
}

// ---------- bridge shape ----------
type RequestFn<Args extends unknown[], Res> = (...args: Args) => Promise<Res>;
type SendFn<Args extends unknown[]> = (...args: Args) => void;
type Subscribe<P = void> = (cb: (payload: P) => void) => () => void;

export interface StenoaiBridge {
  version: number;

  app: { getVersion: RequestFn<[], AppVersionResponse> };

  window: { focus: SendFn<[]>; readyToShow: SendFn<[]> };

  shell: {
    openExternal: RequestFn<[string], Result<Record<string, never>>>;
  };

  system: {
    getStatus: RequestFn<[], StatusResponse>;
    test: RequestFn<[], Result<Record<string, never>>>;
    clearState: RequestFn<[], Result<Record<string, never>>>;
  };

  setup: {
    check: RequestFn<[], SetupCheckResponse>;
    systemCheck: RequestFn<[], Result<Record<string, unknown>>>;
    ffmpeg: RequestFn<[], Result<Record<string, unknown>>>;
    python: RequestFn<[], Result<Record<string, unknown>>>;
    ollamaAndModel: RequestFn<[], Result<Record<string, unknown>>>;
    whisper: RequestFn<[], Result<Record<string, unknown>>>;
    test: RequestFn<[], Result<Record<string, unknown>>>;
    triggerWizard: RequestFn<[], Result<Record<string, unknown>>>;
  };

  perm: {
    checkMicrophone: RequestFn<[], MicPermissionResponse>;
    requestMicrophone: RequestFn<[], MicPermissionGrantResponse>;
  };

  recording: {
    start: RequestFn<[name?: string], StartRecordingResponse>;
    stop: RequestFn<[], StopRecordingResponse>;
    pause: RequestFn<[], PauseRecordingResponse>;
    resume: RequestFn<[], ResumeRecordingResponse>;
    reportSystemAudioState: SendFn<[active: boolean]>;
    processSystemAudio: RequestFn<[filePath: string, name: string], Result<{ message: string }>>;
    processFile: RequestFn<[filePath: string, name: string], Result<{ message: string }>>;
    pickAudioFile: RequestFn<[], PickAudioFileResponse>;
    getQueue: RequestFn<[], QueueStatus | { success: false; error: string }>;
    getDir: RequestFn<[], RecordingsDirResponse>;
  };

  meetings: {
    list: RequestFn<[], ListMeetingsResponse>;
    update: RequestFn<[summaryFile: string, patch: UpdateMeetingPatch], UpdateMeetingResponse>;
    revealFolder: RequestFn<[filePath: string], Result<Record<string, never>>>;
    delete: RequestFn<[meeting: Meeting], DeleteMeetingResponse>;
    reprocess: RequestFn<
      [summaryFile: string, regenTitle: boolean, name: string],
      Result<{ message: string }>
    >;
    saveNotes: RequestFn<[name: string, notes: string], SaveMeetingNotesResponse>;
    regenTitle: RequestFn<[summaryFile: string, name: string], Result<Record<string, never>>>;
  };

  query: {
    ask: RequestFn<[file: string, q: string], QueryResponse>;
    askStream: SendFn<[id: string, file: string, q: string]>;
    cancel: SendFn<[id: string]>;
  };

  chat: {
    save: RequestFn<[data: ChatSessionsBlob], Result<Record<string, never>>>;
    load: RequestFn<[], LoadChatSessionsResponse>;
  };

  folders: {
    list: RequestFn<[], ListFoldersResponse>;
    create: RequestFn<[name: string, color?: string], CreateFolderResponse>;
    rename: RequestFn<[id: string, name: string], Result<Record<string, never>>>;
    updateIcon: RequestFn<[id: string, icon: string], Result<Record<string, never>>>;
    delete: RequestFn<[id: string], Result<Record<string, never>>>;
    reorder: RequestFn<[ids: string[]], Result<Record<string, never>>>;
    addMeeting: RequestFn<
      [summaryFile: string, folderId: string],
      Result<Record<string, never>>
    >;
    removeMeeting: RequestFn<
      [summaryFile: string, folderId: string],
      Result<Record<string, never>>
    >;
  };

  models: {
    checkOllama: RequestFn<[], CheckOllamaResponse>;
    list: RequestFn<[], ListModelsResponse>;
    getCurrent: RequestFn<[], GetCurrentModelResponse>;
    set: RequestFn<[name: string], Result<Record<string, never>>>;
    checkInstalled: RequestFn<[name: string], CheckModelInstalledResponse>;
    pull: RequestFn<[name: string], Result<Record<string, never>>>;
  };

  settings: {
    getNotifications: RequestFn<[], GetNotificationsResponse>;
    setNotifications: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getTelemetry: RequestFn<[], GetTelemetryResponse>;
    setTelemetry: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getDockIcon: RequestFn<[], GetDockIconResponse>;
    setDockIcon: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getSystemAudio: RequestFn<[], GetSystemAudioResponse>;
    setSystemAudio: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getLanguage: RequestFn<[], GetLanguageResponse>;
    setLanguage: RequestFn<[code: string], Result<Record<string, never>>>;
    getStoragePath: RequestFn<[], StoragePathResponse>;
    setStoragePath: RequestFn<[p: string], Result<Record<string, never>>>;
    pickStorageFolder: RequestFn<[], PickStorageFolderResponse>;
    getAiPrompts: RequestFn<[], GetAiPromptsResponse>;
  };

  ai: {
    getProvider: RequestFn<[], GetAiProviderResponse>;
    setProvider: RequestFn<[p: AiProvider], Result<Record<string, never>>>;
    setRemoteOllamaUrl: RequestFn<[url: string], Result<Record<string, never>>>;
    testRemoteOllama: RequestFn<[url: string], Result<{ ok: boolean; message?: string }>>;
    setCloudApiUrl: RequestFn<[url: string], Result<Record<string, never>>>;
    setCloudApiKey: RequestFn<[key: string], Result<Record<string, never>>>;
    setCloudProvider: RequestFn<[p: CloudProvider], Result<Record<string, never>>>;
    setCloudModel: RequestFn<[m: string], Result<Record<string, never>>>;
    testCloudApi: RequestFn<[], Result<{ ok: boolean; message?: string }>>;
  };

  calendar: {
    google: {
      connect: RequestFn<[], Result<Record<string, never>>>;
      status: RequestFn<[], AuthStatusResponse>;
      disconnect: RequestFn<[], Result<Record<string, never>>>;
    };
    outlook: {
      connect: RequestFn<[], Result<Record<string, never>>>;
      status: RequestFn<[], AuthStatusResponse>;
      disconnect: RequestFn<[], Result<Record<string, never>>>;
    };
    getEvents: RequestFn<[], GetCalendarEventsResponse>;
  };

  updates: {
    check: RequestFn<[], CheckForUpdatesResponse>;
    announcements: RequestFn<[], CheckAnnouncementsResponse>;
    openReleasePage: RequestFn<[url: string], Result<Record<string, never>>>;
    install: SendFn<[]>;
  };

  shortcuts: {
    rendererReady: SendFn<[]>;
  };

  on: {
    debugLog: Subscribe<string>;
    setupFlowTriggered: Subscribe<unknown>;
    toggleRecordingHotkey: Subscribe<void>;
    summaryChunk: Subscribe<SummaryChunkEvent>;
    summaryTitle: Subscribe<SummaryTitleEvent>;
    summaryComplete: Subscribe<SummaryCompleteEvent>;
    processingComplete: Subscribe<ProcessingCompleteEvent>;
    queryChunk: Subscribe<QueryChunkEvent>;
    queryDone: Subscribe<QueryDoneEvent>;
    modelPullProgress: Subscribe<ModelPullProgressEvent>;
    modelPullComplete: Subscribe<ModelPullCompleteEvent>;
    updateAvailable: Subscribe<UpdateAvailableEvent>;
    updateDownloadProgress: Subscribe<UpdateProgressEvent>;
    updateDownloaded: Subscribe<UpdateDownloadedEvent>;
    googleAuthChanged: Subscribe<{ connected: boolean }>;
    outlookAuthChanged: Subscribe<{ connected: boolean }>;
    shortcutStartRecording: Subscribe<ShortcutStartRecordingEvent>;
    shortcutStopRecording: Subscribe<void>;
    trayStartRecording: Subscribe<void>;
    trayStopRecording: Subscribe<void>;
    trayOpenSettings: Subscribe<void>;
    showQuitDialog: Subscribe<{ type: 'recording' | 'processing'; jobCount?: number }>;
  };

  dialog: {
    respondQuit: SendFn<[confirmed: boolean]>;
  };

  subscribeQueryStream: (
    queryId: string,
    handlers: {
      onChunk?: (chunk: string) => void;
      onDone?: () => void;
      onError?: (err: Error) => void;
    }
  ) => () => void;
}

declare global {
  interface Window {
    stenoai: StenoaiBridge;
  }
}

/**
 * Accessor that asserts the bridge was actually installed. Throws a loud
 * error if the preload didn't run (e.g. someone forgot the contextIsolation
 * flag or loaded the renderer in a browser tab). Call this instead of
 * `window.stenoai.*` directly so bugs surface as messages, not
 * `Cannot read properties of undefined`.
 */
export function ipc(): StenoaiBridge {
  if (typeof window === 'undefined' || !window.stenoai) {
    throw new Error(
      '[ipc] window.stenoai is not defined — preload did not run. ' +
        'Check that main.js selected the new renderer webPreferences.'
    );
  }
  return window.stenoai;
}

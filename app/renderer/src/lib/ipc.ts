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
  /** Set when transcription crashed (e.g. an OOM): the recording was
   *  preserved instead of deleted and no real summary exists. The detail
   *  view renders an honest failure state instead of an empty note. */
  transcription_failed?: boolean;
  reprocessable?: boolean;
  error?: string;
  /** Set to false when the meeting has a transcript but notes were not
   *  generated automatically (auto-summarize off, #258). The detail view
   *  offers a "Generate notes" CTA instead of a blank/"no summary" state. */
  notes_generated?: boolean;
}

export interface Meeting {
  session_info: SessionInfo;
  summary: string;
  participants?: unknown[];
  discussion_areas?: unknown[];
  key_points?: string[];
  action_items?: unknown[];
  transcript?: string;
  is_diarised?: boolean;
  diarised_text?: string | null;
  folders?: string[];
  /** User notes as persisted + returned by the backend (`_parse_meeting_markdown` -> `user_notes`). */
  user_notes?: string | null;
  /** Renderer-side notes for the in-progress / draft recording (live + processing views). */
  notes?: string;
  reports?: Report[];
  active_report?: string;
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
  mlxTag?: string;
  mlxInstalled?: boolean;
  mlxSizeGb?: number;
  ggufInstalled?: boolean;
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
  is_all_day?: boolean;
  response_status?:
    | 'accepted'
    | 'declined'
    | 'tentative'
    | 'needsAction'
    | 'organizer'
    | 'unknown';
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

// ---------- Org adapter types ----------
export interface OrgUser {
  email: string;
  name: string;
  orgId: string;
}

export interface OrgStatusResponse {
  signedIn: boolean;
  adapterUrl?: string;
  email?: string;
  name?: string;
  orgId?: string;
  /** True if the user has *ever* successfully signed in to an org (on this
   *  install). Persists across sign-outs. Used by the sidebar to decide
   *  whether to surface the "Sign in to org" CTA — personal users who've
   *  never connected to an org don't see clutter; enterprise users get a
   *  one-click recovery path after their first connection. */
  everSignedIn?: boolean;
  /** JWT exp claim (Unix seconds). When signedIn, the renderer schedules a
   *  setTimeout to invalidate this query the instant the token expires —
   *  no polling, no stale UI. Absent on signed-out / malformed responses. */
  exp?: number;
}

export type OrgLoginResponse = Result<{
  signedIn: true;
  adapterUrl: string;
  email: string;
  name: string;
  orgId: string;
}>;

export interface OrgMeetingSummary {
  id: string;
  title: string;
  owner_email: string;
  org_id: string;
  visibility: 'private' | 'org';
  created_at: number;
  has_artifact: boolean;
  /** True when the shared note also has a transcript artifact in S3. Lets
   *  the list view show a "has transcript" affordance without GETting each
   *  meeting individually. */
  has_transcript: boolean;
}

export interface OrgMeeting extends OrgMeetingSummary {
  body: string;
  /** Inlined transcript content. Only present when the meeting was shared
   *  with a transcript (post-v0.3.0 adapter). Missing for older notes. */
  transcript_body?: string;
  download_url?: string;
}

export type OrgListMeetingsResponse = Result<{ meetings: OrgMeetingSummary[] }>;
export type OrgGetMeetingResponse = Result<{ meeting: OrgMeeting }>;

export interface OrgCreateMeetingPayload {
  title: string;
  body?: string;
  visibility?: 'private' | 'org';
  s3_key?: string | null;
}

export interface OrgShareMeetingPayload {
  title: string;
  body: string;
  /** Optional transcript content uploaded as a separate S3 object. Diarised
   *  text (with [You]/[Others] tags) is preferred when available; the
   *  desktop side decides which to send. Empty string skips the second
   *  upload entirely. */
  transcript?: string;
  visibility?: 'private' | 'org';
  /** When present, main records this summary as "backup attempted" so the
   *  auto-backup trigger won't push a duplicate copy on a later reprocess. */
  summaryFile?: string;
}

export type OrgShareMeetingResponse = Result<{ meeting: OrgMeeting; s3_key: string }>;

export interface OrgTryAutoBackupPayload {
  summaryFile: string;
  title: string;
  body: string;
  /** Optional transcript — same semantics as OrgShareMeetingPayload.transcript. */
  transcript?: string;
  visibility?: 'private' | 'org';
}

/** Result of the auto-backup gateway. `attempted` is true only if we
 *  actually performed an upload; otherwise `reason` tells the caller why
 *  we skipped (most are silent — only 'error' / 'upload-failed' surface
 *  in the UI). */
export type OrgTryAutoBackupResponse =
  | { attempted: true; meeting: OrgMeeting; s3_key: string }
  | {
      attempted: false;
      reason:
        | 'not-signed-in'
        | 'disabled'
        | 'already-attempted'
        | 'missing-summary-file'
        | 'missing-title'
        | 'missing-body'
        | 'upload-failed'
        | 'error';
      error?: string;
    };

export type GetOrgAutoBackupResponse = Result<{ org_auto_backup_enabled: boolean }>;
export type SetOrgAutoBackupResponse = Result<{ org_auto_backup_enabled: boolean }>;

/** Enterprise policy published by the adapter (GET /policy). The desktop
 *  honors these in the UI; the adapter also enforces shared_notes_enabled
 *  server-side (a disabled feature collapses /meetings to owner-only). */
export interface OrgPolicy {
  /** Initial on-state for the auto-backup toggle, seeded on first sign-in. */
  auto_share_default: boolean;
  /** When false, hide the Shared notes tab + cross-folder chat. */
  shared_notes_enabled: boolean;
}

export type GetOrgPolicyResponse = Result<{ policy: OrgPolicy }>;

export type OrgGetBackupStateResponse = Result<{
  shared: boolean;
  meeting_id: string | null;
  attempted_at: string | null;
  /** ISO timestamp of the last upload failure for this note, or null. Set
   *  independently of `shared` so a never-shared note can still report a
   *  failed backup attempt; cleared once a share/backup actually lands. */
  failed_at: string | null;
  /** Truncated error message from the last failed backup, or null. */
  error: string | null;
}>;

/** Outcome from `org.unshareBySummary`. `adapter_status` tells you which
 *  branch ran so the renderer can word the toast — `deleted` is the happy
 *  path, `already-gone` means the org-side meeting was 404 (someone else
 *  deleted it; we still clear the local flag), `no-meeting-id` means the
 *  local flag was orphaned with no `meeting_id` to delete. */
export type OrgUnshareBySummaryResponse = Result<{
  meeting_id: string | null;
  adapter_status: 'deleted' | 'already-gone' | 'no-meeting-id';
}>;

export interface OrgChatPayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  model?: string;
  max_tokens?: number;
}

export type OrgChatResponse = Result<{
  reply: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
}>;

export type MicPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown';

export type AiProvider = 'local' | 'remote' | 'cloud' | 'adapter';
export type CloudProvider = 'openai' | 'anthropic' | 'bedrock' | 'custom';

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
  /** Side-channel tracking for in-flight `reprocess-meeting` invocations,
   *  which don't go through `processingQueue` / `currentJob`. Populated
   *  by the reprocess IPC for the lifetime of each spawned Python
   *  subprocess and cleared in its finally block. Keyed by summaryFile
   *  in main so overlapping reprocesses coexist (e.g. user reprocesses A,
   *  navigates to B, reprocesses B before A finishes). Renderer consumers
   *  use this to flag the matching existing meeting rows as in-progress
   *  on Home. Empty array (not undefined) when no reprocess is active. */
  currentReprocesses: Array<{ summaryFile: string; sessionName: string | null }>;
  hasRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  sessionName: string | null;
}

export type PickAudioFileResponse = Result<{ filePath: string }>;
export type RecordingsDirResponse = Result<{ path: string }>;

export type ListMeetingsResponse = Result<{ meetings: Meeting[] }>;
export type GetMeetingResponse = Result<{ meeting: Meeting }>;
export type UpdateMeetingResponse = Result<{ message: string; updatedData: Meeting }>;
export type DeleteMeetingResponse = Result<{ message: string }>;
export type SaveMeetingNotesResponse = Result<{ path: string }>;

export type QueryResponse = Result<{ answer: string }>;
export type LoadChatSessionsResponse = Result<{ data: ChatSessionsBlob | null }>;

export type ListFoldersResponse = Result<{ folders: Folder[] }>;
export type CreateFolderResponse = Result<{ folder: Folder }>;

export type CheckOllamaResponse = Result<{ installed: boolean; path?: string }>;
export type CheckModelInstalledResponse = Result<{ installed: boolean }>;
export interface Template {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  language: string;
  format: 'structured' | 'markdown';
  builtin: boolean;
  locked: boolean;
}
export type ListTemplatesResponse = Result<{
  templates: Template[];
  default_template_id: string;
}>;
export type SaveTemplateResponse = Result<{ template: Template }>;

export interface Report {
  id: string;
  template_id: string;
  template_name: string;
  model: string;
  content: string;
  created_at: string;
}

export interface RawSupportedModel {
  name?: string;
  size?: string;
  params?: string;
  description?: string;
  speed?: string;
  quality?: string;
  deprecated?: boolean;
  installed?: boolean;
  // Distinct from `installed`, which is also true when only the NVFP4
  // sibling is present (see mlx_installed) -- this is specifically whether
  // the GGUF id itself was pulled, needed by anything that must not act on
  // a tag that was never actually downloaded (e.g. deleting it).
  gguf_installed?: boolean;
  mlx_tag?: string;
  mlx_installed?: boolean;
  // The NVFP4 blob's own size -- a different (often larger) download than
  // this entry's `size`, which describes the GGUF variant only.
  mlx_size?: string;
}

export type ListModelsResponse = Result<{
  supported_models: Record<string, RawSupportedModel>;
  current_model: string;
  provider: string;
}>;
export type GetCurrentModelResponse = Result<{ model: string }>;

// Deliberately NOT wrapped in Result<T>: Result<T> is `({ success: true } & T)`,
// and these responses already have their own `success` field, so wrapping would
// collapse both `success` fields into one (`true & boolean` narrows to `true`)
// and silently hide the real success/failure the caller needs to branch on.
// main.js's verify-model/delete-model handlers (Task 8) return the Python CLI's
// `{ success, error }` JSON verbatim, with no additional wrapping.
export type VerifyModelResponse = { success: boolean; error: string | null };
export type DeleteModelResponse = { success: boolean; error: string | null };
// model -> either its still-running progress string, or (done: true) its
// terminal outcome if it finished while nothing was around to consume the
// live model-pull-complete event (e.g. Settings was unmounted). Flat for the
// same reason as the two types above: main.js returns its in-memory maps
// verbatim, no Result<T> wrapping.
export type GetActivePullsResponse = Record<
  string,
  { progress?: string; done: boolean; success?: boolean; error?: string; cancelled?: boolean }
>;
export type CancelPullResponse = { success: boolean; error: string | null };

export type ListWhisperModelsResponse = Result<{
  supported_models: Record<string, RawSupportedModel>;
  current_model: string;
  provider: string;
}>;

export type ListParakeetModelsResponse = Result<{
  supported_models: Record<string, RawSupportedModel>;
  current_model: string;
  provider: string;
}>;

export type ParakeetStatusResponse = Result<{
  model: string;
  installed: boolean;
}>;

export type TranscriptionEngine = 'parakeet' | 'whisper';

export type GetTranscriptionEngineResponse = Result<{
  engine: TranscriptionEngine;
  valid_engines: TranscriptionEngine[];
}>;

export type GetNotificationsResponse = Result<{ notifications_enabled: boolean }>;
export type GetTelemetryResponse = Result<{
  telemetry_enabled: boolean;
  anonymous_id?: string;
}>;
export type GetDockIconResponse = Result<{ hide_dock_icon: boolean }>;
export type GetSystemAudioResponse = Result<{ system_audio_enabled: boolean }>;
export type GetAutoDetectMeetingsResponse = Result<{ auto_detect_meetings_enabled: boolean }>;
export type GetWhisperModelResponse = Result<{ whisper_model: string; supported_models: string[] }>;
export type GetKeepRecordingsResponse = Result<{ keep_recordings: boolean }>;

export type GetAutoSummarizeResponse = Result<{ auto_summarize_enabled: boolean }>;

export type GetSilenceAutoStopResponse = Result<{
  silence_auto_stop_enabled: boolean;
  silence_auto_stop_minutes: number;
  supported_minutes: number[];
}>;

export type SetSilenceAutoStopEnabledResponse = Result<{ silence_auto_stop_enabled: boolean }>;
export type SetSilenceAutoStopMinutesResponse = Result<{ silence_auto_stop_minutes: number }>;
export type GetLanguageResponse = Result<{ language: string }>;
export type GetUserNameResponse = Result<{ user_name: string }>;
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
  /** The local/remote Ollama summarisation model (config.model). */
  model: string;
  cloud_api_key_set: boolean;
  /** AWS region used as the Bedrock endpoint host (defaults to us-east-1). */
  bedrock_region: string;
  /** Optional cross-region inference profile id. Empty when unset. */
  bedrock_inference_profile: string;
  /** Curated list of Claude-on-Bedrock model ids surfaced as the dropdown. */
  bedrock_supported_models: string[];
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

// ---------- event payloads ----------
export interface ProcessingProgressEvent {
  line: string;
  // The meeting's summary file — its unique key — so a detail view can ignore
  // progress from a different meeting's concurrent reprocess. Uses the file path
  // (not the display name, which two meetings can share) for an exact match.
  summaryFile?: string;
}
export interface SummaryChunkEvent {
  chunk: string;
  sessionName: string;
  summaryFile?: string;
}
export interface SummaryTitleEvent {
  title: string;
  sessionName: string;
}
export interface SummaryCompleteEvent {
  success: boolean;
  sessionName: string;
  summaryFile?: string;
  /** True when this completion belongs to a template report generation rather
   *  than a reprocess. Lets the renderer suppress the reprocess/model-memory
   *  failure banner for report failures, independent of event ordering. */
  report?: boolean;
}
export interface ProcessingCompleteEvent {
  success: boolean;
  sessionName: string;
  message: string;
  meetingData?: Meeting;
  /** Populated by the reprocess flow (which doesn't carry a freshly-
   *  generated Meeting payload like the recording flow does). Lets the
   *  app-level cleanup find the matching streamCache entry to clear
   *  even when MeetingDetail unmounted mid-reprocess. */
  summaryFile?: string;
  /** Set when the backend gracefully marked a transcription crash: the
   *  audio was preserved and a reprocessable meeting was saved, so the
   *  flow still succeeds (success: true) but the renderer should surface
   *  the failure honestly rather than treat it as a normal note. */
  transcriptionFailed?: boolean;
  transcriptionError?: string;
  /** True when this is the terminal event of a template report generation
   *  (not a reprocess). The renderer rolls the stream back without the
   *  reprocess banner regardless of whether STREAM_ERROR or a non-zero exit
   *  ended it. */
  report?: boolean;
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
  cancelled?: boolean;
}
export interface WhisperPullProgressEvent {
  model: string;
  progress: string;
}
export interface WhisperPullCompleteEvent {
  model: string;
  success: boolean;
  error?: string;
}
export interface ParakeetPullProgressEvent {
  /** Present on pull-parakeet-model invocations; omitted on
   *  setup-parakeet (which downloads the default model with no id arg). */
  model?: string | null;
  stage: 'downloading' | 'loading' | string;
}
export interface ParakeetPullCompleteEvent {
  model?: string | null;
  success: boolean;
  error?: string;
}

// ---------- live transcript ----------
export interface LiveSegment {
  text: string;
  start: number;
  end: number;
  /** True once Parakeet has frozen this sentence — subsequent pushes will
   *  start a new partial. False means the segment is the trailing partial
   *  and may be replaced by the next event. */
  isFinal: boolean;
  /** Speaker attribution from the per-channel RMS comparison performed
   *  client-side when the segment arrives. 'You' / 'Others' / undefined
   *  when the mic-only path is active (no system channel to compare). */
  speaker?: 'You' | 'Others';
}

export type LiveTranscriptStateResponse = Result<{
  sessionName: string | null;
  segments: LiveSegment[];
  /** True once the Python side has loaded the Parakeet model. Before this
   *  flips, the UI should show a model-loading state instead of an empty
   *  "no speech yet" panel — the difference matters for first-launch UX. */
  ready: boolean;
  /** Last failure reported by the consumer thread, if any. Null on success. */
  error: { stage: string; error?: string; message?: string } | null;
}>;

export interface LiveTranscriptReadyEvent {
  sessionName: string;
}

export interface LiveTranscriptChunkEvent {
  sessionName: string;
  segment: LiveSegment;
}

export interface LiveTranscriptErrorEvent {
  sessionName: string;
  stage: string;
  error?: string;
  message?: string;
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
    parakeet: RequestFn<[], Result<Record<string, unknown>>>;
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
    /** Hint that a recording may be imminent so main can re-warm the Parakeet
     *  model. Throttled main-side. Fire-and-forget. */
    hintWarmup: SendFn<[]>;
    enableLoopbackAudio: RequestFn<[], void>;
    disableLoopbackAudio: RequestFn<[], void>;
    getSystemAudioSupport: RequestFn<
      [],
      Result<{
        supported: boolean;
        osVersion: string;
        screenPermission: string;
        experimental?: boolean;
        platform?: string;
      }>
    >;
    /** Open an on-disk WebM file for the renderer-driven recording. Chunks are
     *  appended as they arrive (see appendSystemAudioChunk) so a crash leaves a
     *  processable file instead of losing the whole recording. */
    openSystemAudioFile: RequestFn<[name: string], Result<{ filePath: string }>>;
    appendSystemAudioChunk: RequestFn<[bytes: Uint8Array], Result<Record<string, never>>>;
    closeSystemAudioFile: RequestFn<[], Result<{ filePath: string }>>;
    /** Report a renderer-side capture failure so main can surface a native
     *  notification (a failed start would otherwise be silent). Fire-and-forget. */
    reportCaptureError: SendFn<[message: string]>;
    processSystemAudio: RequestFn<[filePath: string, name: string], Result<{ message: string }>>;
    // Fire-and-forget: the handler copies the file into recordings/ and queues
    // it (addToProcessingQueue), then resolves immediately with no payload —
    // it does NOT wait for transcription. Progress shows as a processing row.
    processFile: RequestFn<[filePath: string, name: string], Result<Record<string, never>>>;
    pickAudioFile: RequestFn<[], PickAudioFileResponse>;
    /** Resolve a dropped File's absolute path (Electron 32+ removed File.path). Synchronous. */
    getPathForFile: (file: File) => string;
    getQueue: RequestFn<[], QueueStatus | { success: false; error: string }>;
    getDir: RequestFn<[], RecordingsDirResponse>;
  };

  liveTranscript: {
    getState: RequestFn<[], LiveTranscriptStateResponse>;
    pushChunk: SendFn<[bytes: ArrayBuffer | Uint8Array]>;
    stop: SendFn<[]>;
  };

  meetings: {
    list: RequestFn<[], ListMeetingsResponse>;
    get: RequestFn<[summaryFile: string], GetMeetingResponse>;
    update: RequestFn<[summaryFile: string, patch: UpdateMeetingPatch], UpdateMeetingResponse>;
    revealFolder: RequestFn<[filePath: string], Result<Record<string, never>>>;
    delete: RequestFn<[meeting: Meeting], DeleteMeetingResponse>;
    reprocess: RequestFn<
      [summaryFile: string, regenTitle: boolean, name: string],
      Result<{ message: string }>
    >;
    saveNotes: RequestFn<[name: string, notes: string], SaveMeetingNotesResponse>;
    exportTranscript: RequestFn<[defaultFilename: string, content: string], Result<{ path: string }>>;
    regenTitle: RequestFn<[summaryFile: string, name: string], Result<Record<string, never>>>;
    generateReport: RequestFn<[summaryFile: string, templateId: string], Result<{ message: string }>>;
    setActiveReport: RequestFn<[summaryFile: string, reportId: string], Result<Record<string, never>>>;
    deleteReport: RequestFn<[summaryFile: string, reportId: string], Result<Record<string, never>>>;
  };

  query: {
    ask: RequestFn<[file: string, q: string], QueryResponse>;
    askStream: SendFn<[id: string, file: string, q: string]>;
    chatGlobalStream: SendFn<[id: string, q: string, folderId?: string | null]>;
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

  templates: {
    list: RequestFn<[], ListTemplatesResponse>;
    save: RequestFn<[t: Partial<Template>], SaveTemplateResponse>;
    remove: RequestFn<[id: string], Result<Record<string, never>>>;
    setDefault: RequestFn<[id: string], Result<Record<string, never>>>;
    reset: RequestFn<[id: string], Result<Record<string, never>>>;
  };

  models: {
    checkOllama: RequestFn<[], CheckOllamaResponse>;
    list: RequestFn<[], ListModelsResponse>;
    getCurrent: RequestFn<[], GetCurrentModelResponse>;
    set: RequestFn<[name: string], Result<Record<string, never>>>;
    checkInstalled: RequestFn<[name: string], CheckModelInstalledResponse>;
    pull: RequestFn<[name: string], Result<Record<string, never>>>;
    cancelPull: RequestFn<[name: string], CancelPullResponse>;
    verify: RequestFn<[name: string], VerifyModelResponse>;
    delete: RequestFn<[name: string], DeleteModelResponse>;
    getActivePulls: RequestFn<[], GetActivePullsResponse>;
    ackPullComplete: SendFn<[name: string]>;
  };

  whisperModels: {
    list: RequestFn<[], ListWhisperModelsResponse>;
    set: RequestFn<[name: string], Result<Record<string, never>>>;
    pull: RequestFn<[name: string], Result<Record<string, never>>>;
  };

  parakeetModels: {
    list: RequestFn<[], ListParakeetModelsResponse>;
    pull: RequestFn<[id?: string | null], Result<{ model?: string; already_installed?: boolean }>>;
    status: RequestFn<[], ParakeetStatusResponse>;
  };

  transcriptionEngine: {
    get: RequestFn<[], GetTranscriptionEngineResponse>;
    set: RequestFn<[engine: TranscriptionEngine], Result<{ engine: TranscriptionEngine }>>;
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
    getAutoDetectMeetings: RequestFn<[], GetAutoDetectMeetingsResponse>;
    setAutoDetectMeetings: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getWhisperModel: RequestFn<[], GetWhisperModelResponse>;
    setWhisperModel: RequestFn<[model: string], Result<Record<string, never>>>;
    getKeepRecordings: RequestFn<[], GetKeepRecordingsResponse>;
    setKeepRecordings: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getAutoSummarize: RequestFn<[], GetAutoSummarizeResponse>;
    setAutoSummarize: RequestFn<[v: boolean], Result<Record<string, never>>>;
    getSilenceAutoStop: RequestFn<[], GetSilenceAutoStopResponse>;
    setSilenceAutoStopEnabled: RequestFn<[v: boolean], SetSilenceAutoStopEnabledResponse>;
    setSilenceAutoStopMinutes: RequestFn<[v: number], SetSilenceAutoStopMinutesResponse>;
    showSilenceAutoStopNotification: RequestFn<
      [payload: { minutes: number; sessionName: string | null }],
      Result<Record<string, never>>
    >;
    showNoteReadyNotification: RequestFn<
      [payload: { title: string; failed?: boolean; hardFailure?: boolean }],
      Result<Record<string, never>>
    >;
    /** Design-for-test seam for the pre-meeting notification (production fire
     *  path is the main-side scheduler). Returns `shown` for the gate/suppression. */
    showPremeetingNotification: RequestFn<
      [payload: { event: { id: string; title?: string } }],
      Result<{ shown?: boolean }>
    >;
    getLanguage: RequestFn<[], GetLanguageResponse>;
    setLanguage: RequestFn<[code: string], Result<Record<string, never>>>;
    getUserName: RequestFn<[], GetUserNameResponse>;
    setUserName: RequestFn<[name: string], Result<Record<string, never>>>;
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
    setBedrockRegion: RequestFn<[region: string], Result<Record<string, never>>>;
    setBedrockInferenceProfile: RequestFn<[profile: string], Result<Record<string, never>>>;
    testCloudApi: RequestFn<[], Result<{ models?: string[] }>>;
  };

  calendar: {
    google: {
      connect: RequestFn<[], Result<Record<string, never>>>;
      cancel: RequestFn<[], Result<{ cancelled: boolean }>>;
      status: RequestFn<[], AuthStatusResponse>;
      disconnect: RequestFn<[], Result<Record<string, never>>>;
    };
    outlook: {
      connect: RequestFn<[], Result<Record<string, never>>>;
      cancel: RequestFn<[], Result<{ cancelled: boolean }>>;
      status: RequestFn<[], AuthStatusResponse>;
      disconnect: RequestFn<[], Result<Record<string, never>>>;
    };
    getEvents: RequestFn<[], GetCalendarEventsResponse>;
  };

  updates: {
    check: RequestFn<[], CheckForUpdatesResponse>;
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
    processingProgress: Subscribe<ProcessingProgressEvent>;
    queryChunk: Subscribe<QueryChunkEvent>;
    queryDone: Subscribe<QueryDoneEvent>;
    modelPullProgress: Subscribe<ModelPullProgressEvent>;
    modelPullComplete: Subscribe<ModelPullCompleteEvent>;
    whisperPullProgress: Subscribe<WhisperPullProgressEvent>;
    whisperPullComplete: Subscribe<WhisperPullCompleteEvent>;
    parakeetPullProgress: Subscribe<ParakeetPullProgressEvent>;
    parakeetPullComplete: Subscribe<ParakeetPullCompleteEvent>;
    liveTranscriptReady: Subscribe<LiveTranscriptReadyEvent>;
    liveTranscriptChunk: Subscribe<LiveTranscriptChunkEvent>;
    liveTranscriptError: Subscribe<LiveTranscriptErrorEvent>;
    updateAvailable: Subscribe<UpdateAvailableEvent>;
    updateDownloadProgress: Subscribe<UpdateProgressEvent>;
    updateDownloaded: Subscribe<UpdateDownloadedEvent>;
    googleAuthChanged: Subscribe<{ connected: boolean }>;
    outlookAuthChanged: Subscribe<{ connected: boolean }>;
    shortcutStartRecording: Subscribe<ShortcutStartRecordingEvent>;
    shortcutStopRecording: Subscribe<void>;
    trayStartRecording: Subscribe<void>;
    trayStopRecording: Subscribe<void>;
    autoRecordRequested: Subscribe<{ sessionName?: string; appName?: string }>;
    autoPauseRequested: Subscribe<void>;
    autoResumeRequested: Subscribe<void>;
    autoSummariseRequested: Subscribe<void>;
    trayOpenSettings: Subscribe<void>;
    showQuitDialog: Subscribe<{ type: 'recording' | 'processing'; jobCount?: number }>;
  };

  org: {
    status: RequestFn<[], OrgStatusResponse>;
    login: RequestFn<[adapterUrl: string, email: string, password: string], OrgLoginResponse>;
    ssoGoogleStart: RequestFn<[adapterUrl: string], OrgLoginResponse>;
    logout: RequestFn<[], Result<Record<string, never>>>;
    listMeetings: RequestFn<[], OrgListMeetingsResponse>;
    getMeeting: RequestFn<[id: string], OrgGetMeetingResponse>;
    createMeeting: RequestFn<[payload: OrgCreateMeetingPayload], OrgGetMeetingResponse>;
    deleteMeeting: RequestFn<[id: string], Result<{ id: string }>>;
    shareMeeting: RequestFn<[payload: OrgShareMeetingPayload], OrgShareMeetingResponse>;
    getBackupState: RequestFn<[summaryFile: string], OrgGetBackupStateResponse>;
    unshareBySummary: RequestFn<[summaryFile: string], OrgUnshareBySummaryResponse>;
    getAutoBackup: RequestFn<[], GetOrgAutoBackupResponse>;
    setAutoBackup: RequestFn<[enabled: boolean], SetOrgAutoBackupResponse>;
    getPolicy: RequestFn<[], GetOrgPolicyResponse>;
    tryAutoBackup: RequestFn<[payload: OrgTryAutoBackupPayload], OrgTryAutoBackupResponse>;
    aiChat: RequestFn<[payload: OrgChatPayload], OrgChatResponse>;
    chatStream: SendFn<[streamId: string, payload: OrgChatPayload]>;
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

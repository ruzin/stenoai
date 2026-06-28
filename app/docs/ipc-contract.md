# IPC Contract — StenoAI

This document is the **canonical inventory** of every IPC surface between the
Electron main process (`app/main.js`) and the renderer. Phase 1's `preload.js`
will implement exactly what is listed here, exposed through
`window.stenoai.*` — nothing more.

> **Rule.** Any PR that adds, removes, or changes an IPC channel must update
> this doc in the same commit. Mismatches between `main.js` and this doc are
> the contract break we are explicitly protecting against by keeping the doc
> authoritative.

## Legend

- **Direction**
  - `R→M (invoke)` — `ipcRenderer.invoke(...)` → `ipcMain.handle(...)` request/response
  - `R→M (send)` — `ipcRenderer.send(...)` → `ipcMain.on(...)` fire-and-forget
  - `M→R` — `webContents.send(...)` → `ipcRenderer.on(...)` main-driven event
  - `R-direct` — synchronous renderer-side call with no IPC hop (an Electron renderer API such as `webUtils` exposed through the bridge). Not every bridge method is an IPC channel.
- **Needed** — whether the new (React) renderer needs the channel.
  - `yes` — keep and port
  - `drop` — remove (dead listener, unused in renderer, or main-only concern)
  - `main-only` — main still uses the channel (e.g. auto-updater) but no renderer API is exposed
- Every invoke response conforms to `{ success: boolean; error?: string; ... }`
  unless explicitly documented otherwise.

---

## 1. Status, setup, and app info

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `get-status` | R→M invoke | yes | `stenoai.system.getStatus()` |
| `test-system` | R→M invoke | yes | `stenoai.system.test()` |
| `clear-state` | R→M invoke | yes | `stenoai.system.clearState()` |
| `startup-setup-check` | R→M invoke | yes | `stenoai.setup.check()` |
| `setup-system-check` | R→M invoke | yes | `stenoai.setup.systemCheck()` |
| `setup-ffmpeg` | R→M invoke | yes | `stenoai.setup.ffmpeg()` |
| `setup-python` | R→M invoke | yes | `stenoai.setup.python()` |
| `setup-ollama-and-model` | R→M invoke | yes | `stenoai.setup.ollamaAndModel()` |
| `setup-whisper` | R→M invoke | yes | `stenoai.setup.whisper()` |
| `setup-parakeet` | R→M invoke | yes | `stenoai.setup.parakeet()` |
| `setup-test` | R→M invoke | yes | `stenoai.setup.test()` |
| `trigger-setup-wizard` | R→M invoke | yes | `stenoai.setup.triggerWizard()` |
| `trigger-setup-flow` | M→R | yes | `stenoai.on.setupFlowTriggered(cb)` |
| `get-app-version` | R→M invoke | yes | `stenoai.app.getVersion()` |
| `check-microphone-permission` | R→M invoke | yes | `stenoai.perm.checkMicrophone()` |
| `request-microphone-permission` | R→M invoke | yes | `stenoai.perm.requestMicrophone()` |
| `focus-window` | R→M send | yes | `stenoai.window.focus()` |
| `debug-log` | M→R | yes | `stenoai.on.debugLog(cb)` |

```ts
type Result<T> = ({ success: true } & T) | { success: false; error: string };

type StatusResponse = Result<{ status: string; details?: unknown }>;

type SetupCheckResponse = Result<{
  allGood: boolean;
  checks: Array<[icon: string, label: string]>;
}>;

type AppVersionResponse = Result<{ version: string; name: string }>;

type MicPermissionStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
type MicPermissionResponse = Result<{ status: MicPermissionStatus }>;
type MicPermissionGrantResponse = Result<{ granted: boolean }>;
```

---

## 2. Recording (live)

Two flavors. `start-recording` / `stop-recording` are the classic synchronous
CLI pair. `start-recording-ui` / `stop-recording-ui` spawn a long-running
background recorder that owns its own processing pipeline and streams
progress events back.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `start-recording` | R→M invoke | drop (superseded by `-ui`) | — |
| `stop-recording` | R→M invoke | drop (superseded by `-ui`) | — |
| `start-recording-ui` | R→M invoke | yes | `stenoai.recording.start(name?)` |
| `stop-recording-ui` | R→M invoke | yes | `stenoai.recording.stop()` |
| `pause-recording-ui` | R→M invoke | yes | `stenoai.recording.pause()` |
| `resume-recording-ui` | R→M invoke | yes | `stenoai.recording.resume()` |
| `system-audio-recording-state` | R→M send | yes | `stenoai.recording.reportSystemAudioState(active)` |
| `process-system-audio-recording` | R→M invoke | yes | `stenoai.recording.processSystemAudio(filePath, name)` |
| `process-recording` | R→M invoke | yes | `stenoai.recording.processFile(path, name)` — imports a local file: copies it into `recordings/` then **queues** it (fire-and-forget, resolves before transcription; progress shows as a processing row) |
| `select-audio-file` | R→M invoke | yes | `stenoai.recording.pickAudioFile()` |
| — | R-direct (webUtils) | yes | `stenoai.recording.getPathForFile(file)` — sync; resolves a dropped File's absolute path (Electron 32+ removed `File.path`) |
| `get-queue-status` | R→M invoke | yes | `stenoai.recording.getQueue()` |
| `get-recordings-dir` | R→M invoke | yes | `stenoai.recording.getDir()` |
| `get-live-transcript-state` | R→M invoke | yes | `stenoai.liveTranscript.getState()` |
| `live-transcribe-chunk` | R→M send | yes | `stenoai.liveTranscript.pushChunk(bytes)` |
| `live-transcribe-stop` | R→M send | yes | `stenoai.liveTranscript.stop()` |
| `live-transcript-ready` | M→R | yes | `stenoai.on.liveTranscriptReady(cb)` |
| `live-transcript-chunk` | M→R | yes | `stenoai.on.liveTranscriptChunk(cb)` |
| `live-transcript-error` | M→R | yes | `stenoai.on.liveTranscriptError(cb)` |
| `toggle-recording-hotkey` | M→R | yes | `stenoai.on.toggleRecordingHotkey(cb)` |

```ts
type StartRecordingResponse = Result<{ message: string }>;
type StopRecordingResponse = Result<{ message: string }>;
type PauseRecordingResponse = Result<{ message: string }>;
type ResumeRecordingResponse = Result<{ message: string }>;

interface LiveSegment {
  text: string;
  start: number;
  end: number;
  isFinal: boolean;
}
type LiveTranscriptStateResponse = Result<{
  sessionName: string | null;
  segments: LiveSegment[];
  ready: boolean;
  error: { stage: string; error?: string; message?: string } | null;
}>;
interface LiveTranscriptReadyEvent { sessionName: string }
interface LiveTranscriptChunkEvent { sessionName: string; segment: LiveSegment }
interface LiveTranscriptErrorEvent { sessionName: string; stage: string; error?: string; message?: string }

interface QueueStatus {
  success: true;
  isProcessing: boolean;
  queueSize: number;
  currentJob: string | null;   // sessionName or null
  /** Side-channel tracking for in-flight `reprocess-meeting` invocations.
   *  Reprocess doesn't go through `processingQueue` / `currentJob`, so it
   *  ships here so the renderer can flag the matching existing meeting
   *  rows as in-progress. Keyed in main by summaryFile so overlapping
   *  reprocesses coexist. Empty array when none active. */
  currentReprocesses: Array<{ summaryFile: string; sessionName: string | null }>;
  hasRecording: boolean;
  isPaused: boolean;
  elapsedSeconds: number;
  sessionName: string | null;
}

type PickAudioFileResponse = Result<{ filePath: string }>;
type RecordingsDirResponse = Result<{ path: string }>;
```

Pause/resume remains part of the preload contract even though the current
React UI does not expose dedicated controls. Queue status is the source of
truth for elapsed time and paused state so remounts recover correctly.

---

## 3. Meetings

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `list-meetings` | R→M invoke | yes | `stenoai.meetings.list()` |
| `update-meeting` | R→M invoke | yes | `stenoai.meetings.update(summaryFile, patch)` |
| `delete-meeting` | R→M invoke | yes | `stenoai.meetings.delete(meeting)` |
| `reprocess-meeting` | R→M invoke | yes | `stenoai.meetings.reprocess(summaryFile, regenTitle, name)` |
| `save-meeting-notes` | R→M invoke | yes | `stenoai.meetings.saveNotes(name, notes)` |
| `export-transcript` | R→M invoke | yes | `stenoai.meetings.exportTranscript(defaultFilename, content)` |
| `meetings-refreshed` | M→R | **drop** | — (orphan — see note) |
| `summary-chunk` | M→R | yes | `stenoai.on.summaryChunk(cb)` |
| `summary-title` | M→R | yes | `stenoai.on.summaryTitle(cb)` |
| `summary-complete` | M→R | yes | `stenoai.on.summaryComplete(cb)` |
| `processing-complete` | M→R | yes | `stenoai.on.processingComplete(cb)` |
| `processing-progress` | M→R | yes | `stenoai.on.processingProgress(cb)` |

```ts
interface SessionInfo {
  name: string;
  summary_file: string;
  transcript_file?: string;
  audio_file?: string;
  processed_at?: string;
  updated_at?: string;
  duration_seconds?: number;
  folders?: string[];
}

interface Meeting {
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
}

type ListMeetingsResponse = Result<{ meetings: Meeting[] }>;

interface UpdateMeetingPatch {
  name?: string;
  summary?: string;
  participants?: unknown[];
  key_points?: string[];
  action_items?: unknown[];
}
type UpdateMeetingResponse = Result<{ message: string; updatedData: Meeting }>;

type DeleteMeetingResponse = Result<{ message: string }>;

type SaveMeetingNotesResponse = Result<{ path: string }>;

// `path` is the file the transcript bundle was written to. Cancelling the save
// dialog resolves as { success: false, error: 'canceled' } (not a rejection),
// so the renderer treats a cancel like any other non-success and shows nothing.
// `'canceled'` is a NORMATIVE cross-process sentinel: the renderer matches it by
// exact string to stay silent. Producers define it once in app/ipc-sentinels.js
// (EXPORT_CANCELED, required by main.js + the mock IPC); the renderer mirrors it
// as EXPORT_CANCELED_ERROR. This doc is the source of truth — change all three
// together.
type ExportTranscriptResponse = Result<{ path: string }>;

// Main → renderer events emitted during reprocess / recording pipelines.
interface SummaryChunkEvent  { chunk: string; sessionName: string }
interface SummaryTitleEvent  { title: string; sessionName: string }
interface SummaryCompleteEvent { success: boolean; sessionName: string }
interface ProcessingCompleteEvent {
  success: boolean;
  sessionName: string;
  message: string;
  meetingData?: Meeting;
}
```

### `processing-progress` (M→R)

Emitted during map-reduce summarization of long meetings to update the processing-row badge.

**Payload:** `{ line: string }` — e.g. `"PROGRESS:summarize:2/5"` or `"PROGRESS:summarize:reducing"`

**Renderer:** `ipc().on.processingProgress(cb)` → updates Processing.tsx label to *"Summarizing part 2 of 5…"* or *"Merging summaries…"*.

**Orphan listener.** `meetings-refreshed` is listened for in
`app/index.html:9008` but `main.js` never sends it. Only the e2e mock
emits it. Remove the listener in Phase 2 and rely on `processing-complete`
+ an explicit re-list.

---

## 4. Chat sessions + transcript query

Streaming is **the** non-trivial contract. Renderer sends
`query-transcript-stream` with a `queryId`, listens for `query-chunk`
events, and stops the stream via `query-cancel`. `query-done` always fires
(success or failure).

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `query-transcript` | R→M invoke | yes | `stenoai.query.ask(file, q)` |
| `query-transcript-stream` | R→M send | yes | `stenoai.query.askStream(id, file, q)` |
| `query-cancel` | R→M send | yes | `stenoai.query.cancel(id)` |
| `query-chunk` | M→R | yes | `stenoai.on.queryChunk(cb)` |
| `query-done` | M→R | yes | `stenoai.on.queryDone(cb)` |
| `save-chat-sessions` | R→M invoke | yes | `stenoai.chat.save(data)` |
| `load-chat-sessions` | R→M invoke | yes | `stenoai.chat.load()` |

```ts
type QueryResponse = Result<{ answer: string }>;

interface QueryChunkEvent { queryId: string; chunk: string }
interface QueryDoneEvent  { queryId: string; success: boolean; error?: string }

// Shape is opaque to main.js — renderer owns the format.
interface ChatSessionsBlob {
  sessions: Array<{
    id: string;
    name: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
    createdAt: number;
    updatedAt: number;
  }>;
}
// `data` is null when no chat history exists. `migratedFromLegacy: true` is set
// when main returned the legacy `chat_sessions.json` blob (a flat array) on a
// fresh install of the new renderer; the renderer migrates the shape in memory
// and persists to `chat_sessions_v2.json` on next save. The legacy file is
// never modified, so toggling back to the legacy renderer keeps working.
type LoadChatSessionsResponse = Result<{
  data: ChatSessionsBlob | LegacyBlob | null;
  migratedFromLegacy?: boolean;
}>;
```

---

## 5. Folders

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `list-folders` | R→M invoke | yes | `stenoai.folders.list()` |
| `create-folder` | R→M invoke | yes | `stenoai.folders.create(name, color?)` |
| `rename-folder` | R→M invoke | yes | `stenoai.folders.rename(id, name)` |
| `delete-folder` | R→M invoke | yes | `stenoai.folders.delete(id)` |
| `reorder-folders` | R→M invoke | yes | `stenoai.folders.reorder(ids)` |
| `add-meeting-to-folder` | R→M invoke | yes | `stenoai.folders.addMeeting(summaryFile, folderId)` |
| `remove-meeting-from-folder` | R→M invoke | yes | `stenoai.folders.removeMeeting(summaryFile, folderId)` |

```ts
interface Folder {
  id: string;
  name: string;
  color: string;      // hex (e.g. "#818cf8")
  order: number;
}

type ListFoldersResponse = Result<{ folders: Folder[] }>;
type CreateFolderResponse = Result<{ folder: Folder }>;
```

---

## 6. Models (local Ollama + cloud)

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `check-ollama-installed` | R→M invoke | yes | `stenoai.models.checkOllama()` |
| `list-models` | R→M invoke | yes | `stenoai.models.list()` |
| `get-current-model` | R→M invoke | yes | `stenoai.models.getCurrent()` |
| `set-model` | R→M invoke | yes | `stenoai.models.set(name)` |
| `check-model-installed` | R→M invoke | yes | `stenoai.models.checkInstalled(name)` |
| `pull-model` | R→M invoke | yes | `stenoai.models.pull(name)` |
| `model-pull-progress` | M→R | yes | `stenoai.on.modelPullProgress(cb)` |
| `model-pull-complete` | M→R | yes | `stenoai.on.modelPullComplete(cb)` |

```ts
type CheckOllamaResponse = Result<{ installed: boolean; path?: string }>;
type CheckModelInstalledResponse = Result<{ installed: boolean }>;

interface ListedModel {
  name: string;
  size_gb?: number;
  installed: boolean;
  current?: boolean;
}
type ListModelsResponse = Result<{ models: ListedModel[]; current?: string }>;
type GetCurrentModelResponse = Result<{ model: string }>;

interface ModelPullProgressEvent { model: string; progress: string }
interface ModelPullCompleteEvent  { model: string; success: boolean; error?: string }
```

---

## 6a. Transcription engine (Parakeet / Whisper)

Engine selection + per-engine model management. User picks the active
engine in Settings → Transcribe; the live VAD pipeline reads
`transcription_engine` from config to decide which engine to load.
Parakeet has one model id today; Whisper has two variants (Small +
Large V3 Turbo).

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `get-transcription-engine` | R→M invoke | yes | `stenoai.transcriptionEngine.get()` |
| `set-transcription-engine` | R→M invoke | yes | `stenoai.transcriptionEngine.set(engine)` |
| `list-parakeet-models` | R→M invoke | yes | `stenoai.parakeetModels.list()` |
| `pull-parakeet-model` | R→M invoke | yes | `stenoai.parakeetModels.pull(id?)` |
| `parakeet-status` | R→M invoke | yes | `stenoai.parakeetModels.status()` |
| `parakeet-pull-progress` | M→R | yes | `stenoai.on.parakeetPullProgress(cb)` |
| `parakeet-pull-complete` | M→R | yes | `stenoai.on.parakeetPullComplete(cb)` |
| `list-whisper-models` | R→M invoke | yes | `stenoai.whisperModels.list()` |
| `set-whisper-model` | R→M invoke | yes | `stenoai.whisperModels.set(name)` |
| `pull-whisper-model` | R→M invoke | yes | `stenoai.whisperModels.pull(name)` |
| `whisper-pull-progress` | M→R | yes | `stenoai.on.whisperPullProgress(cb)` |
| `whisper-pull-complete` | M→R | yes | `stenoai.on.whisperPullComplete(cb)` |

```ts
type TranscriptionEngine = 'parakeet' | 'whisper';

type GetTranscriptionEngineResponse = Result<{
  engine: TranscriptionEngine;
  valid_engines: TranscriptionEngine[];
}>;
type ParakeetStatusResponse = Result<{ model: string; installed: boolean }>;

// Parakeet pull events: `model` is present on pull-parakeet-model
// invocations (the explicit id is echoed back); on setup-parakeet
// (no id arg → default model) the field is omitted.
interface ParakeetPullProgressEvent {
  model?: string | null;
  stage: 'downloading' | 'loading' | string;
}
interface ParakeetPullCompleteEvent {
  model?: string | null;
  success: boolean;
  error?: string;
}

interface WhisperPullProgressEvent { model: string; progress: string }
interface WhisperPullCompleteEvent { model: string; success: boolean; error?: string }
```

---

## 7. Settings (getters + setters)

All `get-*` return `{ success, <flag>: value }`. All `set-*` accept the new
value and return `{ success, <flag>: value }`. Booleans for the Python CLI
are string-cased (`"True"`/`"False"`) — that translation lives in main.js.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `get-notifications` / `set-notifications` | R→M invoke | yes | `stenoai.settings.getNotifications()` / `setNotifications(b)` |
| `get-silence-auto-stop` | R→M invoke | yes | `stenoai.settings.getSilenceAutoStop()` |
| `set-silence-auto-stop-enabled` | R→M invoke | yes | `stenoai.settings.setSilenceAutoStopEnabled(b)` |
| `set-silence-auto-stop-minutes` | R→M invoke | yes | `stenoai.settings.setSilenceAutoStopMinutes(n)` |
| `show-silence-auto-stop-notification` | R→M invoke | yes | `stenoai.settings.showSilenceAutoStopNotification({ minutes, sessionName })` |
| `show-note-ready-notification` | R→M invoke | yes | `stenoai.settings.showNoteReadyNotification({ title, failed?, hardFailure? })` — `failed`: graceful transcription failure (marked note written); `hardFailure`: processing crash / import that never enqueued (no note) |
| `get-telemetry` / `set-telemetry` | R→M invoke | yes | `stenoai.settings.getTelemetry()` / `setTelemetry(b)` |
| `get-dock-icon` / `set-dock-icon` | R→M invoke | yes | `stenoai.settings.getDockIcon()` / `setDockIcon(b)` |
| `get-system-audio` / `set-system-audio` | R→M invoke | yes | `stenoai.settings.getSystemAudio()` / `setSystemAudio(b)` |
| `get-language` / `set-language` | R→M invoke | yes | `stenoai.settings.getLanguage()` / `setLanguage(code)` |
| `get-storage-path` / `set-storage-path` | R→M invoke | yes | `stenoai.settings.getStoragePath()` / `setStoragePath(p)` |
| `select-storage-folder` | R→M invoke | yes | `stenoai.settings.pickStorageFolder()` |
| `get-ai-prompts` | R→M invoke | yes | `stenoai.settings.getAiPrompts()` |

```ts
type GetNotificationsResponse = Result<{ notifications_enabled: boolean }>;
type GetTelemetryResponse     = Result<{ telemetry_enabled: boolean }>;
type GetDockIconResponse      = Result<{ hide_dock_icon: boolean }>;
type GetSystemAudioResponse   = Result<{ system_audio_enabled: boolean }>;
type GetLanguageResponse      = Result<{ language: string }>;

type StoragePathResponse = Result<{
  storage_path: string | null;
  custom_path: string | null;
  default_path: string;
}>;
type PickStorageFolderResponse = Result<{ folderPath: string }>;

type GetAiPromptsResponse = Result<{ summarization: string }>;

type GetSilenceAutoStopResponse = Result<{
  silence_auto_stop_enabled: boolean;
  silence_auto_stop_minutes: number;
  supported_minutes: number[];
}>;
type SetSilenceAutoStopEnabledResponse = Result<{ silence_auto_stop_enabled: boolean }>;
type SetSilenceAutoStopMinutesResponse = Result<{ silence_auto_stop_minutes: number }>;

/** Both notification IPCs gate internally on `notifications_enabled`
 *  (the global "Desktop notifications" toggle in Settings → General) —
 *  the renderer doesn't need to pre-check. They return `{success: true}`
 *  even when the banner was suppressed by the user setting so callers
 *  don't need to distinguish "disabled" from "shown" failure paths. */
type ShowSilenceAutoStopNotificationResponse = Result<Record<string, never>>;
type ShowNoteReadyNotificationResponse = Result<Record<string, never>>;
```

---

## 8. AI provider (local / remote Ollama / cloud)

Cloud API key is stored via Electron `safeStorage` (disk file
`~/Library/Application Support/stenoai/.cloud-api-key`), never passed
through IPC on read.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `get-ai-provider` | R→M invoke | yes | `stenoai.ai.getProvider()` |
| `set-ai-provider` | R→M invoke | yes | `stenoai.ai.setProvider(p)` |
| `set-remote-ollama-url` | R→M invoke | yes | `stenoai.ai.setRemoteOllamaUrl(url)` |
| `test-remote-ollama` | R→M invoke | yes | `stenoai.ai.testRemoteOllama(url)` |
| `set-cloud-api-url` | R→M invoke | yes | `stenoai.ai.setCloudApiUrl(url)` |
| `set-cloud-api-key` | R→M invoke | yes | `stenoai.ai.setCloudApiKey(k)` |
| `set-cloud-provider` | R→M invoke | yes | `stenoai.ai.setCloudProvider(p)` |
| `set-cloud-model` | R→M invoke | yes | `stenoai.ai.setCloudModel(m)` |
| `test-cloud-api` | R→M invoke | yes | `stenoai.ai.testCloudApi()` |

```ts
type AiProvider = 'local' | 'remote' | 'cloud';
type CloudProvider = 'openai' | 'anthropic' | 'custom';

type GetAiProviderResponse = Result<{
  ai_provider: AiProvider;
  remote_ollama_url: string;
  cloud_api_url: string;
  cloud_provider: CloudProvider;
  cloud_model: string;
  cloud_api_key_set: boolean;  // always overridden by safeStorage check
}>;
```

---

## 9. Calendar (Google + Outlook)

Both providers follow the same four-channel shape. Only one provider is
connected at a time; `*-auth-start` disconnects the other on success.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `google-auth-start` | R→M invoke | yes | `stenoai.calendar.google.connect()` |
| `google-auth-status` | R→M invoke | yes | `stenoai.calendar.google.status()` |
| `google-auth-disconnect` | R→M invoke | yes | `stenoai.calendar.google.disconnect()` |
| `outlook-auth-start` | R→M invoke | yes | `stenoai.calendar.outlook.connect()` |
| `outlook-auth-status` | R→M invoke | yes | `stenoai.calendar.outlook.status()` |
| `outlook-auth-disconnect` | R→M invoke | yes | `stenoai.calendar.outlook.disconnect()` |
| `get-calendar-events` | R→M invoke | yes | `stenoai.calendar.getEvents()` |
| `google-auth-changed` | M→R | yes | `stenoai.on.googleAuthChanged(cb)` |
| `outlook-auth-changed` | M→R | yes | `stenoai.on.outlookAuthChanged(cb)` |

```ts
type AuthStatusResponse = Result<{ connected: boolean }>;

interface CalendarEvent {
  id: string;
  title: string;
  start: string;      // ISO8601
  end: string;        // ISO8601
  attendees?: Array<{ email: string; name?: string }>;
  location?: string;
  meeting_url?: string;
  description?: string;
}
type GetCalendarEventsResponse =
  | { success: true; events: CalendarEvent[] }
  | { success: false; needsAuth: true }
  | { success: false; error: string };
```

---

## 10. Updates + announcements

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `check-for-updates` | R→M invoke | yes | `stenoai.updates.check()` |
| `check-announcements` | R→M invoke | yes | `stenoai.updates.announcements()` |
| `open-release-page` | R→M invoke | yes | `stenoai.updates.openReleasePage(url)` |
| `install-update` | R→M send | yes | `stenoai.updates.install()` |
| `update-available` | M→R | yes | `stenoai.on.updateAvailable(cb)` |
| `update-download-progress` | M→R | yes | `stenoai.on.updateDownloadProgress(cb)` |
| `update-downloaded` | M→R | yes | `stenoai.on.updateDownloaded(cb)` |

```ts
type CheckForUpdatesResponse = Result<{
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  downloadUrl: string | null;
}>;

interface Announcement {
  id: string;
  title: string;
  body: string;
  action_url?: string;
  action_label?: string;
  min_version?: string;
  max_version?: string;
  dismissible?: boolean;
}
type CheckAnnouncementsResponse = Result<{
  announcements: Announcement[];
  currentVersion: string;
}>;

interface UpdateAvailableEvent { version: string }
interface UpdateProgressEvent  { percent: number }
interface UpdateDownloadedEvent { version: string }
```

---

## 11. Deep links + tray

These exist because main-process events (deep link URL, tray click) need to
reach the renderer. The renderer never initiates them.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `shortcut-renderer-ready` | R→M send | yes | `stenoai.shortcuts.rendererReady()` |
| `shortcut-start-recording` | M→R | yes | `stenoai.on.shortcutStartRecording(cb)` |
| `shortcut-stop-recording` | M→R | yes | `stenoai.on.shortcutStopRecording(cb)` |
| `tray-start-recording` | M→R | yes | `stenoai.on.trayStartRecording(cb)` |
| `tray-stop-recording` | M→R | yes | `stenoai.on.trayStopRecording(cb)` |
| `tray-open-settings` | M→R | yes | `stenoai.on.trayOpenSettings(cb)` |

```ts
interface ShortcutStartRecordingEvent { sessionName: string | null }
// stop / tray events have no payload
```

---

## 11a. Organisation adapter (enterprise mode)

Talks to a self-hosted Steno adapter for shared notes, AI proxying, and S3
artifacts. Session token + adapter URL persisted via `safeStorage`. The
renderer never sees the JWT directly — every call goes through these
handlers, which add the bearer header in main.

| Channel | Direction | Needed | Preload API |
| --- | --- | --- | --- |
| `org-status` | R→M invoke | yes | `stenoai.org.status()` |
| `org-login` | R→M invoke | yes | `stenoai.org.login(adapterUrl, email, password)` |
| `org-sso-google-start` | R→M invoke | yes | `stenoai.org.ssoGoogleStart(adapterUrl)` |
| `org-logout` | R→M invoke | yes | `stenoai.org.logout()` |
| `org-list-meetings` | R→M invoke | yes | `stenoai.org.listMeetings()` |
| `org-get-meeting` | R→M invoke | yes | `stenoai.org.getMeeting(id)` |
| `org-create-meeting` | R→M invoke | yes | `stenoai.org.createMeeting(payload)` |
| `org-delete-meeting` | R→M invoke | yes | `stenoai.org.deleteMeeting(id)` |
| `org-share-meeting` | R→M invoke | yes | `stenoai.org.shareMeeting(payload)` |
| `org-ai-chat` | R→M invoke | yes | `stenoai.org.aiChat(payload)` |
| `org-chat-stream` | R→M send | yes | `stenoai.org.chatStream(streamId, payload)` |

`org-sso-google-start` runs the loopback-redirect OAuth flow against the
customer's Google client (the adapter does the code exchange so the
client_secret never leaves the adapter). `org-chat-stream` mirrors the
local `chat-global-stream` wire shape — chunks land on the existing
`query-chunk` / `query-done` events so the renderer's streaming infra
doesn't need a parallel subscription.

`org-share-meeting` is the canonical share path: main does presign → PUT
to S3 → register metadata in one step, so the renderer never sees the
presigned URL or the bytes-in-flight. `org-create-meeting` is kept for
inline-body fallbacks (legacy or test). A failed backup is recorded in
`.org-backup-state.json` (surfaced per-note via `org-get-backup-state`'s
`failed_at`/`error`, the note-detail "Not backed up" chip) and written to the
persistent diagnostic log, so support can see failures even though the
user-facing signal is intentionally quiet.

```ts
interface OrgStatusResponse {
  signedIn: boolean;
  adapterUrl?: string;
  email?: string;
  name?: string;
  orgId?: string;
}

type OrgLoginResponse = Result<{
  signedIn: true;
  adapterUrl: string;
  email: string;
  name: string;
  orgId: string;
}>;

interface OrgMeetingSummary {
  id: string;
  title: string;
  owner_email: string;
  org_id: string;
  visibility: 'private' | 'org';
  created_at: number;
  has_artifact: boolean;
}

interface OrgMeeting extends OrgMeetingSummary {
  body: string;
  download_url?: string;
}

interface OrgChatPayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  system?: string;
  model?: string;
  max_tokens?: number;
}
```

A 401 from the adapter clears the persisted session, forcing a re-login.

---

## 12. Preload surface (summary)

Every `stenoai.*` function is either a typed async request that returns a
`Result<T>` or an event subscription that returns an `unsubscribe` function:

```ts
// All invoke channels:
type RequestFn<Args extends unknown[], Res> = (...args: Args) => Promise<Res>;

// All send channels:
type SendFn<Args extends unknown[]> = (...args: Args) => void;

// All M→R events:
type Subscribe<P> = (cb: (payload: P) => void) => () => void;

// The root object shape — the source of truth is
// `app/preload/index.ts` (Phase 1.1, STE-10).
interface StenoaiBridge {
  app:      { getVersion: RequestFn<[], AppVersionResponse>; };
  window:   { focus: SendFn<[]>; };
  system:   { getStatus: RequestFn<[], StatusResponse>; /* … */ };
  setup:    { /* … */ };
  perm:     { /* … */ };
  recording:{ /* … */ };
  meetings: { /* … */ };
  query:    { /* … */ };
  chat:     { /* … */ };
  folders:  { /* … */ };
  models:   { /* … */ };
  settings: { /* … */ };
  ai:       { /* … */ };
  calendar: { google: {/* … */}; outlook: {/* … */}; getEvents: /* … */ };
  updates:  { /* … */ };
  shortcuts:{ /* … */ };
  on:       { /* all M→R subscribe helpers */ };
}
declare global { interface Window { stenoai: StenoaiBridge } }
```

## 13. Channels the new renderer will not expose

These are registered in `main.js` or listened for in `index.html` today,
but the new renderer should not re-export them in `preload.js`:

| Channel | Why drop |
| --- | --- |
| `start-recording` | Superseded by `start-recording-ui` |
| `stop-recording` | Superseded by `stop-recording-ui` |
| `meetings-refreshed` | Orphan — listener in `index.html` only, no sender in `main.js` |

## 14. Counts

- `ipcMain.handle` channels: **78**
- `ipcMain.on` channels: **6** (`focus-window`, `shortcut-renderer-ready`, `query-transcript-stream`, `query-cancel`, `install-update`, `system-audio-recording-state`)
- `webContents.send` channels: **19** (`shortcut-start-recording`, `shortcut-stop-recording`, `tray-start-recording`, `tray-stop-recording`, `tray-open-settings`, `toggle-recording-hotkey`, `debug-log`, `trigger-setup-flow`, `summary-chunk`, `summary-title`, `summary-complete`, `processing-complete`, `query-chunk`, `query-done`, `model-pull-progress`, `model-pull-complete`, `update-available`, `update-download-progress`, `update-downloaded`, `google-auth-changed`, `outlook-auth-changed`)

Total IPC surface to port: **~100 channels**.

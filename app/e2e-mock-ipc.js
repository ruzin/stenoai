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

// A real (silent, zero-sample) 16-bit mono 16kHz WAV file's bytes,
// base64-encoded -- valid enough for the renderer's blob: URL + <audio>
// playback path to actually decode, unlike an arbitrary placeholder string.
const MINIMAL_WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

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
  // Non-empty so this seed is a genuinely *summarised* note — the
  // generate-notes-bar T1's "hides for a normal note" case must take the
  // has-summary render path, not the "no summary available" fallback
  // (#313 review).
  summary: 'The team agreed to ship on Friday; Bob owns the release notes.',
  key_points: [],
  action_items: [],
  discussion_areas: [],
};

// A transcript-only note (auto-summarise off, #276 → notes_generated:false):
// has a transcript, no summary. Drives the GenerateNotesBar T1 (the floating
// "Generate notes" CTA above the Ask bar). Seeded only when
// STENOAI_E2E_SEED_PENDING_NOTE=1.
const PENDING_MEETING = {
  session_info: {
    name: 'New note',
    summary_file: 'pending_summary.md',
    processed_at: '2026-07-05T10:00:00Z',
    duration_seconds: 60,
    notes_generated: false,
  },
  transcript: '[00:03] [You] we ship Friday.\n[00:06] [Others] I will prep the release notes.',
  is_diarised: true,
  summary: '',
  key_points: [],
  action_items: [],
  discussion_areas: [],
  participants: [],
};

// A continued note (continue-recording appended a segment after notes were
// generated → notes_stale:true): has a summary AND a stale marker. Drives the
// "Regenerate notes" variant of the floating CTA. Seeded only when
// STENOAI_E2E_SEED_STALE_NOTE=1.
const STALE_MEETING = {
  session_info: {
    name: 'Continued note',
    summary_file: 'stale_summary.md',
    processed_at: '2026-07-10T10:00:00Z',
    duration_seconds: 300,
    notes_stale: true,
  },
  transcript:
    '[00:03] [You] first segment.\n\n--- Resumed 10:20 ---\n\n[00:02] [You] second segment.',
  is_diarised: true,
  summary: 'Covers only the first segment.',
  key_points: [],
  action_items: [],
  discussion_areas: [],
  participants: [],
};

// An instant-stop placeholder (processing:true): written from the live
// transcript at stop, still upgrading in the background. Drives the
// "Finishing up…" affordance + the stop-navigates-to-note behaviour. Seeded
// only when STENOAI_E2E_SEED_PROCESSING_NOTE=1.
const PROCESSING_NOTE_FILE = 'processing_summary.md';
const PROCESSING_MEETING = {
  session_info: {
    name: 'Instant Note',
    summary_file: PROCESSING_NOTE_FILE,
    processed_at: '2026-07-12T10:00:00Z',
    duration_seconds: 60,
    notes_generated: false,
    processing: true,
  },
  transcript: '[00:03] we ship Friday.',
  is_diarised: false,
  summary: '',
  key_points: [],
  action_items: [],
  discussion_areas: [],
  participants: [],
};

// A generated template report attached to SEED_MEETING when
// STENOAI_E2E_SEED_REPORT=1 (copy-notes-report T1). Gated separately so the
// transcript-export T1 keeps seeing the report-less meeting it asserts on.
const SEED_REPORT = {
  id: 'rep_e2e_1',
  template_id: 'tpl_e2e_status',
  template_name: 'Status Report',
  model: 'mock-model',
  // Leading <think> block: the copy path must strip reasoning like the
  // rendered view does, so the spec can assert it never reaches the clipboard.
  content:
    '<think>secret chain of thought</think>\n## Status Report\n\n- Pipeline healthy\n- Next: open the reqs',
  created_at: '2026-06-19T13:00:00Z',
};

// Mutable so the stateful set-active-report mock below persists the pill
// switch across the invalidate → get-meeting refetch, like the real sidecar.
let seedActiveReport = null;

const seededMeeting = () =>
  process.env.STENOAI_E2E_SEED_REPORT === '1'
    ? { ...SEED_MEETING, reports: [SEED_REPORT], active_report: seedActiveReport }
    : SEED_MEETING;

// A diarised meeting for the speaker-review T1 spec -- seeded only when
// STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS=1. summary_file's stem
// ("speaker-review-mtg") matches the meetingStem key used by the
// speakerState.suggestions seed below, since SpeakerReviewPanel derives the
// stem from summary_file client-side (meetingStemFromSummaryFile).
const SPEAKER_SEED_MEETING = {
  session_info: {
    name: 'Speaker Review Meeting',
    summary_file: 'speaker-review-mtg_summary.json',
    processed_at: '2026-06-19T12:00:00Z',
    duration_seconds: 900,
    transcription_failed: false,
  },
  transcript: '',
  is_diarised: true,
  diarised_text: '[00:05] [Speaker 2] hello there',
  participants: [],
  summary: 'A test meeting for speaker review.',
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
    autoInstallWhenIdle: true, // idle auto-install toggle (config default on)
  };

  // In-memory recording state machine for the pill-dock T1: start/pause/
  // resume/stop mutate it and get-queue-status reflects it, so the renderer's
  // queue poll drives the same status transitions the real backend would.
  // Idle shape matches the old static default, so specs that never record
  // see no difference.
  const rec = {
    active: false,
    paused: false,
    processing: false,
    sessionName: null,
    // The append/resume target (summary file) of the active recording, mirrored
    // into get-queue-status.recordingSummaryFile so the detail view can match
    // "recording this note" by identity (not display name).
    appendTo: null,
    startedAt: 0,
    pausedAt: 0,
  };

  // In-memory overlay so update-meeting → get-meeting round-trips the My notes
  // tab in T1 (summaryFile → { user_notes }). The real handler persists to the
  // note file; the T1 seeds are consts, so we overlay here instead.
  const meetingOverlay = {};

  // In-flight soft-deletes (#234), id → the deleted meeting. Mirrors main's
  // pendingDelete map just far enough for undo to hand the row back.
  const pendingDeletes = {};
  let pendingDeleteSeq = 0;

  const applyOverlay = (m) => {
    if (!m || !m.session_info) return m;
    const o = meetingOverlay[m.session_info.summary_file];
    return o ? { ...m, ...o } : m;
  };

  // Speaker-review (SpeakerReviewPanel) mock state -- seeded only when a
  // spec sets STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS=1 so the other T1 specs
  // are unaffected. Shape mirrors the real suggest-speakers/list-person-
  // profiles JSON (see src.speaker_suggestions + app/docs/ipc-contract.md's
  // "6b. Speakers" section). Mutated by confirm/create/rename/delete so a
  // spec can click a real action and assert the panel re-renders from the
  // (mocked) refetch, the same way org-login/org-status do for org state.
  const seedSpeakers = process.env.STENOAI_E2E_SEED_SPEAKER_SUGGESTIONS === '1';
  const speakerState = {
    personProfiles: seedSpeakers
      ? [
          { person_id: 'p-julian', display_name: 'Julian', prototype_counts: { remote: 2 }, hard_negative_counts: {}, updated_at: 0 },
          { person_id: 'p-christian', display_name: 'Christian Weyer', prototype_counts: { remote: 1 }, hard_negative_counts: {}, updated_at: 0 },
        ]
      : [],
    // channels -> { diarization_speaker_id: SpeakerSuggestion }
    suggestions: seedSpeakers
      ? {
          mic: {
            SPEAKER_0: {
              status: 'confirmed', suggested_person_id: 'p-julian', suggested_name: 'Julian',
              merged_from: [],
              candidates: [{ person_id: 'p-julian', display_name: 'Julian', distance: 0.05, hard_negative_conflict: false }],
              reasons: [],
              speech_duration_seconds: 245, segment_count: 60, first_timestamp: '02:10',
              sample_text: 'I think we should ship this on Friday',
              is_likely_artifact: false,
              confirmed_by_user: null,
            },
            // "possible" still carries a suggested_person_id/suggested_name
            // (the real suggest_speaker always attaches the best candidate,
            // regardless of confidence tier) -- only "none" has them null.
            SPEAKER_1: {
              status: 'possible', suggested_person_id: 'p-christian', suggested_name: 'Christian Weyer',
              merged_from: [],
              candidates: [{ person_id: 'p-christian', display_name: 'Christian Weyer', distance: 0.28, hard_negative_conflict: false }],
              reasons: [],
              speech_duration_seconds: 80, segment_count: 20, first_timestamp: '05:45',
              sample_text: 'let me check the numbers again',
              is_likely_artifact: false,
              confirmed_by_user: null,
            },
            // status "none" but with a below-threshold candidate still
            // attached -- shown (Change/New person/Keep, no Approve),
            // unlike a truly empty-candidates "none" row (hidden).
            SPEAKER_2: {
              status: 'none', suggested_person_id: null, suggested_name: null,
              merged_from: [],
              candidates: [{ person_id: 'p-julian', display_name: 'Julian', distance: 0.55, hard_negative_conflict: false }],
              reasons: [],
              speech_duration_seconds: 30, segment_count: 8, first_timestamp: '00:42',
              sample_text: null,
              is_likely_artifact: false,
              confirmed_by_user: null,
            },
            SPEAKER_3: {
              status: 'none', suggested_person_id: null, suggested_name: null,
              merged_from: [], candidates: [], reasons: [],
              speech_duration_seconds: 5, segment_count: 1, first_timestamp: '10:02',
              sample_text: null,
              is_likely_artifact: false,
              confirmed_by_user: null,
            },
            // Real-library shape (short scattered turns) -- hidden by
            // default behind the panel's "Show N filtered rows" toggle.
            SPEAKER_4: {
              status: 'possible', suggested_person_id: 'p-christian', suggested_name: 'Christian Weyer',
              merged_from: [],
              candidates: [{ person_id: 'p-christian', display_name: 'Christian Weyer', distance: 0.35, hard_negative_conflict: false }],
              reasons: [],
              speech_duration_seconds: 12, segment_count: 20, first_timestamp: '08:03',
              sample_text: null,
              is_likely_artifact: true,
              confirmed_by_user: null,
            },
          },
        }
      : {},
  };

  // Mirrors Config._person_name_taken's case/whitespace-insensitive
  // uniqueness check (src/config.py) -- keeps the mock's error path
  // consistent with the real backend for the T1 duplicate-name tests.
  function personNameTaken(name, excludeId) {
    const normalized = name.trim().toLowerCase();
    return speakerState.personProfiles.some(
      (p) => p.person_id !== excludeId && p.display_name.trim().toLowerCase() === normalized,
    );
  }

  // Channels with behaviour a test depends on. Each is (event, ...args) like a
  // real ipcMain.handle callback. Mirror the real handlers' return shapes from
  // app/main.js (get-ai-provider ~5950, org-* ~7990).
  const MOCKS = {
    'start-recording-ui': async (_event, name, _trigger, appendTo) => {
      rec.active = true;
      rec.paused = false;
      rec.processing = false;
      rec.sessionName = name && String(name).trim() ? String(name).trim() : 'Note';
      rec.appendTo = appendTo && String(appendTo).trim() ? String(appendTo).trim() : null;
      rec.startedAt = Date.now();
      return { success: true, sessionName: rec.sessionName };
    },
    'stop-recording-ui': async () => {
      rec.active = false;
      rec.paused = false;
      rec.appendTo = null;
      // Park in "processing" — T1 has no backend to complete it; the spec only
      // asserts the renderer's optimistic transition to the processing dock.
      rec.processing = true;
      // Instant stop: with the processing-note seed, return the placeholder's
      // path so useRecording.stopRecording navigates to the note (not the dock).
      if (process.env.STENOAI_E2E_SEED_PROCESSING_NOTE === '1') {
        return { success: true, summaryFile: PROCESSING_NOTE_FILE };
      }
      return { success: true };
    },
    'pause-recording-ui': async () => {
      if (rec.active && !rec.paused) {
        rec.paused = true;
        rec.pausedAt = Date.now();
      }
      return { success: true };
    },
    'resume-recording-ui': async () => {
      if (rec.active && rec.paused) {
        rec.paused = false;
        // Freeze elapsed across the pause, like the real backend: shift the
        // start forward by the paused span so elapsed doesn't tick while
        // paused.
        rec.startedAt += Date.now() - rec.pausedAt;
      }
      return { success: true };
    },
    'get-queue-status': async () => ({
      success: true,
      isProcessing: rec.processing,
      queueSize: 0,
      currentJob: rec.processing ? rec.sessionName : null,
      currentReprocesses: [],
      hasRecording: rec.active,
      isPaused: rec.paused,
      elapsedSeconds: rec.active
        ? Math.floor(((rec.paused ? rec.pausedAt : Date.now()) - rec.startedAt) / 1000)
        : 0,
      sessionName: rec.active || rec.processing ? rec.sessionName : null,
      recordingSummaryFile: rec.active ? rec.appendTo : null,
    }),

    // Live transcript backfill. Real main.js populates liveTranscriptState from
    // the ASR sidecar (a model) — unreachable in T1 — so we seed it here. With
    // STENOAI_E2E_SEED_PRIOR_SEGMENTS=1 it returns carried-over priorSegments
    // (the resume/continue case) so the generate-notes-bar T1 can assert the
    // live bar shows earlier speech instead of starting blank.
    'get-live-transcript-state': async () => ({
      success: true,
      sessionName: rec.active || rec.processing ? rec.sessionName : null,
      segments: [],
      priorSegments:
        process.env.STENOAI_E2E_SEED_PRIOR_SEGMENTS === '1' && (rec.active || rec.processing)
          ? [
              { text: 'earlier bit one', start: 3, end: 5, isFinal: true, speaker: 'You' },
              { text: 'earlier bit two', start: 6, end: 8, isFinal: true, speaker: 'Others' },
            ]
          : [],
      ready: true,
      error: null,
    }),

    // Engine is static per launch; STENOAI_E2E_MOCK_ENGINE lets the pill-dock
    // T1 drive the Whisper variant (no live transcript, inline pause/resume).
    'get-transcription-engine': async () => ({
      success: true,
      engine: process.env.STENOAI_E2E_MOCK_ENGINE || 'parakeet',
    }),

    // Default not-installed keeps most T1 specs on their routes; the pill-dock
    // T1 sets STENOAI_E2E_MOCK_PARAKEET_INSTALLED=1 so App.tsx's first-run
    // setup gate doesn't redirect it to /setup before it can hit Record.
    'parakeet-status': async () => ({
      success: true,
      model: '',
      installed: process.env.STENOAI_E2E_MOCK_PARAKEET_INSTALLED === '1',
    }),

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

    // Stateful idle auto-install toggle: set updates the in-memory value that
    // get returns, like the other stateful setting mocks — so a T1 flip is
    // observable on the next get (and the switch isn't stuck disabled). Lives
    // in MOCKS (which shadows DEFAULTS) so this is the single source.
    'get-auto-install-when-idle': async () => ({
      success: true,
      auto_install_when_idle: state.autoInstallWhenIdle,
    }),
    'set-auto-install-when-idle': async (_event, enabled) => {
      state.autoInstallWhenIdle = !!enabled;
      return { success: true, auto_install_when_idle: state.autoInstallWhenIdle };
    },

    // Seed meetings for the specs that need them, gated per env so the
    // org/shared-notes specs keep an empty Home. STENOAI_E2E_SEED_MEETING (one
    // known meeting) drives the transcript-export T1; STENOAI_E2E_SEED_MEETINGS
    // (the recency-sorted trio) drives the command-palette T1. This handler
    // lives in MOCKS, which shadows DEFAULTS, so it is the single source for the
    // channel.
    'list-meetings': async () => {
      if (process.env.STENOAI_E2E_SEED_PENDING_NOTE === '1') {
        return { success: true, meetings: [PENDING_MEETING] };
      }
      if (process.env.STENOAI_E2E_SEED_STALE_NOTE === '1') {
        return { success: true, meetings: [STALE_MEETING] };
      }
      if (process.env.STENOAI_E2E_SEED_PROCESSING_NOTE === '1') {
        return { success: true, meetings: [PROCESSING_MEETING] };
      }
      if (seedSpeakers) {
        return { success: true, meetings: [SPEAKER_SEED_MEETING] };
      }
      if (process.env.STENOAI_E2E_SEED_MEETING === '1') {
        return { success: true, meetings: [seededMeeting()] };
      }
      return { success: true, meetings: SEEDED_MEETINGS };
    },

    // Mirror the real handler just enough for the copy-notes-report T1: persist
    // the switch so the refetch that follows the mutation doesn't reset the
    // pill. 'standard' clears it, like src/reports.py set_active.
    'set-active-report': async (_event, _summaryFile, reportId) => {
      seedActiveReport = !reportId || reportId === 'standard' ? null : reportId;
      return { success: true };
    },

    // The detail route loads via get-meeting (the lazy per-meeting fetch), not
    // by filtering list-meetings — answer it with the same seeded meeting so the
    // transcript-export detail route resolves and renders the transcript actions.
    'get-meeting': async (_event, summaryFile) => {
      if (process.env.STENOAI_E2E_SEED_PENDING_NOTE === '1') {
        return { success: true, meeting: applyOverlay(PENDING_MEETING) };
      }
      if (process.env.STENOAI_E2E_SEED_STALE_NOTE === '1') {
        return { success: true, meeting: applyOverlay(STALE_MEETING) };
      }
      if (process.env.STENOAI_E2E_SEED_PROCESSING_NOTE === '1') {
        return { success: true, meeting: applyOverlay(PROCESSING_MEETING) };
      }
      if (seedSpeakers) {
        return { success: true, meeting: SPEAKER_SEED_MEETING };
      }
      if (process.env.STENOAI_E2E_SEED_MEETING === '1') {
        // seededMeeting() carries main's optional template-report; applyOverlay
        // layers my user_notes edits on top (My notes tab round-trip).
        return { success: true, meeting: applyOverlay(seededMeeting()) };
      }
      const m = SEEDED_MEETINGS.find(
        (x) => x.session_info && x.session_info.summary_file === summaryFile,
      );
      return m
        ? { success: true, meeting: applyOverlay(m) }
        : { success: false, error: 'meeting not found' };
    },

    // Soft-delete (#234). The permissive unknown-channel default would answer
    // `{success:true}` with no `id`, and useDeleteMeeting skips the Undo toast
    // without one — so the delete-UX T1 needs the real response shape here.
    // State is per-launch: the id counter and store let undo/commit key off it
    // the way main's pendingDelete map does.
    'delete-meeting': async (_event, meeting) => {
      const id = `e2e-delete-${++pendingDeleteSeq}`;
      pendingDeletes[id] = meeting;
      // Long enough that the window can't expire mid-assertion; the spec drives
      // undo/dismiss explicitly rather than waiting this out.
      return { success: true, id, deadline: Date.now() + 60_000 };
    },
    'undo-delete-meeting': async (_event, id) => {
      const meeting = pendingDeletes[id];
      if (!meeting) return { success: false, error: 'no pending delete' };
      delete pendingDeletes[id];
      return { success: true, meeting };
    },
    'commit-delete-meeting': async (_event, id) => {
      delete pendingDeletes[id];
      return { success: true };
    },
    // Nothing survives a mock launch, so there is never a window to restore —
    // but answer with the real shape (`pending: []`) rather than letting the
    // permissive default hand the toast an undefined array to map over.
    'list-pending-deletes': async () => ({ success: true, pending: [] }),

    // My notes autosave: persist the overlay so a follow-up get-meeting sees
    // the edit (mirrors the real update-meeting body-section upsert).
    'update-meeting': async (_event, summaryFile, patch) => {
      if (patch && typeof patch.user_notes === 'string') {
        meetingOverlay[summaryFile] = {
          ...(meetingOverlay[summaryFile] || {}),
          user_notes: patch.user_notes,
        };
      }
      return { success: true, message: 'ok' };
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

    // Mirror the real export-note-pdf handler's seam. The mock has no Chromium
    // to rasterise HTML, so instead of a PDF it writes the renderer-built HTML
    // verbatim to STENOAI_E2E_EXPORT_PATH — that lets a T1 spec assert the exact
    // document the renderer produced (the HTML→PDF render is covered by the T2
    // spec against the real handler). Without the seam there's no dialog here,
    // so report a cancel.
    'export-note-pdf': async (_event, _defaultFilename, html) => {
      if (typeof html !== 'string' || html.length === 0) {
        return { success: false, error: 'No notes content to export.' };
      }
      const seamPath = process.env.STENOAI_E2E_EXPORT_PATH;
      if (!seamPath) return { success: false, error: EXPORT_CANCELED };
      fs.writeFileSync(seamPath, html, 'utf-8');
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

    // Onboarding permission gate. The real handlers ask macOS; under mock IPC we
    // grant so the setup-progress spec can run past the first step. Harmless for
    // other specs, none of which invoke these channels.
    'check-microphone-permission': async () => ({ success: true, status: 'granted' }),
    'request-microphone-permission': async () => ({ success: true, granted: true }),

    // Onboarding model downloads. With STENOAI_E2E_SETUP_PROGRESS=1 the handler
    // emits the same renderer progress events the real handlers do, then holds
    // the step in its 'running' state (the promise never resolves) so the
    // download-progress spec can observe the bar. The app is torn down at test
    // end. Without the flag they resolve success, matching the permissive
    // default so nothing else changes.
    'setup-parakeet': async (event) => {
      if (process.env.STENOAI_E2E_SETUP_PROGRESS === '1') {
        const wc = event && event.sender;
        if (wc && !wc.isDestroyed()) {
          // Parakeet exposes only coarse stages (no byte counts).
          wc.send('parakeet-pull-progress', { stage: 'downloading' });
        }
        return new Promise(() => {});
      }
      return { success: true, message: 'Parakeet model ready' };
    },
    'setup-ollama-and-model': async (event) => {
      if (process.env.STENOAI_E2E_SETUP_PROGRESS === '1') {
        const wc = event && event.sender;
        if (wc && !wc.isDestroyed()) {
          // Two records: the phase change (manifest -> blob) and a byte-progress
          // line, mirroring the real { status, pct, completed, total } payload.
          wc.send('setup-ollama-progress', { status: 'pulling manifest', pct: 0, completed: 0, total: 0 });
          wc.send('setup-ollama-progress', {
            status: 'pulling sha256:abcd',
            pct: 42,
            completed: 42,
            total: 100,
          });
        }
        return new Promise(() => {});
      }
      return { success: true, message: 'Ollama and AI model ready' };
    },

    'list-person-profiles': async () => ({ success: true, person_profiles: speakerState.personProfiles }),

    'suggest-speakers': async (_event, meetingStem) => ({
      success: true,
      meeting_id: meetingStem,
      recording_available: seedSpeakers,
      channels: speakerState.suggestions,
    }),

    // Deterministic fake clip -- no real ffmpeg/audio decode in T1. Always
    // "succeeds" when speaker suggestions are seeded, mirroring
    // recording_available: true above.
    'get-speaker-sample-audio': async (_event, _meetingStem, _channel, _diarizationSpeakerId) => {
      if (!seedSpeakers) return { success: false, error: 'no source audio available' };
      // A real (if silent/empty) minimal 16-bit mono WAV -- so the renderer's
      // blob: URL construction + <audio> playback path is exercised with
      // valid audio data, not just a placeholder string.
      return { success: true, audio_base64: MINIMAL_WAV_BASE64 };
    },

    // Accepts either --person-id (Change) or --new-person (New person) mode,
    // mirroring the real CLI's exactly-one-of contract. Mutates
    // speakerState so a subsequent suggest-speakers refetch (the panel's
    // real post-confirm behaviour) reflects the confirmation.
    'confirm-speaker': async (_event, params) => {
      const { meetingStem, channel, diarizationSpeakerId, personId, newPersonName } = params || {};
      if (!meetingStem || !channel || !diarizationSpeakerId) {
        return { success: false, error: 'missing required fields' };
      }
      if (Boolean(personId) === Boolean(newPersonName)) {
        return { success: false, error: 'Specify exactly one of personId or newPersonName' };
      }
      let person = personId
        ? speakerState.personProfiles.find((p) => p.person_id === personId)
        : null;
      if (newPersonName) {
        if (personNameTaken(newPersonName)) {
          return { success: false, error: `A person named '${newPersonName.trim()}' already exists` };
        }
        person = {
          person_id: `p-${newPersonName.toLowerCase().replace(/\s+/g, '-')}`,
          display_name: newPersonName,
          prototype_counts: {}, hard_negative_counts: {}, updated_at: Date.now(),
        };
        speakerState.personProfiles.push(person);
      }
      if (!person) return { success: false, error: `No person profile with id ${personId}` };

      // Preserve the cluster's identification anchors (duration/segment
      // count/first_timestamp never change just because a name was
      // confirmed) -- only the suggestion fields are overwritten.
      const channelSuggestions = speakerState.suggestions[channel] || (speakerState.suggestions[channel] = {});
      const previous = channelSuggestions[diarizationSpeakerId] || {
        speech_duration_seconds: 0, segment_count: 0, first_timestamp: null,
        sample_text: null, is_likely_artifact: false, confirmed_by_user: null,
      };
      channelSuggestions[diarizationSpeakerId] = {
        ...previous,
        status: 'confirmed', suggested_person_id: person.person_id, suggested_name: person.display_name,
        merged_from: [],
        candidates: [{ person_id: person.person_id, display_name: person.display_name, distance: 0, hard_negative_conflict: false }],
        reasons: [],
        // Real persisted evidence now exists for this cluster -- mirrors the
        // real backend's confirmed_by_user derivation (a matching
        // SpeakerPrototype), so it survives a simulated navigate-away-and-back
        // (a fresh suggest-speakers refetch) even after this panel unmounts.
        confirmed_by_user: person.display_name,
      };

      return {
        success: true,
        person_id: person.person_id,
        display_name: person.display_name,
        prototype_id: `proto-${diarizationSpeakerId}`,
        resolved_diarization_speaker_id: diarizationSpeakerId,
        merged_from: [],
        hard_negatives_added_against: [],
        relabeled_lines: 0,
      };
    },

    'create-person-profile': async (_event, displayName) => {
      if (personNameTaken(displayName)) {
        return { success: false, error: `A person named '${displayName.trim()}' already exists` };
      }
      const person = {
        person_id: `p-${displayName.toLowerCase().replace(/\s+/g, '-')}`,
        display_name: displayName,
        prototype_counts: {}, hard_negative_counts: {}, updated_at: Date.now(),
      };
      speakerState.personProfiles.push(person);
      return { success: true, person_id: person.person_id, display_name: person.display_name };
    },

    'rename-person-profile': async (_event, id, displayName) => {
      const person = speakerState.personProfiles.find((p) => p.person_id === id);
      if (!person) return { success: false };
      if (personNameTaken(displayName, id)) {
        return { success: false, error: `A person named '${displayName.trim()}' already exists` };
      }
      person.display_name = displayName;
      return { success: true };
    },

    // Mirrors the real backend: suggest-speakers recomputes candidates/
    // confirmed_by_user from person_profiles on every call, so a deleted
    // person's references disappear from any cluster that pointed at them.
    'delete-person-profile': async (_event, id) => {
      const before = speakerState.personProfiles.length;
      speakerState.personProfiles = speakerState.personProfiles.filter((p) => p.person_id !== id);
      const deleted = speakerState.personProfiles.length < before;
      if (deleted) {
        for (const channelSuggestions of Object.values(speakerState.suggestions)) {
          for (const suggestion of Object.values(channelSuggestions)) {
            if (suggestion.suggested_person_id === id) {
              suggestion.status = 'none';
              suggestion.suggested_person_id = null;
              suggestion.suggested_name = null;
              suggestion.confirmed_by_user = null;
              suggestion.candidates = suggestion.candidates.filter((c) => c.person_id !== id);
            }
          }
        }
      }
      return { success: deleted };
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

  // Matches src/parakeet.py's platform dispatch: MLX on darwin, ONNX
  // elsewhere. Mock IDs should track that split so a T1 run on Windows/Linux
  // CI doesn't advertise a macOS-only model as installed/current.
  const PARAKEET_MODEL_ID =
    process.platform === 'darwin'
      ? 'mlx-community/parakeet-tdt-0.6b-v3'
      : 'istupakov/parakeet-tdt-0.6b-v3-onnx';

  const DEFAULTS = {
    'get-app-version': { success: true, version: '0.0.0-e2e', name: 'Steno' },
    // Read-only display poll for the About tab's "Check for Updates" button
    // (settings-about.t1). Fully hermetic — no real GitHub call under mock
    // IPC, so this is the only source of truth for that flow in T1.
    'check-for-updates': () => {
      // STENOAI_E2E_SEED_UPDATE_BLOCKED_OS=1 simulates an under-floor Mac: an
      // update exists on GitHub but this OS is below the 14.4 launch floor, so
      // osUpdateEligible is false and the About tab must explain that instead of
      // offering a broken install/download nudge (#432, settings-about.t1).
      if (process.env.STENOAI_E2E_SEED_UPDATE_BLOCKED_OS === '1') {
        return {
          success: true,
          updateAvailable: true,
          currentVersion: '0.0.0-e2e',
          latestVersion: '9.9.9',
          releaseUrl: 'https://github.com/ruzin/stenoai/releases/latest',
          releaseName: 'Version 9.9.9',
          downloadUrl: null,
          osUpdateEligible: false,
        };
      }
      return {
        success: true,
        updateAvailable: false,
        currentVersion: '0.0.0-e2e',
        latestVersion: '0.0.0-e2e',
        releaseUrl: '',
        releaseName: '',
        downloadUrl: null,
        osUpdateEligible: true,
      };
    },
    // AboutTab's mount-time re-seed effect. Without an explicit stub, both
    // fields fall through to the permissive default (undefined, not null),
    // and `downloadPercent !== null` reads true for undefined — showing a
    // stray "Downloading update… undefined%" bar on first paint.
    // STENOAI_E2E_SEED_UPDATE_ERROR seeds a persisted failed background update
    // so the About tab's mount-time rehydration (settings-about.t1) can assert
    // the failure is restored on navigation, not just from the live one-shot
    // 'update-error' event.
    'get-update-status': () => ({
      success: true,
      downloadedVersion: null,
      downloadPercent: null,
      downloadError:
        process.env.STENOAI_E2E_SEED_UPDATE_ERROR === '1' ? 'network unreachable' : null,
    }),
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
    // Without these, both new toggles fall through to the permissive
    // {success:true} default (no show_menu_bar_icon/premeeting_notifications_enabled
    // field), and GeneralTab's disabled={...data === undefined} leaves both
    // switches permanently disabled under mock IPC.
    'get-menu-bar-icon': { success: true, show_menu_bar_icon: true },
    'get-premeeting-notifications': { success: true, premeeting_notifications_enabled: true },
    // parakeet-status lives in MOCKS (env-gated installed flag).
    // Transcribe tab reads this on first paint. (The engine itself moved to
    // MOCKS so STENOAI_E2E_MOCK_ENGINE can override it; default parakeet keeps
    // the language picker enabled — parakeet-language-picker.t1.)
    'get-language': { success: true, language: 'auto' },
    // Real production catalog (src/whisper_models.py / src/parakeet_models.py)
    // rather than empty — so the Settings UI's model list actually renders
    // cards to look at (manual/dev use) instead of always erroring "Could not
    // load transcription models." Parakeet ships pre-"installed" (matches the
    // fresh-install default engine); Whisper stays uninstalled so the
    // Download button state is also visible in the same screen.
    'list-whisper-models': {
      success: true,
      supported_models: {
        'large-v3-turbo': {
          name: 'Whisper Large V3 Turbo',
          size: '1.6GB',
          installed: false,
          description:
            'Best accuracy Whisper model. Supports 99 languages including non-European languages such as Chinese, Japanese, Arabic, Korean, and Hindi.',
          speed: 'medium',
          quality: 'excellent',
        },
      },
      current_model: '',
      provider: 'whisper',
    },
    'list-parakeet-models': {
      success: true,
      supported_models: {
        [PARAKEET_MODEL_ID]: {
          name: 'Parakeet TDT v3',
          size: '572MB',
          installed: true,
          description:
            'Highest quality. Supports live transcription in English and 25 European languages — Spanish, French, German, Italian, Portuguese, Dutch, Russian, Polish, Czech, and 16 others.',
          speed: 'very fast',
          quality: 'excellent',
        },
      },
      current_model: PARAKEET_MODEL_ID,
    },
    // Summarisation & Chat's local "Model" list (ModelList in AiTab.tsx). Real
    // production catalog (Config.SUPPORTED_MODELS in src/config.py) so that
    // section also renders cards to look at under mock IPC instead of always
    // erroring "Could not reach Ollama." -- the same reasoning as the Whisper/
    // Parakeet lists above. Only the default model ships "installed"; the
    // matches config.py's fresh-install default and its deprecated flag.
    'list-models': {
      success: true,
      current_model: 'gemma4:e2b-it-qat',
      provider: 'local',
      // A 16 GB Mac: enough for the small models but not gemma4:12b / gpt-oss:20b,
      // which drives the "May exceed memory" badge (see model-memory.ts, #248).
      total_ram_gb: 16,
      supported_models: {
        'gemma4:e2b-it-qat': {
          name: 'Gemma 4 E2B (QAT)',
          size: '4.3GB',
          params: '2B',
          description: 'Lightest Gemma 4, quantization-aware, real 128K context (default)',
          speed: 'fast',
          quality: 'good',
          installed: true,
        },
        'gemma4:e4b-it-qat': {
          name: 'Gemma 4 E4B (QAT)',
          size: '6.1GB',
          params: '4B',
          description: 'Quantization-aware E4B — higher quality than E2B at a modest footprint',
          speed: 'medium',
          quality: 'excellent',
          installed: false,
        },
        'llama3.2:3b': {
          name: 'Llama 3.2 3B',
          size: '2GB',
          params: '3B',
          description: 'Replaced by Gemma 4 E2B',
          speed: 'very fast',
          quality: 'good',
          deprecated: true,
          installed: false,
        },
        'qwen3.5:9b': {
          name: 'Qwen 3.5 9B',
          size: '6.6GB',
          params: '9B',
          description: 'Excellent at structured output and action items',
          speed: 'medium',
          quality: 'excellent',
          installed: false,
        },
        'gemma4:12b-it-qat': {
          name: 'Gemma 4 12B (QAT)',
          size: '7.2GB',
          params: '12B',
          description: 'Large 256K context, quantization-aware - best for long meetings',
          speed: 'medium',
          quality: 'excellent',
          installed: false,
        },
        'gpt-oss:20b': {
          name: 'GPT-OSS 20B',
          size: '14GB',
          params: '20B',
          description: 'OpenAI open-weight model with reasoning capabilities',
          speed: 'medium',
          quality: 'excellent',
          installed: false,
        },
      },
    },
    'get-current-model': { success: true, model: 'gemma4:e2b-it-qat' },
    // get-queue-status lives in MOCKS (stateful recording machine) — its idle
    // shape is identical to the static default that used to sit here.
    // Settings > Templates renders a row per template with badge/prompt/action
    // variety (default, locked built-in, unlocked built-in, custom) — an empty
    // list would only ever show the "New Template" row.
    'list-templates': {
      success: true,
      templates: [
        {
          id: 'standard',
          name: 'Standard Summary',
          icon: '',
          prompt: '',
          language: 'auto',
          format: 'structured',
          builtin: true,
          locked: true,
        },
        {
          id: 'action-items',
          name: 'Action Items',
          icon: '',
          prompt:
            'Summarise the meeting into a punchy list of action items, each with an owner and a due date if one was mentioned.',
          language: 'auto',
          format: 'markdown',
          builtin: true,
          locked: false,
        },
        {
          id: 'exec-summary',
          name: '1:1 Notes',
          icon: '',
          prompt:
            'Write a short executive summary followed by decisions made and open questions still outstanding.',
          language: 'en',
          format: 'markdown',
          builtin: false,
          locked: false,
        },
      ],
      default_template_id: 'standard',
    },
  };

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, realFn) => {
    let fn;
    if (MOCKS[channel]) {
      fn = MOCKS[channel];
    } else if (Object.prototype.hasOwnProperty.call(DEFAULTS, channel)) {
      const value = DEFAULTS[channel];
      // A function-valued default is evaluated per invoke (so it can read
      // env seeds set for a specific spec); a plain value is returned as-is.
      fn = typeof value === 'function' ? value : async () => value;
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

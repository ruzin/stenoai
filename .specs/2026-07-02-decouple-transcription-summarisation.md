# Spec: Decouple transcription from summarisation (Granola-style manual notes)

_Author: /zoro · 2026-07-02 · status: approved_

## Problem / Why
Today, stopping a recording immediately runs transcribe→summarise in one shot
(`process-streaming`, `simple_recorder.py:672`). You can't record without
committing to a summary, can't pause/resume freely, and there's no such thing as
a note you've only transcribed. We want the Granola model: transcription is a
live, pausable/resumable/stoppable activity in its own right, and a summary is
generated only when the user explicitly asks for it.

## Goals
- Transcription and summarisation are independent: stopping transcription never
  auto-summarises.
- A recording produces a **transcript-only note** the moment it stops — listed and
  browsable with no summary yet.
- A **Generate notes** action (button above the Ask bar) summarises that transcript
  on demand.
- Transcription lives in its own **pill** next to the Ask bar; expanding it shows
  the live transcript, timer, and consent notice, with **Pause / Resume / Stop**.
- You can **Resume** transcribing into an existing note (append), then regenerate.

## Non-Goals
- **Whisper.** v1 is Parakeet-only; whisper keeps today's auto-summarise-on-stop
  path unchanged (`App.tsx:231` already forks on engine).
- **Batch transcription for Parakeet** — no batch pass; we trust and persist the
  live transcript. (No background "upgrade" pass either.)
- **True channel diarisation** — we keep the existing renderer-side heuristic
  You/Others (`decideSpeaker`, `liveRmsBuffer.ts`); no stereo split in the live path.
- **Live language switching** in the panel (display-only / omitted for v1).
- **Audio pre-processing** (high-pass/loudnorm) on the persisted live transcript.

## Users & Context
A Steno user on Parakeet (macOS) recording a meeting who wants to control when
(and whether) an AI summary is produced — including recording in segments and
generating notes only at the end.

## Requirements
### Functional
- Start recording → live transcript accumulates in the pill (as today).
- **Pause** holds the session (mic retained); **Resume** continues.
- **Stop** ends the session, releases the mic, and persists a transcript-only note
  that appears in the notes list. No summary is generated.
- The persisted transcript retains the live **You/Others labels + [MM:SS]**
  (today they're shown but dropped on save — `is_diarised:False`).
- **Generate notes** appears above the Ask bar when transcription is stopped/paused
  and a transcript exists with no summary yet. Clicking it summarises the transcript
  (streamed) and fills the note.
- **Resume** on a stopped note re-arms capture into the same note, appends to its
  transcript; **Regenerate** (existing) re-summarises.
- The transcribe pill expands into a panel: consent notice, timer, live transcript
  (reuse `LiveTranscriptBar`), Pause/Resume + Stop.

### Non-Functional
- Parakeet/macOS only; gate all new UI + flow on engine === parakeet, leave the
  whisper path byte-for-byte unchanged.
- Stop→note-listed should feel instant (no transcription pass).
- Follows CLAUDE.md: add/adjust e2e coverage in the same change.

## Proposed Approach
Split the monolith. For Parakeet, **bypass `process-streaming`** entirely:

1. **Persist a transcript-only note on Stop.** The renderer already holds the
   labelled live segments (`useLiveTranscript`, `LiveSegment.speaker`). On Stop,
   send them to a new IPC handler that writes a note file shaped like today's
   `<stem>_summary.md` but with the transcript embedded under `## Transcript`
   (labelled `[MM:SS] [You]/[Others]` lines, `is_diarised:true`) and an **empty
   summary body marked `summary_status: pending`** — mirroring the existing
   "transcription-failure" precedent that writes a reprocessable note without a
   summary (`simple_recorder.py:391-449`). New small CLI command (e.g.
   `save-transcript-note`) does the write.
2. **Generate notes = reuse `reprocess`.** `reprocess` already summarises the
   transcript embedded in a note file with no re-transcription
   (`simple_recorder.py:1941`, IPC `reprocess-meeting` `main.js:1866`). "Generate
   notes" calls it; the streamed `CHUNK:`/`STREAM_COMPLETE` UI already exists.
   Flip `summary_status: pending → done` on save.
3. **Note lifecycle / list.** `MeetingDetail` gains a `pending` state (distinct
   from `transcription_failed`): render the empty "Write notes" body + the Generate
   notes CTA; show the transcript via the pill/panel. Existing `Regenerate`
   (`MeetingDetail.tsx:552`) covers post-generation re-runs.
4. **Bottom-dock UI rework.** Reshape `BottomDockSlot` (`App.tsx:184-232`): the
   recording dock becomes the collapsed **transcribe pill** (state: Recording+timer
   / Paused-Resume / Stopped-Resume) that expands to the panel; add the **Generate
   notes** button above the Ask bar. Pause/Resume reuse `useSystemAudioCapture`
   (`:632`) + `useRecording` (`:203`).
5. **Kill auto-summarise for Parakeet.** Skip `addToProcessingQueue` /
   `process-streaming` on the Parakeet stop path (`main.js:6846`); route Stop to the
   new persist step instead. Whisper still enqueues as today.

### Alternatives Considered
- **Live now + batch upgrade in background** — best quality + instant feel, but two
  transcripts to reconcile; deferred (see Non-Goals).
- **New "summarise-from-transcript" command** instead of reusing `reprocess` —
  rejected; `reprocess` already reads the embedded transcript, so shaping the note
  file to carry it is less code.

## Affected Areas
- `app/main.js` — `stop-recording-ui` (`:3838`), `process-system-audio-recording`
  (`:6846`), `processNextInQueue` (`:3329`), `LIVE_SEG` handling (`:3003-3041`),
  `liveTranscriptState` (`:3139`), `reprocess-meeting` (`:1866`); new persist IPC.
- `simple_recorder.py` — new `save-transcript-note` command; `reprocess` (`:1941`);
  failure-note precedent (`:391-449`). `process-streaming` (`:672`) untouched
  (whisper).
- Renderer — `App.tsx` `BottomDockSlot` (`:184-232`), `LiveDock.tsx`,
  `LiveTranscriptBar.tsx`, `AskBar.tsx` (`:109`), `MeetingDetail.tsx` (`:537-559`),
  `useSystemAudioCapture.ts` (`:632`), `useRecording.ts` (`:203`),
  `useLiveTranscript.ts` (`:81`), `ipc.ts` (`LiveSegment` `:586`, new bridge calls).
- e2e — new/updated T2 spec for the decoupled flow.

## Edge Cases & Failure Modes
- **Stop with empty transcript** → don't create a note (no-op + toast).
- **Quit/crash mid-session** → in-memory live transcript is lost (same exposure as
  today; note only persists on Stop). Flagged as a risk, not solved in v1.
- **Generate notes while actively transcribing** → disabled until paused/stopped.
- **Multiple Stop→Resume cycles** → transcript appends; note file re-written each Stop.
- **Whisper user** → new pill/flow hidden; old behavior intact.
- **`.org` adapter / auto-backup** → summary-backup only fires after Generate notes,
  not on transcript-only save (verify backup gating).

## Decisions (confirmed)
- **Title.** Transcript-only notes use a placeholder title (date / "New note") until
  Generate notes; the real title is generated at Generate-notes time (title gen
  currently lives inside the skipped `process-streaming`).
- **Carrier.** Reuse the `<stem>_summary.md` file as the transcript-only carrier with
  a `summary_status: pending` marker (so `reprocess` works unchanged), rather than a
  separate transcript-only record type.

## Risks & Open Questions
- Persisted transcript quality = live quality (per-utterance, no cleanup, heuristic
  speaker labels). Accepted, but it's a visible drop from batch for some meetings.
- Reusing the `_summary.md` file as the transcript-only carrier: confirm the
  meetings list + `MeetingDetail` handle `summary_status: pending` cleanly and it
  doesn't read as a "failed" note.
- Does anything else depend on `process-streaming` running on stop (analytics,
  titles, heartbeats)? Title gen moves to Generate-notes time (see Decisions);
  verify nothing else is stranded.

## Acceptance Criteria
- [ ] Stopping a Parakeet recording creates a transcript-only note in the list with
      **no** summary generated.
- [ ] The transcribe pill sits beside the Ask bar; expanding shows live transcript +
      timer + consent; Pause / Resume / Stop behave correctly.
- [ ] Generate notes appears when stopped/paused with a transcript; clicking it
      streams a summary into the note.
- [ ] Resume appends to the same note's transcript; Regenerate re-summarises.
- [ ] Saved transcript retains You/Others + [MM:SS].
- [ ] Whisper recordings still auto-summarise on stop (unchanged).
- [ ] e2e T2 spec covers stop→transcript-only-note→generate-notes.

## Out of Scope / Future
- Whisper decoupled flow.
- Background batch upgrade for channel-accurate diarisation + audio cleanup.
- Live language switching in the panel.
- Persistence of an in-progress session across app quit/crash.

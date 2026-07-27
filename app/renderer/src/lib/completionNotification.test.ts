import { describe, it, expect } from 'vitest';
import { classifyCompletionNotification, meetingAlreadyHasNotes } from './completionNotification';

describe('classifyCompletionNotification (#bug2/#bug3)', () => {
  it('notes generated → note-ready (auto_summarize on / reprocess done)', () => {
    expect(classifyCompletionNotification({ notesGenerated: true })).toBe('note-ready');
  });

  it('no notes generated → transcript-ready (auto_summarize off, transcript-only)', () => {
    expect(classifyCompletionNotification({ notesGenerated: false })).toBe('transcript-ready');
  });

  it('notesGenerated absent → transcript-ready (defaults to no notes)', () => {
    expect(classifyCompletionNotification({})).toBe('transcript-ready');
  });

  it('transcription failure → note-ready even with no notes (never offers "generate notes")', () => {
    expect(
      classifyCompletionNotification({ notesGenerated: false, transcriptionFailed: true }),
    ).toBe('note-ready');
  });

  it('failure marked on the meeting → note-ready', () => {
    expect(
      classifyCompletionNotification({
        notesGenerated: false,
        meetingTranscriptionFailed: true,
      }),
    ).toBe('note-ready');
  });

  it('notes generated AND failed → note-ready', () => {
    expect(
      classifyCompletionNotification({ notesGenerated: true, transcriptionFailed: true }),
    ).toBe('note-ready');
  });

  it('append/continue: no new notes but the note already has them → note-ready (M2)', () => {
    expect(
      classifyCompletionNotification({ notesGenerated: false, notesAlreadyExist: true }),
    ).toBe('note-ready');
  });

  it('append into a still-transcript-only note (no notes either way) → transcript-ready', () => {
    expect(
      classifyCompletionNotification({ notesGenerated: false, notesAlreadyExist: false }),
    ).toBe('transcript-ready');
  });
});

describe('meetingAlreadyHasNotes (#M2 — real notes_generated semantics)', () => {
  // The backend NEVER writes notes_generated:true — it writes false for a
  // transcript-only note or omits the key when the note has notes. These cases
  // exercise the real values the call site actually receives (the prior fix's
  // `Boolean(notes_generated)` was always false because true never occurs).
  it('note WITH notes: notes_generated absent → true', () => {
    expect(meetingAlreadyHasNotes({ session_info: {} })).toBe(true);
  });

  it('transcript-only note: notes_generated explicitly false → false', () => {
    expect(meetingAlreadyHasNotes({ session_info: { notes_generated: false } })).toBe(false);
  });

  it('no meetingData on the event → false (fall back to the transient signal)', () => {
    expect(meetingAlreadyHasNotes(undefined)).toBe(false);
    expect(meetingAlreadyHasNotes(null)).toBe(false);
  });

  it('append into a note with notes classifies as note-ready end-to-end', () => {
    // SUMMARY_SKIPPED (notesGenerated false) + a note that already has notes.
    const notesAlreadyExist = meetingAlreadyHasNotes({ session_info: {} });
    expect(classifyCompletionNotification({ notesGenerated: false, notesAlreadyExist })).toBe(
      'note-ready',
    );
  });

  it('fresh transcript-only note classifies as transcript-ready end-to-end', () => {
    const notesAlreadyExist = meetingAlreadyHasNotes({
      session_info: { notes_generated: false },
    });
    expect(classifyCompletionNotification({ notesGenerated: false, notesAlreadyExist })).toBe(
      'transcript-ready',
    );
  });
});

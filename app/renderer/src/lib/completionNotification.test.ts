import { describe, it, expect } from 'vitest';
import { classifyCompletionNotification } from './completionNotification';

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
});

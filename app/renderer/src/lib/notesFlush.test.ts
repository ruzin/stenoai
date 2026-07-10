import { describe, test, expect, vi } from 'vitest';
import { flushNotesThenProcess } from '@/lib/notesFlush';

describe('flushNotesThenProcess', () => {
  test('flushes the latest notes, then processes — in that order', async () => {
    const calls: string[] = [];
    const saveNotes = vi.fn(async () => {
      calls.push('save');
    });
    const processRecording = vi.fn(async () => {
      calls.push('process');
    });

    await flushNotesThenProcess({
      name: 'Note',
      filePath: '/tmp/rec.webm',
      getDraftNotes: () => 'last-second edit',
      saveNotes,
      processRecording,
    });

    expect(saveNotes).toHaveBeenCalledWith('Note', 'last-second edit');
    expect(processRecording).toHaveBeenCalledWith('/tmp/rec.webm', 'Note');
    expect(calls).toEqual(['save', 'process']); // write must land before the read
  });

  test('skips the write when there are no notes, but still processes', async () => {
    const saveNotes = vi.fn(async () => {});
    const processRecording = vi.fn(async () => {});

    for (const notes of [undefined, '']) {
      await flushNotesThenProcess({
        name: 'Note',
        filePath: '/tmp/rec.webm',
        getDraftNotes: () => notes,
        saveNotes,
        processRecording,
      });
    }

    expect(saveNotes).not.toHaveBeenCalled();
    expect(processRecording).toHaveBeenCalledTimes(2);
  });

  test('a failed flush does not block processing (best-effort)', async () => {
    const err = new Error('disk full');
    const onFlushError = vi.fn();
    const processRecording = vi.fn(async () => {});

    await flushNotesThenProcess({
      name: 'Note',
      filePath: '/tmp/rec.webm',
      getDraftNotes: () => 'notes',
      saveNotes: async () => {
        throw err;
      },
      processRecording,
      onFlushError,
    });

    expect(onFlushError).toHaveBeenCalledWith(err);
    expect(processRecording).toHaveBeenCalledTimes(1);
  });
});

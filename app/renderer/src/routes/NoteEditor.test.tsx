import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteEditor, validateNotePatch, type NoteDraft } from './NoteEditor';

const DRAFT: NoteDraft = {
  summary: 'We agreed the budget.',
  keyPoints: ['Budget approved'],
  actionItems: ['Anna sends the draft'],
  discussionAreas: [{ title: 'Budget', analysis: 'Reviewed.' }],
};

describe('NoteEditor', () => {
  it('renders the current values', () => {
    render(<NoteEditor value={DRAFT} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue('We agreed the budget.')).toBeTruthy();
    expect(screen.getByDisplayValue('Budget approved')).toBeTruthy();
  });

  it('keeps Save disabled until something changes', () => {
    render(<NoteEditor value={DRAFT} onSave={vi.fn()} onCancel={vi.fn()} />);
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'We agreed the Q3 budget.' },
    });
    expect(save.disabled).toBe(false);
  });

  it('sends only the fields that actually changed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'We agreed the Q3 budget.' },
    });
    // act() around the click flushes the resolved onSave promise, so the
    // component's own post-save state update doesn't land after the test ends.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalledWith({ summary: 'We agreed the Q3 budget.' });
  });

  it('refuses a value containing a markdown heading and explains why', () => {
    const onSave = vi.fn();
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'ok\n## Transcript' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/heading/i)).toBeTruthy();
  });

  it('removes a list row', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /remove key point 1/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalledWith({ key_points: [] });
  });

  it('calls onCancel without saving', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  // ---- beyond the brief -------------------------------------------------

  it('adds a row and sends the appended entry', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add action item/i }));
    fireEvent.change(screen.getByLabelText('Action item 2'), {
      target: { value: 'Ben books the room' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalledWith({
      action_items: ['Anna sends the draft', 'Ben books the room'],
    });
  });

  it('does not enable Save for an added but still-empty row', () => {
    render(<NoteEditor value={DRAFT} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add key point/i }));
    const save = screen.getByRole('button', { name: /save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('edits a topic title and analysis', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Budget'), { target: { value: 'Q3 budget' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(onSave).toHaveBeenCalledWith({
      discussion_areas: [{ title: 'Q3 budget', analysis: 'Reviewed.' }],
    });
  });

  it('keeps edit mode open and preserves typing when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Disk is full'));
    const onCancel = vi.fn();
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={onCancel} />);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'We agreed the Q3 budget.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/disk is full/i)).toBeTruthy());
    expect(screen.getByDisplayValue('We agreed the Q3 budget.')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables both buttons while a save is in flight', async () => {
    let release!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );
    render(<NoteEditor value={DRAFT} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('We agreed the budget.'), {
      target: { value: 'We agreed the Q3 budget.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement).disabled).toBe(
        true
      );
    });
    expect((screen.getByRole('button', { name: /cancel/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
    release();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

/**
 * The line-break guard can't be driven through the rendered single-line inputs:
 * jsdom (like a real browser) applies the value-sanitization algorithm to
 * `input[type=text]` and strips CR/LF on assignment, so a newline can never
 * reach the draft that way. It CAN reach it from the note on disk, which is
 * exactly the case that must not be saved back through renderBulletList. So the
 * guard is tested where it lives, as a pure function.
 */
describe('validateNotePatch', () => {
  it('passes a clean patch', () => {
    expect(validateNotePatch({ summary: 'Fine.', key_points: ['a', 'b'] })).toBeNull();
  });

  it('rejects a markdown heading in any field', () => {
    expect(validateNotePatch({ summary: 'ok\n## Transcript' })).toMatch(/heading/i);
    expect(validateNotePatch({ key_points: ['### forged'] })).toMatch(/heading/i);
    expect(validateNotePatch({ action_items: ['ok', '  # forged'] })).toMatch(/heading/i);
    expect(validateNotePatch({ discussion_areas: [{ title: '# forged' }] })).toMatch(/heading/i);
    expect(
      validateNotePatch({ discussion_areas: [{ title: 'ok', analysis: 'a\n#### forged' }] })
    ).toMatch(/heading/i);
  });

  it('does not mistake a hash that is not a heading for one', () => {
    expect(validateNotePatch({ summary: 'Ticket #42 is done.' })).toBeNull();
    expect(validateNotePatch({ key_points: ['C#'] })).toBeNull();
  });

  it('rejects a line break in a list entry, which renderBulletList would truncate', () => {
    expect(validateNotePatch({ key_points: ['line one\nline two'] })).toMatch(/line break/i);
    expect(validateNotePatch({ action_items: ['line one\r\nline two'] })).toMatch(/line break/i);
  });

  it('rejects a line break in a topic title, which would slide into the analysis', () => {
    expect(validateNotePatch({ discussion_areas: [{ title: 'Budget\nreview' }] })).toMatch(
      /line break/i
    );
    expect(validateNotePatch({ discussion_areas: [{ title: 'Budget\rreview' }] })).toMatch(
      /line break/i
    );
  });

  it('allows a line break in the summary and in a topic analysis', () => {
    expect(validateNotePatch({ summary: 'One.\n\nTwo.' })).toBeNull();
    expect(
      validateNotePatch({ discussion_areas: [{ title: 'T', analysis: 'One.\n\nTwo.' }] })
    ).toBeNull();
  });
});

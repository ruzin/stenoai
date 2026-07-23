import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Meeting } from '@/lib/ipc';
import { UndoDeleteToast } from '@/components/UndoDeleteToast';
import { useUndoDeleteStore } from '@/hooks/undoDeleteStore';

/**
 * Data-safety regression for the Undo toast (#234, cubic #1). Clicking Undo used
 * to remove the entry up front and fire restore with no error handling — so a
 * FAILED restore removed the toast, and the startup sweep then hard-deleted the
 * still-trashed note next launch = silent data loss.
 *
 * The contract asserted here: a failed restore must NOT remove the entry — it
 * stays on screen (re-armed + flagged failed) so the user can retry Undo; a
 * successful restore removes it. jsdom + real zustand store; only ipc()/recording
 * are mocked, so useRestoreMeeting's HOOK-LEVEL onSuccess/onError run for real.
 */

const restoreMock =
  vi.fn<(id: string) => Promise<{ success: boolean; error?: string; meeting?: Meeting }>>();
const purgeMock = vi.fn(async () => ({ success: true }));

vi.mock('@/lib/ipc', () => ({
  ipc: () => ({
    meetings: {
      restore: (id: string) => restoreMock(id),
      purgeTrashed: () => purgeMock(),
    },
  }),
}));
// useMeetings (imported transitively by UndoDeleteToast) pulls these at import
// time; inert stubs keep the import graph off Electron/zustand internals.
vi.mock('@/hooks/useRecording', () => ({
  useRecording: () => ({ status: 'idle', sessionName: null, elapsed: 0, reprocessingSummaryFiles: new Set() }),
}));
vi.mock('@/hooks/liveDraftStore', () => ({ useLiveDraftStore: () => undefined }));

const mkMeeting = (summaryFile: string, name: string): Meeting =>
  ({ session_info: { summary_file: summaryFile, name } }) as unknown as Meeting;

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderToast() {
  const qc = makeClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <UndoDeleteToast />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

const entries = () => useUndoDeleteStore.getState().entries;

describe('UndoDeleteToast — failed restore keeps the entry', () => {
  beforeEach(() => {
    restoreMock.mockReset();
    purgeMock.mockClear();
    // The toast renders into #toast-host via a portal.
    const host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
    useUndoDeleteStore.setState({ entries: [] });
  });

  afterEach(() => {
    document.getElementById('toast-host')?.remove();
    useUndoDeleteStore.setState({ entries: [] });
  });

  test('a FAILED restore does not remove the entry — it stays retryable', async () => {
    restoreMock.mockResolvedValue({ success: false, error: 'restore target already exists' });
    useUndoDeleteStore.getState().add({
      trashId: 't-fail',
      meeting: mkMeeting('a.json', 'Alpha'),
      createdAt: Date.now(),
    });

    const { getByRole } = renderToast();
    // Click Undo.
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /undo/i }));
    });

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith('t-fail'));
    // The entry is STILL present (not stranded for the sweep), re-armed + flagged.
    await waitFor(() => {
      const e = entries().find((x) => x.trashId === 't-fail');
      expect(e).toBeTruthy();
      expect(e?.restoring).toBe(false);
      expect(e?.restoreFailed).toBe(true);
    });
  });

  test('a SUCCESSFUL restore removes the entry', async () => {
    restoreMock.mockResolvedValue({ success: true, meeting: mkMeeting('a.json', 'Alpha') });
    useUndoDeleteStore.getState().add({
      trashId: 't-ok',
      meeting: mkMeeting('a.json', 'Alpha'),
      createdAt: Date.now(),
    });

    const { getByRole } = renderToast();
    await act(async () => {
      fireEvent.click(getByRole('button', { name: /undo/i }));
    });

    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith('t-ok'));
    await waitFor(() => expect(entries().find((x) => x.trashId === 't-ok')).toBeUndefined());
  });
});

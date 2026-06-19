import * as React from 'react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Meeting } from '@/lib/ipc';
import { useDeleteMeeting, meetingsKeys } from '@/hooks/useMeetings';

/**
 * Cache-race coverage for useDeleteMeeting (#204 / "skip the backend re-scan on
 * delete"). The hook removes the deleted row from the list cache with
 * setQueryData instead of invalidating (no re-scan), guarding against a stale
 * list-meetings response with two cancelQueries (onMutate + onSuccess).
 *
 * These are unit tests, not Playwright: the list query's response is a promise
 * we resolve by hand, so each race is deterministic (no real UI timing). The
 * invariants asserted are exactly the issue's: a stale refetch that lands after
 * the delete must NOT resurrect the deleted row, and an independent update that
 * the cancel drops must not be PERMANENTLY lost (a later refetch reconciles it).
 */

// ipc().meetings.delete is the only ipc call useDeleteMeeting makes; the list
// observer below uses an injected queryFn, so the rest of ipc is irrelevant.
const deleteMock = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/ipc', () => ({
  ipc: () => ({ meetings: { delete: deleteMock } }),
}));
// useMeetings (same module) pulls these at import time; we never call it here,
// so inert stubs keep the import graph off Electron/zustand internals.
vi.mock('@/hooks/useRecording', () => ({ useRecording: () => ({ status: 'idle', sessionName: null, elapsed: 0 }) }));
vi.mock('@/hooks/liveDraftStore', () => ({ useLiveDraftStore: () => undefined }));

const mkMeeting = (summaryFile: string, name: string): Meeting =>
  ({ session_info: { summary_file: summaryFile, name } }) as unknown as Meeting;

const A = mkMeeting('a.json', 'Alpha');
const B_OLD = mkMeeting('b.json', 'Beta');
const B_NEW = mkMeeting('b.json', 'Beta (renamed)');

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The list query's response, swappable per step. The active observer in the
// harness calls this on every (re)fetch.
let nextList: () => Promise<Meeting[]> = () => Promise.resolve([]);

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderHarness(qc: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => {
      // An active observer so cancel/refetch on the list key is meaningful,
      // mirroring useMeetings without dragging in its recording deps.
      const list = useQuery({ queryKey: meetingsKeys.list(), queryFn: () => nextList() });
      const del = useDeleteMeeting();
      return { list, del };
    },
    { wrapper },
  );
}

const listCache = (qc: QueryClient) => qc.getQueryData<Meeting[]>(meetingsKeys.list());
const files = (rows: Meeting[] | undefined) => (rows ?? []).map((m) => m.session_info.summary_file);

describe('useDeleteMeeting cache races', () => {
  beforeEach(() => {
    deleteMock.mockClear();
    nextList = () => Promise.resolve([]);
  });

  test('a stale list refetch already in flight before the delete does not resurrect the deleted row', async () => {
    const qc = makeClient();
    nextList = () => Promise.resolve([A, B_OLD]);
    const { result } = renderHarness(qc);
    await waitFor(() => expect(files(listCache(qc))).toEqual(['a.json', 'b.json']));

    // A refetch is already running when the delete fires; it was scanned before
    // the file was removed, so it would carry the (stale) deleted row.
    const stale = defer<Meeting[]>();
    nextList = () => stale.promise;
    act(() => {
      void qc.invalidateQueries({ queryKey: meetingsKeys.list() });
    });
    await waitFor(() => expect(qc.getQueryState(meetingsKeys.list())?.fetchStatus).toBe('fetching'));

    // Backend truth after the delete (for any fresh fetch): A is gone.
    await act(async () => {
      await result.current.del.mutateAsync(A);
    });
    nextList = () => Promise.resolve([B_OLD]);

    // The stale refetch lands AFTER the delete — must be ignored.
    await act(async () => {
      stale.resolve([A, B_OLD]);
      await stale.promise;
    });

    expect(files(listCache(qc))).not.toContain('a.json');
    expect(files(listCache(qc))).toContain('b.json');
  });

  test('a list refetch triggered during the delete IPC does not resurrect the deleted row', async () => {
    const qc = makeClient();
    nextList = () => Promise.resolve([A, B_OLD]);
    const { result } = renderHarness(qc);
    await waitFor(() => expect(files(listCache(qc))).toEqual(['a.json', 'b.json']));

    // Hold the delete IPC open so we can start a refetch *during* it.
    const del = defer<{ success: true }>();
    deleteMock.mockReturnValueOnce(del.promise);
    let mutate!: Promise<unknown>;
    act(() => {
      mutate = result.current.del.mutateAsync(A);
    });

    const stale = defer<Meeting[]>();
    nextList = () => stale.promise;
    act(() => {
      void qc.invalidateQueries({ queryKey: meetingsKeys.list() });
    });
    await waitFor(() => expect(qc.getQueryState(meetingsKeys.list())?.fetchStatus).toBe('fetching'));

    // Finish the delete: onSuccess's second cancelQueries must drop the refetch
    // started mid-IPC, and the setQueryData filter removes the row.
    nextList = () => Promise.resolve([B_OLD]);
    await act(async () => {
      del.resolve({ success: true });
      await mutate;
    });
    await act(async () => {
      stale.resolve([A, B_OLD]);
      await stale.promise;
    });

    expect(files(listCache(qc))).not.toContain('a.json');
    expect(files(listCache(qc))).toContain('b.json');
  });

  test('an independent update racing the delete is not permanently lost, and the deleted row stays gone', async () => {
    const qc = makeClient();
    nextList = () => Promise.resolve([A, B_OLD]);
    const { result } = renderHarness(qc);
    await waitFor(() => expect(files(listCache(qc))).toEqual(['a.json', 'b.json']));

    // An independent update (useUpdateMeeting only invalidates — no optimistic
    // write) starts a refetch carrying B's NEW state, with A still present.
    const update = defer<Meeting[]>();
    nextList = () => update.promise;
    act(() => {
      void qc.invalidateQueries({ queryKey: meetingsKeys.list() });
    });
    await waitFor(() => expect(qc.getQueryState(meetingsKeys.list())?.fetchStatus).toBe('fetching'));

    // Delete A — its cancelQueries drops the update's refetch.
    await act(async () => {
      await result.current.del.mutateAsync(A);
    });

    // The cancelled refetch resolving must not bring A back.
    await act(async () => {
      update.resolve([A, B_NEW]);
      await update.promise;
    });
    expect(files(listCache(qc))).not.toContain('a.json');

    // The update was dropped from the cache by the cancel, but it is NOT
    // permanently lost: the next refetch (backend truth) reconciles it while the
    // deleted row stays gone.
    nextList = () => Promise.resolve([B_NEW]);
    await act(async () => {
      await qc.refetchQueries({ queryKey: meetingsKeys.list() });
    });
    const rows = listCache(qc);
    expect(files(rows)).toEqual(['b.json']);
    expect(rows?.[0].session_info.name).toBe('Beta (renamed)');
  });
});

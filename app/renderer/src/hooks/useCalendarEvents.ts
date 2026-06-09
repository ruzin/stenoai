import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type CalendarEvent } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

export type CalendarState =
  | { needsAuth: false; events: CalendarEvent[] }
  | { needsAuth: true; events: [] };

export const calendarKeys = {
  all: ['calendar'] as const,
  events: () => [...calendarKeys.all, 'events'] as const,
  google: () => [...calendarKeys.all, 'google'] as const,
  outlook: () => [...calendarKeys.all, 'outlook'] as const,
};

/**
 * Mount the Google + Outlook auth-change → calendar-cache-invalidate
 * subscriptions. Call from App.tsx ONLY. Every additional caller would
 * add a duplicate listener pair and a redundant invalidateQueries per
 * auth event.
 *
 * Split out from useCalendarEvents so that route-level callers can keep
 * subscribing to the data via useQuery (sharing the cache via the
 * `events` queryKey) without each one re-registering the IPC bus.
 */
export function useCalendarAuthBus() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const off = [
      ipc().on.googleAuthChanged(() => {
        qc.invalidateQueries({ queryKey: calendarKeys.all });
      }),
      ipc().on.outlookAuthChanged(() => {
        qc.invalidateQueries({ queryKey: calendarKeys.all });
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [qc]);
}

export function useCalendarEvents() {
  return useQuery<CalendarState>({
    queryKey: calendarKeys.events(),
    queryFn: async (): Promise<CalendarState> => {
      const res = await ipc().calendar.getEvents();
      if (res.success) return { needsAuth: false, events: res.events };
      if ('needsAuth' in res) return { needsAuth: true, events: [] };
      throw new Error(res.error);
    },
    // Poll every 2 minutes so events the user adds in their calendar app
    // surface here in roughly the time it takes to switch context, without
    // hammering the provider API. Combined with the route-change refetch
    // in App.tsx and refetchOnWindowFocus, the user almost never sees a
    // stale carousel — but the 60 s staleTime below de-dupes refetches so
    // rapid navigation doesn't fire one fetch per nav.
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
  });
}

export function useGoogleCalendarAuth() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: calendarKeys.google(),
    queryFn: async () => {
      const res = await ipc().calendar.google.status();
      if (!res.success) throw new Error(res.error);
      return { connected: res.connected };
    },
  });
  const connect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.google.connect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.google.disconnect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  return { status, connect, disconnect };
}

export function useOutlookCalendarAuth() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: calendarKeys.outlook(),
    queryFn: async () => {
      const res = await ipc().calendar.outlook.status();
      if (!res.success) throw new Error(res.error);
      return { connected: res.connected };
    },
  });
  const connect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.outlook.connect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  const disconnect = useMutation({
    mutationFn: async () => unwrap(await ipc().calendar.outlook.disconnect()),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
  return { status, connect, disconnect };
}

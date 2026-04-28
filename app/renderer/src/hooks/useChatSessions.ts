import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, type ChatSessionsBlob } from '@/lib/ipc';

export type ChatSession = ChatSessionsBlob['sessions'][number];
export type ChatMessage = ChatSession['messages'][number];

function newSessionId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyBlob(): ChatSessionsBlob {
  return { sessions: [] };
}

const CHAT_KEY = ['chat-sessions'] as const;

// Legacy format written by the old renderer:
// [[meetingName, OldSession[]], ...]
type LegacyMessage = { role: 'user' | 'ai'; content: string };
type LegacySession = { id: string; title: string; messages: LegacyMessage[]; pending: boolean };
type LegacyBlob = [meetingName: string, sessions: LegacySession[]][];

function migrateLegacyBlob(legacy: LegacyBlob): ChatSessionsBlob {
  const sessions: ChatSession[] = legacy.flatMap(([meetingName, oldSessions]) =>
    oldSessions.map((s) => {
      const ts = Number(s.id) || Date.now();
      return {
        id: s.id,
        name: meetingName ? `${meetingName} — ${s.title}` : s.title,
        messages: s.messages.map((m) => ({
          role: m.role === 'ai' ? ('assistant' as const) : ('user' as const),
          content: m.content,
          ts,
        })),
        createdAt: ts,
        updatedAt: ts,
      };
    }),
  );
  return { sessions };
}

export function useChatSessions(summaryFile: string | null) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const query = useQuery<ChatSessionsBlob>({
    queryKey: CHAT_KEY,
    queryFn: async () => {
      const res = await ipc().chat.load();
      if (!res.success) throw new Error(res.error);
      const data = res.data;
      if (!data) return emptyBlob();
      if (Array.isArray(data.sessions)) return data;
      // Migrate legacy format: [[meetingName, OldSession[]], ...]
      // Old sessions have {id, title, messages: [{role:'user'|'ai', content}], pending}
      if (Array.isArray(data)) return migrateLegacyBlob(data as unknown as LegacyBlob);
      return emptyBlob();
    },
    staleTime: Infinity,
  });

  const blob = query.data ?? emptyBlob();

  // Only expose sessions that belong to this meeting. Legacy sessions migrated
  // from the old renderer don't have a summaryFile (the legacy format only
  // tracked meeting names, not file paths), so we surface them on every meeting
  // view rather than dropping them silently. Users can rename or delete them.
  const meetingSessions = React.useMemo(() => {
    if (!summaryFile) return [];
    const matched = blob.sessions.filter((s) => s.summaryFile === summaryFile);
    const orphans = blob.sessions.filter((s) => !s.summaryFile);
    return [...matched, ...orphans];
  }, [blob.sessions, summaryFile]);

  // Always read the freshest blob from the cache so that rapid-fire mutations
  // (createSession → appendMessage in the same tick) don't clobber each other
  // via stale closures.
  const readLatest = React.useCallback((): ChatSessionsBlob => {
    return queryClient.getQueryData<ChatSessionsBlob>(CHAT_KEY) ?? emptyBlob();
  }, [queryClient]);

  // When the meeting changes, restore the most recently updated session for
  // that meeting (so returning to a note shows your previous chat).
  React.useEffect(() => {
    if (!summaryFile) {
      setActiveId(null);
      return;
    }
    const sorted = readLatest()
      .sessions.filter((s) => s.summaryFile === summaryFile)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setActiveId(sorted[0]?.id ?? null);
  }, [summaryFile, readLatest]);

  const persist = React.useCallback(
    async (next: ChatSessionsBlob) => {
      const previous = queryClient.getQueryData<ChatSessionsBlob>(CHAT_KEY);
      queryClient.setQueryData(CHAT_KEY, next);
      const res = await ipc().chat.save(next);
      if (!res.success) {
        // Rollback so the cache and disk stay in sync, and surface the error
        // to callers instead of swallowing the failure.
        queryClient.setQueryData(CHAT_KEY, previous);
        throw new Error(res.error || 'Failed to save chat sessions');
      }
    },
    [queryClient],
  );

  const activeSession = React.useMemo(
    () => meetingSessions.find((s) => s.id === activeId) ?? null,
    [meetingSessions, activeId],
  );

  const createSession = React.useCallback(
    async (name?: string) => {
      const now = Date.now();
      const session: ChatSession = {
        id: newSessionId(),
        name: name ?? 'New chat',
        ...(summaryFile ? { summaryFile } : {}),
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      const current = readLatest();
      await persist({ sessions: [session, ...current.sessions] });
      setActiveId(session.id);
      return session.id;
    },
    [persist, readLatest, summaryFile],
  );

  const appendMessage = React.useCallback(
    async (sessionId: string, message: ChatMessage) => {
      const current = readLatest();
      await persist({
        sessions: current.sessions.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: [...s.messages, message],
                updatedAt: Date.now(),
              }
            : s,
        ),
      });
    },
    [persist, readLatest],
  );

  const renameSession = React.useCallback(
    async (sessionId: string, name: string) => {
      const current = readLatest();
      await persist({
        sessions: current.sessions.map((s) =>
          s.id === sessionId ? { ...s, name, updatedAt: Date.now() } : s,
        ),
      });
    },
    [persist, readLatest],
  );

  const deleteSession = React.useCallback(
    async (sessionId: string) => {
      const current = readLatest();
      if (activeId === sessionId) setActiveId(null);
      await persist({
        sessions: current.sessions.filter((s) => s.id !== sessionId),
      });
    },
    [persist, readLatest, activeId],
  );

  return {
    sessions: meetingSessions,
    activeId,
    activeSession,
    setActiveId,
    createSession,
    appendMessage,
    renameSession,
    deleteSession,
    isLoading: query.isLoading,
  };
}

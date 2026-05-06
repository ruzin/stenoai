import * as React from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Square,
} from 'lucide-react';
import { FolderScopePicker } from '@/components/FolderScopePicker';
import { ChatHistoryRow } from '@/components/ChatHistoryRow';
import { MeetingsShell } from '@/components/MeetingsShell';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { PRESETS, PresetGlyph } from '@/lib/chatPresets';
import {
  useAllChatSessions,
  useChatSessions,
  type ChatMessage,
} from '@/hooks/useChatSessions';
import { useGlobalStreaming } from '@/hooks/useStreamingQuery';
import { useAiProvider } from '@/hooks/useAi';
import { navigate } from '@/lib/router';
import {
  GLOBAL_SCOPE,
  bucketKey,
  deriveSessionName,
  toBucketLabel,
} from '@/lib/chat';
import { consumePendingNewChat } from '@/routes/Chat';
import { renderMarkdown } from '@/lib/markdown';

interface ChatConversationProps {
  sessionId: string;
}

export function ChatConversation({ sessionId }: ChatConversationProps) {
  const allSessions = useAllChatSessions();
  const chat = useChatSessions(GLOBAL_SCOPE, null);
  const streaming = useGlobalStreaming();
  const provider = useAiProvider();

  const [input, setInput] = React.useState('');
  const [activeStreamId, setActiveStreamId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  // Folder scope persists for the lifetime of the conversation page mount.
  // The entry page's scope is handed off via consumePendingNewChat; later
  // turns in the same conversation can be re-scoped from this composer.
  const [scopeFolderId, setScopeFolderId] = React.useState<string | null>(null);
  const pendingPersistRef = React.useRef<string | null>(null);
  const submittingRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const isCloud = provider.data?.ai_provider === 'cloud';
  const cloudKeySet = provider.data?.cloud_api_key_set ?? false;
  const ready = isCloud && cloudKeySet;

  // Make THIS session the active one as soon as the route mounts so
  // chat.activeSession / chat.appendMessage operate on the right record
  // instead of whichever one useChatSessions's auto-restore landed on.
  React.useEffect(() => {
    chat.setActiveId(sessionId);
  }, [sessionId, chat]);

  // Pick up an in-flight stream the entry page kicked off right before
  // navigating, so we don't lose its tokens during the route change.
  // The entry page's chosen scope rides along with the handoff so the
  // composer here starts with the same folder context.
  React.useEffect(() => {
    const pending = consumePendingNewChat(sessionId);
    if (pending) {
      pendingPersistRef.current = pending.sessionId;
      setActiveStreamId(pending.streamId);
      setScopeFolderId(pending.folderId);
    }
  }, [sessionId]);

  const session = React.useMemo(() => {
    const list = allSessions.data?.sessions ?? [];
    return list.find((s) => s.id === sessionId) ?? null;
  }, [allSessions.data?.sessions, sessionId]);

  const otherSessions = React.useMemo(() => {
    const list = allSessions.data?.sessions ?? [];
    return list
      .filter((s) => s.summaryFile === GLOBAL_SCOPE)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allSessions.data?.sessions]);

  // Group sessions into time buckets for the History dropdown ("Today",
  // "Last 2 weeks", "April", etc.) — same pattern Granola uses. Order is
  // determined by the highest updatedAt in each group, so a stale "April"
  // group sinks below a fresh "Today" automatically.
  const groupedSessions = React.useMemo(() => {
    const groups = new Map<string, typeof otherSessions>();
    const now = Date.now();
    for (const s of otherSessions) {
      const k = bucketKey(s.updatedAt, now);
      const arr = groups.get(k) ?? [];
      arr.push(s);
      groups.set(k, arr);
    }
    return Array.from(groups.entries()).map(([key, sessions]) => ({
      key,
      label: toBucketLabel(key),
      sessions,
    }));
  }, [otherSessions]);

  const activeStream = activeStreamId ? streaming.streams[activeStreamId] : null;
  const isStreaming = activeStream?.status === 'streaming';

  // Persist the assistant turn when its stream finishes.
  React.useEffect(() => {
    if (!activeStreamId) return;
    const stream = streaming.streams[activeStreamId];
    if (!stream || stream.status === 'streaming') return;
    const persistId = pendingPersistRef.current;
    if (!persistId) return;
    const content =
      stream.text.trim() ||
      (stream.status === 'error'
        ? `Error: ${stream.error ?? 'query failed'}`
        : '(empty response)');
    const message: ChatMessage = {
      role: 'assistant',
      content,
      ts: Date.now(),
    };
    void chat.appendMessage(persistId, message);
    pendingPersistRef.current = null;
    streaming.clearStream(activeStreamId);
    setActiveStreamId(null);
  }, [activeStreamId, streaming, chat]);

  // Keep the conversation scrolled to the bottom on new content.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, activeStream?.text]);

  const submit = async (raw: string) => {
    const q = raw.trim();
    if (!q || isStreaming || submittingRef.current || !ready || !session) return;
    submittingRef.current = true;
    try {
      await chat.appendMessage(session.id, {
        role: 'user',
        content: q,
        ts: Date.now(),
      });
      setInput('');
      const streamId = streaming.startGlobalStream(q, scopeFolderId);
      pendingPersistRef.current = session.id;
      setActiveStreamId(streamId);
    } finally {
      submittingRef.current = false;
    }
  };

  const stop = () => {
    if (!activeStreamId) return;
    streaming.cancelStream(activeStreamId);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(input);
  };

  const liveText = isStreaming ? activeStream?.text ?? '' : '';

  // Session might not exist yet on cold reload (allSessions is still
  // loading). Show a soft loading state rather than dumping the user
  // back to /chat — the URL is the source of truth.
  if (!session && allSessions.isFetched) {
    return (
      <MeetingsShell activeSummaryFile={null}>
        <div className="mx-auto max-w-[640px] py-20 text-center">
          <h1 className="mv-title mb-3">Chat not found.</h1>
          <p className="text-[14px]" style={{ color: 'var(--fg-2)' }}>
            This conversation may have been deleted.
          </p>
          <button
            type="button"
            onClick={() => navigate('/chat')}
            className="mt-4 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
            style={{ color: 'var(--fg-1)', background: 'var(--surface-raised)' }}
          >
            <ArrowLeft className="size-[13px]" />
            Back to Chat
          </button>
        </div>
      </MeetingsShell>
    );
  }

  return (
    // bleed: skip AppShell's centered scroll wrapper (which has pb-36 baked
    // in) so we can own the layout — flex column with a scrolling message
    // area + composer pinned to the bottom of the viewport with no padding
    // gap underneath.
    <MeetingsShell activeSummaryFile={null} bleed>
      <div className="flex min-h-0 flex-1 flex-col" style={{ background: 'var(--page)' }}>
        {/* Toolbar — back, History dropdown, New chat. */}
        <div className="mx-auto flex w-full max-w-[760px] items-center justify-between gap-2 px-10 pb-3 pt-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-[color:var(--surface-hover)]"
              style={{ color: 'var(--fg-2)' }}
              aria-label="Back to Chat"
              title="Back to Chat"
            >
              <ArrowLeft className="size-[15px]" />
            </button>

            <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ml-1 inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--fg-1)',
                    background: 'var(--surface-raised)',
                  }}
                  aria-label="Switch chat"
                >
                  History
                  <ChevronDown className="size-[12px]" style={{ color: 'var(--fg-2)' }} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[320px] p-1">
                {otherSessions.length === 0 ? (
                  <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                    No other chats yet.
                  </div>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto py-1">
                    {/* Few chats → flat list, no group headers (less visual
                        noise). Many chats → grouped by time bucket so old
                        ones are findable. */}
                    {otherSessions.length <= 5 ? (
                      otherSessions.map((s) => (
                        <ChatHistoryRow
                          key={s.id}
                          session={s}
                          activeId={sessionId}
                          onSelect={() => setHistoryOpen(false)}
                          onRename={(name) => void chat.renameSession(s.id, name)}
                          onDelete={async () => {
                            const wasActive = s.id === sessionId;
                            await chat.deleteSession(s.id);
                            if (wasActive) navigate('/chat');
                          }}
                        />
                      ))
                    ) : (
                      groupedSessions.map((group) => (
                        <div key={group.key} className="mb-1.5 last:mb-0">
                          <div
                            className="px-2 pb-0.5 pt-1 text-[11px] font-medium"
                            style={{ color: 'var(--fg-muted)' }}
                          >
                            {group.label}
                          </div>
                          {group.sessions.map((s) => (
                            <ChatHistoryRow
                              key={s.id}
                              session={s}
                              activeId={sessionId}
                              onRename={(name) => void chat.renameSession(s.id, name)}
                              onDelete={async () => {
                                const wasActive = s.id === sessionId;
                                await chat.deleteSession(s.id);
                                if (wasActive) navigate('/chat');
                              }}
                            />
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* "New chat" lives in the global toolbar (route-aware "+ New" pill)
              when on chat routes, so we don't repeat it here. */}
        </div>

        {/* Scrolling message area. flex-1 takes all remaining vertical space
            so the composer below it renders at the actual viewport bottom
            with no empty band underneath. */}
        <div
          ref={scrollRef}
          className="scrollbar-clean min-h-0 flex-1 overflow-y-auto"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-10 pb-6 pt-2">
            {(session?.messages ?? []).map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))}
            {isStreaming && (
              <Bubble role="assistant" content={liveText || 'Thinking…'} live />
            )}
          </div>
        </div>

        {/* Composer pinned at the visual bottom — out of the scroll
            container, in the flex column. No leftover padding underneath. */}
        <div className="mx-auto w-full max-w-[760px] px-10 pb-6 pt-2">
          <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
            <PopoverAnchor asChild>
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border p-3 transition-shadow focus-within:shadow-[var(--shadow-md)]"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--surface-raised)',
            }}
          >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Same '/' shortcut as the entry page — opens the preset
              // picker when the input is empty so a literal slash typed
              // mid-sentence doesn't surprise the user.
              if (e.key === '/' && input === '' && ready && !isStreaming) {
                e.preventDefault();
                setPresetsOpen(true);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
                e.preventDefault();
                void submit(input);
              }
            }}
            disabled={!ready || isStreaming}
            placeholder="Ask anything  /"
            className="block w-full bg-transparent px-2 pb-3 pt-1 outline-none disabled:cursor-not-allowed"
            style={{ fontSize: 15, color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <FolderScopePicker value={scopeFolderId} onChange={setScopeFolderId} />
              <span className="text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                {provider.data?.cloud_provider
                  ? `${provider.data.cloud_provider} · ${provider.data.cloud_model}`
                  : 'Auto'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--surface-hover)]"
                  style={{ color: 'var(--fg-1)' }}
                  aria-label="Stop"
                >
                  <Square className="size-[12px]" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || !ready}
                  className="inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
                  style={{ color: 'var(--fg-1)' }}
                  aria-label="Send"
                >
                  <ArrowUp className="size-[14px]" />
                </button>
              )}
            </div>
          </div>
          </form>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              side="top"
              sideOffset={8}
              className="w-[var(--radix-popover-trigger-width)] max-w-none p-1"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div
                className="px-2 pb-1 pt-0.5 text-[11px] font-medium"
                style={{ color: 'var(--fg-muted)' }}
              >
                Presets
              </div>
              <div className="flex flex-col">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setInput(p.prompt);
                      setPresetsOpen(false);
                      inputRef.current?.focus();
                    }}
                    className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--surface-hover)]"
                  >
                    <div
                      className="flex items-center gap-2 text-[13px]"
                      style={{ color: 'var(--fg-1)' }}
                    >
                      <PresetGlyph />
                      {p.label}
                    </div>
                    <div className="pl-[26px] text-[12px]" style={{ color: 'var(--fg-2)' }}>
                      {p.description}
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </MeetingsShell>
  );
}


function Bubble({
  role,
  content,
  live,
}: {
  role: 'user' | 'assistant';
  content: string;
  live?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex'}>
      <div
        className={`chat-bubble max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-[1.55] ${live ? 'animate-pulse' : ''}`}
        style={{
          background: isUser ? 'var(--surface-active)' : 'var(--surface-sunken)',
          color: 'var(--fg-1)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* User turns are typed plain text — render as-is to preserve any
            literal asterisks/backticks. Assistant turns get full markdown. */}
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{content}</span>
        ) : (
          renderMarkdown(content)
        )}
      </div>
    </div>
  );
}

// Re-export so callers don't need to know about deriveSessionName here.
export { deriveSessionName };

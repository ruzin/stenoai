import * as React from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Mic,
  Paperclip,
  Square,
  Trash2,
} from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  deriveSessionName,
  relativeTime,
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
  React.useEffect(() => {
    const pending = consumePendingNewChat(sessionId);
    if (pending) {
      pendingPersistRef.current = pending.sessionId;
      setActiveStreamId(pending.streamId);
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
      const streamId = streaming.startGlobalStream(q);
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

            <Popover>
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
              <PopoverContent align="start" className="w-[280px] p-1">
                {otherSessions.length === 0 ? (
                  <div className="px-3 py-3 text-[13px]" style={{ color: 'var(--fg-2)' }}>
                    No other chats yet.
                  </div>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto">
                    {otherSessions.map((s) => (
                      <div
                        key={s.id}
                        className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
                        style={{
                          color: s.id === sessionId ? 'var(--fg-1)' : 'var(--fg-2)',
                          background: s.id === sessionId ? 'var(--surface-active)' : undefined,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => navigate(`/chat/${encodeURIComponent(s.id)}`)}
                          className="flex flex-1 items-center justify-between gap-2 text-left"
                        >
                          <span className="flex-1 truncate">{s.name || 'Untitled chat'}</span>
                          <span className="text-[11px] tabular-nums" style={{ color: 'var(--fg-muted)' }}>
                            {relativeTime(s.updatedAt)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            // If the user just nuked the chat they're
                            // actively viewing, bounce back to /chat so we
                            // don't leave them on a "Chat not found" page.
                            const wasActive = s.id === sessionId;
                            await chat.deleteSession(s.id);
                            if (wasActive) navigate('/chat');
                          }}
                          aria-label={`Delete chat ${s.name || 'Untitled'}`}
                          title="Delete chat"
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[color:var(--surface-active)] group-hover:opacity-100 focus:opacity-100"
                          style={{ color: 'var(--fg-2)' }}
                        >
                          <Trash2 className="size-[12px]" />
                        </button>
                      </div>
                    ))}
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
              if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
                e.preventDefault();
                void submit(input);
              }
            }}
            disabled={!ready || isStreaming}
            placeholder="Ask anything"
            className="block w-full bg-transparent px-2 pb-3 pt-1 outline-none disabled:cursor-not-allowed"
            style={{ fontSize: 15, color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <button type="button" disabled className="inline-flex size-7 items-center justify-center rounded-md disabled:opacity-50" style={{ color: 'var(--fg-2)' }} aria-label="Attach (coming soon)">
                <Paperclip className="size-[14px]" />
              </button>
              <span className="text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                {provider.data?.cloud_provider
                  ? `${provider.data.cloud_provider} · ${provider.data.cloud_model}`
                  : 'Auto'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" disabled className="inline-flex size-7 items-center justify-center rounded-md disabled:opacity-50" style={{ color: 'var(--fg-2)' }} aria-label="Voice (coming soon)">
                <Mic className="size-[14px]" />
              </button>
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

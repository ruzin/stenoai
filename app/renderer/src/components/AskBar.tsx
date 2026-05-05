import * as React from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Square,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAskBar } from '@/lib/askBarContext';
import {
  useChatSessions,
  type ChatMessage,
  type ChatSession,
} from '@/hooks/useChatSessions';
import { useStreamingQuery } from '@/hooks/useStreamingQuery';
import { TranscriptPanelContent } from '@/components/TranscriptPanel';
import { useMeeting } from '@/hooks/useMeetings';

// ---------------------------------------------------------------------------
// Transcript bar — rendered separately above the chat bar
// ---------------------------------------------------------------------------

export function TranscriptBar() {
  const { activeSummaryFile, transcriptOpen, setTranscriptOpen } = useAskBar();
  const meeting = useMeeting(activeSummaryFile ?? undefined);
  const [copied, setCopied] = React.useState(false);

  const copyTranscript = async () => {
    if (!meeting.data) return;
    const text = (meeting.data.transcript ?? '').trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!transcriptOpen || !activeSummaryFile) return null;

  return (
    <div
      data-transcript-bar
      className="mv-transcript open"
      style={{ pointerEvents: 'auto', boxShadow: 'var(--shadow-lg)' }}
      // Stop mousedown bubbling so the AskBar click-outside listener treats
      // interactions inside this panel (search input, copy button, scroll)
      // as in-bounds. Without this, the panel closes the instant you click
      // anywhere inside it.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mv-transcript-head">
        <span className="mv-transcript-wave mv-transcript-wave-static" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span />
        </span>
        <span className="mv-transcript-label">Transcript</span>
        <button
          type="button"
          className="mv-chat-tool"
          onClick={() => void copyTranscript()}
          aria-label="Copy transcript"
          title="Copy transcript"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          type="button"
          className="mv-chat-tool"
          onClick={() => setTranscriptOpen(false)}
          aria-label="Hide transcript"
          title="Hide transcript"
        >
          <ChevronUp size={13} style={{ color: 'var(--fg-2)', flexShrink: 0 }} />
        </button>
      </div>
      <div style={{ height: 260, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border-subtle)' }}>
        <TranscriptPanelContent summaryFile={activeSummaryFile} />
      </div>
    </div>
  );
}

export function AskBar() {
  const { activeSummaryFile, activeMeetingName, transcriptOpen, setTranscriptOpen } = useAskBar();
  const chat = useChatSessions(activeSummaryFile, activeMeetingName);
  const streaming = useStreamingQuery();

  const [expanded, setExpanded] = React.useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [activeStreamId, setActiveStreamId] = React.useState<string | null>(null);
  const pendingPersistRef = React.useRef<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const activeStream = activeStreamId ? streaming.streams[activeStreamId] : null;
  const isStreaming = activeStream?.status === 'streaming';
  const session = chat.activeSession;
  const hasMessages = (session?.messages.length ?? 0) > 0;
  const hidden = !activeSummaryFile;
  const canSend = input.trim().length > 0 && !isStreaming;

  const cancelStreamRef = React.useRef(streaming.cancelStream);
  cancelStreamRef.current = streaming.cancelStream;

  React.useEffect(() => {
    setExpanded(false);
    setSessionMenuOpen(false);
    setTranscriptOpen(false);
    setActiveStreamId((prev) => {
      if (prev) {
        cancelStreamRef.current(prev);
        pendingPersistRef.current = null;
      }
      return null;
    });
  }, [activeSummaryFile, setTranscriptOpen]);

  React.useEffect(() => {
    if (!expanded && !transcriptOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Treat the AskBar container AND the floating TranscriptBar as in-bounds.
      // Without the transcript check, clicks inside the transcript's search
      // input or copy button would close the panel before the click resolves.
      const inside =
        (containerRef.current && containerRef.current.contains(target as Node)) ||
        (target && target.closest?.('[data-transcript-bar]'));
      if (!inside) {
        setExpanded(false);
        setSessionMenuOpen(false);
        setTranscriptOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expanded, transcriptOpen, setTranscriptOpen]);

  React.useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session?.messages.length, activeStream?.text, expanded]);

  React.useEffect(() => {
    if (!activeStreamId) return;
    const stream = streaming.streams[activeStreamId];
    if (!stream) return;
    const sessionId = pendingPersistRef.current;
    if (!sessionId) return;
    if (stream.status === 'streaming') return;

    const content =
      stream.text.trim() ||
      (stream.status === 'error'
        ? `Error: ${stream.error ?? 'query failed'}`
        : '(empty response)');
    const message: ChatMessage = { role: 'assistant', content, ts: Date.now() };
    void chat.appendMessage(sessionId, message);
    pendingPersistRef.current = null;
    streaming.clearStream(activeStreamId);
    setActiveStreamId(null);
  }, [activeStreamId, streaming, chat]);

  const submitPrompt = async (raw: string) => {
    const q = raw.trim();
    if (!q || !activeSummaryFile || isStreaming) return;

    let sessionId = session?.id ?? null;
    if (!sessionId) {
      sessionId = await chat.createSession(deriveSessionName(q));
    }

    const userMsg: ChatMessage = { role: 'user', content: q, ts: Date.now() };
    await chat.appendMessage(sessionId, userMsg);
    setInput('');

    const streamId = streaming.startStream(activeSummaryFile, q);
    pendingPersistRef.current = sessionId;
    setActiveStreamId(streamId);

    setExpanded(true);
    setTranscriptOpen(false);
  };

  const submit = () => submitPrompt(input);

  const stop = () => {
    if (!activeStreamId) return;
    streaming.cancelStream(activeStreamId);
  };

  const onPickSession = (id: string) => {
    chat.setActiveId(id);
    setSessionMenuOpen(false);
    setExpanded(true);
  };

  const onNewSession = async () => {
    setSessionMenuOpen(false);
    if (session && session.messages.length === 0) {
      setExpanded(true);
      return;
    }
    await chat.createSession();
    setExpanded(true);
  };

  const handleTranscriptToggle = () => {
    if (transcriptOpen) {
      setTranscriptOpen(false);
    } else {
      setTranscriptOpen(true);
      setExpanded(false);
      setSessionMenuOpen(false);
    }
  };

  const handleInputFocus = () => {
    setExpanded(true);
    if (transcriptOpen) setTranscriptOpen(false);
  };

  const handleCollapse = () => {
    setExpanded(false);
    setSessionMenuOpen(false);
  };

  if (hidden) return null;

  const showChatPanel = expanded && (hasMessages || isStreaming);

  return (
    <div ref={containerRef} data-ask-bar className="flex w-full flex-col gap-2.5" style={{ pointerEvents: 'auto' }}>

      {/* Chat message panel */}
      {showChatPanel && (
        <div className="mv-transcript open" style={{ maxHeight: 360 }}>
          <ChatHeader
            session={session}
            meetingName={activeMeetingName}
            sessions={chat.sessions}
            activeId={chat.activeId}
            sessionMenuOpen={sessionMenuOpen}
            onOpenSessions={() => setSessionMenuOpen((v) => !v)}
            onPickSession={onPickSession}
            onDeleteSession={(id) => void chat.deleteSession(id)}
            onNewSession={() => void onNewSession()}
            onCollapse={handleCollapse}
          />
          <div
            ref={scrollRef}
            className="scrollbar-clean overflow-y-auto px-4 py-3"
            style={{ maxHeight: 300 }}
          >
            <MessageList
              messages={session?.messages ?? []}
              liveText={isStreaming ? (activeStream?.text ?? '') : ''}
              streaming={isStreaming}
            />
          </div>
        </div>
      )}

      {/* Suggestion chips — appear when ask bar is focused with empty conversation */}
      {expanded && !hasMessages && !isStreaming && (
        <div
          className="mv-chat flex flex-wrap items-center gap-2"
          style={{ padding: '10px 14px' }}
        >
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => void submitPrompt(chip.prompt)}
              className="rounded-lg border px-2.5 py-1 text-xs transition-colors hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--fg-1)]"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--fg-2)' }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Chat composer */}
      <form
        className="mv-chat"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        {/* Transcript toggle */}
        <button
          type="button"
          className={cn('mv-chat-tool', transcriptOpen && 'active')}
          onClick={handleTranscriptToggle}
          aria-label={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          aria-pressed={transcriptOpen}
          title="Transcript"
        >
          {transcriptOpen ? (
            <span className="mv-transcript-wave" aria-hidden="true" style={{ width: 16, height: 12 }}>
              <span /><span /><span /><span /><span /><span /><span />
            </span>
          ) : (
            <span className="mv-transcript-wave" aria-hidden="true" style={{ width: 16, height: 12, opacity: 0.5, animation: 'none' }}>
              <span style={{ height: '40%', animation: 'none' }} />
              <span style={{ height: '70%', animation: 'none' }} />
              <span style={{ height: '100%', animation: 'none' }} />
              <span style={{ height: '60%', animation: 'none' }} />
              <span style={{ height: '90%', animation: 'none' }} />
              <span style={{ height: '50%', animation: 'none' }} />
              <span style={{ height: '30%', animation: 'none' }} />
            </span>
          )}
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          className="mv-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={handleInputFocus}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (isStreaming) stop();
              else void submit();
            }
            if (e.key === 'Escape') {
              handleCollapse();
              (e.target as HTMLElement).blur();
            }
          }}
          placeholder={hasMessages ? 'Continue chat…' : 'Ask anything about this meeting…'}
          aria-label="Ask about this meeting"
        />

        {/* Send / stop */}
        {isStreaming ? (
          <button
            type="button"
            className="mv-chat-send active"
            onClick={stop}
            aria-label="Stop"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="submit"
            className={cn('mv-chat-send', canSend && 'active')}
            disabled={!canSend}
            aria-label="Send"
          >
            <ArrowUp size={14} />
          </button>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat header with floating session dropdown
// ---------------------------------------------------------------------------

interface ChatHeaderProps {
  session: ChatSession | null;
  meetingName: string | null;
  sessions: ChatSession[];
  activeId: string | null;
  sessionMenuOpen: boolean;
  onOpenSessions: () => void;
  onPickSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
  onCollapse: () => void;
}

function ChatHeader({
  session,
  meetingName,
  sessions,
  activeId,
  sessionMenuOpen,
  onOpenSessions,
  onPickSession,
  onDeleteSession,
  onNewSession,
  onCollapse,
}: ChatHeaderProps) {
  return (
    <div className="relative flex flex-shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="relative">
        <button
          type="button"
          onClick={onOpenSessions}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold transition-colors hover:bg-muted',
            sessionMenuOpen && 'bg-muted',
          )}
          style={{ color: 'var(--fg-1)' }}
        >
          <span className="max-w-[340px] truncate">
            {session?.name ?? (meetingName ? `Ask about ${meetingName}` : 'Ask AI')}
          </span>
          <ChevronDown
            className={cn('size-3.5 flex-shrink-0 transition-transform duration-150', sessionMenuOpen && 'rotate-180')}
            style={{ color: 'var(--fg-2)' }}
          />
        </button>

        {sessionMenuOpen && (
          <SessionDropdown
            sessions={sessions}
            activeId={activeId}
            onPick={onPickSession}
            onDelete={onDeleteSession}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onNewSession}
          className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--fg-2)' }}
        >
          New chat
        </button>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse"
          aria-label="Collapse"
          className="mv-chat-tool"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session dropdown
// ---------------------------------------------------------------------------

interface SessionDropdownProps {
  sessions: ChatSession[];
  activeId: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}

function SessionDropdown({ sessions, activeId, onPick, onDelete }: SessionDropdownProps) {
  return (
    <div
      role="menu"
      data-ask-bar-sessions
      className="absolute left-0 top-[calc(100%+4px)] z-30 min-w-[240px] overflow-hidden rounded-xl border p-1.5 shadow-lg"
      style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-subtle)' }}
    >
      {sessions.length === 0 ? (
        <p className="px-3 py-2 text-xs" style={{ color: 'var(--fg-muted)' }}>No saved chats yet.</p>
      ) : (
        sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className={cn(
                'group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted',
                isActive && 'bg-muted font-medium',
              )}
            >
              <button
                type="button"
                onClick={() => onPick(s.id)}
                className="flex-1 truncate text-left"
                style={{ color: 'var(--fg-1)' }}
              >
                {s.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                aria-label={`Delete chat ${s.name}`}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                style={{ color: 'var(--fg-muted)' }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message list + bubbles
// ---------------------------------------------------------------------------

interface MessageListProps {
  messages: ChatMessage[];
  liveText: string;
  streaming: boolean;
}

function MessageList({ messages, liveText, streaming }: MessageListProps) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
      {streaming && (
        <div className="flex justify-start">
          {liveText ? (
            <div className="max-w-[90%] text-sm leading-[1.7]" style={{ color: 'var(--fg-1)' }}>
              {renderMarkdown(liveText)}
              <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse align-text-bottom" style={{ background: 'var(--fg-2)' }} />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-1" style={{ color: 'var(--fg-muted)' }}>
              <span className="text-[13px]">Thinking</span>
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      {isUser ? (
        <div
          className="max-w-[75%] rounded-[18px_18px_4px_18px] border px-3.5 py-2 text-sm"
          style={{
            background: 'var(--surface-hover)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--fg-1)',
          }}
        >
          {message.content}
        </div>
      ) : (
        <div className="max-w-[90%] text-sm leading-[1.7]" style={{ color: 'var(--fg-1)' }}>
          {renderMarkdown(message.content)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal markdown renderer (lists + bold)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listType ?? 'ul';
    nodes.push(
      <Tag
        key={key++}
        className={cn('my-1 space-y-0.5 pl-5', Tag === 'ul' ? 'list-disc' : 'list-decimal')}
      >
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
    listType = null;
  };

  for (const line of lines) {
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);

    if (ulMatch) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listItems.push(ulMatch[1]);
    } else if (olMatch) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listItems.push(olMatch[1]);
    } else {
      flushList();
      if (line.trim()) {
        nodes.push(<p key={key++}>{renderInline(line)}</p>);
      } else if (nodes.length > 0) {
        nodes.push(<br key={key++} />);
      }
    }
  }
  flushList();

  return <>{nodes}</>;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part || null
        ),
      )}
    </>
  );
}

const SUGGESTION_CHIPS: { label: string; prompt: string }[] = [
  { label: 'Summarize key decisions', prompt: 'Summarize the key decisions made' },
  { label: 'Action items', prompt: 'What action items were discussed?' },
  { label: 'Main topics', prompt: 'What were the main topics covered?' },
];

function deriveSessionName(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 40) return trimmed;
  return `${trimmed.slice(0, 40).trimEnd()}…`;
}

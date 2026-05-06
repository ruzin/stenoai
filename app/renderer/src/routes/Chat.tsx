import * as React from 'react';
import {
  ArrowUp,
  ChefHat,
  ChevronRight,
  Mic,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import { ChatHistoryRow } from '@/components/ChatHistoryRow';
import { MeetingsShell } from '@/components/MeetingsShell';
import {
  useAllChatSessions,
  useChatSessions,
} from '@/hooks/useChatSessions';
import { useGlobalStreaming } from '@/hooks/useStreamingQuery';
import { useAiProvider } from '@/hooks/useAi';
import { useUserName } from '@/hooks/useSettings';
import { navigate } from '@/lib/router';
import { GLOBAL_SCOPE, bucketKey, deriveSessionName, toBucketLabel } from '@/lib/chat';

// Templated prompts ("Meals" — Steno's playful name for what other apps call
// recipes/suggestions). Keep this list small at the top level; "See all"
// can reveal the full library in a follow-up.
const MEALS: { label: string; prompt: string }[] = [
  { label: 'List recent todos', prompt: 'List my action items from the last week.' },
  { label: 'Coach me', prompt: 'Coach me on my recent meetings — patterns, blind spots, things to work on.' },
  { label: 'Write weekly recap', prompt: 'Write a recap of this week based on my notes.' },
  { label: 'Streamline my calendar', prompt: 'Look at my upcoming meetings and suggest which ones I could skip or combine.' },
  { label: 'Blind spots', prompt: 'What blind spots have come up across my recent meetings?' },
];

export function Chat() {
  const allSessions = useAllChatSessions();
  // Reuse useChatSessions's persist/createSession with the global sentinel
  // so saves go through the same atomic-write path.
  const chat = useChatSessions(GLOBAL_SCOPE, null);
  const streaming = useGlobalStreaming();
  const provider = useAiProvider();
  const userName = useUserName();

  const [input, setInput] = React.useState('');
  const submittingRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const isCloud = provider.data?.ai_provider === 'cloud';
  const cloudKeySet = provider.data?.cloud_api_key_set ?? false;
  const ready = isCloud && cloudKeySet;

  // Recents = global-scope chats only (sessions started from THIS tab),
  // never the in-meeting AskBar history.
  const allRecents = React.useMemo(() => {
    const list = allSessions.data?.sessions ?? [];
    return list
      .filter((s) => s.summaryFile === GLOBAL_SCOPE)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allSessions.data?.sessions]);

  // Default view shows the 8 most-recent chats; "See all" expands to the
  // full list grouped by time bucket (Today / Last 2 weeks / April / …).
  // Hide the toggle entirely when the list already fits.
  const COLLAPSED_LIMIT = 8;
  const [recentsExpanded, setRecentsExpanded] = React.useState(false);
  const canExpand = allRecents.length > COLLAPSED_LIMIT;
  const recents = recentsExpanded ? allRecents : allRecents.slice(0, COLLAPSED_LIMIT);
  const groupedRecents = React.useMemo(() => {
    if (!recentsExpanded) return null;
    const groups = new Map<string, typeof allRecents>();
    const now = Date.now();
    for (const s of allRecents) {
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
  }, [recentsExpanded, allRecents]);

  const submit = async (raw: string) => {
    const q = raw.trim();
    if (!q || submittingRef.current || !ready) return;
    submittingRef.current = true;
    try {
      const sessionId = await chat.createSession(deriveSessionName(q));
      await chat.appendMessage(sessionId, {
        role: 'user',
        content: q,
        ts: Date.now(),
      });
      setInput('');
      const streamId = streaming.startGlobalStream(q);
      // Stash the stream id + session id on a module-level pending map so
      // the conversation page can pick them up after navigation. Avoids
      // having to thread them through the URL.
      pendingNewChat = { sessionId, streamId };
      navigate(`/chat/${encodeURIComponent(sessionId)}`);
    } finally {
      submittingRef.current = false;
    }
  };

  const onPickMeal = (prompt: string) => {
    setInput(prompt);
    inputRef.current?.focus();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(input);
  };

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto max-w-[640px] pt-14">
        <h1
          className="mb-6"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 32,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: 'var(--fg-1)',
          }}
        >
          {userName.data ? `Hi ${userName.data}, ask anything` : 'Ask anything'}
        </h1>

        {!ready && provider.isFetched && <CloudRequiredBanner />}

        <form
          onSubmit={onSubmit}
          className="mb-8 rounded-2xl border p-3 transition-shadow focus-within:shadow-[var(--shadow-md)]"
          style={{
            borderColor: 'var(--border-subtle)',
            background: 'var(--surface-raised)',
            opacity: ready ? 1 : 0.6,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(input);
              }
            }}
            disabled={!ready}
            placeholder={ready ? 'What topics came up?' : 'Connect a cloud provider in Settings to ask across notes'}
            className="block w-full bg-transparent px-2 pb-3 pt-1 outline-none disabled:cursor-not-allowed"
            style={{ fontSize: 15, color: 'var(--fg-1)', fontFamily: 'var(--font-sans)' }}
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled
                className="inline-flex size-7 items-center justify-center rounded-md disabled:opacity-50"
                style={{ color: 'var(--fg-2)' }}
                aria-label="Attach a note (coming soon)"
                title="Attach a note (coming soon)"
              >
                <Paperclip className="size-[14px]" />
              </button>
              <span className="text-[12px]" style={{ color: 'var(--fg-muted)' }}>
                {provider.data?.cloud_provider
                  ? `${provider.data.cloud_provider} · ${provider.data.cloud_model}`
                  : 'Auto'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled
                className="inline-flex size-7 items-center justify-center rounded-md disabled:opacity-50"
                style={{ color: 'var(--fg-2)' }}
                aria-label="Voice input (coming soon)"
                title="Voice input (coming soon)"
              >
                <Mic className="size-[14px]" />
              </button>
              <button
                type="submit"
                disabled={!input.trim() || !ready}
                className="inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--surface-hover)] disabled:opacity-40"
                style={{ color: 'var(--fg-1)' }}
                aria-label="Send"
              >
                <ArrowUp className="size-[14px]" />
              </button>
            </div>
          </div>
        </form>

        <section className="mb-10">
          <SectionHead
            title="Recents"
            action={
              canExpand ? (
                <button
                  type="button"
                  onClick={() => setRecentsExpanded((v) => !v)}
                  className="inline-flex items-center gap-0.5 text-[12px] transition-colors hover:text-[color:var(--fg-1)]"
                  style={{ color: 'var(--fg-2)' }}
                >
                  {recentsExpanded ? 'Show less' : 'See all'}
                  <ChevronRight
                    className={`size-[12px] transition-transform ${recentsExpanded ? 'rotate-90' : ''}`}
                  />
                </button>
              ) : undefined
            }
          />
          {allRecents.length === 0 ? (
            <div
              className="rounded-md border px-4 py-6 text-center text-[13px]"
              style={{
                borderColor: 'var(--border-subtle)',
                color: 'var(--fg-2)',
                background: 'var(--surface-sunken)',
              }}
            >
              Your past chats will show up here.
            </div>
          ) : recentsExpanded && groupedRecents ? (
            <div className="flex flex-col">
              {groupedRecents.map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
                  <div
                    className="px-1 pb-1 pt-2 text-[11px] font-medium"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {group.label}
                  </div>
                  {group.sessions.map((s) => (
                    <ChatHistoryRow
                      key={s.id}
                      session={s}
                      showTime
                      onRename={(name) => void chat.renameSession(s.id, name)}
                      onDelete={() => void chat.deleteSession(s.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {recents.map((s) => (
                <ChatHistoryRow
                  key={s.id}
                  session={s}
                  showTime
                  onRename={(name) => void chat.renameSession(s.id, name)}
                  onDelete={() => void chat.deleteSession(s.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="pb-12">
          <SectionHead title="Meals" />
          <div className="flex flex-wrap gap-2">
            {MEALS.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => onPickMeal(m.prompt)}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--fg-1)',
                  background: 'var(--surface-raised)',
                }}
              >
                <ChefHat className="size-[13px]" style={{ color: 'var(--fg-2)' }} />
                {m.label}
              </button>
            ))}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
              style={{ color: 'var(--fg-2)' }}
              aria-label="See all preset prompts"
              title="See all (coming soon)"
            >
              See all
              <ChevronRight className="size-[12px]" />
            </button>
          </div>
        </section>
      </div>
    </MeetingsShell>
  );
}

// Module-level handoff between the entry page (kicks off the stream right
// before navigating) and the conversation page (picks up the stream id +
// session id on mount). Avoids stuffing them in the URL.
export interface PendingNewChat {
  sessionId: string;
  streamId: string;
}
let pendingNewChat: PendingNewChat | null = null;

export function consumePendingNewChat(sessionId: string): PendingNewChat | null {
  if (!pendingNewChat) return null;
  if (pendingNewChat.sessionId !== sessionId) return null;
  const out = pendingNewChat;
  pendingNewChat = null;
  return out;
}

function CloudRequiredBanner() {
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-md border px-3 py-2.5 text-[13px]"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--surface-sunken)',
        color: 'var(--fg-2)',
      }}
    >
      <Sparkles className="mt-0.5 size-[14px] flex-shrink-0" style={{ color: 'var(--fg-2)' }} />
      <div className="flex-1">
        Cross-note chat needs a cloud AI provider — local models can't fit a
        full-corpus prompt yet. Switch to OpenAI or Anthropic in{' '}
        <button
          type="button"
          className="underline transition-colors hover:text-[color:var(--fg-1)]"
          onClick={() => navigate('/settings')}
          style={{ color: 'var(--fg-1)' }}
        >
          Settings → AI
        </button>
        .
      </div>
    </div>
  );
}

function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="text-[13px] font-medium tracking-[-0.005em]" style={{ color: 'var(--fg-1)' }}>
        {title}
      </h2>
      {action}
    </div>
  );
}


import * as React from 'react';
import {
  ArrowUp,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { ChatHistoryRow } from '@/components/ChatHistoryRow';
import { FolderScopePicker } from '@/components/FolderScopePicker';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
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
import { PRESETS, PresetGlyph } from '@/lib/chatPresets';

export function Chat() {
  const allSessions = useAllChatSessions();
  // Reuse useChatSessions's persist/createSession with the global sentinel
  // so saves go through the same atomic-write path.
  const chat = useChatSessions(GLOBAL_SCOPE, null);
  const streaming = useGlobalStreaming();
  const provider = useAiProvider();
  const userName = useUserName();

  const [input, setInput] = React.useState('');
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  // Scope: null = ask across every note. Folder ID limits the corpus
  // server-side. Default null so first-time users get the broadest
  // possible answer.
  const [scopeFolderId, setScopeFolderId] = React.useState<string | null>(null);
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
      const streamId = streaming.startGlobalStream(q, scopeFolderId);
      // Stash the stream id + session id + scope on a module-level pending
      // map so the conversation page can pick them up after navigation.
      // Avoids having to thread them through the URL.
      pendingNewChat = { sessionId, streamId, folderId: scopeFolderId };
      navigate(`/chat/${encodeURIComponent(sessionId)}`);
    } finally {
      submittingRef.current = false;
    }
  };

  const onPickPreset = (prompt: string) => {
    setInput(prompt);
    setPresetsOpen(false);
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

        <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
          <PopoverAnchor asChild>
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
                  // Type "/" with an empty input → open the presets picker
                  // (matches the Granola pattern). Don't insert the slash —
                  // it's a shortcut character, not part of the prompt.
                  if (e.key === '/' && input === '' && ready) {
                    e.preventDefault();
                    setPresetsOpen(true);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit(input);
                  }
                }}
                disabled={!ready}
                placeholder={ready ? 'Summarise my meetings this week  /' : 'Connect a cloud provider in Settings to ask across notes'}
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
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="w-[var(--radix-popover-trigger-width)] max-w-none p-1"
            // Don't yank focus from the input when the popover opens — the
            // user is mid-typing and Enter/Esc need to keep working there.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium" style={{ color: 'var(--fg-muted)' }}>
              Presets
            </div>
            <div className="flex flex-col">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onPickPreset(p.prompt)}
                  className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--surface-hover)]"
                >
                  <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--fg-1)' }}>
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
          <SectionHead title="Presets" />
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => onPickPreset(m.prompt)}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors hover:bg-[color:var(--surface-hover)]"
                style={{
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--fg-1)',
                  background: 'var(--surface-raised)',
                }}
              >
                <PresetGlyph />
                {m.label}
              </button>
            ))}
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
  folderId: string | null;
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


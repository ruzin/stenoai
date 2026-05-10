import * as React from 'react';
import { ArrowUp, ArrowLeft, Globe, Lock, Square, Users } from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigate } from '@/lib/router';
import { ipc } from '@/lib/ipc';
import { useOrgMeeting, useOrgMeetings, useOrgSession } from '@/hooks/useOrg';

function formatDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function NotSignedIn() {
  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
        <div
          className="flex size-12 items-center justify-center rounded-full"
          style={{ background: 'var(--surface-raised)', color: 'var(--fg-2)' }}
        >
          <Users size={20} />
        </div>
        <h1 className="text-[24px] font-normal" style={{ fontFamily: 'var(--font-serif)', color: 'var(--fg-1)' }}>
          Connect your organisation
        </h1>
        <p className="text-[14px] leading-[1.55]" style={{ color: 'var(--fg-2)' }}>
          Sign in to your Steno enterprise adapter to see notes shared by your
          colleagues and chat across them.
        </p>
        <Button onClick={() => navigate('/settings')} className="mt-2">
          Open Settings → Organisation
        </Button>
      </div>
    </MeetingsShell>
  );
}

// ----------------------------------------------------------------------------
// LIST: /org/shared
// ----------------------------------------------------------------------------

export function OrgShared() {
  const session = useOrgSession();
  const meetings = useOrgMeetings(session.data?.signedIn ?? false);

  if (session.isLoading) {
    return (
      <MeetingsShell activeSummaryFile={null}>
        <div className="py-8 text-center text-[14px]" style={{ color: 'var(--fg-2)' }}>Loading…</div>
      </MeetingsShell>
    );
  }
  if (!session.data?.signedIn) return <NotSignedIn />;

  const rows = meetings.data ?? [];
  const myEmail = session.data.email;

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto max-w-[760px]">
        <header className="mb-8">
          <h1
            className="m-0 text-[28px] font-normal"
            style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em', color: 'var(--fg-1)' }}
          >
            Shared notes
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-2)' }}>
            {session.data.orgId} · {rows.length} {rows.length === 1 ? 'note' : 'notes'} · cross-note questions live in the Chat tab under <em>Shared notes</em>.
          </p>
        </header>

        {meetings.isLoading ? (
          <div className="py-8 text-center text-[14px]" style={{ color: 'var(--fg-2)' }}>Loading notes…</div>
        ) : meetings.error ? (
          <div className="rounded-[8px] border border-[color:var(--border-subtle)] p-4 text-[13px]" style={{ color: 'var(--danger, #b3261e)' }}>
            {(meetings.error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded-[10px] p-8 text-center text-[14px]"
            style={{
              background: 'var(--surface-sunken)',
              color: 'var(--fg-2)',
              border: '1px dashed var(--border-subtle)',
            }}
          >
            No shared notes yet — share one of your meetings with{' '}
            <span style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-mono)' }}>{session.data.orgId}</span>{' '}
            to see it here.
          </div>
        ) : (
          <ul className="flex flex-col">
            {rows.map((m) => (
              <li
                key={m.id}
                className="cursor-pointer border-t border-[color:var(--border-subtle)] py-3 transition-colors last:border-b hover:bg-[color:var(--surface-hover)]"
                onClick={() => navigate(`/org/shared/${encodeURIComponent(m.id)}`)}
              >
                <div className="flex items-start justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium" style={{ color: 'var(--fg-1)' }}>
                      {m.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                      {m.visibility === 'org' ? <Globe size={11} /> : <Lock size={11} />}
                      <span>{m.owner_email === myEmail ? 'you' : m.owner_email}</span>
                      <span>·</span>
                      <span>{formatDate(m.created_at)}</span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MeetingsShell>
  );
}

// ----------------------------------------------------------------------------
// DETAIL: /org/shared/:id  — body + chat-about-this-note
// ----------------------------------------------------------------------------

export function OrgSharedDetail({ id }: { id: string }) {
  const session = useOrgSession();
  const meeting = useOrgMeeting(id);
  if (!session.data?.signedIn) return <NotSignedIn />;

  // Body is inlined by the adapter (it server-side fetches from S3 if the
  // note has an s3_key). Renderer never talks to S3 directly — keeps creds
  // in one place and avoids CORS surprises.
  const bodyText = meeting.data?.body ?? '';

  return (
    <MeetingsShell activeSummaryFile={null}>
      <div className="mx-auto max-w-[760px]">
        <button
          type="button"
          onClick={() => navigate('/org/shared')}
          className="mb-5 inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--fg-1)]"
          style={{ color: 'var(--fg-2)' }}
        >
          <ArrowLeft size={12} /> Shared notes
        </button>

        {meeting.isLoading ? (
          <div className="py-8 text-center text-[14px]" style={{ color: 'var(--fg-2)' }}>Loading…</div>
        ) : meeting.error ? (
          <div className="rounded-[8px] border border-[color:var(--border-subtle)] p-4 text-[13px]" style={{ color: 'var(--danger, #b3261e)' }}>
            {(meeting.error as Error).message}
          </div>
        ) : meeting.data ? (
          <>
            <header className="mb-3">
              <h1
                className="m-0 text-[26px] font-normal"
                style={{ fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em', color: 'var(--fg-1)' }}
              >
                {meeting.data.title}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                <span>shared by {meeting.data.owner_email}</span>
                <span>·</span>
                <span>{formatDate(meeting.data.created_at)}</span>
                {meeting.data.has_artifact && (
                  <>
                    <span>·</span>
                    <span title="Body lives in your org's S3 bucket; the adapter fetched it server-side. Never written to this Mac.">
                      from S3
                    </span>
                  </>
                )}
              </p>
            </header>
            <article
              className="mb-8 whitespace-pre-wrap rounded-[10px] p-5 text-[14px] leading-[1.7]"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--fg-1)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {bodyText || '(no body)'}
            </article>

            <NoteChat
              system={
                `You answer questions about a single meeting note titled "${meeting.data.title}". Be concise and cite content from the note when relevant.\n\n--- NOTE ---\n${bodyText}`
              }
              placeholder="Ask about this note…"
            />
          </>
        ) : null}
      </div>
    </MeetingsShell>
  );
}

// ----------------------------------------------------------------------------
// Internal: NoteChat — small chat panel reused inside the detail view for
// asking questions about a single shared note. Cross-note questions live in
// the main Chat tab under the "Shared notes" scope.
// ----------------------------------------------------------------------------

interface NoteChatProps {
  system: string;
  placeholder: string;
}

interface ChatTurn { role: 'user' | 'assistant'; content: string }

/**
 * Streaming chat panel for a single shared note. Subscribes to the same
 * query-chunk / query-done events the local AskBar uses, so chunks arrive
 * the same way regardless of backend. Visually this matches the local
 * AskBar's rounded surface + composer at the bottom of its own card.
 */
function NoteChat({ system, placeholder }: NoteChatProps) {
  const [messages, setMessages] = React.useState<ChatTurn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [streamingText, setStreamingText] = React.useState('');
  const [streamingId, setStreamingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const logRef = React.useRef<HTMLDivElement>(null);
  const isStreaming = streamingId !== null;

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, streamingText]);

  const send = () => {
    const q = draft.trim();
    if (!q || isStreaming) return;
    setDraft('');
    setError(null);
    const history = [...messages];
    const next: ChatTurn[] = [...history, { role: 'user', content: q }];
    setMessages(next);
    setStreamingText('');

    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let acc = '';
    const off = ipc().subscribeQueryStream(id, {
      onChunk: (chunk) => {
        acc += chunk;
        setStreamingText(acc);
      },
      onDone: () => {
        setMessages((prev) => [...prev, { role: 'assistant', content: acc || '(empty response)' }]);
        setStreamingText('');
        setStreamingId(null);
        off();
      },
      onError: (err) => {
        setError(err.message);
        setStreamingText('');
        setStreamingId(null);
        off();
      },
    });
    setStreamingId(id);
    ipc().org.chatStream(id, { system, messages: next });
  };

  const cancel = () => {
    if (!streamingId) return;
    ipc().query.cancel(streamingId);
  };

  return (
    <section
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="border-b border-[color:var(--border-subtle)] px-4 py-2.5 text-[12px] font-medium" style={{ color: 'var(--fg-2)' }}>
        Ask · proxied through org adapter
      </div>
      <div ref={logRef} className="flex max-h-[360px] flex-col gap-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !isStreaming && (
          <div className="py-3 text-center text-[12px]" style={{ color: 'var(--fg-muted)' }}>
            no messages yet
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {isStreaming && <Bubble role="assistant" content={streamingText || 'Thinking…'} live />}
        {error && (
          <div className="text-[12px]" style={{ color: 'var(--danger, #b3261e)' }}>
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[color:var(--border-subtle)] px-3 py-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          className="h-[32px] rounded-[8px] text-[13px]"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button
            type="button"
            onClick={cancel}
            className="h-[32px] gap-1.5 px-3 text-[12px]"
            variant="outline"
          >
            <Square size={12} /> Stop
          </Button>
        ) : (
          <Button
            onClick={send}
            disabled={!draft.trim()}
            className="h-[32px] gap-1.5 px-3 text-[12px]"
          >
            <ArrowUp size={12} /> Send
          </Button>
        )}
      </div>
    </section>
  );
}

function Bubble({ role, content, live }: { role: 'user' | 'assistant'; content: string; live?: boolean }) {
  const base = 'max-w-[88%] rounded-[10px] px-3 py-2 text-[13.5px]';
  if (role === 'user') {
    return (
      <div
        className={`self-end ${base}`}
        style={{ background: 'var(--fg-1)', color: 'var(--surface-raised)' }}
      >
        {content}
      </div>
    );
  }
  return (
    <div
      className={`self-start whitespace-pre-wrap ${base}`}
      style={{ background: 'var(--surface-sunken)', color: 'var(--fg-1)', opacity: live && !content.trim() ? 0.6 : 1 }}
    >
      {content}
    </div>
  );
}

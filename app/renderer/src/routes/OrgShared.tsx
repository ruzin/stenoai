import * as React from 'react';
import { ArrowLeft, Globe, Lock, Send, Users } from 'lucide-react';
import { MeetingsShell } from '@/components/MeetingsShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { navigate } from '@/lib/router';
import { useOrgAiChat, useOrgMeeting, useOrgMeetingBody, useOrgMeetings, useOrgSession } from '@/hooks/useOrg';

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
  // Body comes back from S3 via the presigned download URL the adapter
  // hands us. Memory-cached only — nothing written to disk.
  const body = useOrgMeetingBody(meeting.data);
  if (!session.data?.signedIn) return <NotSignedIn />;

  const bodyText = body.data ?? '';

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
                    <span title="Body retrieved from your org's S3 bucket via a 15-minute presigned URL — never written to this Mac.">
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
              {body.isLoading
                ? 'Loading from S3…'
                : body.error
                  ? `(could not load body: ${(body.error as Error).message})`
                  : bodyText || '(no body)'}
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

function NoteChat({ system, placeholder }: { system: string; placeholder: string }) {
  const chat = useOrgAiChat();
  const [messages, setMessages] = React.useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([]);
  const [draft, setDraft] = React.useState('');
  const logRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, chat.isPending]);

  const send = async () => {
    const q = draft.trim();
    if (!q || chat.isPending) return;
    setDraft('');
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    try {
      const res = await chat.mutateAsync({ system, messages: next });
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      setMessages([
        ...next,
        { role: 'assistant', content: `(error: ${(e as Error).message})` },
      ]);
    }
  };

  return (
    <section
      className="rounded-[10px]"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="border-b border-[color:var(--border-subtle)] px-4 py-2.5 text-[12px] font-medium" style={{ color: 'var(--fg-2)' }}>
        Ask · proxied through org adapter
      </div>
      <div ref={logRef} className="flex max-h-[360px] flex-col gap-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="py-3 text-center text-[12px]" style={{ color: 'var(--fg-muted)' }}>
            no messages yet
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'self-end max-w-[88%] rounded-[10px] px-3 py-2 text-[13.5px]'
                : 'self-start max-w-[88%] rounded-[10px] px-3 py-2 text-[13.5px] whitespace-pre-wrap'
            }
            style={
              m.role === 'user'
                ? { background: 'var(--fg-1)', color: 'var(--surface-raised)' }
                : { background: 'var(--surface-sunken)', color: 'var(--fg-1)' }
            }
          >
            {m.content}
          </div>
        ))}
        {chat.isPending && (
          <div className="self-start text-[12px]" style={{ color: 'var(--fg-muted)' }}>
            thinking…
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
              void send();
            }
          }}
          placeholder={placeholder}
          className="h-[32px] rounded-[8px] text-[13px]"
          disabled={chat.isPending}
        />
        <Button
          onClick={() => void send()}
          disabled={chat.isPending || !draft.trim()}
          className="h-[32px] gap-1.5 px-3 text-[12px]"
        >
          <Send size={12} /> Send
        </Button>
      </div>
    </section>
  );
}

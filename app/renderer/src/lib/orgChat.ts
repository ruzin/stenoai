/**
 * Helpers for chatting against the org-shared notes corpus through the
 * adapter's /ai/chat endpoint. Used by both the Chat tab entry composer and
 * the ChatConversation follow-up composer when scope === ORG_SHARED_SCOPE.
 */
import { ipc } from '@/lib/ipc';
import type { OrgMeetingSummary, OrgMeeting } from '@/lib/ipc';
import { unwrap } from '@/lib/result';

interface OrgChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Fetches every visible org meeting and inlines its body (from S3 if needed).
 * Cheap with a handful of demo notes; once corpora grow, swap for retrieval.
 */
async function loadOrgCorpus(): Promise<string> {
  const list = unwrap(await ipc().org.listMeetings()).meetings as OrgMeetingSummary[];
  if (list.length === 0) return '(no shared notes available yet)';
  const blocks = await Promise.all(
    list.map(async (m): Promise<string> => {
      try {
        const meeting = unwrap(await ipc().org.getMeeting(m.id)).meeting as OrgMeeting;
        let body = meeting.body ?? '';
        if (!body && meeting.download_url) {
          const r = await fetch(meeting.download_url);
          if (r.ok) body = await r.text();
        }
        return [
          `### ${meeting.title}`,
          `[id: ${meeting.id}, shared by ${meeting.owner_email}]`,
          body || '(empty)',
        ].join('\n');
      } catch (e) {
        return `### ${m.title}\n[id: ${m.id}] (could not load body: ${(e as Error).message})`;
      }
    }),
  );
  return blocks.join('\n\n---\n\n');
}

const SYSTEM_PREFIX =
  `You answer questions across an organisation's shared meeting notes. ` +
  `Cite the note title (or its [id: ...]) when an answer comes from a specific note. ` +
  `If the corpus doesn't contain enough information to answer confidently, say so.`;

/** Sends one turn through org.aiChat, returning the assistant reply. */
export async function askOrgChat(
  history: OrgChatTurn[],
  question: string,
): Promise<string> {
  const corpus = await loadOrgCorpus();
  const system = `${SYSTEM_PREFIX}\n\n--- SHARED NOTES ---\n${corpus}`;
  const messages: OrgChatTurn[] = [
    ...history,
    { role: 'user', content: question },
  ];
  const res = unwrap(await ipc().org.aiChat({ system, messages }));
  return res.reply;
}

import type { Meeting } from '@/lib/ipc';

// Build a clean, metadata-rich Markdown bundle for pasting into an external LLM.
// Pure: takes the in-memory Meeting, returns a string. Returns '' when there is no
// transcript at all (callers disable their action on empty output).
export function buildTranscriptBundle(meeting: Meeting | null | undefined): string {
  if (!meeting) return '';

  const info = meeting.session_info;
  const title = (info?.name ?? '').trim() || 'Untitled note';

  // Prefer the diarised ([You]/[Others]) text when present; else the flat transcript.
  const body = (
    meeting.is_diarised && (meeting.diarised_text ?? '').trim()
      ? (meeting.diarised_text as string)
      : (meeting.transcript ?? '')
  ).trim();
  if (!body) return '';

  // Metadata line — drop any field that is missing. Labels are English to match
  // the rest of the UI (the Copy notes bundle, headings, etc. are all English);
  // the app isn't localised, so hardcoded German here read as a stray.
  const metaParts: string[] = [];
  const dateStr = isoToDate(info?.processed_at ?? info?.updated_at);
  if (dateStr) metaParts.push(`Date: ${dateStr}`);
  const durStr = secondsToMinutes(info?.duration_seconds);
  if (durStr) metaParts.push(`Duration: ${durStr}`);
  const people = participantNames(meeting.participants);
  if (people) metaParts.push(`Participants: ${people}`);

  const lines: string[] = [`# ${title}`];
  if (metaParts.length) lines.push(metaParts.join(' · '));

  const notes = (meeting.notes ?? '').trim();
  if (notes) lines.push('', '## Notes', notes);

  lines.push('', '## Transcript', body);
  return lines.join('\n');
}

// e.g. "2026-06-19-epsilon-planning.md"
export function defaultExportFilename(meeting: Meeting | null | undefined): string {
  const info = meeting?.session_info;
  const date = isoToDate(info?.processed_at ?? info?.updated_at) ?? isoToDate(new Date().toISOString())!;
  const slug =
    (info?.name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // Cap the slug so a very long title can't push the filename past the
      // ~255-byte filesystem limit (date prefix + ".md" leave headroom).
      .slice(0, 80)
      .replace(/-+$/g, '') || 'transcript';
  return `${date}-${slug}.md`;
}

function isoToDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function secondsToMinutes(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  return mins < 1 ? '<1 min' : `${mins} min`;
}

function participantNames(participants: unknown): string | null {
  // participants is typed as a list, but malformed/legacy data could hand us a
  // string or object; calling .map() on a non-array would throw and crash the
  // whole export render. Guard the collection itself, not just its entries.
  if (!Array.isArray(participants) || participants.length === 0) return null;
  const names = participants
    .map((p) => {
      // participants is unknown[]; a non-string entry (or a {name} whose name
      // isn't a string) must not reach .trim() — that would throw and crash the
      // whole export. Coerce anything non-string to '' instead.
      if (typeof p === 'string') return p;
      const name = (p as { name?: unknown } | null)?.name;
      return typeof name === 'string' ? name : '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? names.join(', ') : null;
}

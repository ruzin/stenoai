import i18n from '@/lib/i18n';

/*
 * Display title for a meeting whose real title has not been generated yet (#337).
 *
 * A recording is stored under the placeholder "Note" (optionally suffixed, e.g.
 * "Note-A1B2C3"). That string is a protocol token, not a name: the backend
 * matches it with _AUTO_NAMED_PATTERN (simple_recorder.py) and replaces it with
 * an AI-generated title once the summary exists. So it must stay exactly that in
 * storage — but a German user with auto-summarise off, or after a failed title
 * generation, would otherwise stare at an English "Note" forever.
 *
 * Same storage-vs-display split as the section headings and the seeded template
 * name: canonical English on disk, translated only where it is rendered.
 *
 * Deliberately narrow:
 *   - only the exact reserved tokens match, so a note a user actually named
 *     "Note" keeps their name (it is stored identically, and treating it as a
 *     placeholder is the lesser evil of the two — the backend already does the
 *     same thing when it decides whether to overwrite the title).
 *   - the backend pattern also covers "<name> — <timestamp>", which is a
 *     user-named session and must NOT be touched here.
 *   - never use this where the value is stored, searched or uploaded. It is for
 *     rendering only.
 */
const PLACEHOLDER = /^(Meeting|Note)(-[A-Z0-9]{6})?$/;

export function meetingDisplayTitle(name: string | null | undefined): string {
  if (!name) return '';
  const match = PLACEHOLDER.exec(name);
  if (!match) return name;
  const base = i18n.t(`meeting.placeholderTitle.${match[1].toLowerCase()}`, {
    defaultValue: match[1],
  });
  // Keep the disambiguating suffix: back-to-back recordings rely on it to tell
  // otherwise-identical placeholder titles apart in the list.
  return `${base}${match[2] ?? ''}`;
}

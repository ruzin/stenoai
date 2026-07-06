/**
 * Builds the plain-text payload for the "Copy notes" header action in
 * MeetingDetail. Pure so the report-vs-Standard selection is unit-testable:
 * when a generated template report is open, the clipboard must carry that
 * report's markdown, not the Standard structured note — the copy always
 * matches what's on screen.
 */

export interface NotesCopySections {
  name: string;
  meta?: string;
  summary?: string;
  discussionAreas: { title: string; analysis?: string }[];
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
}

export function buildNotesCopyText(
  sections: NotesCopySections,
  activeReport: { content: string } | null,
): string {
  const lines: string[] = [sections.name];
  if (sections.meta) lines.push(sections.meta);

  if (activeReport) {
    const content = activeReport.content.trim();
    if (content) lines.push('', content);
    return lines.join('\n');
  }

  const summary = sections.summary?.trim();
  if (summary) {
    lines.push('', 'SUMMARY', summary);
  }
  if (sections.discussionAreas.length) {
    lines.push('', 'KEY TOPICS');
    sections.discussionAreas.forEach((a) =>
      lines.push(`- ${a.title}${a.analysis ? `: ${a.analysis}` : ''}`),
    );
  }
  if (sections.keyPoints.length) {
    lines.push('', 'KEY POINTS');
    sections.keyPoints.forEach((p) => lines.push(`- ${p}`));
  }
  if (sections.actionItems.length) {
    lines.push('', 'ACTION ITEMS');
    sections.actionItems.forEach((a) => lines.push(`- ${a}`));
  }
  if (sections.participants.length) {
    lines.push('', 'PARTICIPANTS', sections.participants.join(', '));
  }
  return lines.join('\n');
}

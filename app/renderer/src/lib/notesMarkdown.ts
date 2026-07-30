import type { StructuredNoteSections } from './notesCopy';

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

export function buildNotesMarkdown(
  sections: StructuredNoteSections,
  activeReport: { content: string } | null,
): string {
  const titleBlock = [`# ${sections.name}`];
  if (sections.meta) titleBlock.push(sections.meta);

  const blocks: string[] = [titleBlock.join('\n')];

  if (activeReport) {
    if (hasText(activeReport.content)) blocks.push(activeReport.content);
    return blocks.join('\n\n');
  }

  if (hasText(sections.summary)) {
    blocks.push(`## Summary\n\n${sections.summary}`);
  }

  if (sections.discussionAreas.length) {
    const topics = sections.discussionAreas
      .map((area) => {
        const topic = [`### ${area.title}`];
        if (hasText(area.analysis)) topic.push('', area.analysis);
        return topic.join('\n');
      })
      .join('\n\n');
    blocks.push(`## Key Topics\n\n${topics}`);
  }

  if (sections.keyPoints.length) {
    blocks.push(`## Key Points\n\n${sections.keyPoints.map((point) => `- ${point}`).join('\n')}`);
  }

  if (sections.actionItems.length) {
    blocks.push(`## Action Items\n\n${sections.actionItems.map((item) => `- ${item}`).join('\n')}`);
  }

  if (sections.participants.length) {
    blocks.push(`## Participants\n\n${sections.participants.join(', ')}`);
  }

  return blocks.join('\n\n');
}

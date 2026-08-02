import { describe, expect, test } from 'vitest';
import type { StructuredNoteSections } from './notesCopy';
import { buildNotesMarkdown } from './notesMarkdown';

const fullSections: StructuredNoteSections = {
  name: 'Weekly *sync*',
  meta: 'Mon, Jun 23, 2026, 10:00 AM · 45m',
  summary: 'We discussed **the roadmap**.',
  discussionAreas: [
    {
      title: 'Roadmap & scope',
      analysis: 'Q3 priorities [agreed](https://example.com/roadmap).',
    },
    { title: 'Hiring' },
  ],
  keyPoints: ['Ship `v2` in July'],
  actionItems: ['Ben: prepare <the draft>'],
  participants: ['Ben', 'Ruzin & Alex'],
};

describe('buildNotesMarkdown', () => {
  test('renders every structured field in copy-export order without escaping body text', () => {
    expect(buildNotesMarkdown(fullSections, null)).toBe(
      [
        '# Weekly *sync*',
        'Mon, Jun 23, 2026, 10:00 AM · 45m',
        '',
        '## Summary',
        '',
        'We discussed **the roadmap**.',
        '',
        '## Key Topics',
        '',
        '### Roadmap & scope',
        '',
        'Q3 priorities [agreed](https://example.com/roadmap).',
        '',
        '### Hiring',
        '',
        '## Key Points',
        '',
        '- Ship `v2` in July',
        '',
        '## Action Items',
        '',
        '- Ben: prepare <the draft>',
        '',
        '## Participants',
        '',
        'Ben, Ruzin & Alex',
      ].join('\n'),
    );
  });

  test('removing any handled structured field changes the output', () => {
    const complete = buildNotesMarkdown(fullSections, null);
    const removals: Array<[string, StructuredNoteSections]> = [
      ['title', { ...fullSections, name: '' }],
      ['meta', { ...fullSections, meta: undefined }],
      ['summary', { ...fullSections, summary: undefined }],
      [
        'discussion title',
        {
          ...fullSections,
          discussionAreas: [
            { analysis: fullSections.discussionAreas[0].analysis, title: '' },
            fullSections.discussionAreas[1],
          ],
        },
      ],
      [
        'discussion analysis',
        {
          ...fullSections,
          discussionAreas: [
            { title: fullSections.discussionAreas[0].title },
            fullSections.discussionAreas[1],
          ],
        },
      ],
      ['discussion areas', { ...fullSections, discussionAreas: [] }],
      ['key points', { ...fullSections, keyPoints: [] }],
      ['action items', { ...fullSections, actionItems: [] }],
      ['participants', { ...fullSections, participants: [] }],
    ];

    removals.forEach(([field, sections]) => {
      expect(buildNotesMarkdown(sections, null), field).not.toBe(complete);
    });
  });

  test('omits every empty section without leaving a heading', () => {
    const markdown = buildNotesMarkdown(
      {
        name: 'Empty note',
        summary: '   ',
        discussionAreas: [],
        keyPoints: [],
        actionItems: [],
        participants: [],
      },
      null,
    );

    expect(markdown).toBe('# Empty note');
    expect(markdown).not.toContain('## Summary');
    expect(markdown).not.toContain('## Key Topics');
    expect(markdown).not.toContain('## Key Points');
    expect(markdown).not.toContain('## Action Items');
    expect(markdown).not.toContain('## Participants');
  });

  test('an open active report preserves title and meta while replacing the structured body', () => {
    const content = '## 1:1 Notes\n\n- Roadmap <locked>\n';
    const markdown = buildNotesMarkdown(fullSections, { content });

    expect(markdown).toBe(
      [
        '# Weekly *sync*',
        'Mon, Jun 23, 2026, 10:00 AM · 45m',
        '',
        content,
      ].join('\n'),
    );
    expect(markdown).not.toContain('## Summary');
    expect(markdown).not.toContain('## Key Topics');
    expect(buildNotesMarkdown(fullSections, { content: '' })).not.toBe(markdown);
  });
});

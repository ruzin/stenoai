// Pure, section-scoped transforms over the BODY of a meeting note (.md) -
// everything after the closing frontmatter '---'. Every function replaces
// exactly one '## ' section and leaves every other byte untouched. This is the
// same contract upsertUserNotesSection (main.js) already proves for User Notes;
// this module generalises it so the note editor can patch the other sections.
//
// The canonical order is the one simple_recorder.py writes: the model's
// markdown (Summary, Key Topics, Key Points, Action Items), then Transcript,
// then User Notes. A section that does not exist yet is inserted at its
// canonical position so the file keeps the shape a user recognises.
//
// Section headings are matched case-insensitively because parseMeetingMarkdown
// lowercases them; they are WRITTEN in canonical casing.

const SECTION_ORDER = [
  'Summary',
  'Key Topics',
  'Key Points',
  'Action Items',
  'Participants',
  'Transcript',
  'User Notes',
];

// A line that would create or close a markdown section if it reached the file.
// Leading whitespace counts: parseMeetingMarkdown trims nothing on the way in,
// but a pasted "  ## Transcript" is still a user trying to forge structure.
const STRUCTURAL_LINE = /^\s*#{1,6}\s/m;

function containsStructuralLine(text) {
  return STRUCTURAL_LINE.test(String(text ?? ''));
}

function canonicalRank(heading) {
  const i = SECTION_ORDER.findIndex(
    (h) => h.toLowerCase() === String(heading).trim().toLowerCase(),
  );
  // An unknown section sorts last so a future section we do not know about is
  // never re-ordered ahead of Transcript.
  return i === -1 ? SECTION_ORDER.length : i;
}

// Split the body into ordered blocks. The first block carries any preamble
// before the first '## ' heading and has heading === null.
function splitSections(body) {
  const blocks = [{ heading: null, lines: [] }];
  for (const line of String(body ?? '').split('\n')) {
    // '### Topic' does NOT match: index 2 is '#', not a space. Same rule as
    // parseMeetingMarkdown, so topics stay inside their parent section.
    if (line.startsWith('## ')) {
      blocks.push({ heading: line.slice(3).trim(), lines: [] });
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks;
}

function joinSections(blocks) {
  const out = [];
  for (const block of blocks) {
    if (block.heading !== null) out.push(`## ${block.heading}`);
    out.push(...block.lines);
  }
  // Trim the tail so repeated edits cannot accrete blank lines, then restore
  // exactly one terminating newline.
  return `${out.join('\n').replace(/\s+$/, '')}\n`;
}

// The body lines of a section: one blank line after the heading, the content,
// one blank line before whatever follows.
function sectionLines(content) {
  return ['', ...String(content).split('\n'), ''];
}

function setSection(body, heading, content) {
  const blocks = splitSections(body);
  const trimmed = String(content ?? '').replace(/\s+$/, '');
  const at = blocks.findIndex(
    (b) => b.heading !== null && b.heading.toLowerCase() === heading.toLowerCase(),
  );

  if (at !== -1) {
    // An empty value removes the section, matching upsertUserNotesSection.
    if (!trimmed) {
      blocks.splice(at, 1);
      return joinSections(blocks);
    }
    blocks[at].lines = sectionLines(trimmed);
    return joinSections(blocks);
  }

  if (!trimmed) return joinSections(blocks);

  const rank = canonicalRank(heading);
  let insertAt = blocks.length;
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i].heading !== null && canonicalRank(blocks[i].heading) > rank) {
      insertAt = i;
      break;
    }
  }
  blocks.splice(insertAt, 0, { heading, lines: sectionLines(trimmed) });
  return joinSections(blocks);
}

function renderBulletList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join('\n');
}

function renderTopics(areas) {
  return (Array.isArray(areas) ? areas : [])
    .map((area) => {
      const title = String(area && area.title ? area.title : '').trim();
      if (!title) return '';
      const analysis = String(area && area.analysis ? area.analysis : '').trim();
      return analysis ? `### ${title}\n\n${analysis}` : `### ${title}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

const setSummary = (body, text) => setSection(body, 'Summary', String(text ?? '').trim());
const setKeyPoints = (body, items) => setSection(body, 'Key Points', renderBulletList(items));
const setActionItems = (body, items) => setSection(body, 'Action Items', renderBulletList(items));
const setDiscussionAreas = (body, areas) => setSection(body, 'Key Topics', renderTopics(areas));

module.exports = {
  SECTION_ORDER,
  containsStructuralLine,
  setSection,
  setSummary,
  setKeyPoints,
  setActionItems,
  setDiscussionAreas,
};

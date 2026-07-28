const { test } = require('node:test');
const assert = require('node:assert');

const {
  setSummary,
  setKeyPoints,
  setActionItems,
  setDiscussionAreas,
  containsStructuralLine,
} = require('./note-sections');

// A note body in the exact shape simple_recorder.py writes: the model's
// markdown, then ## Transcript, then ## User Notes.
const BODY = [
  '',
  '## Summary',
  '',
  'We agreed the budget.',
  '',
  '## Key Topics',
  '',
  '### Budget',
  '',
  'Numbers were reviewed.',
  '',
  '## Key Points',
  '',
  '- Budget approved',
  '',
  '## Action Items',
  '',
  '- Anna sends the draft',
  '',
  '## Transcript',
  '',
  '[You] Hello.',
  '',
  '## User Notes',
  '',
  'my own note',
  '',
].join('\n');

test('setSummary replaces only the summary and leaves every other section byte-identical', () => {
  const out = setSummary(BODY, 'We agreed the budget for Q3.');
  assert.match(out, /## Summary\n\nWe agreed the budget for Q3\.\n/);
  assert.match(out, /## Transcript\n\n\[You\] Hello\.\n/);
  assert.match(out, /## User Notes\n\nmy own note\n/);
  assert.match(out, /### Budget\n\nNumbers were reviewed\.\n/);
  assert.strictEqual(out.includes('We agreed the budget.\n'), false);
});

test('setKeyPoints rewrites the bullet list', () => {
  const out = setKeyPoints(BODY, ['Budget approved', 'Anna owns the draft']);
  assert.match(out, /## Key Points\n\n- Budget approved\n- Anna owns the draft\n/);
  assert.match(out, /## Action Items\n\n- Anna sends the draft\n/);
});

test('setActionItems with an empty list removes the section entirely', () => {
  const out = setActionItems(BODY, []);
  assert.strictEqual(out.includes('## Action Items'), false);
  assert.match(out, /## Key Points\n\n- Budget approved\n/);
  assert.match(out, /## Transcript\n/);
});

test('setDiscussionAreas rewrites the ### topics under Key Topics', () => {
  const out = setDiscussionAreas(BODY, [
    { title: 'Budget', analysis: 'Numbers were reviewed.' },
    { title: 'Hiring', analysis: 'Two roles open.' },
  ]);
  assert.match(out, /## Key Topics\n\n### Budget\n\nNumbers were reviewed\.\n\n### Hiring\n\nTwo roles open\.\n/);
});

test('a topic without analysis renders as a bare heading', () => {
  const out = setDiscussionAreas(BODY, [{ title: 'Budget' }]);
  assert.match(out, /### Budget\n/);
  assert.strictEqual(out.includes('undefined'), false);
});

test('a missing section is inserted at its canonical position, not appended', () => {
  const withoutActions = setActionItems(BODY, []);
  const out = setActionItems(withoutActions, ['Ben books the room']);
  const actionsAt = out.indexOf('## Action Items');
  const keyPointsAt = out.indexOf('## Key Points');
  const transcriptAt = out.indexOf('## Transcript');
  assert.ok(keyPointsAt < actionsAt, 'Action Items must follow Key Points');
  assert.ok(actionsAt < transcriptAt, 'Action Items must precede Transcript');
});

test('repeated edits do not accrete blank lines', () => {
  let out = setSummary(BODY, 'One.');
  out = setSummary(out, 'Two.');
  out = setSummary(out, 'Three.');
  assert.strictEqual(/\n{3,}/.test(out), false);
});

test('containsStructuralLine catches a heading a user could paste into a field', () => {
  assert.strictEqual(containsStructuralLine('## Transcript'), true);
  assert.strictEqual(containsStructuralLine('ok\n### Sneaky'), true);
  assert.strictEqual(containsStructuralLine('  ## indented'), true);
  assert.strictEqual(containsStructuralLine('a #hashtag is fine'), false);
  assert.strictEqual(containsStructuralLine('C# is fine'), false);
});

import { describe, expect, it } from 'vitest';

import { orderProfilesForRow } from './SpeakerReviewPanel';

const p = (display_name: string) => ({ display_name, person_id: `id-${display_name.toLowerCase()}` });

describe('orderProfilesForRow', () => {
  it('puts people already assigned in this meeting first', () => {
    const ordered = orderProfilesForRow(
      [p('Zoe'), p('Alice'), p('Max')],
      new Set(['id-max']),
    );
    expect(ordered.map((x) => x.display_name)).toEqual(['Max', 'Alice', 'Zoe']);
  });

  it('keeps each group alphabetical', () => {
    const ordered = orderProfilesForRow(
      [p('Zoe'), p('Alice'), p('Max'), p('Bea')],
      new Set(['id-max', 'id-zoe']),
    );
    expect(ordered.map((x) => x.display_name)).toEqual(['Max', 'Zoe', 'Alice', 'Bea']);
  });

  it('leaves the order alone when nobody is assigned yet', () => {
    const ordered = orderProfilesForRow([p('Zoe'), p('Alice')], new Set());
    expect(ordered.map((x) => x.display_name)).toEqual(['Alice', 'Zoe']);
  });

  it('does not mutate the list it was given', () => {
    const input = [p('Zoe'), p('Alice')];
    orderProfilesForRow(input, new Set(['id-alice']));
    expect(input.map((x) => x.display_name)).toEqual(['Zoe', 'Alice']);
  });
});

describe('orderProfilesForRow identity', () => {
  it('matches on person_id, not on the display name', () => {
    // Two profiles can read alike after a rename. Marking the never-assigned
    // one as present in this meeting would invite the exact misassignment
    // the "here" hint exists to prevent.
    const assigned = { display_name: 'Alex', person_id: 'id-a' };
    const other = { display_name: 'Alex', person_id: 'id-b' };
    const ordered = orderProfilesForRow([other, assigned], new Set(['id-a']));
    expect(ordered.map((x) => x.person_id)).toEqual(['id-a', 'id-b']);
  });
});

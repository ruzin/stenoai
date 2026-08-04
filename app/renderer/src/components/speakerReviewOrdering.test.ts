import { describe, expect, it } from 'vitest';

import { orderProfilesForRow } from './SpeakerReviewPanel';

const p = (display_name: string) => ({ display_name, person_id: display_name.toLowerCase() });

describe('orderProfilesForRow', () => {
  it('puts people already assigned in this meeting first', () => {
    const ordered = orderProfilesForRow(
      [p('Zoe'), p('Alice'), p('Max')],
      new Set(['Max']),
    );
    expect(ordered.map((x) => x.display_name)).toEqual(['Max', 'Alice', 'Zoe']);
  });

  it('keeps each group alphabetical', () => {
    const ordered = orderProfilesForRow(
      [p('Zoe'), p('Alice'), p('Max'), p('Bea')],
      new Set(['Max', 'Zoe']),
    );
    expect(ordered.map((x) => x.display_name)).toEqual(['Max', 'Zoe', 'Alice', 'Bea']);
  });

  it('leaves the order alone when nobody is assigned yet', () => {
    const ordered = orderProfilesForRow([p('Zoe'), p('Alice')], new Set());
    expect(ordered.map((x) => x.display_name)).toEqual(['Alice', 'Zoe']);
  });

  it('does not mutate the list it was given', () => {
    const input = [p('Zoe'), p('Alice')];
    orderProfilesForRow(input, new Set(['Alice']));
    expect(input.map((x) => x.display_name)).toEqual(['Zoe', 'Alice']);
  });
});

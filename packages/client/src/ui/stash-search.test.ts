import type { Item, ItemDb } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { countHits, searcher } from './stash-search';

const def = (id: string, name: string) => ({ id, name, type: 'misc', size: [1, 1] });
const items = new Map(
  [
    def('akm', 'AKM'),
    def('dot', 'Red dot'),
    def('round', '7.62×39 mm AP'),
    def('pack', 'Small backpack'),
  ].map((d) => [d.id, d]),
) as unknown as ItemDb;

const plain = (item: string): Item => ({ item, count: 1 });
const akm: Item = {
  ...plain('akm'),
  attachments: { optic: 'dot', muzzle: null, magazine: null },
};

describe('stash search', () => {
  it('finds nothing to pick out with nothing typed', () => {
    expect(searcher(items, '')).toBeNull();
    expect(searcher(items, '   ')).toBeNull();
  });

  it('matches names in any case, and part of a word', () => {
    expect(searcher(items, 'ak')!(plain('akm'))).toBe(true);
    expect(searcher(items, 'BACKPACK')!(plain('pack'))).toBe(true);
    expect(searcher(items, 'scope')!(plain('akm'))).toBe(false);
  });

  it('takes an x for the × in a name', () => {
    expect(searcher(items, '7.62x39')!(plain('round'))).toBe(true);
    expect(searcher(items, '7.62×39')!(plain('round'))).toBe(true);
  });

  it('needs every word, and looks at what is fitted to a gun', () => {
    expect(searcher(items, 'akm red')!(akm)).toBe(true);
    expect(searcher(items, 'red')!(plain('akm'))).toBe(false);
    expect(searcher(items, 'akm blue')!(akm)).toBe(false);
  });

  it('finds a bag by what is in it, and counts a grid', () => {
    const round = { item: plain('round'), x: 0, y: 0, rotated: false };
    const inside = { w: 2, h: 2, containers: false, items: [round] };
    const bag: Item = { ...plain('pack'), grid: inside };
    const hit = searcher(items, 'ap')!;
    expect(hit(bag)).toBe(true);
    const grid = {
      w: 4,
      h: 1,
      containers: true,
      items: [{ item: bag, x: 0, y: 0, rotated: false }],
    };
    grid.items.push({ item: plain('dot'), x: 1, y: 0, rotated: false });
    expect(countHits(grid, hit)).toBe(1);
  });
});

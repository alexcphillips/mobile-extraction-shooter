import type { Item } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { holdsFavourite } from './favourites';

const plain = (item: string): Item => ({ item, count: 1 });

describe('favourites', () => {
  const favs = new Set(['gpu', 'red-dot']);

  it('picks out a favourite, and what holds one', () => {
    expect(holdsFavourite(plain('gpu'), favs)).toBe(true);
    expect(holdsFavourite(plain('watch'), favs)).toBe(false);
    // A gun with a favourite fitted.
    const gun: Item = {
      ...plain('akm'),
      attachments: { optic: 'red-dot', muzzle: null, magazine: null },
    };
    expect(holdsFavourite(gun, favs)).toBe(true);
    // A backpack with one inside, however deep.
    const bag: Item = {
      ...plain('backpack'),
      grid: {
        w: 4,
        h: 4,
        containers: false,
        items: [{ x: 0, y: 0, rotated: false, item: plain('gpu') }],
      },
    };
    expect(holdsFavourite(bag, favs)).toBe(true);
    expect(holdsFavourite(bag, new Set())).toBe(false);
  });
});

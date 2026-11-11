import type { Item } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { holdsFavorite } from './favorites';

const plain = (item: string): Item => ({ item, count: 1 });

describe('favorites', () => {
  const favs = new Set(['gpu', 'red-dot']);

  it('picks out a favorite, and what holds one', () => {
    expect(holdsFavorite(plain('gpu'), favs)).toBe(true);
    expect(holdsFavorite(plain('watch'), favs)).toBe(false);
    // A gun with a favorite fitted.
    const gun: Item = {
      ...plain('akm'),
      attachments: { optic: 'red-dot', muzzle: null, magazine: null, laser: null },
    };
    expect(holdsFavorite(gun, favs)).toBe(true);
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
    expect(holdsFavorite(bag, favs)).toBe(true);
    expect(holdsFavorite(bag, new Set())).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createItem } from '../sim/create-item';
import { TEST_ITEMS as items } from '../sim/test-items';
import { createGrid, placeAt } from './grid';
import { sortGrid } from './sort';

/** A 6×4 stash page with things scattered over it, and half stacks of rounds. */
function messy() {
  const grid = createGrid(6, 4, true);
  placeAt(items, grid, createItem(items, 'watch'), 5, 3, false);
  placeAt(items, grid, createItem(items, 'round', 30), 0, 3, false);
  placeAt(items, grid, createItem(items, 'bandage'), 1, 2, false);
  placeAt(items, grid, createItem(items, 'rifle'), 2, 0, false);
  placeAt(items, grid, createItem(items, 'round', 40), 0, 0, false);
  expect(grid.items).toHaveLength(5);
  return grid;
}

describe('sorting a stash page', () => {
  it('packs by type from the top left, topping up stacks', () => {
    const grid = messy();
    expect(sortGrid(items, grid, 'type')).toBe(true);
    expect(grid.items.map((g) => [g.item.item, g.item.count, g.x, g.y])).toEqual([
      ['rifle', 1, 0, 0],
      // 40 + 30 rounds: one stack (a stack is 100).
      ['round', 70, 4, 0],
      ['bandage', 1, 5, 0],
      ['watch', 1, 4, 1],
    ]);
  });

  it('by value puts the dearest first, and leaves the page as it was if it all wouldn’t fit', () => {
    const grid = messy();
    expect(sortGrid(items, grid, 'value')).toBe(true);
    expect(grid.items[0]!.item.item).toBe('rifle');
    // Too full to repack: four rifles in a 4×8 page take it all, and a fifth item won't go.
    const full = createGrid(4, 8, true);
    for (let y = 0; y < 8; y += 2) placeAt(items, full, createItem(items, 'rifle'), 0, y, false);
    const before = JSON.parse(JSON.stringify(full.items)) as unknown;
    full.items.push({ x: 0, y: 7, rotated: false, item: createItem(items, 'watch') });
    expect(sortGrid(items, full, 'type')).toBe(false);
    expect(full.items.slice(0, 4)).toEqual(before);
  });
});

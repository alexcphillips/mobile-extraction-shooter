import { describe, expect, it } from 'vitest';
import { TEST_ITEMS as items } from '../sim/test-items';
import {
  addItem,
  canHold,
  canSwap,
  countOf,
  createGrid,
  dropAt,
  findSpot,
  inGrid,
  isFree,
  itemAt,
  placeAt,
  rotateAt,
  takeFrom,
  transfer,
  type Item,
} from './grid';

const one = (item: string, count = 1): Item => ({ item, count });

describe('grids', () => {
  it('auto-places row by row from the top left, unrotated before rotated', () => {
    const g = createGrid(4, 3);
    // The 4×2 rifle fills the top two rows; the 2×1 pistol goes under it.
    expect(addItem(items, g, one('rifle'))).toBe(0);
    expect(findSpot(items, g, 'pistol')).toEqual({ x: 0, y: 2, rotated: false });
    // A 1×2 magazine only fits a 1-high gap turned on its side.
    expect(findSpot(items, g, 'big-mag')).toEqual({ x: 0, y: 2, rotated: true });
    expect(addItem(items, g, one('big-mag'))).toBe(0);
    expect(g.items[1]).toMatchObject({ x: 0, y: 2, rotated: true });
    expect(itemAt(items, g, 1, 2)).toBe(1);
    expect(itemAt(items, g, 2, 2)).toBe(-1);
  });

  it('keeps items in bounds and apart', () => {
    const g = createGrid(3, 3);
    expect(placeAt(items, g, one('helmet'), 1, 1, false)).toBe(true);
    expect(isFree(items, g, 0, 0, 1, 3)).toBe(true);
    expect(isFree(items, g, 0, 0, 2, 2)).toBe(false);
    expect(placeAt(items, g, one('helmet'), 2, 0, false)).toBe(false);
    expect(placeAt(items, g, one('round'), 3, 0, false)).toBe(false);
    expect(placeAt(items, g, one('round'), 0, 0, false)).toBe(true);
    // The 3×3 vest has nowhere to go.
    expect(addItem(items, g, one('vest'))).toBe(1);
  });

  it('tops up stacks first, then fills new spots a full stack at a time', () => {
    const g = createGrid(2, 1);
    addItem(items, g, one('round', 70));
    const more = one('round', 200);
    // 30 top up the first stack, 100 make a second, and 70 don't fit.
    expect(addItem(items, g, more)).toBe(70);
    expect(more.count).toBe(70);
    expect(g.items.map((i) => i.item.count)).toEqual([100, 100]);
    expect(countOf(g, 'round')).toBe(200);
    // A stack that fits whole goes in as itself.
    const h = createGrid(1, 1);
    const stack = one('round', 40);
    addItem(items, h, stack);
    expect(h.items[0]!.item).toBe(stack);
  });

  it('takes from stacks, removing the empty ones', () => {
    const g = createGrid(3, 1);
    addItem(items, g, one('round', 250));
    expect(takeFrom(g, 'round', 60)).toBe(60);
    expect(g.items.map((i) => i.item.count)).toEqual([100, 90]);
    expect(takeFrom(g, 'round', 500)).toBe(190);
    expect(g.items).toEqual([]);
  });

  it('puts no containers in containers', () => {
    const pockets = createGrid(4, 4);
    const stash = createGrid(10, 10, true);
    const backpack = one('backpack');
    expect(canHold(items, pockets, backpack)).toBe(false);
    expect(addItem(items, pockets, backpack)).toBe(1);
    expect(placeAt(items, pockets, backpack, 0, 0, false)).toBe(false);
    expect(addItem(items, stash, backpack)).toBe(0);
    expect(transfer(items, stash, 0, pockets)).toBe(false);
    expect(dropAt(items, stash, 0, pockets, 0, 0, false)).toBe(false);
    expect(stash.items).toHaveLength(1);
  });

  it("takes rigs and backpacks, full or not, in a backpack's grid, but never in themselves", () => {
    const pack = createGrid(10, 10);
    pack.bags = true;
    const empty: Item = { item: 'rig', count: 1, grid: createGrid(3, 2) };
    expect(canHold(items, pack, empty)).toBe(true);
    expect(addItem(items, pack, empty)).toBe(0);
    // A rig full of meds, and a full backpack, go in too (2026-11-11).
    const fullRig: Item = { item: 'rig', count: 1, grid: createGrid(3, 2) };
    addItem(items, fullRig.grid!, one('round'));
    expect(addItem(items, pack, fullRig)).toBe(0);
    const full: Item = { item: 'backpack', count: 1, grid: createGrid(4, 4) };
    full.grid!.bags = true;
    addItem(items, full.grid!, one('pistol'));
    expect(addItem(items, pack, full)).toBe(0);
    // As deep as you like, but a bag never goes in its own grid or one inside it.
    const outer: Item = { item: 'backpack', count: 1, grid: pack };
    expect(canHold(items, full.grid!, outer)).toBe(false);
    expect(canHold(items, pack, outer)).toBe(false);
    expect(canHold(items, full.grid!, { item: 'backpack', count: 1, grid: createGrid(2, 2) })).toBe(
      true,
    );
    // Never a rig's grid, and never the vault, even empty.
    expect(canHold(items, fullRig.grid!, { item: 'rig', count: 1, grid: createGrid(1, 1) })).toBe(
      false,
    );
    expect(canHold(items, pack, { item: 'vault', count: 1, grid: createGrid(2, 2) })).toBe(false);
  });

  it('moves and rotates by dropping, if there is room', () => {
    const g = createGrid(3, 2);
    placeAt(items, g, one('pistol'), 0, 0, false);
    placeAt(items, g, one('round'), 2, 1, false);
    // Moving onto its own old cells is fine.
    expect(dropAt(items, g, 0, g, 1, 0, false)).toBe(true);
    expect(g.items[0]).toMatchObject({ x: 1, y: 0, rotated: false });
    // Turned upright at (1, 0) it's clear.
    expect(rotateAt(items, g, 0)).toBe(true);
    expect(g.items[0]).toMatchObject({ x: 1, y: 0, rotated: true });
    // Turning back flat with the round at (2, 0) in the way doesn't (it can't swap with it).
    g.items[1]!.y = 0;
    expect(rotateAt(items, g, 0)).toBe(false);
    expect(g.items[0]).toMatchObject({ x: 1, y: 0, rotated: true });
  });

  it('swaps a dropped item with the items under it if they fit where it was', () => {
    // A 1×2 medkit at (0, 0) dropped on two 1×1s at (2, 0) and (2, 1).
    const g = createGrid(3, 2);
    placeAt(items, g, one('medkit'), 0, 0, false);
    placeAt(items, g, one('watch'), 2, 0, false);
    placeAt(items, g, one('bandage'), 2, 1, false);
    expect(canSwap(items, g, 0, g, 2, 0, false)).toBe(true);
    expect(dropAt(items, g, 0, g, 2, 0, false)).toBe(true);
    const at = (id: string) => g.items.find((o) => o.item.item === id);
    expect(at('medkit')).toMatchObject({ x: 2, y: 0 });
    expect(at('watch')).toMatchObject({ x: 0, y: 0 });
    expect(at('bandage')).toMatchObject({ x: 0, y: 1 });
    // Between grids too.
    const pockets = createGrid(1, 2);
    placeAt(items, pockets, one('round', 5), 0, 0, false);
    expect(dropAt(items, pockets, 0, g, 0, 1, false)).toBe(true);
    expect(pockets.items[0]).toMatchObject({ x: 0, y: 0, item: { item: 'bandage' } });
    expect(at('round')).toMatchObject({ x: 0, y: 1 });
  });

  it('turns a swapped item to fit the cells the dropped one left', () => {
    // A flat 2×1 pistol at (0, 0), with (0, 1) and (1, 1) taken, dropped at (2, 0) on an
    // upright medkit at (3, 0): upright it can't go back, so it lies flat at (0, 0).
    const g = createGrid(4, 2);
    placeAt(items, g, one('pistol'), 0, 0, false);
    placeAt(items, g, one('watch'), 0, 1, false);
    placeAt(items, g, one('watch'), 1, 1, false);
    placeAt(items, g, one('medkit'), 3, 0, false);
    expect(canSwap(items, g, 0, g, 2, 0, false)).toBe(true);
    expect(dropAt(items, g, 0, g, 2, 0, false)).toBe(true);
    const at = (id: string) => g.items.find((o) => o.item.item === id);
    expect(at('pistol')).toMatchObject({ x: 2, y: 0, rotated: false });
    expect(at('medkit')).toMatchObject({ x: 0, y: 0, rotated: true });
  });

  it("doesn't swap when what's under it has no room where it was", () => {
    // A 1×1 at (2, 0) dropped on the 1×2 medkit: the bandage below it leaves the medkit no room.
    const g = createGrid(3, 2);
    placeAt(items, g, one('medkit'), 0, 0, false);
    placeAt(items, g, one('watch'), 2, 0, false);
    placeAt(items, g, one('bandage'), 2, 1, false);
    expect(canSwap(items, g, 1, g, 0, 0, false)).toBe(false);
    expect(dropAt(items, g, 1, g, 0, 0, false)).toBe(false);
    expect(g.items[1]).toMatchObject({ x: 2, y: 0 });
    // Nor a backpack into pockets.
    const stash = createGrid(4, 4, true);
    const pockets = createGrid(4, 4);
    placeAt(items, stash, one('backpack'), 0, 0, false);
    placeAt(items, pockets, one('watch'), 0, 0, false);
    expect(dropAt(items, pockets, 0, stash, 0, 0, false)).toBe(false);
    expect(stash.items[0]!.item.item).toBe('backpack');
  });

  it('merges a dropped stack into a stack of the same item, leaving what does not fit', () => {
    const a = createGrid(2, 1);
    const b = createGrid(2, 1);
    placeAt(items, a, one('round', 80), 0, 0, false);
    placeAt(items, b, one('round', 50), 1, 0, false);
    expect(dropAt(items, a, 0, b, 1, 0, false)).toBe(true);
    expect(b.items[0]!.item.count).toBe(100);
    expect(a.items[0]!.item.count).toBe(30);
    expect(dropAt(items, a, 0, b, 1, 0, false)).toBe(false);
    // Different items don't merge: they swap.
    placeAt(items, a, one('watch'), 1, 0, false);
    expect(dropAt(items, a, 1, b, 1, 0, false)).toBe(true);
    expect(b.items[0]!.item.item).toBe('watch');
    expect(a.items[1]).toMatchObject({ x: 1, y: 0, item: { item: 'round', count: 100 } });
  });

  it('double-tap transfers what fits and leaves the rest', () => {
    const from = createGrid(2, 2);
    const to = createGrid(1, 1);
    placeAt(items, from, one('round', 100), 0, 0, false);
    placeAt(items, to, one('round', 60), 0, 0, false);
    expect(transfer(items, from, 0, to)).toBe(true);
    expect(to.items[0]!.item.count).toBe(100);
    expect(from.items[0]!.item.count).toBe(60);
    expect(transfer(items, from, 0, to)).toBe(false);
    placeAt(items, from, one('watch'), 1, 1, false);
    const big = createGrid(2, 2);
    expect(transfer(items, from, 1, big)).toBe(true);
    expect(from.items).toHaveLength(1);
    expect(big.items[0]!.item.item).toBe('watch');
  });

  it('keeps every item inside one section', () => {
    // A rig of four 1×2 pouches.
    const pouches = [0, 1, 2, 3].map((x) => ({ x, y: 0, w: 1, h: 2 }));
    const g = createGrid(4, 2, false, pouches);
    expect(inGrid(g, 0, 0, 1, 2)).toBe(true);
    expect(inGrid(g, 0, 0, 2, 1)).toBe(false);
    // Nothing wider than a pouch: a 2×1 pistol only fits turned upright.
    expect(findSpot(items, g, 'pistol')).toEqual({ x: 0, y: 0, rotated: true });
    expect(placeAt(items, g, one('pistol'), 1, 0, false)).toBe(false);
    expect(addItem(items, g, one('rifle'))).toBe(1);
    // A backpack's two 2×2 pockets under a 4×1 top, and a cell in neither.
    const bag = createGrid(4, 3, false, [
      { x: 0, y: 0, w: 4, h: 1 },
      { x: 0, y: 1, w: 2, h: 2 },
      { x: 3, y: 1, w: 1, h: 1 },
    ]);
    expect(isFree(items, bag, 0, 1, 2, 2)).toBe(true);
    expect(isFree(items, bag, 1, 1, 2, 2)).toBe(false);
    expect(isFree(items, bag, 3, 2, 1, 1)).toBe(false);
    // Dragged across a pocket's edge, it's refused, swap or no swap.
    placeAt(items, bag, one('medkit'), 0, 1, false);
    placeAt(items, bag, one('watch'), 3, 1, false);
    expect(dropAt(items, bag, 0, bag, 2, 1, false)).toBe(false);
    expect(dropAt(items, bag, 0, bag, 1, 1, false)).toBe(true);
  });

  it('never holds the vault item, even a grid that takes containers', () => {
    const stash = createGrid(10, 10, true);
    expect(canHold(items, stash, one('vault'))).toBe(false);
    expect(addItem(items, stash, one('vault'))).toBe(1);
    expect(placeAt(items, stash, one('vault'), 0, 0, false)).toBe(false);
  });
});

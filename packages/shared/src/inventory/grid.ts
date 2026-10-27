import { itemDef, stackSize, type AttachmentSlot, type ItemDb } from '../content/items';

/**
 * One item, or a stack of one kind, wherever it is: in a grid, in a gear slot or on a gun.
 * Plain JSON-safe data. Which optional fields it has depends on its type; the sim's
 * narrower types (WeaponState, ArmourState, ContainerState) are Items with them required.
 */
export interface Item {
  /** The item definition's id. */
  item: string;
  /** How many: 1 unless the item stacks. */
  count: number;
  /** Armour: durability left. */
  durability?: number;
  /** Meds: uses left, or HP left in a heal's pool. Repair kits: points left. Keys: uses left. */
  left?: number;
  /** Guns: rounds loaded. */
  mag?: number;
  /** Guns: the attachment in each slot, or null. */
  attachments?: Record<AttachmentSlot, string | null>;
  /** Rigs and backpacks: what's in them. */
  grid?: Grid;
}

/** An item in a grid, at its top-left cell. Rotated swaps its width and height. */
export interface GridItem {
  x: number;
  y: number;
  rotated: boolean;
  item: Item;
}

/**
 * A grid of cells that items sit in by size: pockets, a rig, a backpack, the vault, the
 * stash, or a loot container. No containers inside containers: only grids with
 * containers set (the stash, loot containers) take rigs and backpacks.
 */
export interface Grid {
  w: number;
  h: number;
  /** Whether rigs and backpacks can go in it. */
  containers: boolean;
  items: GridItem[];
}

export function createGrid(w: number, h: number, containers = false): Grid {
  return { w, h, containers, items: [] };
}

/** An item's width in a grid, rotated or not. */
export function itemWidth(items: ItemDb, id: string, rotated: boolean): number {
  const [w, h] = itemDef(items, id).size;
  return rotated ? h : w;
}

export function itemHeight(items: ItemDb, id: string, rotated: boolean): number {
  const [w, h] = itemDef(items, id).size;
  return rotated ? w : h;
}

/** Whether a grid may hold an item at all, wherever it goes: no containers in containers. */
export function canHold(items: ItemDb, grid: Grid, item: Item): boolean {
  return grid.containers || itemDef(items, item.item).type !== 'container';
}

/**
 * Whether a w × h area at (x, y) is inside the grid and clear of every item but the one
 * at index ignore.
 */
export function isFree(
  items: ItemDb,
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  ignore = -1,
): boolean {
  if (x < 0 || y < 0 || x + w > grid.w || y + h > grid.h) return false;
  for (let i = 0; i < grid.items.length; i++) {
    if (i === ignore) continue;
    const o = grid.items[i]!;
    const ow = itemWidth(items, o.item.item, o.rotated);
    const oh = itemHeight(items, o.item.item, o.rotated);
    if (x < o.x + ow && o.x < x + w && y < o.y + oh && o.y < y + h) return false;
  }
  return true;
}

/** The index of the item covering cell (x, y), or -1. */
export function itemAt(items: ItemDb, grid: Grid, x: number, y: number): number {
  for (let i = 0; i < grid.items.length; i++) {
    const o = grid.items[i]!;
    const ow = itemWidth(items, o.item.item, o.rotated);
    const oh = itemHeight(items, o.item.item, o.rotated);
    if (x >= o.x && x < o.x + ow && y >= o.y && y < o.y + oh) return i;
  }
  return -1;
}

/** Where an item goes when auto-placed. */
export interface Spot {
  x: number;
  y: number;
  rotated: boolean;
}

/**
 * The first free spot for an item, row by row from the top left; unrotated anywhere comes
 * before rotated. Null if there's none.
 */
export function findSpot(items: ItemDb, grid: Grid, id: string, ignore = -1): Spot | null {
  const [w, h] = itemDef(items, id).size;
  for (const rotated of w === h ? [false] : [false, true]) {
    const sw = rotated ? h : w;
    const sh = rotated ? w : h;
    for (let y = 0; y + sh <= grid.h; y++) {
      for (let x = 0; x + sw <= grid.w; x++) {
        if (isFree(items, grid, x, y, sw, sh, ignore)) return { x, y, rotated };
      }
    }
  }
  return null;
}

/** Puts an item at a spot if the grid may hold it there. */
export function placeAt(
  items: ItemDb,
  grid: Grid,
  item: Item,
  x: number,
  y: number,
  rotated: boolean,
): boolean {
  if (!canHold(items, grid, item)) return false;
  const w = itemWidth(items, item.item, rotated);
  const h = itemHeight(items, item.item, rotated);
  if (!isFree(items, grid, x, y, w, h)) return false;
  grid.items.push({ x, y, rotated, item });
  return true;
}

/**
 * Auto-placement: tops up stacks of the same item already there, then puts the rest in
 * the first free spots, a full stack per spot. What fits leaves item.count; returns how
 * many didn't fit (and are still in item). When the whole item fits as it is, the object
 * itself goes in the grid.
 */
export function addItem(items: ItemDb, grid: Grid, item: Item): number {
  if (item.count <= 0 || !canHold(items, grid, item)) return item.count;
  const max = stackSize(itemDef(items, item.item));
  if (max > 1) {
    for (const g of grid.items) {
      if (g.item.item !== item.item || g.item.count >= max) continue;
      const n = Math.min(max - g.item.count, item.count);
      g.item.count += n;
      item.count -= n;
      if (item.count === 0) return 0;
    }
  }
  while (item.count > 0) {
    const spot = findSpot(items, grid, item.item);
    if (!spot) break;
    if (item.count <= max) {
      grid.items.push({ ...spot, item });
      return 0;
    }
    grid.items.push({ ...spot, item: { item: item.item, count: max } });
    item.count -= max;
  }
  return item.count;
}

/** Takes the item at an index out of the grid. */
export function removeAt(grid: Grid, index: number): Item {
  const [g] = grid.items.splice(index, 1);
  if (!g) throw new Error(`no item at index ${index}`);
  return g.item;
}

/**
 * Drag and drop: moves the item at fromIndex in from to (x, y) in to, which may be the
 * same grid (to move or rotate it there). Dropped on a stack of the same item, it tops
 * that stack up instead, and whatever doesn't fit stays where it was. Returns whether
 * anything moved.
 */
export function dropAt(
  items: ItemDb,
  from: Grid,
  fromIndex: number,
  to: Grid,
  x: number,
  y: number,
  rotated: boolean,
): boolean {
  const g = from.items[fromIndex];
  if (!g || !canHold(items, to, g.item)) return false;
  const under = itemAt(items, to, x, y);
  const target = to.items[under];
  if (target && target !== g && target.item.item === g.item.item) {
    const max = stackSize(itemDef(items, g.item.item));
    const n = Math.min(max - target.item.count, g.item.count);
    if (n <= 0) return false;
    target.item.count += n;
    g.item.count -= n;
    if (g.item.count === 0) removeAt(from, fromIndex);
    return true;
  }
  const w = itemWidth(items, g.item.item, rotated);
  const h = itemHeight(items, g.item.item, rotated);
  if (!isFree(items, to, x, y, w, h, from === to ? fromIndex : -1)) return false;
  if (from === to) {
    g.x = x;
    g.y = y;
    g.rotated = rotated;
  } else {
    removeAt(from, fromIndex);
    to.items.push({ x, y, rotated, item: g.item });
  }
  return true;
}

/** Turns an item where it is, if it still fits there. A square item doesn't turn. */
export function rotateAt(items: ItemDb, grid: Grid, index: number): boolean {
  const g = grid.items[index];
  if (!g) return false;
  const [w, h] = itemDef(items, g.item.item).size;
  return w !== h && dropAt(items, grid, index, grid, g.x, g.y, !g.rotated);
}

/**
 * Double-tap: auto-places the item at fromIndex into another grid. A stack that only
 * partly fits leaves the rest behind. Returns whether anything moved.
 */
export function transfer(items: ItemDb, from: Grid, fromIndex: number, to: Grid): boolean {
  const g = from.items[fromIndex];
  if (!g || from === to) return false;
  const before = g.item.count;
  const left = addItem(items, to, g.item);
  if (left === 0) removeAt(from, fromIndex);
  return left < before;
}

/** How many of an item are in a grid, across its stacks. */
export function countOf(grid: Grid, id: string): number {
  let n = 0;
  for (const g of grid.items) if (g.item.item === id) n += g.item.count;
  return n;
}

/** Takes up to n of an item from a grid's stacks, last first. Returns how many it took. */
export function takeFrom(grid: Grid, id: string, n: number): number {
  let taken = 0;
  for (let i = grid.items.length - 1; i >= 0 && taken < n; i--) {
    const it = grid.items[i]!.item;
    if (it.item !== id) continue;
    const k = Math.min(it.count, n - taken);
    it.count -= k;
    taken += k;
    if (it.count === 0) grid.items.splice(i, 1);
  }
  return taken;
}

import type { CompiledMap } from '../content/compile';
import type { LootContainerDef } from '../content/loot-containers';
import { itemDef, type ItemDb } from '../content/items';
import {
  addItem,
  canHold,
  createGrid,
  dropAt,
  placeAt,
  removeAt,
  rotateAt,
  type Grid,
  type GridItem,
  type Item,
} from '../inventory/grid';
import {
  CARRIED_GRIDS,
  carriedGrid,
  equip,
  fitsSlot,
  unequip,
  type Gear,
  type GearSlot,
} from './gear';
import type { Character, EntityId, SimState } from './state';

/**
 * How far a body or a loot container can be from your feet to loot it, in metres:
 * across, and up or down.
 */
export const LOOT_REACH = 2;

/** A desk, cabinet or crate placed in the raid, and what's in it. */
export interface LootContainer {
  /** Its marker's path id. */
  id: string;
  /** Its kind, in content/loot-containers. */
  def: string;
  x: number;
  y: number;
  z: number;
  /** Takes rigs and backpacks. */
  grid: Grid;
}

/** Whose items: your own, a dead body's, or a loot container's. */
export type Owner =
  { kind: 'self' } | { kind: 'body'; id: EntityId } | { kind: 'container'; id: string };

/** A character's grids by name, or a loot container's one grid ("loot"). */
export type GridName = 'pockets' | 'rig' | 'backpack' | 'vault' | 'loot';

export interface GridRef {
  owner: Owner;
  grid: GridName;
}

/**
 * An item in a grid, by index. `item` is the definition id the sender saw there; an
 * action whose item has since moved or changed fails rather than taking something else.
 */
export interface InGrid extends GridRef {
  index: number;
  item: string;
}

export interface InSlot {
  owner: Owner;
  slot: GearSlot;
  item: string;
}

export type ItemRef = InGrid | InSlot;

/** Where an item is dropped: a spot in a grid, or a gear slot. */
export type Target = (GridRef & { x: number; y: number; rotated: boolean }) | Omit<InSlot, 'item'>;

/**
 * Something done in the inventory, sent in PlayerInput.inventory and applied at the start
 * of the next tick, so it works the same when a co-op server runs the raid.
 * - move: drag and drop, to a grid spot (merging onto a stack of the same item) or a gear
 *   slot (swapping with what's there if that can go where the dragged item came from).
 * - rotate: turns an item where it is.
 * - quick: double-tap. To yourself, into an empty gear slot it fits, else into what you
 *   carry; to a body, into its pockets, rig and backpack; to a container, into it. A
 *   stack that only partly fits leaves the rest behind.
 */
export type InventoryAction =
  | { type: 'move'; from: ItemRef; to: Target }
  | { type: 'rotate'; at: InGrid }
  | { type: 'quick'; from: ItemRef; to: Owner };

/** An inventory action was applied (ok) or refused. */
export interface InventoryEvent {
  type: 'inventory';
  by: EntityId;
  ok: boolean;
}

/** Puts an empty loot container at every lootContainer marker. */
export function placeLootContainers(
  state: SimState,
  map: CompiledMap,
  defs: ReadonlyMap<string, LootContainerDef>,
): void {
  for (const m of map.markers) {
    if (m.type !== 'lootContainer') continue;
    const def = defs.get(m.container);
    if (!def) throw new Error(`loot container ${m.id}: no kind "${m.container}"`);
    state.loot.push({
      id: m.id,
      def: def.id,
      x: m.x,
      y: m.y,
      z: m.z,
      grid: createGrid(def.grid[0], def.grid[1], true),
    });
  }
}

export function lootContainerById(state: SimState, id: string): LootContainer | undefined {
  for (const l of state.loot) if (l.id === id) return l;
  return undefined;
}

function near(c: Character, x: number, y: number, z: number): boolean {
  return Math.hypot(x - c.x, z - c.z) <= LOOT_REACH && Math.abs(y - c.y) <= LOOT_REACH;
}

/** The character whose gear an owner is, if c may reach it: c itself, or a dead body. */
function ownerCharacter(state: SimState, c: Character, owner: Owner): Character | null {
  if (owner.kind === 'self') return c;
  if (owner.kind !== 'body' || owner.id === c.id) return null;
  for (const e of state.entities) {
    if (e.id === owner.id) return e.health.dead && near(c, e.x, e.y, e.z) ? e : null;
  }
  return null;
}

/** Whether c can reach an owner's items now. */
export function canReach(state: SimState, c: Character, owner: Owner): boolean {
  if (owner.kind !== 'container') return !!ownerCharacter(state, c, owner);
  const l = lootContainerById(state, owner.id);
  return !!l && near(c, l.x, l.y, l.z);
}

function gearGrid(gear: Gear, name: GridName): Grid | null {
  switch (name) {
    case 'pockets':
      return gear.pockets;
    case 'rig':
      return gear.rig?.grid ?? null;
    case 'backpack':
      return gear.backpack?.grid ?? null;
    case 'vault':
      return gear.vault;
    case 'loot':
      return null;
  }
}

/** A grid c can reach, or null. */
export function gridOf(state: SimState, c: Character, ref: GridRef): Grid | null {
  if (ref.owner.kind === 'container') {
    if (ref.grid !== 'loot' || !canReach(state, c, ref.owner)) return null;
    return lootContainerById(state, ref.owner.id)?.grid ?? null;
  }
  const ch = ownerCharacter(state, c, ref.owner);
  return ch ? gearGrid(ch.gear, ref.grid) : null;
}

function slotOf(gear: Gear, slot: GearSlot): Item | null {
  return (gear as unknown as Record<GearSlot, Item | null>)[slot];
}

/** Where an item is now, resolved and checked against what the sender saw. */
type Found =
  | { at: 'grid'; grid: Grid; index: number; g: GridItem; item: Item }
  | { at: 'slot'; ch: Character; slot: GearSlot; item: Item };

function find(state: SimState, c: Character, ref: ItemRef): Found | null {
  if ('slot' in ref) {
    const ch = ownerCharacter(state, c, ref.owner);
    const item = ch && slotOf(ch.gear, ref.slot);
    return ch && item?.item === ref.item ? { at: 'slot', ch, slot: ref.slot, item } : null;
  }
  const grid = gridOf(state, c, ref);
  const g = grid?.items[ref.index];
  return grid && g?.item.item === ref.item
    ? { at: 'grid', grid, index: ref.index, g, item: g.item }
    : null;
}

/** Takes a found item out of where it is. */
function takeOut(f: Found): void {
  if (f.at === 'grid') removeAt(f.grid, f.index);
  else unequip(f.ch, f.slot);
}

/** Applies one inventory action for c. Returns whether it did anything. */
export function applyInventory(
  state: SimState,
  c: Character,
  items: ItemDb,
  action: InventoryAction,
): boolean {
  if (c.health.dead) return false;
  switch (action.type) {
    case 'rotate': {
      const grid = gridOf(state, c, action.at);
      const g = grid?.items[action.at.index];
      return !!grid && g?.item.item === action.at.item && rotateAt(items, grid, action.at.index);
    }
    case 'move': {
      const from = find(state, c, action.from);
      return !!from && moveTo(state, c, items, from, action.to);
    }
    case 'quick': {
      const from = find(state, c, action.from);
      return !!from && quickMove(state, c, items, from, action.to);
    }
  }
}

function moveTo(state: SimState, c: Character, items: ItemDb, from: Found, to: Target): boolean {
  if ('slot' in to) {
    const ch = ownerCharacter(state, c, to.owner);
    return !!ch && toSlot(items, from, ch, to.slot);
  }
  const grid = gridOf(state, c, to);
  if (!grid) return false;
  if (from.at === 'grid') return dropAt(items, from.grid, from.index, grid, to.x, to.y, to.rotated);
  if (!placeAt(items, grid, from.item, to.x, to.y, to.rotated)) return false;
  unequip(from.ch, from.slot);
  return true;
}

/** Drops an item on a gear slot, swapping with what's there if that fits where it came from. */
function toSlot(items: ItemDb, from: Found, ch: Character, slot: GearSlot): boolean {
  if (from.at === 'slot' && from.ch === ch && from.slot === slot) return false;
  if (!fitsSlot(items, slot, from.item)) return false;
  const old = slotOf(ch.gear, slot);
  if (!old) {
    takeOut(from);
    equip(ch, items, slot, from.item);
    return true;
  }
  if (from.at === 'slot') {
    if (!fitsSlot(items, from.slot, old)) return false;
    unequip(from.ch, from.slot);
    equip(ch, items, slot, from.item);
    equip(from.ch, items, from.slot, old);
    return true;
  }
  // From a grid: the old item goes where the new one was, or anywhere else in that grid.
  if (!canHold(items, from.grid, old)) return false;
  const { x, y, rotated } = from.g;
  removeAt(from.grid, from.index);
  const placed =
    placeAt(items, from.grid, old, x, y, rotated) ||
    placeAt(items, from.grid, old, x, y, !rotated) ||
    addItem(items, from.grid, old) === 0;
  if (!placed) {
    from.grid.items.splice(from.index, 0, from.g);
    return false;
  }
  equip(ch, items, slot, from.item);
  return true;
}

/** Gun slots in the order a double-tapped gun fills them: a pistol prefers the sidearm. */
const PISTOL_SLOTS: readonly GearSlot[] = ['sidearm', 'primary1', 'primary2'];
const GUN_SLOTS: readonly GearSlot[] = ['primary1', 'primary2'];
const OTHER_SLOTS: readonly GearSlot[] = ['knife', 'helmet', 'bodyArmour', 'rig', 'backpack'];

function quickMove(state: SimState, c: Character, items: ItemDb, from: Found, to: Owner): boolean {
  if (!canReach(state, c, to)) return false;
  if (to.kind === 'self' && !(from.at === 'slot' && from.ch === c)) {
    const def = itemDef(items, from.item.item);
    const slots =
      def.type !== 'weapon' ? OTHER_SLOTS : def.hold === 'pistol' ? PISTOL_SLOTS : GUN_SLOTS;
    for (const slot of slots) {
      if (slotOf(c.gear, slot) || !fitsSlot(items, slot, from.item)) continue;
      takeOut(from);
      equip(c, items, slot, from.item);
      return true;
    }
  }
  const before = from.item.count;
  let left = before;
  const into = (grid: Grid | null): void => {
    if (grid && left > 0 && !(from.at === 'grid' && grid === from.grid)) {
      left = addItem(items, grid, from.item);
    }
  };
  if (to.kind === 'container') {
    into(lootContainerById(state, to.id)?.grid ?? null);
  } else {
    const ch = ownerCharacter(state, c, to);
    for (let i = 0; ch && i < CARRIED_GRIDS; i++) into(carriedGrid(ch.gear, i));
  }
  if (left === 0) takeOut(from);
  return left < before;
}

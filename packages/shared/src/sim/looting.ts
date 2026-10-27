import type { CompiledMap } from '../content/compile';
import type { LootContainerDef } from '../content/loot-containers';
import {
  attachmentDef,
  fits,
  itemDef,
  weaponDef,
  type AttachmentSlot,
  type ItemDb,
} from '../content/items';
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
  heldWeapon,
  stow,
  unequip,
  type Gear,
  type GearSlot,
} from './gear';
import type { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { dropItem, type GroundItem } from './ground';
import { repairable } from './repair';
import type { Character, EntityId, SimState } from './state';
import { attach, detach, type WeaponState } from './weapons';

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

/** Whose items: your own, a dead body's, a loot container's, or the ground's. */
export type Owner =
  | { kind: 'self' }
  | { kind: 'body'; id: EntityId }
  | { kind: 'container'; id: string }
  | { kind: 'ground' };

export const GROUND_OWNER: Owner = { kind: 'ground' };

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

/** An item on the ground, by its index in state.ground. Each must be within reach. */
export interface OnGround {
  owner: { kind: 'ground' };
  ground: number;
  item: string;
}

export type ItemRef = InGrid | InSlot | OnGround;

/** An attachment on a gun: `part` is the attachment id the sender saw in that slot. */
export interface PartRef {
  gun: ItemRef;
  slot: AttachmentSlot;
  part: string;
}

/** A spot in a grid: the top-left cell, and whether the item is turned. */
export type GridSpot = GridRef & { x: number; y: number; rotated: boolean };

/** Dropped at your feet. */
export interface ToGround {
  owner: { kind: 'ground' };
}

/** Where an item is dropped: a spot in a grid, a gear slot, or the ground. */
export type Target = GridSpot | Omit<InSlot, 'item'> | ToGround;

/**
 * Something done in the inventory, sent in PlayerInput.inventory and applied at the start
 * of the next tick, so it works the same when a co-op server runs the raid.
 * - move: drag and drop, to a grid spot (merging onto a stack of the same item), a gear
 *   slot (swapping with what's there if that can go where the dragged item came from;
 *   from the ground, what's there takes its place on the ground) or the ground (dropped
 *   at your feet).
 * - rotate: turns an item where it is.
 * - quick: double-tap. To yourself, into an empty gear slot it fits, else into what you
 *   carry; to a body, into its pockets, rig and backpack; to a container, into it; to the
 *   ground, dropped at your feet. A stack that only partly fits leaves the rest behind.
 *   Picking up with the use button is a quick move from the ground to yourself.
 * - attach: puts an attachment on a gun, wherever each is. A loose one: what was in its
 *   slot goes where the new one was (or anywhere in that grid, or else in what you
 *   carry). One from another gun: what was in its slot goes onto that gun if it fits
 *   there (a swap), else into what you carry.
 * - detach: takes the attachment (`part`, as the sender saw it) out of a gun's slot, to a
 *   spot in a grid, or with to null into what you carry.
 * - repair (session 13b): starts repairing one of your armour pieces (worn or in a grid)
 *   with a repair kit you carry (pockets, rig or backpack), taking the kit's use time like
 *   a med (see updateMedUse). The stash does it at once, from anywhere (applyStash).
 * A magazine change hands back the rounds that no longer fit, into what you carry. What
 * has no room (those rounds, a part swapped off, a part taken off into what you carry)
 * is dropped at your feet rather than the action refused (session 11b).
 */
export type InventoryAction =
  | { type: 'move'; from: ItemRef; to: Target }
  | { type: 'rotate'; at: InGrid }
  | { type: 'quick'; from: ItemRef; to: Owner }
  | { type: 'attach'; gun: ItemRef; from: ItemRef | PartRef }
  | {
      type: 'detach';
      gun: ItemRef;
      slot: AttachmentSlot;
      part: string;
      to: GridSpot | null;
    }
  | { type: 'repair'; kit: ItemRef; armour: ItemRef };

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

/**
 * Whether c can reach an owner's items now. The ground always: each item on it is
 * checked on its own (groundInReach).
 */
export function canReach(state: SimState, c: Character, owner: Owner): boolean {
  if (owner.kind === 'ground') return true;
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

/** Whether c can reach an item on the ground. */
export function groundInReach(c: Character, g: GroundItem): boolean {
  return near(c, g.x, g.y, g.z);
}

function slotOf(gear: Gear, slot: GearSlot): Item | null {
  return (gear as unknown as Record<GearSlot, Item | null>)[slot];
}

/** Where an item is now, resolved and checked against what the sender saw. */
type Found =
  | { at: 'grid'; grid: Grid; index: number; g: GridItem; item: Item }
  | { at: 'slot'; ch: Character; slot: GearSlot; item: Item }
  | { at: 'ground'; list: GroundItem[]; index: number; g: GroundItem; item: Item };

function find(state: SimState, c: Character, ref: ItemRef): Found | null {
  if ('ground' in ref) {
    const g = state.ground[ref.ground];
    return g?.item.item === ref.item && groundInReach(c, g)
      ? { at: 'ground', list: state.ground, index: ref.ground, g, item: g.item }
      : null;
  }
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
  else if (f.at === 'ground') f.list.splice(f.index, 1);
  else unequip(f.ch, f.slot);
}

/**
 * Applies one inventory action for c. Returns whether it did anything. With the world,
 * what's dropped lands on the surface under c's feet.
 */
export function applyInventory(
  state: SimState,
  c: Character,
  items: ItemDb,
  action: InventoryAction,
  world?: CollisionWorld,
): boolean {
  const ctx: Ctx = { state, c, items, world };
  if (c.health.dead) return false;
  switch (action.type) {
    case 'rotate': {
      const grid = gridOf(state, c, action.at);
      const g = grid?.items[action.at.index];
      return !!grid && g?.item.item === action.at.item && rotateAt(items, grid, action.at.index);
    }
    case 'move': {
      const from = find(state, c, action.from);
      return !!from && moveTo(ctx, from, action.to);
    }
    case 'quick': {
      const from = find(state, c, action.from);
      return !!from && quickMove(ctx, from, action.to);
    }
    case 'attach':
      return 'gun' in action.from
        ? movePart(ctx, action.from, action.gun)
        : attachPart(ctx, action.gun, action.from);
    case 'detach':
      return detachPart(ctx, action.gun, action.slot, action.part, action.to);
    case 'repair':
      return startRepair(c, items, action.kit, action.armour);
  }
}

/** The carried grids by name, in carriedGrid's order. */
const CARRIED_NAMES: readonly GridName[] = ['pockets', 'rig', 'backpack'];

/**
 * One of c's own items, by a ref to its own gear slots or grids (vault included), checked
 * against what the sender saw; null for anyone else's or the ground's.
 */
export function ownItem(gear: Gear, ref: ItemRef): Item | null {
  if (ref.owner.kind !== 'self' || 'ground' in ref) return null;
  const item =
    'slot' in ref ? slotOf(gear, ref.slot) : gearGrid(gear, ref.grid)?.items[ref.index]?.item;
  return item?.item === ref.item ? item : null;
}

/**
 * Starts a repair: the kit must be carried (not in the vault, as for meds) with points
 * left, and the armour yours and not at full durability. A reload stops. Returns whether
 * it started.
 */
function startRepair(c: Character, items: ItemDb, kitRef: ItemRef, armourRef: ItemRef): boolean {
  if (!('grid' in kitRef)) return false;
  const grid = CARRIED_NAMES.indexOf(kitRef.grid);
  const kit = grid < 0 ? null : ownItem(c.gear, kitRef);
  const armour = ownItem(c.gear, armourRef);
  if (!kit || !armour || repairable(items, kit, armour) <= 0) return false;
  const def = itemDef(items, kit.item);
  if (def.type !== 'repair') return false;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;
  c.using = { grid, index: kitRef.index, item: kit.item, left: def.useTime, armour: armourRef };
  return true;
}

/** Who is acting, and on what. */
interface Ctx {
  state: SimState;
  c: Character;
  items: ItemDb;
  world: CollisionWorld | undefined;
}

function moveTo(ctx: Ctx, from: Found, to: Target): boolean {
  const { state, c, items } = ctx;
  if ('slot' in to) {
    const ch = ownerCharacter(state, c, to.owner);
    return !!ch && toSlot(items, from, ch, to.slot);
  }
  if (!('grid' in to)) return toGround(ctx, from);
  const grid = gridOf(state, c, to);
  if (!grid) return false;
  if (from.at === 'grid') return dropAt(items, from.grid, from.index, grid, to.x, to.y, to.rotated);
  if (!placeAt(items, grid, from.item, to.x, to.y, to.rotated)) return false;
  takeOut(from);
  return true;
}

/** Drops a found item at c's feet. */
function toGround(ctx: Ctx, from: Found): boolean {
  if (from.at === 'ground') return false;
  takeOut(from);
  dropItem(ctx.state, ctx.c, from.item, ctx.world);
  return true;
}

/** Puts an item in what c carries; what doesn't fit is dropped at its feet. */
function stowOrDrop(ctx: Ctx, item: Item): void {
  if (stow(ctx.c, ctx.items, item) > 0) dropItem(ctx.state, ctx.c, item, ctx.world);
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
  if (from.at === 'ground') {
    // What was in the slot takes its place on the ground.
    const item = from.item;
    from.g.item = old;
    equip(ch, items, slot, item);
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

function quickMove(ctx: Ctx, from: Found, to: Owner): boolean {
  const { state, c, items } = ctx;
  if (to.kind === 'ground') return toGround(ctx, from);
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

/** A gun c can reach, by ref. */
function findGun(ctx: Ctx, ref: ItemRef): WeaponState | null {
  const f = find(ctx.state, ctx.c, ref);
  return f?.item.attachments ? (f.item as WeaponState) : null;
}

function attachPart(ctx: Ctx, gunRef: ItemRef, fromRef: ItemRef): boolean {
  const { state, c, items } = ctx;
  const gun = findGun(ctx, gunRef);
  const from = find(state, c, fromRef);
  if (!gun || from?.at !== 'grid') return false;
  const def = itemDef(items, from.item.item);
  if (def.type !== 'attachment' || !fits(weaponDef(items, gun.item), def)) return false;
  const old = gun.attachments[def.slot];
  const { grid, index, g } = from;
  removeAt(grid, index);
  // What was on the gun goes where the new part was, else anywhere in that grid or carried.
  if (old !== null) {
    const oldPart = createItem(items, old);
    const placed =
      placeAt(items, grid, oldPart, g.x, g.y, g.rotated) ||
      placeAt(items, grid, oldPart, g.x, g.y, !g.rotated) ||
      addItem(items, grid, oldPart) === 0;
    if (!placed) stowOrDrop(ctx, oldPart);
  }
  stowRounds(ctx, weaponDef(items, gun.item).ammo, attach(gun, items, def.id));
  return true;
}

function detachPart(
  ctx: Ctx,
  gunRef: ItemRef,
  slot: AttachmentSlot,
  part: string,
  to: GridSpot | null,
): boolean {
  const { state, c, items } = ctx;
  const gun = findGun(ctx, gunRef);
  if (!gun || gun.attachments[slot] !== part) return false;
  const loose = createItem(items, part);
  if (to) {
    // To a spot: refused if it doesn't fit there.
    const grid = gridOf(state, c, to);
    if (!grid || !placeAt(items, grid, loose, to.x, to.y, to.rotated)) return false;
  } else {
    stowOrDrop(ctx, loose);
  }
  stowRounds(ctx, weaponDef(items, gun.item).ammo, detach(gun, items, slot));
  return true;
}

/** Moves a part from one gun to another, swapping with what's there if it fits the first. */
function movePart(ctx: Ctx, from: PartRef, toRef: ItemRef): boolean {
  const { items } = ctx;
  const a = findGun(ctx, from.gun);
  const b = findGun(ctx, toRef);
  if (!a || !b || a === b || a.attachments[from.slot] !== from.part) return false;
  const def = attachmentDef(items, from.part);
  if (!fits(weaponDef(items, b.item), def)) return false;
  const slot = def.slot;
  const old = b.attachments[slot];
  const swap = old !== null && fits(weaponDef(items, a.item), attachmentDef(items, old));
  const outA = swap ? attach(a, items, old) : detach(a, items, slot);
  const outB = attach(b, items, def.id);
  // What was on the second gun goes into what you carry if it can't go on the first.
  if (old !== null && !swap) stowOrDrop(ctx, createItem(items, old));
  stowRounds(ctx, weaponDef(items, a.item).ammo, outA);
  stowRounds(ctx, weaponDef(items, b.item).ammo, outB);
  return true;
}

/** Rounds a gun handed back, into what c carries or else at its feet. */
function stowRounds(ctx: Ctx, ammo: string, n: number): void {
  if (n > 0) stowOrDrop(ctx, createItem(ctx.items, ammo, n));
}

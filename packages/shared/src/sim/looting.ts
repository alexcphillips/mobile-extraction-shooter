import type { CompiledMap } from '../content/compile';
import type { LootContainerDef } from '../content/loot-containers';
import {
  ATTACHMENT_SLOTS,
  attachmentDef,
  firesRound,
  fits,
  itemDef,
  weaponDef,
  type AttachmentSlot,
  type ItemDb,
} from '../content/items';
import {
  addItem,
  canHold,
  holdsGrid,
  createGrid,
  dropAt,
  findSpot,
  itemHeight,
  itemWidth,
  placeAt,
  removeAt,
  rotateAt,
  stackOf,
  type Grid,
  type GridItem,
  type Item,
} from '../inventory/grid';
import {
  CARRIED_GRIDS,
  carriedGrid,
  equip,
  fitsSlot,
  gearConflict,
  heldWeapon,
  stow,
  unequip,
  type Gear,
  type GearSlot,
} from './gear';
import type { CollisionWorld } from '../world/collision-world';
import { isRevealed, revealed } from './search';
import { createItem } from './create-item';
import { dropItem, type GroundItem } from './ground';
import { cameOffGun } from './raid';
import { repairable } from './repair';
import { eyeHeight, eyeX, eyeZ, type Character, type EntityId, type SimState } from './state';
import {
  attach,
  createWeaponStats,
  detach,
  loadedAmmo,
  weaponStats,
  type WeaponState,
} from './weapons';

/**
 * How far a body or a loot container can be from your feet to loot it, in meters:
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
  /**
   * Made of geometry (a map node's `loot`): the solids aimed at to loot it, and its
   * footprint about (x, z), turned by yaw, that reach is measured from. Absent for a
   * lootContainer marker, which is reached and aimed at as a point.
   */
  shape?: { solids: readonly number[]; hx: number; hz: number; yaw: number };
  /**
   * Someone has searched it (2026-11-03), which lasts the rest of the raid and shows its
   * searched look if it has one. Each container's own: a cabinet's drawers are two
   * containers. Missing (not searched yet, and in older saves) is false.
   */
  searched?: boolean;
}

/** A container was searched for the first time. */
export interface SearchEvent {
  type: 'search';
  by: EntityId;
  container: string;
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

/**
 * A rig or backpack lying in a grid that takes them (a loot container, a stash page, a
 * backpack), by index; `item` is the definition id the sender saw there, as in InGrid.
 * With `inside`, a bag lying in that one's grid in turn, to any depth (2026-11-11).
 */
export interface BagRef {
  index: number;
  item: string;
  inside?: BagRef;
}

/**
 * A grid by owner and name; with `inside`, the grid inside the rig or backpack lying in
 * that grid (2026-11-01: a tap opens one), or one lying in that, and so on.
 */
export interface GridRef {
  owner: Owner;
  grid: GridName;
  inside?: BagRef;
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
 *   ground, dropped at your feet. With `inside`, to a rig or backpack lying in the owner's
 *   `grid` (default 'loot') instead, at any depth (2026-11-01: the one open; any owner's
 *   since 2026-11-11). A stack that only partly fits leaves the rest behind.
 *   With `count` (2026-11-01), only that many of a stack go; the rest stay where they were.
 *   Picking up with the use button is a quick move from the ground to yourself.
 * - split (2026-11-01): takes `count` off a stack in a grid into a new stack, in the
 *   first free spot of the same grid; refused with no room there, or if it isn't fewer
 *   than the stack.
 * - attach: puts an attachment on a gun, wherever each is. A loose one: what was in its
 *   slot goes where the new one was (or anywhere in that grid, or else in what you
 *   carry). One from another gun: what was in its slot goes onto that gun if it fits
 *   there (a swap), else into what you carry.
 * - detach: takes the attachment (`part`, as the sender saw it) out of a gun's slot, to a
 *   spot in a grid, or with to null into what you carry.
 * - repair (session 13b): starts repairing one of your armor pieces (worn or in a grid)
 *   with a repair kit you carry (pockets, rig or backpack), taking the kit's use time like
 *   a med (see updateMedUse). The stash does it at once, from anywhere (applyStash).
 * - unload: takes the rounds out of a gun, wherever it is, into what you carry. A
 *   reload in progress stops.
 * - load (2026-10-30): a stack of rounds dropped on a gun that fires them (loadGun).
 * - strip (2026-11-11, the user's call): unloads a gun and takes off every attachment
 *   (the magazine too) into c's backpack, then rig, then at its feet (between raids, the
 *   stash's pages). Refused if there's nothing to take off.
 * A magazine change hands back the rounds that no longer fit, into what you carry. What
 * has no room (those rounds, a part swapped off, a part taken off into what you carry)
 * is dropped at your feet rather than the action refused (session 11b).
 */
export type InventoryAction =
  | { type: 'move'; from: ItemRef; to: Target }
  | { type: 'rotate'; at: InGrid }
  | { type: 'quick'; from: ItemRef; to: Owner; grid?: GridName; inside?: BagRef; count?: number }
  | { type: 'split'; at: InGrid; count: number }
  | { type: 'attach'; gun: ItemRef; from: ItemRef | PartRef }
  | {
      type: 'detach';
      gun: ItemRef;
      slot: AttachmentSlot;
      part: string;
      to: GridSpot | null;
    }
  | { type: 'repair'; kit: ItemRef; armor: ItemRef }
  | { type: 'unload'; gun: ItemRef }
  | { type: 'strip'; gun: ItemRef }
  | { type: 'load'; gun: ItemRef; from: ItemRef };

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
    const l: LootContainer = {
      id: m.id,
      def: def.id,
      x: m.x,
      y: m.y,
      z: m.z,
      grid: createGrid(def.grid[0], def.grid[1], true),
    };
    if (m.solids) l.shape = { solids: m.solids, hx: m.hx!, hz: m.hz!, yaw: m.yaw };
    state.loot.push(l);
  }
}

export function lootContainerById(state: SimState, id: string): LootContainer | undefined {
  for (const l of state.loot) if (l.id === id) return l;
  return undefined;
}

function near(c: Character, x: number, y: number, z: number): boolean {
  return Math.hypot(x - c.x, z - c.z) <= LOOT_REACH && Math.abs(y - c.y) <= LOOT_REACH;
}

/**
 * How far from its feet a body lying in any direction is covered: most of its length. The
 * use prompt finds a body anywhere it lies, so looting it reaches that far too (2026-11-10).
 */
export const BODY_RADIUS = 1.2;

/**
 * Whether c's feet are near enough a body to loot it: LOOT_REACH from any of it, so
 * LOOT_REACH + BODY_RADIUS from its feet. The use prompt asks the same, so it never offers
 * a body that then says it's out of reach.
 */
export function bodyInReach(c: Character, b: Character): boolean {
  return (
    Math.hypot(b.x - c.x, b.z - c.z) <= LOOT_REACH + BODY_RADIUS &&
    Math.abs(b.y - c.y) <= LOOT_REACH
  );
}

/** The character whose gear an owner is, if c may reach it: c itself, or a dead body. */
export function ownerCharacter(state: SimState, c: Character, owner: Owner): Character | null {
  if (owner.kind === 'self') return c;
  if (owner.kind !== 'body' || owner.id === c.id) return null;
  for (const e of state.entities) {
    if (e.id === owner.id) return e.health.dead && bodyInReach(c, e) ? e : null;
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
  return !!l && containerInReach(c, l);
}

/** Whether c's feet are within LOOT_REACH of a container: its footprint, or its point. */
export function containerInReach(c: Character, l: LootContainer): boolean {
  if (!l.shape) return near(c, l.x, l.y, l.z);
  if (Math.abs(l.y - c.y) > LOOT_REACH) return false;
  // Into its frame, then the distance to its footprint.
  const { hx, hz, yaw } = l.shape;
  const dx = c.x - l.x;
  const dz = c.z - l.z;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const ox = Math.max(0, Math.abs(dx * cs - dz * sn) - hx);
  const oz = Math.max(0, Math.abs(dx * sn + dz * cs) - hz);
  return Math.hypot(ox, oz) <= LOOT_REACH;
}

/** Marks a container searched by c, if it's in reach and wasn't already. */
export function searchContainer(state: SimState, c: Character, id: string): void {
  const l = lootContainerById(state, id);
  if (!l || l.searched || c.health.dead || !containerInReach(c, l)) return;
  l.searched = true;
  state.events.push({ type: 'search', by: c.id, container: id });
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
  let grid: Grid | null = null;
  if (ref.owner.kind === 'container') {
    if (ref.grid === 'loot' && canReach(state, c, ref.owner)) {
      grid = lootContainerById(state, ref.owner.id)?.grid ?? null;
    }
  } else {
    const ch = ownerCharacter(state, c, ref.owner);
    grid = ch ? gearGrid(ch.gear, ref.grid) : null;
  }
  // A bag not yet searched out doesn't open; what's in one shows with it.
  const bag = ref.inside && grid?.items[ref.inside.index]?.item;
  if (bag && !isRevealed(state, c, ref.owner, bag)) return null;
  return bagGrid(grid, ref.inside);
}

/**
 * The grid inside a rig or backpack lying in a grid that takes them (a loot container, a
 * stash page, a backpack), following `inside` down as deep as it goes, checked against
 * what the sender saw at each step; with no bag, the grid itself.
 */
export function bagGrid(grid: Grid | null, inside: BagRef | undefined): Grid | null {
  if (!grid || !inside) return grid;
  if (!grid.containers && !grid.bags) return null;
  const bag = grid.items[inside.index]?.item;
  if (bag?.item !== inside.item || !bag.grid) return null;
  return bagGrid(bag.grid, inside.inside);
}

/**
 * Whether nothing solid is between c's eye and a point, so it isn't looted through a wall.
 * A hit within LOOT_SIGHT_SLACK of the point doesn't count: it's what the point rests on.
 */
export function lootInSight(
  world: CollisionWorld,
  c: Character,
  x: number,
  y: number,
  z: number,
): boolean {
  const ex = eyeX(c);
  const ey = eyeHeight(c);
  const ez = eyeZ(c);
  const dx = x - ex;
  const dy = y - ey;
  const dz = z - ez;
  const d = Math.hypot(dx, dy, dz);
  if (d <= LOOT_SIGHT_SLACK) return true;
  return world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d) >= d - LOOT_SIGHT_SLACK;
}

/** How far short of a point lootInSight's ray may hit something, in meters. */
const LOOT_SIGHT_SLACK = 0.15;

/**
 * Whether c can reach an item on the ground. With the world, it must be in sight too
 * (lootInSight).
 */
export function groundInReach(c: Character, g: GroundItem, world?: CollisionWorld): boolean {
  return near(c, g.x, g.y, g.z) && (!world || lootInSight(world, c, g.x, g.y + 0.1, g.z));
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
  if (!grid || g?.item.item !== ref.item) return null;
  // Not yet searched out (search.ts): as good as not there. A bag's inside shows with it.
  if (!ref.inside && !isRevealed(state, c, ref.owner, g.item)) return null;
  return { at: 'grid', grid, index: ref.index, g, item: g.item };
}

/** Takes a found item out of where it is. */
function takeOut(f: Found): void {
  if (f.at === 'grid') removeAt(f.grid, f.index);
  else if (f.at === 'ground') f.list.splice(f.index, 1);
  else unequip(f.ch, f.slot);
}

/**
 * Applies one inventory action for c. Returns whether it did anything. With the world,
 * what's dropped lands on the surface under c's feet. stash is set by the stash screen
 * (between raids), where a gun swapped off a gun slot goes where the new one was rather
 * than into the backpack, which would take it into the next raid.
 */
export function applyInventory(
  state: SimState,
  c: Character,
  items: ItemDb,
  action: InventoryAction,
  world?: CollisionWorld,
  stash = false,
): boolean {
  const ctx: Ctx = { state, c, items, world, stash };
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
      const count = action.count ?? from?.item.count ?? 0;
      const inside: GridRef | undefined = action.inside && {
        owner: action.to,
        grid: action.grid ?? 'loot',
        inside: action.inside,
      };
      return (
        !!from &&
        validCount(count, from.item.count) &&
        quickMove(ctx, from, action.to, inside, count)
      );
    }
    case 'split':
      return splitStack(ctx, action.at, action.count);
    case 'attach':
      return 'gun' in action.from
        ? movePart(ctx, action.from, action.gun)
        : attachPart(ctx, action.gun, action.from);
    case 'detach':
      return detachPart(ctx, action.gun, action.slot, action.part, action.to);
    case 'repair':
      return startRepair(state, c, items, action.kit, action.armor);
    case 'unload':
      return unload(ctx, action.gun);
    case 'strip':
      return strip(ctx, action.gun);
    case 'load':
      return loadGun(state, c, items, action.gun, action.from, false, world);
  }
}

// Scratch for a gun's magazine size.
const loadStats = createWeaponStats();

/**
 * What dropping a stack of rounds on a gun would do (2026-10-30), or null if nothing: it
 * must be a round the gun fires, and not more of what's in it when it's full. Onto the
 * gun in c's hands in a raid ('reload'), it starts a reload with that round, so it takes
 * the reload time as a reload does; the stack must be carried (pockets, rig or backpack:
 * by hand the backpack is in reach, where R reaches only pockets and rig), and the gun drawn, off a ladder and not reloading already.
 * Onto any other gun, or with instant (between raids), it's at once ('load').
 */
export function loadKind(
  state: SimState,
  c: Character,
  items: ItemDb,
  gunRef: ItemRef,
  fromRef: ItemRef,
  instant: boolean,
): 'reload' | 'load' | null {
  const f = find(state, c, gunRef);
  const gun = f?.item.attachments ? (f.item as WeaponState) : null;
  const from = find(state, c, fromRef);
  if (!gun || !from || !firesRound(items, weaponDef(items, gun.item), from.item.item)) return null;
  const full = gun.mag >= weaponStats(items, gun, loadStats).magazine;
  if (full && from.item.item === loadedAmmo(items, gun)) return null;
  if (instant || gun !== heldWeapon(c)) return 'load';
  if (c.draw > 0 || c.mode === 'ladder' || gun.reloading > 0 || from.at !== 'grid') return null;
  for (let i = 0; i < CARRIED_GRIDS; i++) if (carriedGrid(c.gear, i) === from.grid) return 'reload';
  return null;
}

/**
 * Loads a gun from a stack of rounds (see loadKind). At once: more of the round loaded
 * tops it up from the stack; another round takes the old rounds out (into what c carries,
 * or at its feet) and fills it from the stack. A reload in progress stops. Returns
 * whether it did anything.
 */
export function loadGun(
  state: SimState,
  c: Character,
  items: ItemDb,
  gunRef: ItemRef,
  fromRef: ItemRef,
  instant: boolean,
  world?: CollisionWorld,
): boolean {
  const kind = loadKind(state, c, items, gunRef, fromRef, instant);
  if (!kind) return false;
  const gun = find(state, c, gunRef)!.item as WeaponState;
  const from = find(state, c, fromRef)!;
  const round = from.item.item;
  if (kind === 'reload') {
    gun.reloading = weaponStats(items, gun, loadStats).reloadTime;
    gun.reloadWith = round;
    gun.reloadByHand = true;
    return true;
  }
  const old = loadedAmmo(items, gun);
  const out = round === old ? 0 : gun.mag;
  if (out > 0) gun.mag = 0;
  const n = Math.min(weaponStats(items, gun, loadStats).magazine - gun.mag, from.item.count);
  from.item.count -= n;
  if (from.item.count === 0) takeOut(from);
  gun.mag += n;
  gun.reloading = 0;
  delete gun.reloadWith;
  delete gun.reloadByHand;
  if (round === weaponDef(items, gun.item).ammo) delete gun.loaded;
  else gun.loaded = round;
  stowRounds({ state, c, items, world, stash: instant }, old, out);
  return true;
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
 * An item c can reach now, by ref, checked against what the sender saw: c's own, a dead
 * body's, a container's in reach, or one on the ground in reach. Null if not.
 */
export function reachableItem(state: SimState, c: Character, ref: ItemRef): Item | null {
  return find(state, c, ref)?.item ?? null;
}

/**
 * Starts a repair: the kit must be carried (not in the vault, as for meds) with points
 * left, and the armor not at full durability and in reach: yours, or a body's, a
 * container's or on the ground (the user's call, 2026-11-06). A reload stops. Returns
 * whether it started.
 */
function startRepair(
  state: SimState,
  c: Character,
  items: ItemDb,
  kitRef: ItemRef,
  armorRef: ItemRef,
): boolean {
  if (!('grid' in kitRef)) return false;
  const grid = CARRIED_NAMES.indexOf(kitRef.grid);
  const kit = grid < 0 ? null : ownItem(c.gear, kitRef);
  const armor = reachableItem(state, c, armorRef);
  if (!kit || !armor || repairable(items, kit, armor) <= 0) return false;
  const def = itemDef(items, kit.item);
  if (def.type !== 'repair') return false;
  const w = heldWeapon(c);
  if (w) w.reloading = 0;
  c.using = { grid, index: kitRef.index, item: kit.item, left: def.useTime, armor: armorRef };
  return true;
}

/** Who is acting, and on what. */
interface Ctx {
  state: SimState;
  c: Character;
  items: ItemDb;
  world: CollisionWorld | undefined;
  stash: boolean;
}

function moveTo(ctx: Ctx, from: Found, to: Target): boolean {
  const { state, c, items } = ctx;
  if ('slot' in to) {
    const ch = ownerCharacter(state, c, to.owner);
    return !!ch && toSlot(ctx, from, ch, to.slot);
  }
  if (!('grid' in to)) return toGround(ctx, from);
  const grid = gridOf(state, c, to);
  if (!grid) return false;
  if (!to.inside && hidesUnder(ctx, to, grid, from.item)) return false;
  if (from.at === 'grid') return dropAt(items, from.grid, from.index, grid, to.x, to.y, to.rotated);
  if (!placeAt(items, grid, from.item, to.x, to.y, to.rotated)) return false;
  takeOut(from);
  return true;
}

/** Whether dropping an item at a grid spot would land on something not yet searched out. */
function hidesUnder(
  ctx: Ctx,
  to: GridRef & { x: number; y: number; rotated: boolean },
  grid: Grid,
  item: Item,
): boolean {
  const r = revealed(ctx.state, ctx.c, to.owner);
  if (!r || r.found === r.total) return false;
  const w = itemWidth(ctx.items, item.item, to.rotated);
  const h = itemHeight(ctx.items, item.item, to.rotated);
  return grid.items.some((o) => {
    if (r.shown.has(o.item)) return false;
    const ow = itemWidth(ctx.items, o.item.item, o.rotated);
    const oh = itemHeight(ctx.items, o.item.item, o.rotated);
    return to.x < o.x + ow && o.x < to.x + w && to.y < o.y + oh && o.y < to.y + h;
  });
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

/**
 * Drops an item on a gear slot, swapping with what's there if that fits where it came from.
 * An empty rig or backpack dropped on a slot whose bag has things in it takes them along
 * (the user's call, 2026-11-06; any rig, armored or not, or backpack): see moveContents.
 * What doesn't fit in the new bag (2026-11-11, the user's call) is dropped at c's feet in a
 * raid, or put on the stash's pages between raids; with no room there it stays in the old
 * bag, which then swaps only where a bag with things in it may go.
 */
function toSlot(ctx: Ctx, from: Found, ch: Character, slot: GearSlot): boolean {
  const { items } = ctx;
  if (gunToBag(ctx, from, ch, slot)) return true;
  const oldBag = slotOf(ch.gear, slot)?.grid;
  const newBag = from.item.grid;
  if (!oldBag?.items.length || newBag?.items.length !== 0) return swapSlot(items, from, ch, slot);
  // An empty bag lying in the bag it would replace (at any depth): that bag would end up
  // inside itself.
  const oldItem = slotOf(ch.gear, slot);
  if (from.at === 'grid' && oldItem && holdsGrid(oldItem, from.grid)) return false;
  // What wouldn't fit, tried on copies first, and whether it has somewhere to go.
  const trialOld = copyOf(oldBag);
  moveContents(items, trialOld, copyOf(newBag));
  const spill = !trialOld.items.length || !ctx.stash || fitsStash(ctx, trialOld.items);
  if (!spill) {
    if (!swapSlot(items, from, ch, slot)) return false;
    moveContents(items, oldBag, newBag);
    return true;
  }
  // The old bag goes empty, so it may go wherever an empty one can (into a backpack too).
  const contents = oldBag.items;
  oldBag.items = [];
  const swapped = swapSlot(items, from, ch, slot);
  oldBag.items = contents;
  if (!swapped) return false;
  moveContents(items, oldBag, newBag);
  for (const g of oldBag.items.splice(0)) {
    if (ctx.stash) addToStash(ctx, g.item);
    else dropItem(ctx.state, ctx.c, g.item, ctx.world);
  }
  return true;
}

/** A deep copy of plain JSON data (items and grids are). */
const copyOf = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The stash's pages, between raids: the stash screen's loot containers (stash.ts). */
const stashPages = (ctx: Ctx): Grid[] => ctx.state.loot.map((l) => l.grid);

/** Whether all of these would fit on the stash's pages, tried on copies. */
function fitsStash(ctx: Ctx, left: readonly GridItem[]): boolean {
  const pages = copyOf(stashPages(ctx));
  return left.every((g) => {
    const item = copyOf(g.item);
    return pages.some((page) => addItem(ctx.items, page, item) === 0);
  });
}

/** Puts an item on the first stash pages with room (fitsStash said there is). */
function addToStash(ctx: Ctx, item: Item): void {
  for (const page of stashPages(ctx)) if (addItem(ctx.items, page, item) === 0) return;
}

/**
 * A gun dropped from a grid on a gun of yours in a gun slot (the user's call, 2026-11-06):
 * yours goes into your backpack, else rig, else pockets, and the new one is equipped. Each
 * keeps its own magazine and rounds. False, with nothing changed, if it's not that or
 * there's no room: then it's the usual swap (swapSlot). Not from the ground, which swaps
 * in place, nor in the stash (see applyInventory).
 */
function gunToBag(ctx: Ctx, from: Found, ch: Character, slot: GearSlot): boolean {
  const { c, items } = ctx;
  const old = slotOf(ch.gear, slot);
  if (ctx.stash || ch !== c || from.at !== 'grid' || slot === 'knife' || !old) return false;
  if (itemDef(items, old.item).type !== 'weapon') return false;
  if (!fitsSlot(items, slot, from.item)) return false;
  // Out first, so a gun from the backpack leaves its room for yours.
  takeOut(from);
  const bags = [c.gear.backpack?.grid, c.gear.rig?.grid, c.gear.pockets];
  if (!bags.some((grid) => grid && addItem(items, grid, old) === 0)) {
    from.grid.items.splice(from.index, 0, from.g);
    return false;
  }
  equip(c, items, slot, from.item);
  return true;
}

/**
 * Moves what's in one bag into another: each item at the same spot if it's free, then the
 * rest auto-placed. What doesn't fit stays in the old bag.
 */
function moveContents(items: ItemDb, from: Grid, to: Grid): void {
  const left = from.items.filter((g) => !placeAt(items, to, g.item, g.x, g.y, g.rotated));
  from.items = left.filter((g) => addItem(items, to, g.item) > 0);
}

function swapSlot(items: ItemDb, from: Found, ch: Character, slot: GearSlot): boolean {
  if (from.at === 'slot' && from.ch === ch && from.slot === slot) return false;
  if (!fitsSlot(items, slot, from.item)) return false;
  // Body armor and an armored rig never go on together (2026-11-11).
  if (gearConflict(items, ch.gear, slot, from.item)) return false;
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
    if (gearConflict(items, from.ch.gear, from.slot, old)) return false;
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

/** Gun slots in the order a double-tapped gun fills them: a pistol has only the sidearm. */
const PISTOL_SLOTS: readonly GearSlot[] = ['sidearm'];
const GUN_SLOTS: readonly GearSlot[] = ['primary1', 'primary2'];
const OTHER_SLOTS: readonly GearSlot[] = ['knife', 'helmet', 'bodyArmor', 'rig', 'backpack'];

/** Whether n of a stack of `of` is a whole number from 1 to all of it. */
function validCount(n: number, of: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= of;
}

/** Takes n off a stack in a grid into a new stack in the same grid's first free spot. */
function splitStack(ctx: Ctx, at: InGrid, n: number): boolean {
  const { state, c, items } = ctx;
  const grid = gridOf(state, c, at);
  const g = grid?.items[at.index];
  if (!grid || g?.item.item !== at.item || !validCount(n, g.item.count - 1)) return false;
  const spot = findSpot(items, grid, at.item);
  if (!spot) return false;
  g.item.count -= n;
  grid.items.push({ ...spot, item: stackOf(g.item, n) });
  return true;
}

/** A double-tap move of n of the found item (see InventoryAction's quick). */
function quickMove(
  ctx: Ctx,
  from: Found,
  to: Owner,
  inside: GridRef | undefined,
  n: number,
): boolean {
  const { state, c, items } = ctx;
  // Part of a stack moves as a new item; the rest stays.
  const whole = n === from.item.count;
  if (to.kind === 'ground') {
    if (whole) return toGround(ctx, from);
    if (from.at === 'ground') return false;
    from.item.count -= n;
    dropItem(state, c, stackOf(from.item, n), ctx.world);
    return true;
  }
  if (!canReach(state, c, to)) return false;
  // You or a body: an empty gear slot it fits first (a body's too, so a gun taken off a
  // scav goes back on it: the user's call, 2026-11-06), then the grids.
  const ch = to.kind === 'container' ? null : ownerCharacter(state, c, to);
  if (!inside && whole && ch && !(from.at === 'slot' && from.ch === ch)) {
    const def = itemDef(items, from.item.item);
    const slots =
      def.type !== 'weapon' ? OTHER_SLOTS : def.hold === 'pistol' ? PISTOL_SLOTS : GUN_SLOTS;
    for (const slot of slots) {
      if (slotOf(ch.gear, slot) || !fitsSlot(items, slot, from.item)) continue;
      if (gearConflict(items, ch.gear, slot, from.item)) continue;
      takeOut(from);
      equip(ch, items, slot, from.item);
      return true;
    }
  }
  const moving = whole ? from.item : stackOf(from.item, n);
  const before = moving.count;
  let left = before;
  const into = (grid: Grid | null): void => {
    if (grid && left > 0 && !(from.at === 'grid' && grid === from.grid)) {
      left = addItem(items, grid, moving);
    }
  };
  if (inside) {
    into(gridOf(state, c, inside));
  } else if (to.kind === 'container') {
    into(lootContainerById(state, to.id)?.grid ?? null);
  } else {
    for (let i = 0; ch && i < CARRIED_GRIDS; i++) into(carriedGrid(ch.gear, i));
    // Your vault last, once pockets, rig and backpack are full (the user's call, 2026-10-30).
    if (to.kind === 'self') into(c.gear.vault);
  }
  if (!whole) from.item.count -= before - left;
  else if (left === 0) takeOut(from);
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
  stowRounds(ctx, loadedAmmo(items, gun), attach(gun, items, def.id));
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
  const loose = cameOffGun(c, createItem(items, part));
  if (to) {
    // To a spot: refused if it doesn't fit there.
    const grid = gridOf(state, c, to);
    if (!grid || !placeAt(items, grid, loose, to.x, to.y, to.rotated)) return false;
  } else {
    stowOrDrop(ctx, loose);
  }
  stowRounds(ctx, loadedAmmo(items, gun), detach(gun, items, slot));
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
  if (old !== null && !swap) stowOrDrop(ctx, cameOffGun(ctx.c, createItem(items, old)));
  stowRounds(ctx, loadedAmmo(items, a), outA);
  stowRounds(ctx, loadedAmmo(items, b), outB);
  return true;
}

/** Empties a gun's rounds into what c carries; refused if it's empty. */
function unload(ctx: Ctx, gunRef: ItemRef): boolean {
  const gun = findGun(ctx, gunRef);
  if (!gun || gun.mag <= 0) return false;
  const n = gun.mag;
  gun.mag = 0;
  gun.reloading = 0;
  stowRounds(ctx, loadedAmmo(ctx.items, gun), n);
  return true;
}

/** Unloads a gun and takes every attachment off (see strip in InventoryAction). */
function strip(ctx: Ctx, gunRef: ItemRef): boolean {
  const { c, items } = ctx;
  const gun = findGun(ctx, gunRef);
  if (!gun) return false;
  const slots = ATTACHMENT_SLOTS.filter((s) => gun.attachments[s] !== null);
  if (!slots.length && gun.mag <= 0) return false;
  const ammo = loadedAmmo(items, gun);
  if (gun.mag > 0) bagOrDrop(ctx, cameOffGun(c, createItem(items, ammo, gun.mag)));
  gun.mag = 0;
  gun.reloading = 0;
  for (const slot of slots) {
    bagOrDrop(ctx, cameOffGun(c, createItem(items, gun.attachments[slot]!)));
    detach(gun, items, slot);
  }
  return true;
}

/** Puts an item in c's backpack, then rig; what doesn't fit is dropped at its feet. */
function bagOrDrop(ctx: Ctx, item: Item): void {
  let left = item.count;
  for (const grid of [ctx.c.gear.backpack?.grid, ctx.c.gear.rig?.grid]) {
    if (grid && left > 0) left = addItem(ctx.items, grid, item);
  }
  if (left > 0) dropItem(ctx.state, ctx.c, item, ctx.world);
}

/** Rounds a gun handed back, into what c carries or else at its feet. */
function stowRounds(ctx: Ctx, ammo: string, n: number): void {
  if (n > 0) stowOrDrop(ctx, cameOffGun(ctx.c, createItem(ctx.items, ammo, n)));
}

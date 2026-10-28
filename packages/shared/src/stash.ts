import { itemDef, stackSize, type ItemDb } from './content/items';
import { addItem, removeAt, type Grid, type Item } from './inventory/grid';
import type { Profile } from './profile';
import type { GearSlot } from './sim/gear';
import {
  applyInventory,
  gridOf,
  type GridRef,
  type InventoryAction,
  type ItemRef,
  type Owner,
} from './sim/looting';
import { createItem } from './sim/create-item';
import { createState, type Character, type SimState } from './sim/state';
import { createHealth } from './sim/health';
import { MOVEMENT } from './sim/movement';
import { kitUsedUp, repairArmour } from './sim/repair';

/*
 * The stash screen between raids (session 13). The profile is wrapped in a tiny raid
 * state: one player wearing the profile's gear, standing at one loot container per stash
 * page, whose grids are the pages. So the raid's inventory actions, rules and screen work
 * unchanged. The state shares the profile's objects, so an action edits the profile itself.
 */

const PAGE_PREFIX = 'stash-';

/** A stash page (from 0) as a loot container, in inventory actions. */
export function stashOwner(page: number): Owner {
  return { kind: 'container', id: `${PAGE_PREFIX}${page}` };
}

/** Which stash page an owner is, or -1. */
export function stashPageOf(owner: Owner): number {
  if (owner.kind !== 'container' || !owner.id.startsWith(PAGE_PREFIX)) return -1;
  return Number(owner.id.slice(PAGE_PREFIX.length));
}

export interface StashState {
  profile: Profile;
  sim: SimState;
  player: Character;
}

/** Wraps a profile for the stash screen. Edits through applyStash change it in place. */
export function openStash(profile: Profile): StashState {
  const sim = createState(1);
  const player: Character = {
    id: sim.nextId++,
    kind: 'character',
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    mode: 'ground',
    height: MOVEMENT.standHeight,
    ladder: -1,
    jumpHeld: false,
    landingSpeed: 0,
    health: createHealth(),
    gear: profile.gear,
    aim: 0,
    draw: 0,
    swing: 0,
    using: null,
    extracting: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ai: null,
  };
  sim.entities.push(player);
  profile.stash.forEach((grid, i) => {
    sim.loot.push({ id: `${PAGE_PREFIX}${i}`, def: PAGE_PREFIX, x: 0, y: 0, z: 0, grid });
  });
  return { profile, sim, player };
}

/** The pages from `first`, then the rest in order. */
function pageOrder(s: StashState, first: number): number[] {
  const n = s.profile.stash.length;
  return Array.from({ length: n }, (_, i) => (first + i) % n);
}

/** The item a ref points at, as an object, or null. */
function itemAt(s: StashState, ref: ItemRef): Item | null {
  if ('ground' in ref) return null;
  if ('slot' in ref) {
    if (ref.owner.kind !== 'self') return null;
    return (s.profile.gear as unknown as Record<GearSlot, Item | null>)[ref.slot];
  }
  return gridOf(s.sim, s.player, ref)?.items[ref.index]?.item ?? null;
}

/**
 * A grid of the profile's, by a ref as the stash screen sees it: one of the gear's (a
 * rig's or backpack's inside, the vault) or a stash page. Null if there's no such grid.
 */
export function stashGridOf(profile: Profile, ref: GridRef): Grid | null {
  const page = stashPageOf(ref.owner);
  if (page >= 0) return ref.grid === 'loot' ? (profile.stash[page] ?? null) : null;
  if (ref.owner.kind !== 'self') return null;
  const g = profile.gear;
  switch (ref.grid) {
    case 'pockets':
      return g.pockets;
    case 'rig':
      return g.rig?.grid ?? null;
    case 'backpack':
      return g.backpack?.grid ?? null;
    case 'vault':
      return g.vault;
    default:
      return null;
  }
}

/**
 * Puts new items into the stash, page `page` first, then the others, all or none: a
 * vendor's offer (13b) or a quest's rewards (14). Each stack is a whole number of items
 * up to its stack size. Returns whether it all fitted; if not, nothing changes.
 */
export function addToStash(
  profile: Profile,
  items: ItemDb,
  stacks: readonly { item: string; count?: number | undefined }[],
  page = 0,
): boolean {
  // Into copies of the pages, kept only if all of it fits: a stack can top up others.
  const pages = JSON.parse(JSON.stringify(profile.stash)) as Grid[];
  const n = pages.length;
  for (const s of stacks) {
    const item = createItem(
      items,
      s.item,
      Math.min(s.count ?? 1, stackSize(itemDef(items, s.item))),
    );
    let left = item.count;
    for (let i = 0; i < n && left > 0; i++) left = addItem(items, pages[(page + i) % n]!, item);
    if (left > 0) return false;
  }
  profile.stash = pages;
  return true;
}

/**
 * A repair between raids: at once, with a kit and armour anywhere in the gear or stash.
 * A kit with no points left is removed.
 */
function repairNow(s: StashState, items: ItemDb, kitRef: ItemRef, armourRef: ItemRef): boolean {
  const kit = itemAt(s, kitRef);
  const armour = itemAt(s, armourRef);
  if (!kit || !armour || kit.item !== kitRef.item || armour.item !== armourRef.item) return false;
  if (repairArmour(items, kit, armour) <= 0) return false;
  if (kitUsedUp(kit) && 'index' in kitRef) {
    const grid = stashGridOf(s.profile, kitRef);
    if (grid?.items[kitRef.index]?.item === kit) removeAt(grid, kitRef.index);
  }
  return true;
}

/** Applies the action; a double-tap into a page without room for all of it tries the others. */
function apply(s: StashState, items: ItemDb, action: InventoryAction): boolean {
  if (action.type === 'repair') return repairNow(s, items, action.kit, action.armour);
  const page = action.type === 'quick' ? stashPageOf(action.to) : -1;
  if (action.type !== 'quick' || page < 0) {
    return applyInventory(s.sim, s.player, items, action);
  }
  let changed = false;
  for (const p of pageOrder(s, page)) {
    const item = itemAt(s, action.from);
    if (!item) break;
    if (applyInventory(s.sim, s.player, items, { ...action, to: stashOwner(p) })) changed = true;
    // Gone from where it was: all of it went in.
    if (itemAt(s, action.from) !== item) break;
  }
  return changed;
}

/**
 * Applies an inventory action to the stash and gear. A double-tap into the stash goes to
 * the page it names, then the others. Anything the action would drop on the ground (no
 * room for it) goes into the stash instead, from `page` on; if the stash has no room
 * either, or the knife would leave its slot (it's always carried), nothing changes. If
 * the slot in hand was emptied, the knife is in hand instead; otherwise what's in hand is
 * the player's choice, kept as it is. A repair is done at once (in a raid it takes time).
 * Returns whether anything changed.
 */
export function applyStash(
  s: StashState,
  items: ItemDb,
  action: InventoryAction,
  page = 0,
): boolean {
  if (action.type === 'move' && 'owner' in action.to && action.to.owner.kind === 'ground')
    return false;
  if (action.type === 'quick' && action.to.kind === 'ground') return false;
  const { profile, sim } = s;
  const pages = profile.stash;
  const before = JSON.stringify({ gear: profile.gear, stash: pages.map((g) => g.items) });
  const hadKnife = !!profile.gear.knife;
  if (!apply(s, items, action)) return false;
  let ok = !hadKnife || !!profile.gear.knife;
  for (const g of sim.ground.splice(0)) {
    let left = g.item.count;
    for (const p of pageOrder(s, page)) if (left > 0) left = addItem(items, pages[p]!, g.item);
    if (left > 0) ok = false;
  }
  if (!ok) {
    const was = JSON.parse(before) as {
      gear: Profile['gear'];
      stash: Profile['stash'][0]['items'][];
    };
    Object.assign(profile.gear, was.gear);
    pages.forEach((grid, i) => (grid.items = was.stash[i]!));
    return false;
  }
  if (!profile.gear[profile.gear.hand]) profile.gear.hand = 'knife';
  return true;
}

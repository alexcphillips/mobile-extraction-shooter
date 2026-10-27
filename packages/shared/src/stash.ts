import type { ItemDb } from './content/items';
import { addItem, type Item } from './inventory/grid';
import type { Profile } from './profile';
import type { GearSlot } from './sim/gear';
import {
  applyInventory,
  gridOf,
  type InventoryAction,
  type ItemRef,
  type Owner,
} from './sim/looting';
import { createState, type Character, type SimState } from './sim/state';
import { createHealth } from './sim/health';
import { MOVEMENT } from './sim/movement';

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

/** Applies the action; a double-tap into a page without room for all of it tries the others. */
function apply(s: StashState, items: ItemDb, action: InventoryAction): boolean {
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
 * the player's choice, kept as it is. Returns whether anything changed.
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

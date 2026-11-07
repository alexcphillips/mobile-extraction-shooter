import { TICK_SECONDS } from '../tick';
import type { Grid, Item } from '../inventory/grid';
import type { Owner } from './looting';
import type { Character, SimState } from './state';

/*
 * Searching (2026-11-06, the user's call, as Tarkov does): what's in a container, or in a
 * body's pockets, rig and backpack, shows one item at a time while it's open, top left
 * first, SEARCH.perItem each. What a body wears shows at once (it can be seen). Each
 * player searches for themselves, and it carries on where it stopped when opened again.
 * Until shown, an item can't be taken, swapped or dropped on (looting.ts).
 *
 * Only in a raid that keeps searches (RaidState.searches, set by startRaid): the stash,
 * zombies mode, tests and raids saved before it show everything at once.
 */

export const SEARCH = {
  /** Seconds to search out one item. */
  perItem: 0.45,
} as const;

/** What's open to search, as a key: "c:<container id>" or "b:<body's entity id>". */
export function searchKey(owner: Owner): string | null {
  if (owner.kind === 'container') return `c:${owner.id}`;
  if (owner.kind === 'body') return `b:${owner.id}`;
  return null;
}

/** The owner a key names, or null for a key that isn't one. */
export function ownerOfKey(key: string): Owner | null {
  if (key.startsWith('c:')) return { kind: 'container', id: key.slice(2) };
  if (key.startsWith('b:')) {
    const id = Number(key.slice(2));
    return Number.isInteger(id) ? { kind: 'body', id } : null;
  }
  return null;
}

/** Where an item is in a search's order: its grid's place in the order, then row, then column. */
type Pos = [grid: number, y: number, x: number];

/** One player's search of one thing: time toward the next item, and the last item found. */
export interface Search {
  t: number;
  at: Pos | null;
}

const before = (a: Pos, b: Pos): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The grids an owner's search goes through, by their place in the order: a container's one,
 * or a body's pockets, rig and backpack (a place kept for each even when it has none).
 */
function searchedGrids(state: SimState, owner: Owner): (Grid | null)[] {
  if (owner.kind === 'container') {
    const l = state.loot.find((x) => x.id === owner.id);
    return l ? [l.grid] : [];
  }
  if (owner.kind !== 'body') return [];
  const e = state.entities.find((x) => x.id === owner.id);
  if (!e) return [];
  const g = e.gear;
  return [g.pockets, g.rig?.grid ?? null, g.backpack?.grid ?? null];
}

/** An owner's items with their places, in the order a search finds them. */
function searchOrder(state: SimState, owner: Owner): { pos: Pos; item: Item }[] {
  const out: { pos: Pos; item: Item }[] = [];
  searchedGrids(state, owner).forEach((grid, i) => {
    for (const g of grid?.items ?? []) out.push({ pos: [i, g.y, g.x], item: g.item });
  });
  return out.sort((a, b) => before(a.pos, b.pos));
}

/**
 * What c has found so far in an owner's grids, or null when nothing is hidden from them
 * (searching is off, or it's not a container or a body). Found is everything up to the
 * last item found, by place: taking one out hides nothing more, and one put back in the
 * searched part shows.
 */
export function revealed(
  state: SimState,
  c: Character,
  owner: Owner,
): { shown: ReadonlySet<Item>; found: number; total: number } | null {
  const key = searchKey(owner);
  const searches = state.raid?.searches;
  if (!key || !searches) return null;
  const at = searches[`${c.id}|${key}`]?.at;
  const order = searchOrder(state, owner);
  const shown = new Set<Item>();
  for (const o of order) if (at && before(o.pos, at) <= 0) shown.add(o.item);
  return { shown, found: shown.size, total: order.length };
}

/** Whether c can see an item in an owner's grid (always, where nothing is searched). */
export function isRevealed(state: SimState, c: Character, owner: Owner, item: Item): boolean {
  const r = revealed(state, c, owner);
  return !r || r.shown.has(item);
}

/**
 * One tick of searching what c has open (a key, or null), which the caller has checked is
 * in reach: every SEARCH.perItem, the next item past the last one found.
 */
export function searchTick(state: SimState, c: Character, key: string | null): void {
  const searches = state.raid?.searches;
  if (!key || !searches || c.ai || c.health.dead) return;
  const owner = ownerOfKey(key);
  if (!owner) return;
  const at = `${c.id}|${key}`;
  const s = (searches[at] ??= { t: 0, at: null });
  const next = searchOrder(state, owner).find((o) => !s.at || before(o.pos, s.at) > 0);
  // Nothing left to find: no time banked for what's put in later.
  if (!next) {
    s.t = 0;
    return;
  }
  s.t += TICK_SECONDS;
  if (s.t + 1e-9 < SEARCH.perItem) return;
  s.t -= SEARCH.perItem;
  s.at = next.pos;
}

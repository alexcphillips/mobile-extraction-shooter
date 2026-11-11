import type { ContractDef, ContractObjective } from './content/contracts';
import type { Faction } from './content/enemies';
import type { ItemDb } from './content/items';
import { moduleLevel } from './hangar';
import type { Item } from './inventory/grid';
import type { ActiveContract, Profile } from './profile';
import { addToStash, newStashItem, stashCount, takeFromStash } from './stash';

/*
 * The Intel desk's contracts between raids (session H6; design in docs/hangar.md → The
 * Intel desk's contracts). The desk shows a board of a few contracts a day, picked by the
 * day from those its level allows, the same for everyone. One runs at a time: Get
 * contract starts its window (the user's call: nobody misses one for being away), and a
 * contract taken stays off the board until the next day. Kills count from raid results
 * (a raid that started inside the window counts even if it ends after); hand-overs take
 * items found in raid from the stash. Once every objective is done it never expires and
 * waits to be claimed; unfinished past its window, it's lost, with no penalty.
 *
 * Nothing ticks: settleContracts tidies the state when a route reads it, on the server's
 * clock (`now`, ms), like crafts.
 */

/** The module that gives contracts. */
export const INTEL_DESK = 'intel-desk';

export const CONTRACTS = {
  /** How many contracts the board shows a day. */
  board: 3,
  /** A board day, in ms (UTC days). */
  day: 86_400_000,
};

/** Kills in a raid by the faction killed, as a result reports them. */
export type KillCounts = Partial<Record<Faction, number>>;

/** The board's day at `now`. */
export function contractDay(now: number): number {
  return Math.floor(now / CONTRACTS.day);
}

/** When the board next changes after `now`, in ms. */
export function nextBoard(now: number): number {
  return (contractDay(now) + 1) * CONTRACTS.day;
}

/** FNV-1a, so a day picks the same contracts everywhere. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * The board at `now`: up to CONTRACTS.board contracts the Intel desk's level allows,
 * picked by the day. None until the desk is built. Upgrading it can change the day's pick.
 */
export function contractBoard(
  contracts: Iterable<ContractDef>,
  profile: Profile,
  now: number,
): ContractDef[] {
  const level = moduleLevel(profile, INTEL_DESK);
  const day = contractDay(now);
  return [...contracts]
    .filter((c) => c.level <= level)
    .map((c) => ({ c, h: hash(`${day}:${c.id}`) }))
    .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1))
    .slice(0, CONTRACTS.board)
    .map(({ c }) => c);
}

/** Whether a contract was taken on the day of `now`. */
export function takenToday(profile: Profile, id: string, now: number): boolean {
  const s = profile.contracts;
  return s.day === contractDay(now) && s.taken.includes(id);
}

/** How far an objective has got, from 0 to its count. */
export function contractProgress(active: ActiveContract, o: ContractObjective): number {
  return Math.min(o.count, active.progress[o.id] ?? 0);
}

/** Whether every objective of the running contract is done. */
export function contractDone(def: ContractDef, active: ActiveContract): boolean {
  return def.objectives.every((o) => contractProgress(active, o) >= o.count);
}

/** Where the running contract is at `now`: running, done (to claim) or out of time. */
export function contractStatus(
  def: ContractDef,
  active: ActiveContract,
  now: number,
): 'running' | 'done' | 'expired' {
  if (contractDone(def, active)) return 'done';
  return now >= active.ends ? 'expired' : 'running';
}

/**
 * Tidies the contracts at `now`, in place: a new day clears what was taken, and the
 * running one goes if it's out of time unfinished or no longer exists. Returns whether
 * anything changed.
 */
export function settleContracts(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  now: number,
): boolean {
  const s = profile.contracts;
  let changed = false;
  const day = contractDay(now);
  if (s.day !== day) {
    s.day = day;
    s.taken = [];
    changed = true;
  }
  const a = s.active;
  if (a) {
    const def = contracts.get(a.id);
    if (!def || contractStatus(def, a, now) === 'expired') {
      delete s.active;
      changed = true;
    }
  }
  return changed;
}

/** Why a contract can't be taken at `now`, or null. Settle first. */
export function cantTake(
  profile: Profile,
  contracts: Iterable<ContractDef>,
  def: ContractDef,
  now: number,
): string | null {
  if (moduleLevel(profile, INTEL_DESK) < def.level)
    return `it needs the Intel desk at level ${def.level}`;
  if (profile.contracts.active) return 'finish or drop the contract you have first';
  if (!contractBoard(contracts, profile, now).some((c) => c.id === def.id))
    return "that contract isn't on today's board";
  if (takenToday(profile, def.id, now)) return 'you took that contract today already';
  return null;
}

/** Takes a contract from the board at `now`: its window starts. Returns why it can't, or null. */
export function takeContract(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  def: ContractDef,
  now: number,
): string | null {
  settleContracts(profile, contracts, now);
  const bad = cantTake(profile, contracts.values(), def, now);
  if (bad) return bad;
  profile.contracts.taken.push(def.id);
  profile.contracts.active = {
    id: def.id,
    ends: now + Math.round(def.hours * 3_600_000),
    progress: {},
  };
  return null;
}

/** The running contract (if it still exists), settled at `now`. */
function running(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  now: number,
): { def: ContractDef; active: ActiveContract } | null {
  settleContracts(profile, contracts, now);
  const active = profile.contracts.active;
  const def = active && contracts.get(active.id);
  return def ? { def, active: active! } : null;
}

/** Whether a stored item is one a contract's hand-over takes: found in raid, plain. */
function handsOver(item: string, x: Item): boolean {
  return x.item === item && !!x.found;
}

/** How many of a hand-over's items the stash has that it would take. */
export function contractHandOverCount(profile: Profile, item: string): number {
  return stashCount(profile, (x) => handsOver(item, x));
}

/**
 * Hands over as many found-in-raid items for one of the running contract's objectives as
 * it still needs, at `now`, inside its window. Returns why it can't, or null.
 */
export function handOverContract(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  objective: string,
  now: number,
): string | null {
  const r = running(profile, contracts, now);
  if (!r) return "you haven't got a contract running";
  const o = r.def.objectives.find((x) => x.id === objective);
  if (!o || o.type !== 'handOver') return 'that contract has no such hand-over';
  const need = o.count - contractProgress(r.active, o);
  if (need <= 0) return "that's handed over already";
  const given = takeFromStash(profile, (x) => handsOver(o.item, x), need);
  if (!given) return 'there are none found in raid in your stash';
  r.active.progress[o.id] = (r.active.progress[o.id] ?? 0) + given;
  return null;
}

/**
 * Claims the running contract once every objective is done: its items into the stash,
 * page `page` first (all or none), and its reputation to its vendor. Returns why it
 * can't, or null.
 */
export function claimContract(
  profile: Profile,
  items: ItemDb,
  contracts: ReadonlyMap<string, ContractDef>,
  now: number,
  page = 0,
): string | null {
  const r = running(profile, contracts, now);
  if (!r) return "you haven't got a contract running";
  if (!contractDone(r.def, r.active)) return "that contract isn't finished yet";
  if (!addToStash(profile, items, r.def.rewards.items, page, newStashItem))
    return 'there is no room in your stash for the rewards';
  if (r.def.rewards.rep > 0) {
    const was = profile.vendors[r.def.vendor] ?? { rep: 0, spent: 0 };
    profile.vendors[r.def.vendor] = { ...was, rep: was.rep + r.def.rewards.rep };
  }
  delete profile.contracts.active;
  return null;
}

/** Gives up the running contract: it's gone, with no penalty. Returns why it can't, or null. */
export function dropContract(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  now: number,
): string | null {
  settleContracts(profile, contracts, now);
  if (!profile.contracts.active) return "you haven't got a contract running";
  delete profile.contracts.active;
  return null;
}

/**
 * Counts a raid's kills on `map` toward the running contract, in place, if the raid
 * started (`startedAt`, ms) inside its window. Contract routes are refused in a raid, so
 * the one running at the end was running at the start. Not settled first: a raid that
 * started in time counts even if it ends after. Returns the objectives that went up.
 */
export function contractKills(
  profile: Profile,
  contracts: ReadonlyMap<string, ContractDef>,
  map: string,
  killed: KillCounts,
  startedAt: number,
): ContractObjective[] {
  const active = profile.contracts.active;
  const def = active && contracts.get(active.id);
  if (!def || startedAt >= active.ends) return [];
  const out: ContractObjective[] = [];
  for (const o of def.objectives) {
    if (o.type !== 'kill' || (o.map !== undefined && o.map !== map)) continue;
    const n = killed[o.faction] ?? 0;
    const was = contractProgress(active, o);
    if (n <= 0 || was >= o.count) continue;
    active.progress[o.id] = Math.min(o.count, was + n);
    out.push(o);
  }
  return out;
}

/** Whether two profiles' contracts are the same: only the server's contract routes change them. */
export function sameContracts(a: Profile, b: Profile): boolean {
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

function norm(p: Profile): unknown {
  const { day, taken, active } = p.contracts;
  return {
    day,
    taken,
    active: active && {
      id: active.id,
      ends: active.ends,
      progress: Object.entries(active.progress).sort(([x], [y]) => (x < y ? -1 : 1)),
    },
  };
}

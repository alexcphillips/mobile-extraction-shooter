import type { CompiledMap } from '../content/compile';
import type { ItemDb } from '../content/items';
import { nextFloat, nextIntIn } from '../rng';
import type { CollisionWorld } from '../world/collision-world';
import { AI, SQUAD, clearLine, joinSquad, playerDistance, spawnEnemy } from './ai';
import { equipLoadout } from './loadout';
import { rollEnemyLoot } from './loot-roll';
import { MOVEMENT } from './movement';
import { RAID } from './raid';
import { inExtraction, nearBoss, newSquad, squadState, startPois, stopAreas } from './routes';
import type { Character, SimState } from './state';
import { TICK_SECONDS } from '../tick';
import type { EnemyContent } from './waves';

/*
 * PMC squads (AI rework session 3; design.md → AI → PMCs). A map's `pmcs` puts 3–6 (say)
 * PMCs in at raid start, in squads of 2–4, each squad at a player spawn nobody is using:
 * out of every player's sight and away from them, and away from the other squads. They
 * don't replenish. A squad's members are allies (factions.ts); the first leads and the
 * rest follow it in formation (ai.ts, follow).
 *
 * On a map with points of interest (`poi` markers), each squad walks a route of them,
 * searching loot spots, and leaves the raid at an extraction (AI-4, routes.ts). Without,
 * a squad's leader guards its spawn like a scav would.
 */

export const PMC_SQUADS = {
  /** Squads are this many, fewest and most. */
  size: [1, 3] as const,
  /**
   * How likely each size is, solo first (2026-11-08, the user's call: mostly solos and
   * duos, a rare trio; two squads turning on you together is hard enough).
   */
  sizeWeights: [0.45, 0.45, 0.1] as const,
  /** A squad never starts closer than this to a player, nor in a player's sight. */
  minDistance: 30,
  /** A spawn this far from every player is picked over a nearer one. */
  preferDistance: 60,
  /** Squads start at least this far apart, and out of each other's sight, if they can. */
  apart: 50,
  /**
   * A spawn this close to a boss's ground (its patrol, or its spawn) is used only when no
   * other will do (2026-11-08, the user's go-ahead).
   */
  bossClear: 35,
  /** Choosing a squad's area, each meter between floors counts as this many across. */
  areaFloor: 8,
  /** A member with no clear place in formation starts within this of the spawn. */
  spread: 2.5,
};

/**
 * n PMCs split into squads by PMC_SQUADS.sizeWeights, at random (a size no bigger than what's
 * left). With `squads`, exactly that many instead (fewer if n is smaller), the PMCs dealt out
 * one at a time to squads picked at random, none over the biggest size (so n may be cut).
 */
export function squadSizes(rng: SimState['rng'], n: number, squads?: number): number[] {
  const [min, max] = PMC_SQUADS.size;
  if (squads !== undefined) {
    const k = Math.min(squads, n);
    const out: number[] = Array(k).fill(min);
    let left = Math.min(n, k * max) - k * min;
    while (left > 0) {
      const i = nextIntIn(rng, 0, k - 1);
      if (out[i]! >= max) continue;
      out[i]!++;
      left--;
    }
    return out;
  }
  const out: number[] = [];
  let left = n;
  while (left > 0) {
    let total = 0;
    for (let s = min; s <= Math.min(max, left); s++) total += PMC_SQUADS.sizeWeights[s - min]!;
    let r = nextFloat(rng) * total;
    let s = min;
    for (; s < Math.min(max, left); s++) {
      r -= PMC_SQUADS.sizeWeights[s - min]!;
      if (r < 0) break;
    }
    out.push(s);
    left -= s;
  }
  return out;
}

interface Spot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  eye: number;
}

/**
 * Puts the map's PMC squads in (map.pmcs), each at its own unused player spawn. Call after
 * placing the players. Fewer squads if there aren't spawns enough. Returns the PMCs.
 */
export function startSquads(
  state: SimState,
  world: CollisionWorld,
  map: CompiledMap,
  items: ItemDb,
  content: EnemyContent,
): Character[] {
  const pmcs = map.pmcs;
  if (!pmcs || pmcs.count[1] <= 0) return [];
  const id = pmcs.enemy ?? 'pmc';
  const type = content.types.get(id);
  if (!type) throw new Error(`the map's pmcs: no enemy type "${id}"`);
  const loadout = content.loadouts.get(type.loadout);
  if (!loadout) throw new Error(`enemy type "${id}": no loadout "${type.loadout}"`);
  const rng = state.rng;
  const sizes = squadSizes(rng, nextIntIn(rng, pmcs.count[0], pmcs.count[1]), pmcs.squads);
  startPois(state, map);
  const routes = (state.pois?.length ?? 0) > 0;

  const eye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  const spawns: Spot[] = [];
  // Player spawns, and the map's PMC-only spawns (2026-11-08); only the latter if the map
  // says so (MT-9).
  for (const m of map.markers) {
    if (m.type !== 'pmcSpawn' && (m.type !== 'playerSpawn' || pmcs.pmcSpawnsOnly)) continue;
    const y = world.groundAt(m.x, m.z, MOVEMENT.radius, m.y + 0.5);
    spawns.push({ x: m.x, y, z: m.z, yaw: m.yaw, eye: y + eye });
  }
  // Each squad its own area of the map to start in (2026-11-08): the nearest one to its
  // spawn not yet given out (a floor apart counts as far), else the nearest.
  const areas = routes ? stopAreas(state) : [];
  const given = new Set<string>();
  const areaFor = (spot: Spot) => {
    let best = null as (typeof areas)[number] | null;
    let bestD = Infinity;
    for (const free of [true, false]) {
      for (const a of areas) {
        if (free && given.has(a.id)) continue;
        const d =
          Math.hypot(a.x - spot.x, a.z - spot.z) + Math.abs(a.y - spot.y) * PMC_SQUADS.areaFloor;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (best) break;
    }
    if (best) given.add(best.id);
    return best;
  };
  const used: Spot[] = [];
  const out: Character[] = [];
  for (const size of sizes) {
    const spot = pickSpawn(state, world, spawns, used);
    if (!spot) break;
    const area = areaFor(spot);
    used.push(spot);
    let squad = 0;
    for (let slot = 0; slot < size; slot++) {
      const [x, z, radius] = place(world, spot, slot);
      const c = spawnEnemy(state, world, x, spot.y, z, spot.yaw, {
        radius,
        skill: type.skill,
        faction: type.faction,
        outfits: type.outfits?.length ?? 1,
        type: id,
        voiced: !!(type.voice?.breathe || type.voice?.mutter),
        limbHealth: type.limbHealth,
      });
      equipLoadout(c, items, loadout, rng);
      rollEnemyLoot(c, items, content.tables, type.loot, undefined, rng);
      // A squad is known by its first leader's id.
      if (slot === 0) squad = c.id;
      joinSquad(c, squad, slot);
      out.push(c);
    }
    if (routes) newSquad(state, world, squad).area = area?.id ?? null;
  }
  return out;
}

/**
 * Once a tick, after the AI: squad members standing in their extraction zone count up, and
 * leave the raid with what they carry after RAID.extractTime, as a player would (AI-4).
 * They're taken out of state.entities, with a leave event; not into state.left, which is
 * players'.
 */
export function updateSquads(state: SimState): void {
  if (!state.squads?.length) return;
  let gone = false;
  for (const c of state.entities) {
    const ai = c.ai;
    if (!ai || ai.squad === undefined || c.health.dead) continue;
    const sq = squadState(state, ai.squad);
    const inside = !!sq && sq.leaving && ai.activity === 'extract' && inExtraction(state, c, sq);
    c.extracting = inside ? c.extracting + TICK_SECONDS : 0;
    if (c.extracting >= RAID.extractTime - 1e-9) {
      state.events.push({ type: 'leave', by: c.id, how: 'extracted', at: sq!.extract });
      gone = true;
    }
  }
  if (!gone) return;
  for (let i = state.entities.length - 1; i >= 0; i--) {
    const c = state.entities[i]!;
    if (c.ai?.squad !== undefined && !c.health.dead && c.extracting >= RAID.extractTime - 1e-9)
      state.entities.splice(i, 1);
  }
}

/**
 * An unused player spawn for a squad, at random: clear of every player, preferring those
 * far from them, then those apart from the squads already placed. Null if none is clear.
 */
function pickSpawn(
  state: SimState,
  world: CollisionWorld,
  spawns: Spot[],
  used: Spot[],
): Spot | null {
  // Tiers: far and apart, apart, any clear one, and last one by a boss's ground.
  const tiers: Spot[][] = [[], [], [], []];
  for (const s of spawns) {
    if (used.includes(s)) continue;
    const d = playerDistance(state, world, s.x, s.eye, s.z);
    if (d < PMC_SQUADS.minDistance) continue;
    const apart = used.every((u) => {
      const gap = Math.hypot(u.x - s.x, u.z - s.z);
      return (
        gap >= PMC_SQUADS.apart &&
        !(gap <= AI.sightRange && clearLine(world, u.x, u.eye, u.z, s.x, s.eye, s.z))
      );
    });
    const byBoss = nearBoss(state, s.x, s.z, PMC_SQUADS.bossClear);
    tiers[byBoss ? 3 : apart ? (d >= PMC_SQUADS.preferDistance ? 0 : 1) : 2]!.push(s);
  }
  // Within the best tier, the spot furthest from the squads already placed (2026-11-08,
  // the user's call: with the spawns by a boss's ground left out, squads started close and
  // killed each other early); the first squad's at random.
  for (const t of tiers) {
    if (!t.length) continue;
    if (!used.length) return t[nextIntIn(state.rng, 0, t.length - 1)]!;
    let best = t[0]!;
    let bestGap = -1;
    for (const s of t) {
      let gap = Infinity;
      for (const u of used) gap = Math.min(gap, Math.hypot(u.x - s.x, u.z - s.z));
      if (gap > bestGap) {
        bestGap = gap;
        best = s;
      }
    }
    return best;
  }
  return null;
}

/**
 * Where a squad member starts: the leader on the spawn, the rest in their places in
 * formation behind it, facing the spawn's way, where that's clear; else near the spawn.
 * As [x, z, radius to spawn within]. Also a boss's guards round him (waves.ts, MT-12).
 */
export function place(
  world: CollisionWorld,
  spot: Pick<Spot, 'x' | 'y' | 'z' | 'yaw'>,
  slot: number,
): [number, number, number] {
  if (slot === 0) return [spot.x, spot.z, 0];
  const n = SQUAD.formation.length;
  const [back0, side] = SQUAD.formation[Math.min(slot, n) - 1]!;
  const back = back0 + 3 * Math.max(0, slot - n);
  const fx = -Math.sin(spot.yaw);
  const fz = -Math.cos(spot.yaw);
  const x = spot.x - fx * back + fz * side;
  const z = spot.z - fz * back - fx * side;
  const ground = world.groundAt(x, z, MOVEMENT.radius, spot.y + 0.5);
  const clear =
    Math.abs(ground - spot.y) <= SQUAD.rise &&
    !world.overlaps(
      x,
      z,
      MOVEMENT.radius,
      ground + MOVEMENT.stepUp,
      ground + MOVEMENT.standHeight,
    ) &&
    clearLine(world, spot.x, spot.y + 1, spot.z, x, ground + 1, z);
  return clear ? [x, z, 0] : [spot.x, spot.z, PMC_SQUADS.spread];
}

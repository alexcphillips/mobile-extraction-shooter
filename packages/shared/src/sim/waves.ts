import type { CompiledMap, CompiledMarker } from '../content/compile';
import type { EnemyDef, EnemyLoot, EnemySkill, Faction, LoadoutDef } from '../content/enemies';
import type { ItemDb } from '../content/items';
import type { LootTableDef } from '../content/loot-tables';
import { chance, nextFloat, nextIntIn } from '../rng';
import { TICK_RATE } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import { MOVEMENT } from './movement';
import { AI, checkGunfire, freeToCheck, playerDistance, spawnEnemy, type PatrolDef } from './ai';
import { factionOf } from './factions';
import { equipLoadout } from './loadout';
import { rollEnemyLoot, type LootTables } from './loot-roll';
import { startSquads } from './squads';
import { oneOfPicks } from './spawn-roll';
import { entityById, eyeHeight, type Character, type EntityId, type SimState } from './state';

/*
 * Enemies in a raid (AI rework session 2; design.md → AI → Scavs, PMCs and bosses).
 *
 * Every enemy spawn that isn't a scav's puts its enemy in at raid start, as before. Scavs
 * come in **slots**: a `oneOf` group of spawns (a sector), or a spawn on its own. About a
 * third of the slots fill at raid start; the rest arrive in waves every few minutes. A
 * dead scav frees its slot, which fills again in a later wave, more slowly as the raid
 * goes on, up to about twice the slots in all. A scav never arrives in sight of a player
 * or close to one: it waits for a spot in its sector that's clear.
 *
 * Everything needed to spawn and arm them later (their types' skill, loadouts and loot
 * tables) is copied into the state at raid start, as zombies mode does with its rules, so
 * a saved raid resumes with its queue and the co-op host needs nothing more.
 *
 * Also here: the scavs' **trickle** to a long fight. One noise draws at most 2 (ai.ts);
 * gunfire that keeps on in the same area draws one more free scav about every 30 s.
 */

export const SCAV_WAVES = {
  /** The share of scav slots filled at raid start (rounded up), unless the map sets its own. */
  startShare: 1 / 3,
  /** Seconds between waves; the rest of the slots come in waves of the start's size. */
  interval: 180,
  /** Each wave comes up to this many seconds early or late. */
  jitter: 30,
  /**
   * A freed slot waits at least this many seconds, ×(1 + refillLate × the share of the raid
   * gone), then comes with the next wave: about 2 minutes early on, 6 at the end.
   */
  refill: 120,
  refillLate: 2,
  /** Spawns per slot in a raid, the start's included: the cap is slots × this. */
  perSlot: 2,
  /** A scav never arrives closer than this to a player, nor in a player's sight. */
  minDistance: 30,
  /** A spot this far from every player is picked over a nearer one. */
  preferDistance: 60,
  /** Seconds before a slot with no clear spot tries again. */
  retry: 10,
  /**
   * The trickle: gunfire within trickleRadius of the last counts as the same fight. One
   * that keeps on draws one more free scav, the nearest that could hear it, every
   * trickleEvery seconds, until trickleForget seconds pass without a shot.
   */
  trickleEvery: 30,
  trickleRadius: AI.responderRadius,
  trickleForget: 15,
};

/** A spot a slot's scav can arrive at: one of its sector's enemy spawns. */
export interface WaveSpot {
  /** The enemy spawn marker's id. */
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
  /** Eye height standing there, for the sight check. */
  eye: number;
  patrol: PatrolDef | null;
  type: string;
  loadout: string;
  lootWeights: Record<string, number> | null;
}

export interface WaveSlot {
  spots: WaveSpot[];
  /** Its scav, alive or dead; 0 while empty. */
  entity: EntityId;
  /** The tick its next scav is due; −1 when none is (filled, or no more to come). */
  due: number;
}

/** An enemy type, as much of it as spawning one needs. */
export interface WaveType {
  skill: EnemySkill;
  faction: Faction;
  outfits: number;
  loot: EnemyLoot | null;
}

/** Gunfire in one area, for the trickle. */
export interface Gunfire {
  x: number;
  y: number;
  z: number;
  /** The loudest shot there, after the map's hearing scale. */
  loudness: number;
  /** The tick of the last shot, and when it draws another scav. */
  last: number;
  next: number;
}

export interface WavesState {
  /** The tick the raid started on; waves come every SCAV_WAVES.interval from it. */
  start: number;
  slots: WaveSlot[];
  /** Scavs put in so far, and how many may be in all. */
  spawned: number;
  cap: number;
  types: Record<string, WaveType>;
  loadouts: Record<string, LoadoutDef>;
  tables: Record<string, LootTableDef>;
  gunfire: Gunfire[];
}

/** The content enemies are made from. */
export interface EnemyContent {
  types: ReadonlyMap<string, EnemyDef>;
  loadouts: ReadonlyMap<string, LoadoutDef>;
  tables: LootTables;
  patrols: ReadonlyMap<string, PatrolDef>;
}

type EnemySpawn = Extract<CompiledMarker, { type: 'enemySpawn' }>;

/** A deep copy of plain data. */
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Puts a raid's enemies in at its start: every non-scav spawn's, rolled as before (oneOf,
 * chance), the map's PMC squads (sim/squads.ts), and the first third of the scav slots;
 * the rest are queued in state.waves.
 * Call after startRaid and after placing the players, so the first scavs keep clear of
 * them too. Returns the enemies put in.
 */
export function startEnemies(
  state: SimState,
  world: CollisionWorld,
  map: CompiledMap,
  items: ItemDb,
  content: EnemyContent,
): Character[] {
  const rng = state.rng;
  const picked = oneOfPicks(rng, map.markers, 'enemySpawn');
  const groups = new Map<string, EnemySpawn[]>();
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn' || m.oneOf === undefined) continue;
    const g = groups.get(m.oneOf);
    if (g) g.push(m);
    else groups.set(m.oneOf, [m]);
  }

  const waves: WavesState = {
    start: state.tick,
    slots: [],
    spawned: 0,
    cap: 0,
    types: {},
    loadouts: {},
    tables: {},
    gunfire: [],
  };
  const out: Character[] = [];
  /** Each slot's spot rolled for the start, should it be among the first. */
  const rolled: number[] = [];
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    if (m.oneOf !== undefined && !picked.has(m.id)) continue;
    if (!chance(rng, m.chance ?? 1)) continue;
    const type = content.types.get(m.enemy);
    if (!type) throw new Error(`enemy spawn "${m.id}": no enemy type "${m.enemy}"`);
    const spot = waveSpot(world, m, type, content);
    if (type.faction !== 'scav') {
      out.push(spawnSpot(state, world, items, content, spot));
      continue;
    }
    // A scav's slot: its sector's spawns that are scavs too.
    const members = m.oneOf === undefined ? [m] : groups.get(m.oneOf)!;
    const spots: WaveSpot[] = [];
    for (const g of members) {
      const t = content.types.get(g.enemy);
      if (t && t.faction === 'scav') spots.push(g === m ? spot : waveSpot(world, g, t, content));
    }
    rolled.push(spots.indexOf(spot));
    waves.slots.push({ spots, entity: 0, due: -1 });
  }
  // PMC squads (AI-3), all at the start, at player spawns nobody is using.
  out.push(...startSquads(state, world, map, items, content));
  if (!waves.slots.length) return out;

  // What later scavs are made from, copied in so the state needs no content files.
  for (const slot of waves.slots) {
    for (const s of slot.spots) {
      const type = content.types.get(s.type)!;
      waves.types[s.type] ??= {
        skill: { ...type.skill },
        faction: type.faction,
        outfits: type.outfits?.length ?? 1,
        loot: type.loot ? copy(type.loot) : null,
      };
      waves.loadouts[s.loadout] ??= copy(content.loadouts.get(s.loadout)!);
      for (const id of Object.keys(type.loot?.tables ?? {}))
        if (content.tables.has(id)) waves.tables[id] ??= copy(content.tables.get(id)!);
    }
  }

  // The first third, picked at random; the rest in waves of the same size.
  const n = waves.slots.length;
  const first = Math.max(1, Math.ceil(n * (map.scavStartShare ?? SCAV_WAVES.startShare)));
  const order = waves.slots.map((_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = nextIntIn(rng, 0, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  waves.cap = n * SCAV_WAVES.perSlot;
  let waveTick = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const slot = waves.slots[i]!;
    if (k < first) {
      // A clear spot in its sector if there is one, else the one rolled (the map's check
      // keeps enemy spawns out of sight of player spawns).
      const spot = clearSpot(state, world, slot) ?? slot.spots[rolled[i]!]!;
      slot.entity = spawnSlot(state, world, items, waves, spot).id;
      waves.spawned++;
      out.push(entityById(state, slot.entity) as Character);
      continue;
    }
    const wave = Math.floor(k / first);
    if ((k - first) % first === 0) {
      const at = SCAV_WAVES.interval * wave + SCAV_WAVES.jitter * (nextFloat(rng) * 2 - 1);
      waveTick = state.tick + Math.round(at * TICK_RATE);
    }
    slot.due = waveTick;
  }
  state.waves = waves;
  return out;
}

function waveSpot(
  world: CollisionWorld,
  m: EnemySpawn,
  type: EnemyDef,
  content: EnemyContent,
): WaveSpot {
  const patrol = m.patrol === undefined ? undefined : content.patrols.get(m.patrol);
  return {
    id: m.id,
    x: m.x,
    y: m.y,
    z: m.z,
    yaw: m.yaw,
    radius: m.radius ?? 0,
    eye:
      world.groundAt(m.x, m.z, MOVEMENT.radius, m.y + 0.5) +
      MOVEMENT.standHeight -
      MOVEMENT.eyeBelowTop,
    patrol: patrol ? copy(patrol) : null,
    type: m.enemy,
    loadout: m.loadout ?? type.loadout,
    lootWeights: m.lootWeights ? { ...m.lootWeights } : null,
  };
}

/** A non-scav enemy at its spawn, straight from the content. */
function spawnSpot(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  content: EnemyContent,
  spot: WaveSpot,
): Character {
  const type = content.types.get(spot.type)!;
  const c = spawnEnemy(state, world, spot.x, spot.y, spot.z, spot.yaw, {
    patrol: spot.patrol ?? undefined,
    radius: spot.radius,
    skill: type.skill,
    faction: type.faction,
    outfits: type.outfits?.length ?? 1,
    type: type.id,
  });
  equipLoadout(c, items, content.loadouts.get(spot.loadout)!, state.rng);
  rollEnemyLoot(c, items, content.tables, type.loot, spot.lootWeights ?? undefined, state.rng);
  return c;
}

/** A slot's scav at a spot, from what the state keeps. */
function spawnSlot(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  waves: WavesState,
  spot: WaveSpot,
): Character {
  const type = waves.types[spot.type]!;
  const c = spawnEnemy(state, world, spot.x, spot.y, spot.z, spot.yaw, {
    patrol: spot.patrol ?? undefined,
    radius: spot.radius,
    skill: type.skill,
    faction: type.faction,
    outfits: type.outfits,
    type: spot.type,
  });
  // The spawn's radius may have put it somewhere a player can see, or too close: then on
  // the spot itself, which was checked.
  if (
    spot.radius > 0 &&
    playerDistance(state, world, c.x, eyeHeight(c), c.z) < SCAV_WAVES.minDistance
  ) {
    c.x = c.ai!.homeX = spot.x;
    c.z = c.ai!.homeZ = spot.z;
    c.y = c.ai!.homeY = world.groundAt(spot.x, spot.z, MOVEMENT.radius, spot.y + 0.5);
  }
  equipLoadout(c, items, waves.loadouts[spot.loadout]!, state.rng);
  const tables: LootTables = new Map(Object.entries(waves.tables));
  rollEnemyLoot(c, items, tables, type.loot ?? undefined, spot.lootWeights ?? undefined, state.rng);
  return c;
}

/**
 * A spot in the slot's sector out of every living player's sight and at least
 * minDistance from each, at random, preferring those preferDistance or more away. Null if
 * there's none.
 */
function clearSpot(state: SimState, world: CollisionWorld, slot: WaveSlot): WaveSpot | null {
  let clear = 0;
  let far = 0;
  for (const s of slot.spots) {
    const d = playerDistance(state, world, s.x, s.eye, s.z);
    if (d >= SCAV_WAVES.minDistance) clear++;
    if (d >= SCAV_WAVES.preferDistance) far++;
  }
  if (!clear) return null;
  const wanted = far ? SCAV_WAVES.preferDistance : SCAV_WAVES.minDistance;
  let k = nextIntIn(state.rng, 0, (far || clear) - 1);
  for (const s of slot.spots) {
    if (playerDistance(state, world, s.x, s.eye, s.z) < wanted) continue;
    if (k-- === 0) return s;
  }
  return null;
}

/** Whether any player is still in the raid alive. */
function anyPlayer(state: SimState): boolean {
  for (const e of state.entities) if (!e.ai && !e.health.dead) return true;
  return false;
}

/**
 * Brings in the scavs due (once a second), refills freed slots, and runs the trickle.
 * Called by step during a raid with waves.
 */
export function updateWaves(state: SimState, world: CollisionWorld, items: ItemDb): void {
  const waves = state.waves;
  const raid = state.raid;
  if (!waves || !raid) return;
  trickle(state, waves);
  if ((state.tick - waves.start) % TICK_RATE !== 0 || state.tick >= raid.endTick) return;
  const players = anyPlayer(state);
  for (const slot of waves.slots) {
    if (slot.entity !== 0) {
      const c = entityById(state, slot.entity);
      if (c && !c.health.dead) continue;
      // Its scav died: the slot fills again in a later wave, while any are left to come.
      slot.entity = 0;
      slot.due = refillTick(state, waves, raid.endTick);
    }
    if (slot.due < 0 || state.tick < slot.due || !players) continue;
    if (waves.spawned >= waves.cap) {
      slot.due = -1;
      continue;
    }
    const spot = clearSpot(state, world, slot);
    if (!spot) {
      slot.due = state.tick + SCAV_WAVES.retry * TICK_RATE;
      continue;
    }
    slot.entity = spawnSlot(state, world, items, waves, spot).id;
    slot.due = -1;
    waves.spawned++;
  }
}

/** When a slot freed now fills again: the wave after its wait, or −1 for never. */
function refillTick(state: SimState, waves: WavesState, endTick: number): number {
  if (waves.spawned >= waves.cap) return -1;
  const gone = Math.min(1, (state.tick - waves.start) / Math.max(1, endTick - waves.start));
  const wait = SCAV_WAVES.refill * (1 + SCAV_WAVES.refillLate * gone) * TICK_RATE;
  const every = SCAV_WAVES.interval * TICK_RATE;
  const due = waves.start + Math.ceil((state.tick + wait - waves.start) / every) * every;
  return due < endTick ? due : -1;
}

/**
 * Gunfire that keeps on in one area draws one more scav every SCAV_WAVES.trickleEvery seconds:
 * the nearest free one within earshot (the loudest shot there, after the map's hearing
 * scale), sent to check it with care, past the 2-responder cap.
 */
function trickle(state: SimState, waves: WavesState): void {
  const scale = state.hearingScale ?? 1;
  const r2 = SCAV_WAVES.trickleRadius * SCAV_WAVES.trickleRadius;
  for (const ev of state.events) {
    if (ev.type !== 'shot' || ev.pellet !== 0 || ev.grenade || ev.flame) continue;
    const loud = ev.loudness * scale;
    let fire: Gunfire | undefined;
    for (const g of waves.gunfire) {
      const dx = g.x - ev.fromX;
      const dz = g.z - ev.fromZ;
      if (dx * dx + dz * dz <= r2) {
        fire = g;
        break;
      }
    }
    if (fire) {
      fire.last = state.tick;
      if (loud > fire.loudness) fire.loudness = loud;
    } else {
      waves.gunfire.push({
        x: ev.fromX,
        y: ev.fromY,
        z: ev.fromZ,
        loudness: loud,
        last: state.tick,
        next: state.tick + SCAV_WAVES.trickleEvery * TICK_RATE,
      });
    }
  }
  for (let i = waves.gunfire.length - 1; i >= 0; i--) {
    const g = waves.gunfire[i]!;
    if (state.tick - g.last > SCAV_WAVES.trickleForget * TICK_RATE) {
      waves.gunfire.splice(i, 1);
      continue;
    }
    if (state.tick < g.next) continue;
    g.next += SCAV_WAVES.trickleEvery * TICK_RATE;
    let best: Character | null = null;
    let bestD = g.loudness;
    for (const e of state.entities) {
      if (!e.ai || factionOf(e) !== 'scav' || !freeToCheck(e)) continue;
      const d = Math.hypot(e.x - g.x, e.y - g.y, e.z - g.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) checkGunfire(best, g.x, g.y, g.z);
  }
}

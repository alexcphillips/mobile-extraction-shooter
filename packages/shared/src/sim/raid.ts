import type { CompiledMap } from '../content/compile';
import type { ItemDb } from '../content/items';
import { removeAt, type Grid, type Item } from '../inventory/grid';
import { nextInt, nextFloat } from '../rng';
import { TICK_RATE, TICK_SECONDS } from '../tick';
import { createItem } from './create-item';
import { CARRIED_GRIDS, GEAR_SLOTS, carriedGrid, createGear, type Gear } from './gear';
import type { Character, EntityId, SimState } from './state';

/*
 * The raid lifecycle (session 11): a timer, extraction points, and players leaving. See
 * design.md → Raids and maps → Extraction. Everything here is in the sim so a co-op
 * server runs the same rules.
 */

export const RAID = {
  /** Seconds standing in an extraction point to leave by it. */
  extractTime: 7,
  /** How far above or below an extraction point's centre still counts, in metres. */
  extractHeight: 2,
  /** How close to a quest marker a player must be to investigate it, in metres (14b). */
  investigateReach: 2.5,
};

/** Where players can leave the raid: a circle on the ground. */
export interface ExtractionPoint {
  /** Its marker's path id. */
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

/**
 * A quest marker a player has to investigate in this raid (session 14b): one of their
 * active quests' investigate objectives on this map, not done before.
 */
export interface InvestigateSpot {
  /** The player whose quest it is; in co-op only they see it. */
  holder: EntityId;
  /** The questMarker's path id. */
  marker: string;
  x: number;
  y: number;
  z: number;
  /** Investigated in this raid. It counts even if they die afterwards. */
  done: boolean;
}

export interface RaidState {
  /** The tick the timer runs out on. */
  endTick: number;
  extractions: ExtractionPoint[];
  investigate: InvestigateSpot[];
}

/** What a player's active quests want in a raid on a map (quests.ts raidObjectives). */
export interface RaidObjectives {
  /** questMarkers to investigate, by path id. */
  investigate: string[];
  /** Quest items to put on the ground, each at one of its questMarkers, picked at random. */
  extract: { item: string; spots: string[] }[];
}

/** How a player left the raid alive: extracted, or still in it when time ran out. */
export type LeaveReason = 'extracted' | 'mia';

/** A player who has left the raid, with everything they had. */
export interface LeftRaid {
  character: Character;
  how: LeaveReason;
  /** The extraction point's id, or null when missing in action. */
  at: string | null;
  tick: number;
}

/** A player investigated a quest marker. */
export interface InvestigateEvent {
  type: 'investigate';
  by: EntityId;
  marker: string;
}

/** A player left the raid. They're out of state.entities and in state.left. */
export interface LeaveEvent {
  type: 'leave';
  by: EntityId;
  how: LeaveReason;
  at: string | null;
}

/** Starts the raid's timer, running from now, and opens the map's extraction points. */
export function startRaid(state: SimState, map: CompiledMap, seconds: number): void {
  const extractions: ExtractionPoint[] = [];
  for (const m of map.markers) {
    if (m.type !== 'extraction') continue;
    extractions.push({ id: m.id, name: m.name, x: m.x, y: m.y, z: m.z, radius: m.radius });
  }
  state.raid = {
    endTick: state.tick + Math.round(seconds * TICK_RATE),
    extractions,
    investigate: [],
  };
}

/**
 * Sets up a player's quests in a raid (after startRaid): the markers they can investigate,
 * and their quest items on the ground, each at one of its spots picked with the raid's RNG.
 * A marker missing from the map is an error (the client's content test checks them).
 */
export function startQuests(
  state: SimState,
  map: CompiledMap,
  items: ItemDb,
  holder: EntityId,
  objectives: RaidObjectives,
): void {
  const raid = state.raid;
  if (!raid) return;
  const at = (id: string): { x: number; y: number; z: number } => {
    const m = map.markers.find((x) => x.type === 'questMarker' && x.id === id);
    if (!m) throw new Error(`no quest marker "${id}" on ${map.id}`);
    return m;
  };
  for (const marker of objectives.investigate) {
    const { x, y, z } = at(marker);
    raid.investigate.push({ holder, marker, x, y, z, done: false });
  }
  for (const { item, spots } of objectives.extract) {
    const { x, y, z } = at(spots[nextInt(state.rng, spots.length)]!);
    const yaw = nextFloat(state.rng) * Math.PI * 2;
    state.ground.push({ item: createItem(items, item, 1), x, y, z, yaw });
  }
}

/** The nearest quest marker in reach that a character still has to investigate, or null. */
export function investigateInReach(state: SimState, c: Character): InvestigateSpot | null {
  let best: InvestigateSpot | null = null;
  let bestD = RAID.investigateReach;
  for (const s of state.raid?.investigate ?? []) {
    if (s.holder !== c.id || s.done || Math.abs(c.y - s.y) > RAID.extractHeight) continue;
    const d = Math.hypot(c.x - s.x, c.z - s.z);
    if (d <= bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Investigates the quest marker in reach, if there is one (the Investigate button). */
export function investigate(state: SimState, c: Character): void {
  if (c.health.dead) return;
  const s = investigateInReach(state, c);
  if (!s) return;
  s.done = true;
  state.events.push({ type: 'investigate', by: c.id, marker: s.marker });
}

/** The quest markers a player has investigated in this raid. */
export function investigatedBy(state: SimState, id: EntityId): string[] {
  return (state.raid?.investigate ?? [])
    .filter((s) => s.holder === id && s.done)
    .map((s) => s.marker);
}

/** Seconds left on the raid timer (0 once it has run out), or Infinity with no raid. */
export function timeLeft(state: SimState): number {
  if (!state.raid) return Infinity;
  return Math.max(0, state.raid.endTick - state.tick) * TICK_SECONDS;
}

/** The extraction point a character is standing in, or null. */
export function extractionAt(state: SimState, c: Character): ExtractionPoint | null {
  for (const p of state.raid?.extractions ?? []) {
    if (Math.hypot(c.x - p.x, c.z - p.z) <= p.radius && Math.abs(c.y - p.y) <= RAID.extractHeight) {
      return p;
    }
  }
  return null;
}

/**
 * Once a tick, after everything else: living players in an extraction point count up
 * towards leaving (stepping out resets it; being shot doesn't), and when the timer runs
 * out, every player still in the raid is missing in action. Enemies never leave.
 */
export function updateRaid(state: SimState): void {
  const raid = state.raid;
  if (!raid) return;
  const timeUp = state.tick >= raid.endTick;
  let gone = false;
  for (const c of state.entities) {
    if (c.ai || c.health.dead) continue;
    const p = extractionAt(state, c);
    c.extracting = p ? c.extracting + TICK_SECONDS : 0;
    if (p && c.extracting >= RAID.extractTime - 1e-9) gone = leave(state, c, 'extracted', p.id);
    else if (timeUp) gone = leave(state, c, 'mia', null);
  }
  if (gone) {
    for (let i = state.entities.length - 1; i >= 0; i--) {
      if (state.left.some((l) => l.character === state.entities[i])) state.entities.splice(i, 1);
    }
  }
}

function leave(state: SimState, c: Character, how: LeaveReason, at: string | null): true {
  state.left.push({ character: c, how, at, tick: state.tick });
  state.events.push({ type: 'leave', by: c.id, how, at });
  return true;
}

/** Everything in a character's gear: what's in its slots, and in its grids. */
export function gearItems(gear: Gear): Item[] {
  const out: Item[] = [];
  for (const slot of GEAR_SLOTS) {
    const item = gear[slot];
    if (item) out.push(item);
  }
  for (let i = 0; i < CARRIED_GRIDS; i++) {
    for (const g of carriedGrid(gear, i)?.items ?? []) out.push(g.item);
  }
  for (const g of gear.vault?.items ?? []) out.push(g.item);
  return out;
}

/**
 * What a player keeps from the raid: everything if they extracted; if they died or went
 * missing, only the knife and what's in the vault.
 */
export function keptItems(gear: Gear, survived: boolean): Item[] {
  if (survived) return gearItems(gear);
  const out: Item[] = [];
  if (gear.knife) out.push(gear.knife);
  for (const g of gear.vault?.items ?? []) out.push(g.item);
  return out;
}

/**
 * Takes every quest item out of a player's gear, wherever it is, and returns their ids
 * (one per item). They never reach the stash: the server takes them when the raid ends,
 * and counts the ones its quests wanted (session 14b).
 */
export function takeQuestItems(items: ItemDb, gear: Gear): string[] {
  const out: string[] = [];
  const fromGrid = (grid: Grid | null | undefined): void => {
    if (!grid) return;
    for (let i = grid.items.length - 1; i >= 0; i--) {
      const item = grid.items[i]!.item;
      if (items.get(item.item)?.type === 'quest') {
        out.push(item.item);
        removeAt(grid, i);
      } else fromGrid(item.grid);
    }
  };
  for (const slot of GEAR_SLOTS) fromGrid(gear[slot]?.grid);
  fromGrid(gear.pockets);
  fromGrid(gear.vault);
  return out;
}

/**
 * The gear a player comes out of the raid with: all of it if they extracted; if they
 * died or went missing, a fresh set with only the knife and the vault. As keptItems, but
 * keeping where things are. knife stands in if the gear has none.
 */
export function keptGear(gear: Gear, survived: boolean, knife: Item | null = null): Gear {
  if (survived) return gear;
  const out = createGear(true);
  out.knife = gear.knife ?? knife;
  out.vault = gear.vault ?? out.vault;
  out.hand = 'knife';
  return out;
}

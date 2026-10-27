import type { CompiledMap } from '../content/compile';
import type { Item } from '../inventory/grid';
import { TICK_RATE, TICK_SECONDS } from '../tick';
import { CARRIED_GRIDS, GEAR_SLOTS, carriedGrid, type Gear } from './gear';
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

export interface RaidState {
  /** The tick the timer runs out on. */
  endTick: number;
  extractions: ExtractionPoint[];
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
  state.raid = { endTick: state.tick + Math.round(seconds * TICK_RATE), extractions };
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

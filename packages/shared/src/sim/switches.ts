import { TICK_SECONDS } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import type { Character, EntityId, SimState } from './state';

/*
 * Switches (design.md → Switches, 2026-11-05). A switch is anything solid tagged in the map.
 * Used once, each of its rows opens a door, at once or after a timer, and can play a noise
 * the whole map hears. A door a switch opens stays locked until then. Enemies never use a
 * switch and don't react to its noises: those are sounds, with no part in the AI's hearing.
 */

/** A noise a switch set off, repeated by the client until `left` runs out. */
export interface SwitchNoise {
  /** Which row of which switch, so the client can tell two noises apart. */
  id: number;
  sound: string;
  x: number;
  y: number;
  z: number;
  /** Seconds left. */
  left: number;
}

export interface SwitchEvent {
  type: 'switch';
  by: EntityId;
  index: number;
}

/** A switch's door has opened, its timer done. */
export interface DoorSwitchedEvent {
  type: 'doorSwitched';
  door: number;
  sound: string | undefined;
}

/** Can c reach switch i? Measured to its middle, so a big one counts from its edge. */
export function switchInReach(world: CollisionWorld, c: Character, i: number): boolean {
  const s = world.switches[i];
  if (!s) return false;
  const dx = c.x - s.x;
  const dz = c.z - s.z;
  return dx * dx + dz * dz <= s.reach * s.reach && Math.abs(c.y - s.y) <= s.reach;
}

/** Fills in the switches of a state that has none yet, and runs out timers and noises. */
export function tickSwitches(state: SimState, world: CollisionWorld): void {
  if (state.switches?.length !== world.switches.length) {
    state.switches = world.switches.map(() => false);
    state.noises = [];
  }
  for (let i = 0; i < state.doors.length; i++) {
    const d = state.doors[i]!;
    if (d.opening === undefined) continue;
    d.opening -= TICK_SECONDS;
    if (d.opening <= 1e-9) openDoor(state, world, i, d.openSound);
  }
  for (let i = state.noises.length - 1; i >= 0; i--) {
    const n = state.noises[i]!;
    n.left -= TICK_SECONDS;
    if (n.left <= 0) state.noises.splice(i, 1);
  }
}

/**
 * c holds the use button on switch i this tick, or on none (null). A switch with a use time
 * is used once it's been held that long; letting go, or it no longer being usable (someone
 * else got there first, c walked off or died), starts it over.
 */
export function holdSwitch(
  state: SimState,
  world: CollisionWorld,
  c: Character,
  i: number | null,
): void {
  const s = i === null ? undefined : world.switches[i];
  if (i === null || !s || !canUse(state, world, c, i)) {
    delete c.switching;
    return;
  }
  const held = c.switching?.index === i ? c.switching.held + TICK_SECONDS : TICK_SECONDS;
  if (held + 1e-9 < s.useTime) {
    c.switching = { index: i, held };
    return;
  }
  delete c.switching;
  useSwitch(state, world, c, i);
}

function canUse(state: SimState, world: CollisionWorld, c: Character, i: number): boolean {
  return !state.switches[i] && !c.ai && !c.health.dead && switchInReach(world, c, i);
}

/** Uses switch i for c, if it's in reach and hasn't been used. A switch works once a raid. */
export function useSwitch(state: SimState, world: CollisionWorld, c: Character, i: number): void {
  const s = world.switches[i];
  if (!s || !canUse(state, world, c, i)) return;
  state.switches[i] = true;
  state.events.push({ type: 'switch', by: c.id, index: i });
  s.rows.forEach((row, r) => {
    const d = state.doors[row.door];
    if (row.noise !== undefined) {
      const at = world.doors[row.door];
      state.noises.push({
        id: i * 100 + r,
        sound: row.noise,
        x: at?.x ?? s.x,
        y: at?.y ?? s.y,
        z: at?.z ?? s.z,
        left: row.lasts,
      });
    }
    if (!d || d.open || d.opening !== undefined) return;
    if (row.timer <= 0) openDoor(state, world, row.door, row.openNoise);
    else {
      d.opening = row.timer;
      d.openingFor = row.timer;
      d.openSound = row.openNoise;
    }
  });
}

/** How far door i has come through its timer, 0 to 1; 1 once it's open. */
export function openingProgress(d: {
  open: boolean;
  opening?: number | undefined;
  openingFor?: number | undefined;
}): number {
  if (d.open) return 1;
  if (d.opening === undefined || !d.openingFor) return 0;
  return 1 - d.opening / d.openingFor;
}

function openDoor(
  state: SimState,
  world: CollisionWorld,
  i: number,
  sound: string | undefined,
): void {
  const d = state.doors[i]!;
  delete d.opening;
  delete d.openingFor;
  delete d.openSound;
  d.locked = false;
  d.open = true;
  if (world.doors[i]!.vanishes) d.gone = true;
  world.setDoorOpen(i, true, !!d.flipped);
  if (d.gone) world.setDoorGone(i, true);
  state.events.push({ type: 'doorSwitched', door: i, sound });
}

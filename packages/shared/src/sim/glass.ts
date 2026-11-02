import type { CollisionWorld, RayHit } from '../world/collision-world';
import type { EntityId, SimState } from './state';

/*
 * Glass (design.md → Glass). A pane fills a window: solid to walk, vault and throw against,
 * seen through, and broken for the rest of the raid by a shot (which goes on through), a
 * knife, a blast in reach, or a grenade on an impact fuse (a molotov smashes on it). Breaking
 * is heard: enemies within GLASS.loudness go to look, less through walls.
 */

/** Glass tuning, in metres. */
export const GLASS = {
  /** How far away a pane breaking is heard (the user's call, 2026-11-02: about a room or two). */
  loudness: 12,
  /** A shot breaks at most this many panes in a row before it stops at the next. */
  maxPerShot: 4,
} as const;

/** A pane breaking, at its middle. */
export interface GlassEvent {
  type: 'glass';
  by: EntityId;
  glass: number;
  x: number;
  y: number;
  z: number;
  loudness: number;
}

/**
 * Brings the collision world in line with the state's glass (true is broken), filling in a
 * state that has none yet (or was saved before glass): all whole. Called with syncDoors.
 */
export function syncGlass(state: SimState, world: CollisionWorld): void {
  if (state.glass?.length !== world.glass.length) state.glass = world.glass.map(() => false);
  for (let i = 0; i < state.glass.length; i++) world.setGlassBroken(i, state.glass[i]!);
}

/** The pane a ray hit is, or -1. */
export function glassHit(world: CollisionWorld, hit: RayHit): number {
  return hit.kind === 'solid' ? world.glassOf(hit.index) : -1;
}

/** Breaks pane i, if it's whole, with its event. */
export function breakGlass(state: SimState, world: CollisionWorld, i: number, by: EntityId): void {
  if (i < 0 || state.glass[i]) return;
  state.glass[i] = true;
  world.setGlassBroken(i, true);
  const g = world.glass[i]!;
  state.events.push({
    type: 'glass',
    by,
    glass: i,
    x: g.x,
    y: g.y + g.height / 2,
    z: g.z,
    loudness: GLASS.loudness,
  });
}

/**
 * A blast at (x, y, z) breaks every whole pane within radius of it (to the nearest point of
 * the pane's middle line), with nothing but glass between.
 */
export function breakGlassNear(
  state: SimState,
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  radius: number,
  by: EntityId,
): void {
  for (let i = 0; i < world.glass.length; i++) {
    if (state.glass[i]) continue;
    const g = world.glass[i]!;
    // The nearest point on the pane, in its plane.
    const c = Math.cos(g.yaw);
    const s = Math.sin(g.yaw);
    const along = Math.max(-g.width / 2, Math.min(g.width / 2, (x - g.x) * c - (z - g.z) * s));
    const px = g.x + along * c;
    const pz = g.z - along * s;
    const py = Math.max(g.y, Math.min(g.y + g.height, y));
    const dx = px - x;
    const dy = py - y;
    const dz = pz - z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    if (d > 1e-6 && world.raycast(x, y, z, dx / d, dy / d, dz / d, d - 0.05, undefined, true) < d)
      continue;
    breakGlass(state, world, i, by);
  }
}

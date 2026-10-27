import type { Item } from '../inventory/grid';
import { nextFloat } from '../rng';
import type { CollisionWorld } from '../world/collision-world';
import type { Character, SimState } from './state';

/*
 * Items lying on the ground (session 11b): rolled at lootSpawn markers when the raid
 * starts, dropped from the inventory, and whatever an action has no room for. They're
 * picked up through the inventory actions, with the ground as an owner.
 */

export const GROUND = {
  /** How far in front of you a dropped item lands, in metres, unless a wall is closer. */
  ahead: 0.9,
  /**
   * How far from that spot it may land, at random, so drops don't pile up exactly. At
   * your feet it's less than the body's radius, so never in a wall.
   */
  scatter: 0.15,
  feetScatter: 0.3,
  /** The height a drop is checked for walls at, above the feet. */
  checkHeight: 0.5,
};

/** An item on the ground. y is the surface it lies on; yaw only turns how it's drawn. */
export interface GroundItem {
  item: Item;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * Drops an item in front of c (where you can see it), or at its feet if a wall is in the
 * way, with a little scatter. With a world, it lands on the surface below (from a ladder
 * or mid-jump); without one, it lies at c's feet, at their height.
 */
export function dropItem(
  state: SimState,
  c: Character,
  item: Item,
  world?: CollisionWorld,
): GroundItem {
  let ahead = 0;
  const fx = -Math.sin(c.yaw);
  const fz = -Math.cos(c.yaw);
  if (world) {
    const max = GROUND.ahead + GROUND.scatter + 0.05;
    const wall = world.raycast(c.x, c.y + GROUND.checkHeight, c.z, fx, 0, fz, max);
    ahead = Math.max(0, Math.min(GROUND.ahead, wall - GROUND.scatter - 0.05));
  }
  const a = nextFloat(state.rng) * Math.PI * 2;
  const r = Math.sqrt(nextFloat(state.rng)) * (ahead > 0 ? GROUND.scatter : GROUND.feetScatter);
  const x = c.x + fx * ahead + Math.cos(a) * r;
  const z = c.z + fz * ahead + Math.sin(a) * r;
  const y = world ? world.groundAt(x, z, 0, c.y + 0.1) : c.y;
  const g: GroundItem = { item, x, y, z, yaw: nextFloat(state.rng) * Math.PI * 2 };
  state.ground.push(g);
  return g;
}

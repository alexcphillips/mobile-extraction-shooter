import type { CollisionWorld } from '../world/collision-world';
import { LEFT_LEG, RIGHT_LEG, type Zone } from './health';
import { MOVEMENT } from './movement';
import type { Character, EntityId, SimState } from './state';

/*
 * Barbed wire (TU-2, 2026-11-09; design.md → Tutorial): touching a map's wire, standing,
 * crouched or prone, starts a light bleed on a leg, once each time you go in, not every
 * tick you're in it. A bandage stops it as any other. One health bar (zombies mode) and the
 * infinite health cheat never bleed, so wire does nothing to them.
 */

/** Wire snagging someone: for a sound and the HUD. */
export interface WireEvent {
  type: 'wire';
  target: EntityId;
  zone: Zone;
}

/** Whether c touches wire now, and if it has just gone in, starts it bleeding. */
export function snagOnWire(state: SimState, world: CollisionWorld, c: Character): void {
  if (c.health.dead) {
    c.inWire = false;
    return;
  }
  const touching = world.touchesWire(c.x, c.z, MOVEMENT.radius, c.y, c.y + c.height);
  if (touching && !c.inWire && c.health.pool === undefined && !c.admin?.infiniteHealth) {
    // Which leg is a hash of the tick and who, so the sim's rng isn't drawn from.
    const zone = (state.tick + c.id) % 2 === 0 ? LEFT_LEG : RIGHT_LEG;
    c.health.bleeding[zone] = true;
    state.events.push({ type: 'wire', target: c.id, zone });
  }
  c.inWire = touching;
}

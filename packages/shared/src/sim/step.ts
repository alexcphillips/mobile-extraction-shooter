import type { ItemDb } from '../content/items';
import type { CollisionWorld } from '../world/collision-world';
import { applyFall, bleed } from './health';
import { moveCharacter } from './movement';
import type { SimState, TickInputs } from './state';
import { updateWeapon } from './weapons';

/**
 * Advances the simulation by one fixed tick (TICK_SECONDS), in place. Mutating rather
 * than returning a copy keeps the tick allocation-free; callers that need the previous
 * state for interpolation copy the few fields they draw. state.events lists what happened.
 */
export function step(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  inputs: TickInputs,
): void {
  state.events.length = 0;
  // Everyone moves, then everyone shoots, so shots see this tick's positions.
  for (const e of state.entities) {
    const input = e.health.dead ? undefined : inputs[e.id];
    moveCharacter(e, input, world);
    applyFall(state, e);
  }
  for (const e of state.entities) {
    if (!e.health.dead) updateWeapon(state, e, inputs[e.id], world, items);
  }
  for (const e of state.entities) bleed(state, e);
  state.tick++;
}

import type { CollisionWorld } from '../world/collision-world';
import { moveCharacter } from './movement';
import type { SimState, TickInputs } from './state';

/**
 * Advances the simulation by one fixed tick (TICK_SECONDS), in place. Mutating rather
 * than returning a copy keeps the tick allocation-free; callers that need the previous
 * state for interpolation copy the few fields they draw.
 */
export function step(state: SimState, world: CollisionWorld, inputs: TickInputs): void {
  for (const e of state.entities) moveCharacter(e, inputs[e.id], world);
  state.tick++;
}

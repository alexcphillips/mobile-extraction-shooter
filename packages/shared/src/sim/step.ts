import type { ItemDb } from '../content/items';
import type { NavGrid } from '../nav/nav-grid';
import type { CollisionWorld } from '../world/collision-world';
import { updateAi } from './ai';
import { applyFall, bleed } from './health';
import { moveCharacter, separateCharacters } from './movement';
import type { SimState, TickInputs } from './state';
import { updateWeapon } from './weapons';

/**
 * Advances the simulation by one fixed tick (TICK_SECONDS), in place. Mutating rather
 * than returning a copy keeps the tick allocation-free; callers that need the previous
 * state for interpolation copy the few fields they draw. state.events lists what happened.
 *
 * Enemies think at the end, from this tick's positions and events, and act on it next
 * tick. Without a nav grid they don't think, and stand still.
 */
export function step(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  inputs: TickInputs,
  nav?: NavGrid,
): void {
  state.events.length = 0;
  // Everyone moves, then everyone shoots, so shots see this tick's positions.
  for (const e of state.entities) {
    const input = e.health.dead ? undefined : (inputs[e.id] ?? e.ai?.input);
    moveCharacter(e, input, world);
    applyFall(state, e);
  }
  separateCharacters(state.entities, world);
  for (const e of state.entities) {
    if (!e.health.dead) updateWeapon(state, e, inputs[e.id] ?? e.ai?.input, world, items);
  }
  for (const e of state.entities) bleed(state, e);
  if (nav) updateAi(state, world, items, nav);
  state.tick++;
}

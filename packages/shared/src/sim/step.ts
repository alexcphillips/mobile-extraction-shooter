import type { ItemDb } from '../content/items';
import type { NavGrid } from '../nav/nav-grid';
import type { CollisionWorld } from '../world/collision-world';
import { updateAi } from './ai';
import { applyFall, bleed } from './health';
import { TICK_SECONDS } from '../tick';
import { switchHand } from './gear';
import { applyInventory } from './looting';
import { updateMedUse } from './meds';
import { updateMelee } from './melee';
import { moveCharacter, separateCharacters } from './movement';
import type { SimState, TickInputs } from './state';
import { updateWeapon } from './weapons';

/**
 * Advances the simulation by one fixed tick (TICK_SECONDS), in place. Mutating rather
 * than returning a copy keeps the tick allocation-free; callers that need the previous
 * state for interpolation copy the few fields they draw. state.events lists what happened.
 *
 * Enemies think at the end, from this tick's positions and events, and act on it next
 * tick. Without a nav grid they don't think, and stand still. Inventory actions come
 * first, so the rest of the tick sees what they changed; then switching hands and meds.
 */
export function step(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  inputs: TickInputs,
  nav?: NavGrid,
): void {
  state.events.length = 0;
  for (const e of state.entities) {
    const actions = inputs[e.id]?.inventory;
    if (!actions) continue;
    for (const a of actions) {
      state.events.push({ type: 'inventory', by: e.id, ok: applyInventory(state, e, items, a) });
    }
  }
  // Switching hands and using meds before moving, which is slower while using one.
  for (const e of state.entities) {
    const input = e.health.dead ? undefined : (inputs[e.id] ?? e.ai?.input);
    if (e.draw > 0) e.draw = Math.max(0, e.draw - TICK_SECONDS);
    if (input?.draw) switchHand(e, items, input.draw);
    updateMedUse(e, items, input);
  }
  // Everyone moves, then everyone shoots, so shots see this tick's positions.
  for (const e of state.entities) {
    const input = e.health.dead ? undefined : (inputs[e.id] ?? e.ai?.input);
    moveCharacter(e, input, world);
    applyFall(state, e);
  }
  separateCharacters(state.entities, world);
  for (const e of state.entities) {
    if (e.health.dead) continue;
    const input = inputs[e.id] ?? e.ai?.input;
    updateWeapon(state, e, input, world, items);
    updateMelee(state, e, input, world, items);
  }
  for (const e of state.entities) bleed(state, e);
  if (nav) updateAi(state, world, items, nav);
  state.tick++;
}

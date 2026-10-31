import type { ItemDb } from '../content/items';
import type { NavGrid } from '../nav/nav-grid';
import type { CollisionWorld } from '../world/collision-world';
import { updateAi } from './ai';
import { syncDoors, useDoor } from './doors';
import { applyFall, bleed } from './health';
import { TICK_SECONDS } from '../tick';
import { updateExtinguish, updateFire } from './fire';
import { switchHand } from './gear';
import { updateGrenades, updateThrow } from './grenades';
import { applyInventory } from './looting';
import { updateMedUse } from './meds';
import { updateMelee } from './melee';
import { moveCharacter, separateCharacters } from './movement';
import { investigate, updateRaid } from './raid';
import type { SimState, TickInputs } from './state';
import { updateWeapon } from './weapons';

/**
 * Advances the simulation by one fixed tick (TICK_SECONDS), in place. Mutating rather
 * than returning a copy keeps the tick allocation-free; callers that need the previous
 * state for interpolation copy the few fields they draw. state.events lists what happened.
 *
 * Enemies think at the end, from this tick's positions and events, and act on it next
 * tick. Without a nav grid they don't think, and stand still. The world and nav grid
 * follow the state's doors first. Inventory actions come first, so the rest of the tick
 * sees what they changed; then doors and investigating, switching hands, meds and putting
 * yourself out (which blocks switching hands).
 * Last, the raid: extracting, and the timer running out.
 */
export function step(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  inputs: TickInputs,
  nav?: NavGrid,
): void {
  state.events.length = 0;
  syncDoors(state, world, nav);
  for (const e of state.entities) {
    const actions = inputs[e.id]?.inventory;
    if (!actions) continue;
    for (const a of actions) {
      state.events.push({
        type: 'inventory',
        by: e.id,
        ok: applyInventory(state, e, items, a, world),
      });
    }
  }
  for (const e of state.entities) {
    const door = inputs[e.id]?.door;
    if (door != null) useDoor(state, world, items, e, door);
    if (inputs[e.id]?.investigate) investigate(state, e);
  }
  // Switching hands and using meds before moving, which is slower while using one.
  for (const e of state.entities) {
    const input = e.health.dead ? undefined : (inputs[e.id] ?? e.ai?.input);
    if (e.draw > 0) e.draw = Math.max(0, e.draw - TICK_SECONDS);
    if (e.blind) e.blind = Math.max(0, e.blind - TICK_SECONDS);
    updateExtinguish(e, input);
    if (input?.draw && !e.extinguish) switchHand(e, items, input.draw);
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
    updateThrow(state, e, input, world, items);
  }
  // Thrown this tick or before: they fly, and those whose fuse is up go off. Smoke clears.
  updateGrenades(state, world, items);
  // Flames fly and land, fire on the map burns down, and those alight burn.
  updateFire(state, world, items);
  for (const e of state.entities) bleed(state, e);
  if (nav) updateAi(state, world, items, nav);
  state.tick++;
  // Last, so a player who leaves did everything else this tick.
  updateRaid(state);
}

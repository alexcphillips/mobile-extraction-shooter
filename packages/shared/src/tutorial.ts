import type { CompiledTutorial, TutorialTrigger } from './content/tutorials';
import { countOf } from './inventory/grid';
import { CARRIED_GRIDS, carriedGrid, heldWeapon } from './sim/gear';
import { isBleeding } from './sim/health';
import { MOVEMENT } from './sim/movement';
import { insidePolygon } from './sim/raid';
import type { Character, EntityId, SimState } from './sim/state';

/*
 * Following the tutorial's steps (TU-2, 2026-11-09; content/tutorials.ts): which step
 * shows, and whether its trigger has happened. Reads the sim's state and this tick's
 * events and changes neither, so call advanceTutorial after every tick (not every frame),
 * or events are missed. Plain data, so it's saved with a raid snapshot as is.
 */

export interface TutorialProgress {
  /** The step showing; the number of steps once every one is done. */
  step: number;
  /** Where the player stood as the step began, for a `moved` trigger. */
  fromX: number;
  fromZ: number;
}

export function startTutorial(player: Character): TutorialProgress {
  return { step: 0, fromX: player.x, fromZ: player.z };
}

/** Whether every step is done. */
export function tutorialDone(t: CompiledTutorial, p: TutorialProgress): boolean {
  return p.step >= t.steps.length;
}

/**
 * Moves past the showing step if its trigger happened this tick, and past any after it
 * already true (a heal step when nothing bleeds). Returns whether the step changed.
 */
export function advanceTutorial(
  t: CompiledTutorial,
  p: TutorialProgress,
  state: SimState,
  player: EntityId,
): boolean {
  const c = state.entities.find((e) => e.id === player);
  const start = p.step;
  while (p.step < t.steps.length) {
    const s = t.steps[p.step]!;
    if (!triggered(s.trigger, s, p, state, player, c)) break;
    p.step++;
    if (c) {
      p.fromX = c.x;
      p.fromZ = c.z;
    }
  }
  return p.step !== start;
}

function triggered(
  trigger: TutorialTrigger,
  step: CompiledTutorial['steps'][number],
  p: TutorialProgress,
  state: SimState,
  player: EntityId,
  c: Character | undefined,
): boolean {
  // Extracting takes the player out of the raid: only the event is left.
  if (trigger.type === 'extract')
    return state.events.some((e) => e.type === 'leave' && e.by === player && e.how === 'extracted');
  if (!c || c.health.dead) return false;
  switch (trigger.type) {
    case 'moved':
      return Math.hypot(c.x - p.fromX, c.z - p.fromZ) >= trigger.distance;
    case 'zone':
      return insidePolygon(step.zonePoints ?? [], c.x, c.z);
    case 'vault':
      return c.mode === 'vault' || (c.mode === 'air' && c.vy > 0);
    case 'crouch':
      // Its height eases down to the stance's, so partway there counts.
      return c.height < MOVEMENT.standHeight - 0.1;
    case 'carry':
      return carries(c, trigger.item);
    case 'notBleeding':
      return !isBleeding(c.health);
    case 'kill':
      return state.events.some(
        (e) =>
          e.type === 'death' &&
          e.by === player &&
          e.target !== player &&
          !!state.entities.find((x) => x.id === e.target)?.ai,
      );
    case 'reload':
      return (heldWeapon(c)?.reloading ?? 0) > 0;
    case 'searchBody': {
      const prefix = `${player}|b:`;
      for (const key in state.raid?.searches ?? {}) if (key.startsWith(prefix)) return true;
      return false;
    }
    case 'door':
      return state.events.some(
        (e) =>
          e.type === 'door' &&
          e.by === player &&
          e.door === step.doorIndex &&
          (e.result === 'unlocked' || e.result === 'opened'),
      );
  }
}

/** Whether c has the item: in a gun slot, worn, or in pockets, rig or backpack. */
function carries(c: Character, item: string): boolean {
  const g = c.gear;
  for (const s of [
    g.primary1,
    g.primary2,
    g.sidearm,
    g.knife,
    g.helmet,
    g.bodyArmor,
    g.rig,
    g.backpack,
  ])
    if (s?.item === item) return true;
  for (let i = 0; i < CARRIED_GRIDS; i++) {
    const grid = carriedGrid(g, i);
    if (grid && countOf(grid, item) > 0) return true;
  }
  return false;
}

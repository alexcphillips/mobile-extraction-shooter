import type { Character, CompiledMap, InventoryAction, ItemDb, Owner, SimState } from '@mes/shared';
import { createRoot, type Root } from 'react-dom/client';
import { InventoryController } from './inventory-controller';
import { RaidScreen } from './raid-screen';

/** What the raid screen needs from the game. It reads the live state and never changes it. */
export interface RaidContext {
  sim: SimState;
  player: Character;
  items: ItemDb;
  /** For the map tab. */
  map: CompiledMap;
  /** Queues an inventory action for the next tick. */
  send: (action: InventoryAction) => void;
  /** A body's or container's name (or the ground's). */
  nameOf: (owner: Owner) => string;
  close: () => void;
}

export interface RaidScreenHandle {
  /** Redraws from the state: after a tick that changed the inventory, or what's in reach. */
  refresh: () => void;
  /** Opens a body or container beside your inventory (null: just yours). */
  setTarget: (target: Owner | null) => void;
  hide: () => void;
}

let root: Root | null = null;

/**
 * Opens the in-raid screen over the game, which keeps running: you stand still while
 * you're in it, and can be shot. Loaded on first use, like the settings screen, so React
 * isn't in the startup bundle.
 */
export function openRaidScreen(
  container: HTMLElement,
  ctx: RaidContext,
  target: Owner | null,
): RaidScreenHandle {
  root ??= createRoot(container);
  const r = root;
  let version = 0;
  const render = (): void => {
    version++;
    r.render(<RaidScreen inv={inv} version={version} />);
  };
  const inv = new InventoryController(ctx, target, render);
  container.hidden = false;
  render();
  return {
    refresh: render,
    setTarget: (t) => {
      inv.target = t;
      inv.select(null);
    },
    hide: () => {
      inv.drag.cancel();
      r.render(null);
      container.hidden = true;
    },
  };
}

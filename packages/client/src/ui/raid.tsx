import type {
  Character,
  CompiledMap,
  InventoryAction,
  ItemDb,
  ItemRef,
  MedRef,
  Owner,
  Profile,
  QuestDef,
  SimState,
} from '@mes/shared';
import { createRoot, type Root } from 'react-dom/client';
import { InventoryController } from './inventory-controller';
import { RaidScreen } from './raid-screen';

/**
 * What the inventory needs: the state to draw (it never changes it) and where to send
 * actions. The raid's, or the stash's between raids.
 */
export interface InventoryContext {
  sim: SimState;
  player: Character;
  items: ItemDb;
  /** Queues an inventory action for the next tick (in the stash, applies it). */
  send: (action: InventoryAction) => void;
  /** A body's or container's name (or the ground's). */
  nameOf: (owner: Owner) => string;
  close: () => void;
  /** Between raids: the stash is open, and nothing can be dropped on the ground. */
  stash?: boolean;
  /** Between raids: sells items to the vendors (session 13b); resolves when done or refused. */
  sell?: (refs: ItemRef[]) => Promise<void>;
  /** In a raid: starts using a carried med, or stops the med or repair being used. */
  use?: (use: MedRef | 'cancel') => void;
}

/** What the raid screen needs from the game. */
export interface RaidContext extends InventoryContext {
  /** For the map tab. */
  map: CompiledMap;
  /** For the quests tab: the profile as the raid started, and every quest. */
  profile: Profile;
  quests: readonly QuestDef[];
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
    r.render(<RaidScreen inv={inv} version={version} ctx={ctx} />);
  };
  const inv = new InventoryController(ctx, target, render);
  container.hidden = false;
  render();
  return {
    refresh: render,
    setTarget: (t) => inv.setTarget(t),
    hide: () => {
      inv.drag.cancel();
      r.render(null);
      container.hidden = true;
    },
  };
}

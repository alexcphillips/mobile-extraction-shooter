import type { AdminCheats } from '@mes/shared';

/*
 * Admin cheats for testing (2026-10-30, the user's call), set on the admin page and kept
 * on this device. Dev builds only: a production build never reads or sends them, and the
 * server only honours keeping your gear on the dev server.
 */

export interface Cheats extends AdminCheats {
  /** Dying or going missing keeps everything, as if you'd extracted. */
  keepGear: boolean;
  /** A health bar over every living enemy, through walls. */
  enemyHealth: boolean;
}

const KEY = 'mes.adminCheats';

const OFF: Cheats = {
  infiniteHealth: false,
  infiniteAmmo: false,
  peaceful: false,
  infiniteConsumables: false,
  keepGear: false,
  enemyHealth: false,
};

/** The ones the simulation applies to the player (Character.admin), if any is on. */
export function simCheats(c: Cheats): AdminCheats | null {
  const sim: AdminCheats = {
    infiniteHealth: c.infiniteHealth,
    infiniteAmmo: c.infiniteAmmo,
    peaceful: c.peaceful,
    infiniteConsumables: c.infiniteConsumables,
  };
  return Object.values(sim).some(Boolean) ? sim : null;
}

/** Sets the player's simulation cheats from these, or clears them if none is on. */
export function applySimCheats(player: { admin?: AdminCheats }, c: Cheats): void {
  const sim = simCheats(c);
  if (sim) player.admin = sim;
  else delete player.admin;
}

/** The cheats on now; all off outside dev builds. */
export function readCheats(): Cheats {
  if (!import.meta.env.DEV) return { ...OFF };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Cheats>;
    return {
      infiniteHealth: saved.infiniteHealth === true,
      infiniteAmmo: saved.infiniteAmmo === true,
      peaceful: saved.peaceful === true,
      infiniteConsumables: saved.infiniteConsumables === true,
      keepGear: saved.keepGear === true,
      enemyHealth: saved.enemyHealth === true,
    };
  } catch {
    return { ...OFF };
  }
}

export function saveCheats(c: Cheats): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Private mode or full storage: the toggle shows on, but the next raid won't see it.
  }
}

/** Whether any cheat is on, for a reminder in the menu and the raid. */
export function anyCheat(c: Cheats): boolean {
  return Object.values(c).some(Boolean);
}

/*
 * Zombies cheats (2026-11-04, the user's call), on the admin page's Zombies tab and kept on
 * this device like the others: infinite points, every kill dropping a power-up, and guns to
 * start every zombies game with.
 * The in-game admin panel (play/zombies-admin.ts) does the rest mid-game.
 */

export interface ZombieCheats {
  /** Buying costs no points. */
  infinitePoints: boolean;
  /** Every zombie you kill drops a power-up, past the round's cap. */
  alwaysDrop: boolean;
  /** Weapon item ids put in your hands when a zombies game starts, in this order. */
  guns: string[];
}

const ZOMBIES_KEY = 'mes.zombiesCheats';

/** The zombies cheats on now; all off outside dev builds. */
export function readZombieCheats(): ZombieCheats {
  if (!import.meta.env.DEV) return { infinitePoints: false, alwaysDrop: false, guns: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(ZOMBIES_KEY) ?? '{}') as Partial<ZombieCheats>;
    return {
      infinitePoints: saved.infinitePoints === true,
      alwaysDrop: saved.alwaysDrop === true,
      guns: Array.isArray(saved.guns) ? saved.guns.filter((g) => typeof g === 'string') : [],
    };
  } catch {
    return { infinitePoints: false, alwaysDrop: false, guns: [] };
  }
}

export function saveZombieCheats(c: ZombieCheats): void {
  try {
    localStorage.setItem(ZOMBIES_KEY, JSON.stringify(c));
  } catch {
    // As saveCheats.
  }
}

/** Sets the player's infinite points and always-drop from these, beside whatever else is on. */
export function applyZombieCheats(player: { admin?: AdminCheats }, c: ZombieCheats): void {
  for (const key of ['infinitePoints', 'alwaysDrop'] as const) {
    if (c[key]) {
      player.admin ??= {
        infiniteHealth: false,
        infiniteAmmo: false,
        peaceful: false,
        infiniteConsumables: false,
      };
      player.admin[key] = true;
    } else if (player.admin) delete player.admin[key];
  }
}

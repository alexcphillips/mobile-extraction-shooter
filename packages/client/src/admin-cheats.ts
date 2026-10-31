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

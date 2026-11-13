/*
 * The raid and game mode last picked in the main menu, remembered on this phone. Kept apart from the
 * menu so main.ts can read it without loading the menu's code.
 */

const RAID_KEY = 'mes.raid';

export function lastRaid(): string | null {
  try {
    return localStorage.getItem(RAID_KEY);
  } catch {
    return null;
  }
}

export function rememberRaid(id: string): void {
  try {
    localStorage.setItem(RAID_KEY, id);
  } catch {
    // Private mode or full storage: the menu starts on the first raid next time.
  }
}

const MODE_KEY = 'mes.mode';

/** The main menu's game modes (2026-11-04); extraction is the only one for now. */
export type GameMode = 'extraction';

export function lastMode(): GameMode {
  return 'extraction';
}

export function rememberMode(mode: GameMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // As above: the menu opens on extraction next time.
  }
}

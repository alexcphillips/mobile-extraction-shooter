/*
 * The raid last picked in the main menu, remembered on this phone. Kept apart from the
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

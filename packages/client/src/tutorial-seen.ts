/*
 * Whether this device has been through the tutorial, finished or skipped (TU-3,
 * 2026-11-09). Kept on the device, not the account: the tutorial runs before signing in.
 * A first launch with no account and no flag goes into it; signing in sets it, so a player
 * with an account never gets it unasked.
 */

const KEY = 'mes.tutorialSeen';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Blocked storage: don't trap the player in the tutorial on every launch.
    return true;
  }
}

export function setTutorialSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // As above.
  }
}

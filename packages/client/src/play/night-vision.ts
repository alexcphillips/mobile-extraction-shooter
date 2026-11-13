/*
 * Whether the player has night vision switched on (GZ-5): the client's alone, as the sim
 * doesn't care. N on a keyboard toggles it (input/controls.ts), and so does the button in
 * a helmet's details (touch and pads have no button free: PC controller → Button budget).
 * It shows only while goggles are fitted to the helmet worn.
 */
let on = false;

export const nightVisionOn = (): boolean => on;

export function toggleNightVision(): void {
  on = !on;
}

/** Off again, for a new raid. */
export function resetNightVision(): void {
  on = false;
}

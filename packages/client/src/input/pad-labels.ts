import type { Settings } from '@mes/shared';

/** A controller's face buttons, as prompts and hints name them (CP-1), drawn round and coloured. */
export const PAD_GLYPHS = '□✕○△';

/** One input on the pad, and what it does in a raid and in menus ('' for nothing). */
export interface PadRow {
  /** Button names as drawn: face buttons as glyphs, others as their print (L1, D-pad ↑). */
  keys: readonly string[];
  raid: string;
  menus: string;
}

/**
 * The controller layout (roadmap.md → PC controller), worded for your settings: the
 * settings' controller page draws it (CP-3, 2026-11-08). Keep it in step with
 * input/pad-driver.ts and input/pad-cursor.ts.
 */
export function padLayout(s: Pick<Settings, 'aim' | 'crouch' | 'lean'>): PadRow[] {
  return [
    { keys: ['Left stick'], raid: 'Move (a small push walks)', menus: 'Move the cursor' },
    { keys: ['Right stick'], raid: 'Look', menus: 'Scroll' },
    { keys: ['R2'], raid: 'Fire', menus: '' },
    {
      keys: ['L2'],
      raid: s.aim === 'toggle' ? 'Aim (press again to stop)' : 'Aim while held',
      menus: '',
    },
    { keys: ['L3'], raid: 'Sprint (until you stop pushing forwards)', menus: '' },
    { keys: ['R3'], raid: 'Knife', menus: '' },
    { keys: ['✕'], raid: 'Jump, vault, get up from prone', menus: 'Click; hold and move to drag' },
    {
      keys: ['○'],
      raid:
        s.crouch === 'hold'
          ? 'Crouch while held; double-tap: prone'
          : 'Crouch (press again to stand); held: prone',
      menus: 'Back, close',
    },
    {
      keys: ['□'],
      raid: 'Use when a prompt shows, else reload; held: keep using',
      menus: 'Quick move (as a double-tap)',
    },
    {
      keys: ['△'],
      raid: 'Other primary; held: sidearm',
      menus: 'Details; while dragging: rotate',
    },
    { keys: ['R1'], raid: 'Grenade; hold to pick one, let go to throw', menus: 'Next tab or page' },
    { keys: ['L1'], raid: 'Heal; hold to pick one, let go to use', menus: 'Previous tab or page' },
    {
      keys: ['D-pad ←', 'D-pad →'],
      raid: s.lean === 'toggle' ? 'Lean (press again to straighten)' : 'Lean while held',
      menus: 'Step the cursor',
    },
    { keys: ['D-pad ↑'], raid: 'Detonate C4', menus: 'Step the cursor' },
    { keys: ['D-pad ↓'], raid: 'Put out fire', menus: 'Step the cursor' },
    { keys: ['Options'], raid: 'Settings', menus: 'Close the screen' },
    { keys: ['Touchpad'], raid: 'Bag', menus: 'Close the bag' },
  ];
}

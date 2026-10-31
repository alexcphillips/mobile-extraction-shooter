/**
 * The sounds the game plays itself (session 19), by what they're for, each a file in
 * content/sounds. Items name their own (a gun's shot, a med's use). Loading content checks
 * every one is there.
 */
export const GAME_SOUNDS = {
  /** A bullet or a knife hitting the map. */
  impactWorld: 'impact-world',
  /** Hitting a body. */
  impactFlesh: 'impact-flesh',
  /** Armour taking some of a hit. */
  impactArmour: 'impact-armour',
  /** An enemy's bullet passing close by. */
  whizz: 'bullet-whizz',
  footstep: 'footstep',
  /** Landing from a jump or a fall. */
  land: 'land',
  ladder: 'ladder-step',
  doorOpen: 'door-open',
  doorClose: 'door-close',
  /** Trying a locked door. */
  doorLocked: 'door-locked',
  doorUnlock: 'door-unlock',
  /** An enemy falling dead. */
  bodyFall: 'body-fall',
  /** The player hurt, and killed. */
  hurt: 'hurt',
  death: 'death',
  /** Taking out what's in your hands. */
  draw: 'draw',
  /** Your hit landed, and killed. */
  hitMarker: 'hit-marker',
  killMarker: 'kill-marker',
  /** Each second of the extraction countdown, and getting out. */
  extractTick: 'extract-tick',
  extracted: 'extracted',
  investigate: 'investigate',
  /** Someone catching fire (2026-10-31). */
  ignite: 'ignite',
  /** The raid timer going under two minutes. */
  timerWarning: 'timer-warning',
  /** Moving an item in the inventory, and an action that can't be done. */
  itemMove: 'item-move',
  refuse: 'ui-refuse',
  /** A menu button, and money changing hands (buying, selling, quest rewards). */
  tap: 'ui-tap',
  cash: 'ui-cash',
} as const;

export type GameSound = keyof typeof GAME_SOUNDS;

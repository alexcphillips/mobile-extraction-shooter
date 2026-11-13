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
  /** Armor taking some of a hit. */
  impactArmor: 'impact-armor',
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
  /** Jug kicking a door in (AI-8). */
  doorKick: 'door-kick',
  /** A pane of glass breaking (2026-11-02): softened, not a shriek. */
  glassBreak: 'glass-break',
  /** An enemy falling dead. */
  bodyFall: 'body-fall',
  /** The player hurt, and killed. */
  hurt: 'hurt',
  death: 'death',
  /** A blacked stomach's cough and groan (GZ-3), yours or anyone's. */
  pain: 'pain-groan',
  /** Your own breathing when badly hurt (PS-1): heard only by you. */
  heavyBreath: 'heavy-breathe',
  /** Taking out what's in your hands. */
  draw: 'draw',
  /** Each second of the extraction countdown, and getting out. */
  extractTick: 'extract-tick',
  extracted: 'extracted',
  investigate: 'investigate',
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

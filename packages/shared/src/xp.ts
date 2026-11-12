import type { EnemyDef, Faction } from './content/enemies';
import type { RaidOutcome } from './protocol';

/*
 * The PMC level (2026-11-11, the user's call; design → Quests and vendors → PMC level).
 * One XP total per account, in the profile; the level is worked out from it. Quests give
 * the most (`rewards.xp`) and can need a level to show (`minLevel`). Raids give XP for
 * kills (more for a headshot kill) and for each container searched first; getting out
 * multiplies it, a run-through halves it. The server works it out from the counts a raid's
 * result reports, the client the same way for the results screen.
 */

export const XP = {
  /** The highest level. */
  maxLevel: 50,
  /** Level n needs `curve` × n × (n − 1) XP in all: 1,000 for level 2, 45,000 for 10. */
  curve: 500,
  /** A kill to the head is worth this much more. */
  headshotBonus: 0.5,
  /** Each container searched first in a raid. */
  search: 10,
  /** What getting out multiplies a raid's XP by. Dying or going missing keeps the base. */
  extractBonus: 1.3,
  /**
   * A run-through: getting out this soon with less base XP than this. The raid's XP is
   * halved with no extract bonus, and nothing comes out found in raid (Tarkov's rule,
   * scaled down from its 7 minutes and 200 XP for 10–15 minute raids).
   */
  runThrough: { seconds: 240, xp: 150, multiplier: 0.5 },
  /** Containers searched in one raid's result (a sanity limit). */
  maxSearched: 1000,
} as const;

/** A kill's XP by faction, for an enemy type that doesn't set its own. */
export const FACTION_XP: Record<Faction, number> = { scav: 40, pmc: 100, boss: 400 };

/** What killing one of an enemy type is worth. */
export function enemyXp(def: Pick<EnemyDef, 'faction' | 'xp'>): number {
  return def.xp ?? FACTION_XP[def.faction];
}

/** The XP a level needs in all. Level 1 needs none. */
export function xpForLevel(level: number): number {
  return XP.curve * level * (level - 1);
}

/** The level an XP total reaches, 1 to XP.maxLevel. */
export function levelOf(xp: number): number {
  let level = 1;
  while (level < XP.maxLevel && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Where an XP total stands: the level, and how far into it (null at the top level). */
export function levelProgress(xp: number): {
  level: number;
  into: number;
  need: number | null;
} {
  const level = levelOf(xp);
  const from = xpForLevel(level);
  return {
    level,
    into: xp - from,
    need: level >= XP.maxLevel ? null : xpForLevel(level + 1) - from,
  };
}

/** A kill as a raid's result reports it: the enemy type, and whether to the head. */
export interface RaidKillXp {
  enemy: string;
  head?: true;
}

/** A raid's XP, line by line, as the results screen shows it. */
export interface RaidXp {
  kills: number;
  headshots: number;
  searching: number;
  /** The three above. */
  base: number;
  /** extractBonus, 1, or the run-through's multiplier. */
  multiplier: number;
  runThrough: boolean;
  total: number;
}

/** Whether getting out this way is a run-through (see XP.runThrough). */
export function isRunThrough(how: RaidOutcome, seconds: number, base: number): boolean {
  return how === 'extracted' && seconds < XP.runThrough.seconds && base < XP.runThrough.xp;
}

/**
 * Works out a raid's XP. `enemies` gives each kill's enemy type; a type it doesn't know
 * (removed since) is worth nothing.
 */
export function raidXp(
  how: RaidOutcome,
  seconds: number,
  killed: readonly RaidKillXp[],
  searched: number,
  enemies: ReadonlyMap<string, Pick<EnemyDef, 'faction' | 'xp'>>,
): RaidXp {
  let kills = 0;
  let headshots = 0;
  for (const k of killed) {
    const def = enemies.get(k.enemy);
    if (!def) continue;
    const xp = enemyXp(def);
    kills += xp;
    if (k.head) headshots += Math.round(xp * XP.headshotBonus);
  }
  const searching = searched * XP.search;
  const base = kills + headshots + searching;
  const runThrough = isRunThrough(how, seconds, base);
  const multiplier = runThrough
    ? XP.runThrough.multiplier
    : how === 'extracted'
      ? XP.extractBonus
      : 1;
  return {
    kills,
    headshots,
    searching,
    base,
    multiplier,
    runThrough,
    total: Math.round(base * multiplier),
  };
}

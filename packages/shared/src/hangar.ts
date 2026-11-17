import { POWER_GRID, powerNeeded, type HangarModuleDef } from './content/hangar';
import type { ItemDb } from './content/items';
import { settleHangarSpace, type Profile } from './profile';
import { stashCount, takeFromStash } from './stash';

/*
 * The Hangar between raids (session H1; design in docs/hangar.md): upgrading a module a
 * level, paid for with plain items from the stash. Only the server changes a module's
 * level (PUT /api/profile refuses it), as for quests and vendor standing.
 */

/** A module's level in a profile: 0 until it's built. */
export function moduleLevel(profile: Profile, module: string): number {
  return profile.hangar[module] ?? 0;
}

/** For each item of a module's next level, how many the stash has and how many it takes. */
export function upgradeCost(
  profile: Profile,
  module: HangarModuleDef,
): { item: string; have: number; need: number }[] | null {
  const next = module.levels[moduleLevel(profile, module.id)];
  if (!next) return null;
  return next.cost.map((c) => ({
    item: c.item,
    have: stashCount(profile, (i) => i.item === c.item),
    need: c.count,
  }));
}

/** Why a module can't go up a level now, or null if it can. */
export function cantUpgrade(profile: Profile, module: HangarModuleDef): string | null {
  const level = moduleLevel(profile, module.id);
  if (level >= module.levels.length) return `the ${module.name} is at its top level`;
  const power = powerNeeded(module, level + 1);
  if (moduleLevel(profile, POWER_GRID) < power) return `it needs the Power grid at level ${power}`;
  const short = upgradeCost(profile, module)!.find((c) => c.have < c.need);
  if (short) return `there aren't enough "${short.item}" in your stash`;
  return null;
}

/**
 * Upgrades a module a level, taking its cost out of the stash (all or nothing). Instant.
 * What the level gives in stash space (the Stash module's category pages, the Secure locker's
 * vault: H4) comes with it. Returns why it can't, or null.
 */
export function upgradeModule(
  profile: Profile,
  items: ItemDb,
  module: HangarModuleDef,
): string | null {
  const bad = cantUpgrade(profile, module);
  if (bad) return bad;
  const level = moduleLevel(profile, module.id);
  for (const c of module.levels[level]!.cost)
    takeFromStash(profile, (i) => i.item === c.item, c.count);
  profile.hangar[module.id] = level + 1;
  settleHangarSpace(items, profile);
  return null;
}

/** Whether two profiles' Hangars (module levels) are the same: only the server's Hangar routes change them. */
export function sameHangar(a: Profile, b: Profile): boolean {
  const ka = Object.keys(a.hangar).filter((k) => a.hangar[k]);
  const kb = Object.keys(b.hangar).filter((k) => b.hangar[k]);
  return ka.length === kb.length && ka.every((k) => a.hangar[k] === b.hangar[k]);
}

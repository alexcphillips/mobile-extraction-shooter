import { POWER_GRID, powerNeeded, type HangarModuleDef } from './content/hangar';
import type { ItemDb } from './content/items';
import type { RecipeDef } from './content/recipes';
import { settleHangarSpace, type Craft, type Profile } from './profile';
import { addToStash, newStashItem, stashCount, takeFromStash } from './stash';

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
 * What the level gives in stash space (Quarters' category pages, the Secure locker's
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

/** Whether two profiles' Hangars (levels and crafts) are the same: only the server's Hangar routes change them. */
export function sameHangar(a: Profile, b: Profile): boolean {
  const ka = Object.keys(a.hangar).filter((k) => a.hangar[k]);
  const kb = Object.keys(b.hangar).filter((k) => b.hangar[k]);
  if (ka.length !== kb.length || !ka.every((k) => a.hangar[k] === b.hangar[k])) return false;
  const ca = Object.keys(a.crafts);
  return (
    ca.length === Object.keys(b.crafts).length &&
    ca.every((k) => {
      const x = a.crafts[k]!;
      const y = b.crafts[k];
      return (
        !!y &&
        x.recipe === y.recipe &&
        x.item === y.item &&
        x.count === y.count &&
        x.done === y.done
      );
    })
  );
}

/*
 * Crafting (session H2): a module makes one recipe at a time. Starting takes the inputs
 * from the stash (as an upgrade takes its cost) and sets when it's done by the server's
 * clock (`now`, ms), so it runs while the app is closed: nothing ticks, the time is
 * compared when read. Once done, the output waits in the module until collected, so a
 * full stash never loses it.
 */

/** For each input of a recipe, how many the stash has and how many it takes. */
export function recipeCost(
  profile: Profile,
  recipe: RecipeDef,
): { item: string; have: number; need: number }[] {
  return recipe.inputs.map((c) => ({
    item: c.item,
    have: stashCount(profile, (i) => i.item === c.item),
    need: c.count,
  }));
}

/** The craft in a module, running or waiting, or null. */
export function moduleCraft(profile: Profile, module: string): Craft | null {
  return profile.crafts[module] ?? null;
}

/** How long a craft has left at `now`, in ms: 0 once it's done. */
export function craftLeft(craft: Craft, now: number): number {
  return Math.max(0, craft.done - now);
}

/** Why a module can't start a recipe now, or null if it can. */
export function cantCraft(
  profile: Profile,
  module: HangarModuleDef,
  recipe: RecipeDef,
): string | null {
  if (recipe.module !== module.id) return `the ${module.name} doesn't make that`;
  if (moduleLevel(profile, module.id) < recipe.level)
    return `it needs the ${module.name} at level ${recipe.level}`;
  if (moduleCraft(profile, module.id)) return `the ${module.name} is already making something`;
  const short = recipeCost(profile, recipe).find((c) => c.have < c.need);
  if (short) return `there aren't enough "${short.item}" in your stash`;
  return null;
}

/** How long a recipe takes, in ms. */
export function craftDuration(recipe: RecipeDef): number {
  return Math.round(recipe.minutes * 60_000);
}

/**
 * Starts a recipe in its module at `now` (ms, the server's clock), taking its inputs out
 * of the stash (all or nothing). Returns why it can't, or null.
 */
export function startCraft(
  profile: Profile,
  module: HangarModuleDef,
  recipe: RecipeDef,
  now: number,
): string | null {
  const bad = cantCraft(profile, module, recipe);
  if (bad) return bad;
  for (const c of recipe.inputs) takeFromStash(profile, (i) => i.item === c.item, c.count);
  const { item, count = 1 } = recipe.output;
  profile.crafts[module.id] = { recipe: recipe.id, item, count, done: now + craftDuration(recipe) };
  return null;
}

/**
 * Collects a module's finished craft at `now` into the stash, page `page` first. If it
 * isn't done, or the stash has no room, it stays in the module. Returns why it can't, or null.
 */
export function collectCraft(
  profile: Profile,
  items: ItemDb,
  module: HangarModuleDef,
  now: number,
  page = 0,
): string | null {
  const craft = moduleCraft(profile, module.id);
  if (!craft) return `the ${module.name} has nothing to collect`;
  if (craftLeft(craft, now) > 0) return `the ${module.name} hasn't finished yet`;
  if (!items.has(craft.item)) return `"${craft.item}" no longer exists`;
  if (!addToStash(profile, items, [{ item: craft.item, count: craft.count }], page, newStashItem))
    return 'there is no room in your stash for it';
  delete profile.crafts[module.id];
  return null;
}

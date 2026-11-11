import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { stackSize, type ItemDb } from './items';
import type { HangarModuleDef } from './hangar';
import { idSchema } from './schema';

/*
 * The Hangar's crafting recipes (content/recipes/<id>.json, session H2; design in
 * docs/hangar.md). A recipe belongs to one module and needs it at a level; it takes its
 * inputs from the stash when the craft starts (as an upgrade does) and, after `minutes`
 * of the server's clock, its output waits in the module until collected. One craft at a
 * time per module. No recipe makes money (hangar.md → Rules). Blueprints are deferred.
 *
 * A recipe makes a fixed `output`, or rolls one of its weighted `results` when it starts
 * (H5: the Intel desk's decryptions): an item stack, or reputation with a vendor. The roll
 * is kept in the craft and shown only once collected; rolling at the start means a full
 * stash can't be used to reroll at collect.
 */

export const RECIPE_FORMAT_VERSION = 1;

/** The longest a craft can take: about 8 hours (hangar.md). */
export const MAX_CRAFT_MINUTES = 8 * 60;

const stackSchema = z.strictObject({
  item: idSchema,
  count: z.int().min(1),
});

const resultSchema = z.union([
  z.strictObject({
    weight: z.number().positive(),
    item: idSchema,
    count: z.int().min(1).optional(),
  }),
  z.strictObject({
    weight: z.number().positive(),
    /** A vendor's id, and the reputation it gives with them. */
    vendor: idSchema,
    rep: z.number().positive(),
  }),
]);

export const recipeSchema = z.strictObject({
  formatVersion: z.literal(RECIPE_FORMAT_VERSION),
  id: idSchema,
  /** Its name on the Hangar page, e.g. "Decrypt a flash drive"; the output's name if left out. */
  name: z.string().min(1).optional(),
  /** The module that makes it. */
  module: idSchema,
  /** The module level it needs, 1 up. */
  level: z.int().min(1),
  /** What it takes from the stash, each a different item. */
  inputs: z.array(stackSchema).min(1),
  /** What it makes: one stack, no more than a stack's size. Or `results` instead. */
  output: z.strictObject({ item: idSchema, count: z.int().min(1).optional() }).optional(),
  /** What it may make, one rolled by weight when it starts (H5). Or `output` instead. */
  results: z.array(resultSchema).min(1).optional(),
  /** How long it takes, in real minutes (before the module's `craftTime`). */
  minutes: z.number().positive().max(MAX_CRAFT_MINUTES),
  /** Where it comes in the module's list, lowest first; 0 if left out. */
  order: z.int().optional(),
});

export type RecipeDef = z.infer<typeof recipeSchema>;

/** One thing a recipe may make: an item stack, or reputation with a vendor. */
export type RecipeResult =
  | { weight: number; item: string; count: number; vendor?: undefined; rep?: undefined }
  | { weight: number; vendor: string; rep: number; item?: undefined; count?: undefined };

/** What a recipe may make, by weight: its `output` as the one result, or its `results`. */
export function recipeResults(r: RecipeDef): RecipeResult[] {
  if (r.output) return [{ weight: 1, item: r.output.item, count: r.output.count ?? 1 }];
  return (r.results ?? []).map((x) =>
    'vendor' in x
      ? { weight: x.weight, vendor: x.vendor, rep: x.rep }
      : { weight: x.weight, item: x.item, count: x.count ?? 1 },
  );
}

/** Whether a recipe rolls what it makes (more than one result). */
export function rollsResult(r: RecipeDef): boolean {
  return recipeResults(r).length > 1;
}

/** A result rolled by weight, `random` in [0, 1). */
export function rollResult(r: RecipeDef, random: number): RecipeResult {
  const all = recipeResults(r);
  let left = random * all.reduce((n, x) => n + x.weight, 0);
  for (const x of all) {
    left -= x.weight;
    if (left < 0) return x;
  }
  return all[all.length - 1]!;
}

export const RECIPE_FORMAT: ContentFormat<RecipeDef> = {
  kind: 'recipe',
  version: RECIPE_FORMAT_VERSION,
  schema: recipeSchema,
  migrations: {},
};

/**
 * Checks that every recipe's module exists and has its level, that its inputs are real
 * items (not quest items) listed once each, that it has an `output` or `results` (not
 * both), that each item it makes is a real item, not a quest item or money, that fits in
 * one stack, and that each vendor it gives reputation with exists (when `vendors` is given).
 */
export function checkRecipes(
  recipes: ReadonlyMap<string, RecipeDef>,
  modules: ReadonlyMap<string, HangarModuleDef>,
  items: ItemDb,
  vendors?: ReadonlyMap<string, unknown>,
): void {
  for (const r of recipes.values()) {
    const source = `content/recipes/${r.id}.json`;
    const module = modules.get(r.module);
    if (!module) throw new ContentError(source, `no Hangar module "${r.module}"`);
    if (r.level > module.levels.length)
      throw new ContentError(source, `the ${module.name} has no level ${r.level}`);
    const seen = new Set<string>();
    for (const c of r.inputs) {
      const def = items.get(c.item);
      if (!def) throw new ContentError(source, `no item "${c.item}"`);
      if (def.type === 'quest') throw new ContentError(source, `"${c.item}" is a quest item`);
      if (seen.has(c.item)) throw new ContentError(source, `"${c.item}" is listed twice`);
      seen.add(c.item);
    }
    if (!r.output === !r.results)
      throw new ContentError(source, 'needs an output or results, not both');
    for (const x of recipeResults(r)) {
      if (x.vendor !== undefined) {
        if (vendors && !vendors.has(x.vendor))
          throw new ContentError(source, `no vendor "${x.vendor}"`);
        continue;
      }
      const out = items.get(x.item);
      if (!out) throw new ContentError(source, `no item "${x.item}"`);
      if (out.type === 'quest') throw new ContentError(source, 'makes a quest item');
      if (out.type === 'loot' && out.money) throw new ContentError(source, 'makes money');
      if (x.count > stackSize(out))
        throw new ContentError(source, `makes more "${x.item}" than a stack`);
    }
  }
}

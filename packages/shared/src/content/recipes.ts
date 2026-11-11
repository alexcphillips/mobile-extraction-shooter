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
 */

export const RECIPE_FORMAT_VERSION = 1;

/** The longest a craft can take: about 8 hours (hangar.md). */
export const MAX_CRAFT_MINUTES = 8 * 60;

const stackSchema = z.strictObject({
  item: idSchema,
  count: z.int().min(1),
});

export const recipeSchema = z.strictObject({
  formatVersion: z.literal(RECIPE_FORMAT_VERSION),
  id: idSchema,
  /** The module that makes it. */
  module: idSchema,
  /** The module level it needs, 1 up. */
  level: z.int().min(1),
  /** What it takes from the stash, each a different item. */
  inputs: z.array(stackSchema).min(1),
  /** What it makes: one stack, no more than a stack's size. */
  output: z.strictObject({ item: idSchema, count: z.int().min(1).optional() }),
  /** How long it takes, in real minutes. */
  minutes: z.number().positive().max(MAX_CRAFT_MINUTES),
  /** Where it comes in the module's list, lowest first; 0 if left out. */
  order: z.int().optional(),
});

export type RecipeDef = z.infer<typeof recipeSchema>;

export const RECIPE_FORMAT: ContentFormat<RecipeDef> = {
  kind: 'recipe',
  version: RECIPE_FORMAT_VERSION,
  schema: recipeSchema,
  migrations: {},
};

/**
 * Checks that every recipe's module exists and has its level, that its inputs are real
 * items (not quest items) listed once each, and that its output is a real item, not a quest
 * item or money, that fits in one stack.
 */
export function checkRecipes(
  recipes: ReadonlyMap<string, RecipeDef>,
  modules: ReadonlyMap<string, HangarModuleDef>,
  items: ItemDb,
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
    const out = items.get(r.output.item);
    if (!out) throw new ContentError(source, `no item "${r.output.item}"`);
    if (out.type === 'quest') throw new ContentError(source, 'makes a quest item');
    if (out.type === 'loot' && out.money) throw new ContentError(source, 'makes money');
    if ((r.output.count ?? 1) > stackSize(out))
      throw new ContentError(source, `makes more "${r.output.item}" than a stack`);
  }
}

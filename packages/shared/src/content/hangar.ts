import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import type { ItemDb } from './items';
import { idSchema } from './schema';

/*
 * The Hangar's modules (content/hangar/<id>.json, session H1; design in docs/hangar.md).
 * A module starts unbuilt (level 0); each entry in `levels` is the next level up: what it
 * costs (items from the stash, taken as quest hand-overs take them), the Power grid level
 * it needs, and a line on what it unlocks. Upgrades are instant. The Power grid's level
 * caps every other module's: a level needs the grid at that level unless it says otherwise.
 * Costs are placeholders (one bandage each) until the user sets them (2026-11-10).
 */

export const HANGAR_FORMAT_VERSION = 1;

/** The module whose level the others need. */
export const POWER_GRID = 'power-grid';

/** The most levels a module has. */
export const MODULE_LEVELS = 3;

const costSchema = z.strictObject({
  item: idSchema,
  count: z.int().min(1),
});

const moduleLevelSchema = z.strictObject({
  /** The items it takes, each a different item. */
  cost: z.array(costSchema).min(1),
  /** The Power grid level it needs; the level being reached if left out. Not on the grid's own levels. */
  power: z.int().min(0).max(MODULE_LEVELS).optional(),
  /** What reaching it unlocks, in a line for the module's card. */
  unlocks: z.string().min(1),
  /** From this level on, the module's crafts take this share of their minutes (H5: the Intel desk's faster decryption). */
  craftTime: z.number().positive().max(1).optional(),
});

export const hangarModuleSchema = z.strictObject({
  formatVersion: z.literal(HANGAR_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** What the module does, in a line under its name. */
  blurb: z.string().min(1),
  /** Where it comes on the Hangar page, lowest first; 0 if left out. */
  order: z.int().optional(),
  /** Levels 1 up, in order. */
  levels: z.array(moduleLevelSchema).min(1).max(MODULE_LEVELS),
});

export type HangarModuleDef = z.infer<typeof hangarModuleSchema>;
export type HangarModuleLevel = z.infer<typeof moduleLevelSchema>;

export const HANGAR_FORMAT: ContentFormat<HangarModuleDef> = {
  kind: 'hangar module',
  version: HANGAR_FORMAT_VERSION,
  schema: hangarModuleSchema,
  migrations: {},
};

/** The Power grid level a module's level `level` (1 up) needs. */
export function powerNeeded(module: HangarModuleDef, level: number): number {
  if (module.id === POWER_GRID) return 0;
  return module.levels[level - 1]?.power ?? level;
}

/** The share of a recipe's minutes a module's crafts take at `level`: the last `craftTime` up to it, else 1. */
export function craftTimeAt(module: HangarModuleDef, level: number): number {
  let share = 1;
  for (const l of module.levels.slice(0, level)) share = l.craftTime ?? share;
  return share;
}

/**
 * Checks that the Power grid exists, that every cost names a real item (not a quest item)
 * once per level, and that no level needs more power than the grid has.
 */
export function checkHangar(modules: ReadonlyMap<string, HangarModuleDef>, items: ItemDb): void {
  const grid = modules.get(POWER_GRID);
  if (!grid)
    throw new ContentError(`content/hangar/${POWER_GRID}.json`, 'the Power grid is missing');
  for (const m of modules.values()) {
    const source = `content/hangar/${m.id}.json`;
    m.levels.forEach((l, i) => {
      if (m.id === POWER_GRID && l.power !== undefined)
        throw new ContentError(source, "the Power grid's levels can't need power");
      if (powerNeeded(m, i + 1) > grid.levels.length)
        throw new ContentError(source, `level ${i + 1} needs more power than the grid has`);
      const seen = new Set<string>();
      for (const c of l.cost) {
        if (!items.has(c.item)) throw new ContentError(source, `no item "${c.item}"`);
        if (seen.has(c.item)) throw new ContentError(source, `"${c.item}" is listed twice`);
        seen.add(c.item);
        if (items.get(c.item)!.type === 'quest')
          throw new ContentError(source, `"${c.item}" is a quest item`);
      }
    });
  }
}

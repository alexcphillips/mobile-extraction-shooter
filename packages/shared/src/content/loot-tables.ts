import { z } from 'zod';
import type { EnemyDef } from './enemies';
import { ContentError, type ContentFormat } from './format';
import { itemDef, stackSize, type ItemDb } from './items';
import { idSchema } from './schema';

/*
 * Loot tables (content/loot-tables/<id>.json), from session 11: what a container or an
 * enemy's pockets can hold, as items picked by weight. Everything is rolled once when the
 * raid starts, with the raid's RNG. A lootContainer marker names a table and rolls it its
 * table's `rolls` times; an enemy type names several tables with weights (see enemies.ts),
 * which its spawn's lootWeights multiply.
 */

export const LOOT_TABLE_FORMAT_VERSION = 1;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const count = z.int().min(0);
/** [min, max], inclusive. */
export const countRange = z
  .tuple([count, count])
  .refine(([min, max]) => min <= max, 'min must not be above max');

const entrySchema = z.strictObject({
  item: idSchema,
  weight: positive,
  /** How many, rolled between these: only for items that stack. Defaults to [1, 1]. */
  count: countRange.optional(),
});

export const lootTableSchema = z.strictObject({
  formatVersion: z.literal(LOOT_TABLE_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** How many items a container with this table gets, rolled between these. */
  rolls: countRange,
  items: z.array(entrySchema).min(1),
});

export type LootTableDef = z.infer<typeof lootTableSchema>;
export type LootEntry = z.infer<typeof entrySchema>;

export const LOOT_TABLE_FORMAT: ContentFormat<LootTableDef> = {
  kind: 'loot table',
  version: LOOT_TABLE_FORMAT_VERSION,
  schema: lootTableSchema,
  migrations: {},
};

/** Checks that every table's items exist, and only stacking items have a count. */
export function checkLootTables(tables: ReadonlyMap<string, LootTableDef>, items: ItemDb): void {
  for (const t of tables.values()) {
    const source = `content/loot-tables/${t.id}.json`;
    for (const e of t.items) {
      if (!items.has(e.item)) throw new ContentError(source, `no item "${e.item}"`);
      const max = stackSize(itemDef(items, e.item));
      if (e.count && e.count[1] > max)
        throw new ContentError(source, `${e.item}: count above its stack of ${max}`);
    }
  }
}

/** Checks that every enemy type's loot names tables that exist. */
export function checkEnemyLoot(
  enemies: ReadonlyMap<string, EnemyDef>,
  tables: ReadonlyMap<string, LootTableDef>,
): void {
  for (const e of enemies.values()) {
    for (const id of Object.keys(e.loot?.tables ?? {})) {
      if (!tables.has(id))
        throw new ContentError(`content/enemies/${e.id}.json`, `no loot table "${id}"`);
    }
  }
}

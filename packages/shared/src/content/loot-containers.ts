import { z } from 'zod';
import type { ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Loot containers (content/loot-containers/<id>.json), from session 10: the kinds of desk,
 * cabinet or crate a map's lootContainer markers place. Not items: they stay where they
 * are, and their grid takes rigs and backpacks. What's in them is rolled from the
 * marker's loot table (session 11).
 */

export const LOOT_CONTAINER_FORMAT_VERSION = 1;

const cells = z.int().min(1);

export const lootContainerSchema = z.strictObject({
  formatVersion: z.literal(LOOT_CONTAINER_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** The size inside, [width, height] in cells. */
  grid: z.tuple([cells, cells]),
});

export type LootContainerDef = z.infer<typeof lootContainerSchema>;

export const LOOT_CONTAINER_FORMAT: ContentFormat<LootContainerDef> = {
  kind: 'loot container',
  version: LOOT_CONTAINER_FORMAT_VERSION,
  schema: lootContainerSchema,
  migrations: {},
};

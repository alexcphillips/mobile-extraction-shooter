import { z } from 'zod';
import type { ContentFormat } from './format';
import { idSchema, lootMixSchema } from './schema';

/*
 * Loot containers (content/loot-containers/<id>.json), from session 10: the kinds of desk,
 * cabinet or crate a map's lootContainer markers place. Not items: they stay where they
 * are, and their grid takes rigs and backpacks. What's in them is rolled from the
 * container's own loot (a mix or a table), else its kind's (sim/loot-roll.ts). Made and
 * edited in the loot editor (2026-11-02).
 */

export const LOOT_CONTAINER_FORMAT_VERSION = 1;

const cells = z.int().min(1);

export const lootContainerSchema = z.strictObject({
  formatVersion: z.literal(LOOT_CONTAINER_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** The size inside, [width, height] in cells. */
  grid: z.tuple([cells, cells]),
  /** What one is filled from when it names no loot of its own. */
  loot: lootMixSchema.optional(),
});

export type LootContainerDef = z.infer<typeof lootContainerSchema>;

export const LOOT_CONTAINER_FORMAT: ContentFormat<LootContainerDef> = {
  kind: 'loot container',
  version: LOOT_CONTAINER_FORMAT_VERSION,
  schema: lootContainerSchema,
  migrations: {},
};

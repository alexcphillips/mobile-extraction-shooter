import { z } from 'zod';
import type { ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Raid configs (content/raids/<id>.json), from session 11: a map and the rules for one
 * raid. Normal raids and future weekly challenges use the same format, which will grow
 * a playable area, starting loadout rules, objectives and which extractions are open.
 * For now every player spawn and every extraction point in the map is used.
 */

export const RAID_FORMAT_VERSION = 1;

export const raidSchema = z.strictObject({
  formatVersion: z.literal(RAID_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** A map id in content/maps. */
  map: idSchema,
  /** The raid timer in seconds; you're missing in action when it runs out. */
  duration: z
    .number()
    .refine((n) => Number.isFinite(n) && n > 0, 'must be greater than 0')
    .default(15 * 60),
});

export type RaidDef = z.infer<typeof raidSchema>;

export const RAID_FORMAT: ContentFormat<RaidDef> = {
  kind: 'raid',
  version: RAID_FORMAT_VERSION,
  schema: raidSchema,
  migrations: {},
};

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
  /**
   * Played offline, never on the server (TU-2, 2026-11-09: the tutorial): not in the raid
   * list, the server won't start it, and its map isn't counted where items come from.
   * An optional field, so still format 1.
   */
  offline: z.literal(true).optional(),
  /**
   * A map still being built (DS-2, 2026-11-12: District): in the raid list of dev builds
   * only, tagged "test", and not somewhere items come from. The user says when it's listed.
   * An optional field, so still format 1.
   */
  dev: z.literal(true).optional(),
  /**
   * Where it sits in the map list, lowest first (MT-2, 2026-11-09: Silver Creek, the starter
   * map, first); left out, after those that have one. An optional field, so still format 1.
   */
  order: z.int().optional(),
  /** Short tags shown on its entry in the map list, such as "starter" (MT-2). */
  tags: z.array(z.string().min(1).max(12)).optional(),
  /**
   * The PMC level it unlocks at (2026-11-11: Northpoint at 2); left out, open from the
   * start. The menu grays it out until then. An optional field, so still format 1.
   */
  minLevel: z.int().min(2).optional(),
  /**
   * Where its marker sits on the deploy screen's region map, in the map's 0–1000 × 0–600
   * frame (2026-11-11). Left out, it isn't on the region map. Still format 1.
   */
  region: z
    .strictObject({ x: z.number().min(0).max(1000), y: z.number().min(0).max(600) })
    .optional(),
});

export type RaidDef = z.infer<typeof raidSchema>;

export const RAID_FORMAT: ContentFormat<RaidDef> = {
  kind: 'raid',
  version: RAID_FORMAT_VERSION,
  schema: raidSchema,
  migrations: {},
};

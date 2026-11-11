import { z } from 'zod';
import type { ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Starting kits (content/starting-kits/<id>.json), from session 12: what a new account
 * starts with. "new-player" is the one every account gets. Session 13 may add more (for
 * a player who has gone broke). The knife isn't listed: every player always has one.
 */

export const STARTING_KIT_FORMAT_VERSION = 1;

const stackOf = z.strictObject({
  item: idSchema,
  /** For items that stack; defaults to 1. */
  count: z.int().min(1).optional(),
});

export const startingKitSchema = z.strictObject({
  formatVersion: z.literal(STARTING_KIT_FORMAT_VERSION),
  id: idSchema,
  /** The account balance. */
  money: z.int().min(0),
  /** An item id for each gear slot that isn't empty (not the knife). */
  gear: z
    .strictObject({
      primary1: idSchema.optional(),
      primary2: idSchema.optional(),
      sidearm: idSchema.optional(),
      helmet: idSchema.optional(),
      bodyArmor: idSchema.optional(),
      rig: idSchema.optional(),
      backpack: idSchema.optional(),
    })
    .default({}),
  /** Put in pockets, then rig, then backpack, in this order. */
  carried: z.array(stackOf).default([]),
  /** Put in the stash, in this order. */
  stash: z.array(stackOf).default([]),
  /**
   * What a gun in this kit is loaded with, by the gun's id: a full magazine of that round
   * (the user's call, 2026-11-05). A gun not named here starts empty, as a vendor's does.
   */
  loaded: z.record(idSchema, idSchema).default({}),
  /**
   * Attachments fitted to a gun in this kit, by the gun's id: every copy of that gun gets
   * them, worn or in the stash. A gun not named here comes bare.
   */
  fitted: z.record(idSchema, z.array(idSchema)).default({}),
});

export type StartingKitDef = z.infer<typeof startingKitSchema>;

export const STARTING_KIT_FORMAT: ContentFormat<StartingKitDef> = {
  kind: 'starting kit',
  version: STARTING_KIT_FORMAT_VERSION,
  schema: startingKitSchema,
  migrations: {},
};

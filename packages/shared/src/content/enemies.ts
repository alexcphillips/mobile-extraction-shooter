import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { attachmentDef, firesRound, fits, weaponDef, type ItemDb } from './items';
import { hexColourSchema, idSchema } from './schema';

/*
 * Enemy types (content/enemies/<id>.json) and loadouts (content/loadouts/<id>.json),
 * from session 8. An enemy spawn in a map names a type, and optionally a loadout that
 * replaces the type's own. A loadout is rolled once when the enemy spawns: each part
 * (weapon, helmet, body armour) is picked by weight on its own, so a few lines give a lot
 * of variety. Times are seconds, angles degrees.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');

export const ENEMY_FORMAT_VERSION = 1;
export const LOADOUT_FORMAT_VERSION = 1;

/** How well it fights. Bosses are better at all of it. */
const skillSchema = z.strictObject({
  /** Seconds from seeing you to its first shot. */
  reaction: nonNegative,
  /** How far off its aim wanders when it first sees you, in degrees... */
  aimError: nonNegative,
  /** ...how far once it has settled on you... */
  aimSettled: nonNegative,
  /** ...and how quickly it settles: the error shrinks by about two thirds this often. */
  aimSettle: positive,
  /** After losing sight of you, the chance it holds the angle rather than pushing. */
  holdChance: fraction,
});

/** The colours of its body, by part. Gear is drawn over it. */
const outfitSchema = z.strictObject({
  skin: hexColourSchema,
  /** Torso and arms. */
  top: hexColourSchema,
  /** Hips and legs. */
  bottom: hexColourSchema,
  hands: hexColourSchema,
  feet: hexColourSchema,
});

export const enemySchema = z.strictObject({
  formatVersion: z.literal(ENEMY_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** The loadout it rolls, unless its spawn names another. */
  loadout: idSchema,
  skill: skillSchema,
  /** A plain default outfit if left out. */
  outfit: outfitSchema.optional(),
  /**
   * What it carries besides its loadout (session 11), stowed in its pockets, rig and
   * backpack when it spawns; what doesn't fit is left out. Each of `rolls` items comes
   * from one of `tables` (loot table ids), picked by weight; an enemy spawn's lootWeights
   * multiply these weights. Nothing if left out.
   */
  loot: z
    .strictObject({
      rolls: z
        .tuple([z.int().min(0), z.int().min(0)])
        .refine(([min, max]) => min <= max, 'min must not be above max'),
      tables: z.record(idSchema, nonNegative),
    })
    .optional(),
});

/** [min, max], inclusive. */
const rangeOf = (n: z.ZodType<number>) =>
  z.tuple([n, n]).refine(([min, max]) => min <= max, 'min must not be above max');
const range = rangeOf(nonNegative);

const weaponOptionSchema = z.strictObject({
  weight: positive,
  item: idSchema,
  /** Spare rounds for it, rolled between these. */
  spare: range,
  /**
   * The round it's loaded with and carries spares of, picked by weight from rounds of its
   * calibre. Left out, its own (WeaponDef.ammo).
   */
  ammo: z
    .array(z.strictObject({ weight: positive, item: idSchema }))
    .min(1)
    .optional(),
  /** Each attachment goes on with its chance (1 if left out); the first to roll in a slot wins. */
  attachments: z.array(z.strictObject({ item: idSchema, chance: fraction.optional() })).optional(),
});

const armourOptionSchema = z.strictObject({
  weight: positive,
  /** null: nothing in this slot. */
  item: idSchema.nullable(),
  /** Durability left, as a fraction of full, rolled between these. Defaults to [1, 1]. */
  condition: rangeOf(fraction).optional(),
});

const containerOptionSchema = z.strictObject({
  weight: positive,
  /** null: nothing in this slot. Worn empty; the enemy type's loot goes in them. */
  item: idSchema.nullable(),
});

export const loadoutSchema = z.strictObject({
  formatVersion: z.literal(LOADOUT_FORMAT_VERSION),
  id: idSchema,
  /** A pistol goes in the sidearm slot, anything else in the first primary. */
  weapons: z.array(weaponOptionSchema).min(1),
  helmets: z.array(armourOptionSchema).optional(),
  bodyArmour: z.array(armourOptionSchema).optional(),
  rigs: z.array(containerOptionSchema).optional(),
  backpacks: z.array(containerOptionSchema).optional(),
});

export type EnemyDef = z.infer<typeof enemySchema>;
export type EnemySkill = z.infer<typeof skillSchema>;
export type Outfit = z.infer<typeof outfitSchema>;
export type EnemyLoot = NonNullable<EnemyDef['loot']>;
export type LoadoutDef = z.infer<typeof loadoutSchema>;
export type WeaponOption = z.infer<typeof weaponOptionSchema>;
export type ArmourOption = z.infer<typeof armourOptionSchema>;
export type ContainerOption = z.infer<typeof containerOptionSchema>;

export const ENEMY_FORMAT: ContentFormat<EnemyDef> = {
  kind: 'enemy',
  version: ENEMY_FORMAT_VERSION,
  schema: enemySchema,
  migrations: {},
};

export const LOADOUT_FORMAT: ContentFormat<LoadoutDef> = {
  kind: 'loadout',
  version: LOADOUT_FORMAT_VERSION,
  schema: loadoutSchema,
  migrations: {},
};

/**
 * Checks references: every enemy's loadout exists, and every loadout's items exist, are
 * the right type, and its attachments fit their gun.
 */
export function checkEnemies(
  enemies: ReadonlyMap<string, EnemyDef>,
  loadouts: ReadonlyMap<string, LoadoutDef>,
  items: ItemDb,
): void {
  for (const e of enemies.values()) {
    if (!loadouts.has(e.loadout)) {
      throw new ContentError(`content/enemies/${e.id}.json`, `no loadout "${e.loadout}"`);
    }
  }
  // Admin spawner guns name the enemy they spawn.
  for (const d of items.values()) {
    if (d.type === 'weapon' && d.spawns !== undefined && !enemies.has(d.spawns)) {
      throw new ContentError(`content/items/${d.id}.json`, `no enemy type "${d.spawns}"`);
    }
  }
  for (const l of loadouts.values()) {
    const source = `content/loadouts/${l.id}.json`;
    const check = (fn: () => void): void => {
      try {
        fn();
      } catch (e) {
        throw new ContentError(source, (e as Error).message);
      }
    };
    for (const w of l.weapons) {
      check(() => {
        const gun = weaponDef(items, w.item);
        for (const a of w.attachments ?? []) {
          if (!fits(gun, attachmentDef(items, a.item)))
            throw new Error(`"${a.item}" doesn't fit "${w.item}"`);
        }
        for (const a of w.ammo ?? []) {
          if (!firesRound(items, gun, a.item))
            throw new Error(`"${w.item}" doesn't fire "${a.item}"`);
        }
      });
    }
    for (const [slot, options] of [
      ['helmet', l.helmets],
      ['body', l.bodyArmour],
    ] as const) {
      for (const o of options ?? []) {
        if (o.item === null) continue;
        const item = items.get(o.item);
        if (item?.type !== 'armour' || item.slot !== slot)
          throw new ContentError(source, `"${o.item}" is not ${slot} armour`);
      }
    }
    for (const [slot, options] of [
      ['rig', l.rigs],
      ['backpack', l.backpacks],
    ] as const) {
      for (const o of options ?? []) {
        if (o.item === null) continue;
        const item = items.get(o.item);
        if (item?.type !== 'container' || item.slot !== slot)
          throw new ContentError(source, `"${o.item}" is not a ${slot}`);
      }
    }
  }
}

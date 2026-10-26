import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Item files (content/items/<id>.json). So far only what combat needs: weapons, ammo and
 * armour. Session 6b adds attachments; session 9 adds the other item types, grid sizes
 * and the rest of the item model. Times are seconds, angles degrees, distances metres.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');

export const ITEM_FORMAT_VERSION = 1;

const common = {
  formatVersion: z.literal(ITEM_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
};

const weaponSchema = z.strictObject({
  ...common,
  type: z.literal('weapon'),
  /** The ammo item it fires. */
  ammo: idSchema,
  /** auto keeps firing while the trigger is held; semi fires once per pull. */
  fireMode: z.enum(['auto', 'semi']),
  /** Rounds per minute; for semi, the fastest it can be pulled. */
  rpm: positive,
  magazine: z.int().min(1),
  reloadTime: positive,
  /** From the hip to fully aimed. */
  aimTime: positive,
  /** Shots stop here. */
  range: positive,
  /** The most a shot strays from where you aim, in degrees, from the hip and aimed. */
  hipSpread: nonNegative,
  aimSpread: nonNegative,
  recoil: z.strictObject({
    /** View kick upwards per shot. */
    up: nonNegative,
    /** Random kick sideways per shot, up to this much either way. */
    side: nonNegative,
    /** How fast the view settles back, in degrees per second. */
    recovery: positive,
  }),
});

const ammoSchema = z.strictObject({
  ...common,
  type: z.literal('ammo'),
  /** Damage to the chest; other zones multiply it, then armour absorbs some. */
  damage: positive,
  /** Armour durability lost per point of damage the armour absorbs. Defaults to 1. */
  armourDamage: nonNegative.optional(),
  /** Chance that a hit which gets through starts bleeding. */
  bleedChance: fraction,
});

const armourSchema = z.strictObject({
  ...common,
  type: z.literal('armour'),
  /** A helmet covers the head, body armour the chest. */
  slot: z.enum(['helmet', 'body']),
  /** The fraction of damage it absorbs while it has durability left. */
  absorb: fraction,
  durability: positive,
});

export const itemSchema = z.discriminatedUnion('type', [weaponSchema, ammoSchema, armourSchema]);

export type ItemDef = z.infer<typeof itemSchema>;
export type WeaponDef = z.infer<typeof weaponSchema>;
export type AmmoDef = z.infer<typeof ammoSchema>;
export type ArmourDef = z.infer<typeof armourSchema>;

/** Every item by id. The simulation looks stats up here. */
export type ItemDb = ReadonlyMap<string, ItemDef>;

export const ITEM_FORMAT: ContentFormat<ItemDef> = {
  kind: 'item',
  version: ITEM_FORMAT_VERSION,
  schema: itemSchema,
  migrations: {},
};

function itemOf<T extends ItemDef['type']>(
  items: ItemDb,
  id: string,
  type: T,
): Extract<ItemDef, { type: T }> {
  const item = items.get(id);
  if (!item) throw new Error(`no item "${id}"`);
  if (item.type !== type) throw new Error(`item "${id}" is ${item.type}, not ${type}`);
  return item as Extract<ItemDef, { type: T }>;
}

export const weaponDef = (items: ItemDb, id: string): WeaponDef => itemOf(items, id, 'weapon');
export const ammoDef = (items: ItemDb, id: string): AmmoDef => itemOf(items, id, 'ammo');
export const armourDef = (items: ItemDb, id: string): ArmourDef => itemOf(items, id, 'armour');

/** Checks references between items (a weapon's ammo exists and is ammo). */
export function checkItems(items: ItemDb): void {
  for (const item of items.values()) {
    if (item.type !== 'weapon') continue;
    const ammo = items.get(item.ammo);
    if (ammo?.type !== 'ammo') {
      throw new ContentError(
        `content/items/${item.id}.json`,
        `ammo "${item.ammo}" is not an ammo item`,
      );
    }
  }
}

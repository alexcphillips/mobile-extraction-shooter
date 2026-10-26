import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Item files (content/items/<id>.json). So far only what combat needs: weapons, ammo,
 * armour and attachments. Session 9 adds the other item types, grid sizes and the rest of
 * the item model. Times are seconds, angles degrees, distances metres.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');

/** 2 (session 6b): weapons gained loudness and slots; attachments were added. */
export const ITEM_FORMAT_VERSION = 2;

/** The fixed attachment slots a gun can have. */
export const ATTACHMENT_SLOTS = ['optic', 'muzzle', 'magazine'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];
const slotSchema = z.enum(ATTACHMENT_SLOTS);

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
  /**
   * How it's held: a rifle in both hands at the shoulder, a pistol out in front. Picks the
   * animations and, until the item editor (session 18), the placeholder model. Defaults
   * to rifle.
   */
  hold: z.enum(['rifle', 'pistol']).optional(),
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
  /** How far away a shot can be heard (by AI, from session 7). Suppressors shrink it. */
  loudness: positive,
  /** The attachment slots it has, each at most once. None if left out. */
  slots: z
    .array(slotSchema)
    .refine((a) => new Set(a).size === a.length, 'lists a slot twice')
    .optional(),
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

/**
 * A reticle, drawn over the screen while aiming through an optic. Units are % of the
 * screen height from the aim point, with y down, so 50 reaches the top and bottom edges;
 * a scope's mask has a radius of SCOPE_RADIUS.
 */
const reticleShapeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('dot'), x: finite, y: finite, r: positive }),
  z.strictObject({
    type: z.literal('line'),
    x1: finite,
    y1: finite,
    x2: finite,
    y2: finite,
    width: positive,
  }),
  z.strictObject({ type: z.literal('ring'), x: finite, y: finite, r: positive, width: positive }),
]);

/** The scope mask's radius in reticle units (% of the screen height). */
export const SCOPE_RADIUS = 46;

/**
 * Stat changes an attachment makes. Each is a multiplier except magazine, which is extra
 * rounds. A gun's stats are its own with every attachment's changes applied.
 */
const modsSchema = z.strictObject({
  /** Hip and aimed spread. */
  spread: positive.optional(),
  /** Kick up and sideways. */
  recoil: positive.optional(),
  aimTime: positive.optional(),
  reloadTime: positive.optional(),
  loudness: positive.optional(),
  /** Extra rounds in the gun. */
  magazine: z.int().min(1).optional(),
});

const attachmentSchema = z
  .strictObject({
    ...common,
    type: z.literal('attachment'),
    slot: slotSchema,
    /** The guns it fits. Left out, it fits every gun with its slot. */
    weapons: z.array(idSchema).min(1).optional(),
    mods: modsSchema.optional(),
    /** Optics only: how it looks through it. */
    optic: z
      .strictObject({
        /** Magnification. Above 1 is a scope: full-screen zoom behind a mask. */
        zoom: finite.refine((n) => n >= 1, 'must be 1 or more'),
        reticle: z.strictObject({
          colour: z.string().regex(/^#[0-9a-f]{6}$/i, 'must be #rrggbb'),
          shapes: z.array(reticleShapeSchema).min(1),
        }),
      })
      .optional(),
  })
  .refine((a) => (a.slot === 'optic') === !!a.optic, {
    message: 'optics need an optic section, and only optics may have one',
    path: ['optic'],
  });

export const itemSchema = z.discriminatedUnion('type', [
  weaponSchema,
  ammoSchema,
  armourSchema,
  attachmentSchema,
]);

export type ItemDef = z.infer<typeof itemSchema>;
export type WeaponDef = z.infer<typeof weaponSchema>;
export type AmmoDef = z.infer<typeof ammoSchema>;
export type ArmourDef = z.infer<typeof armourSchema>;
export type AttachmentDef = z.infer<typeof attachmentSchema>;
export type AttachmentMods = z.infer<typeof modsSchema>;
export type OpticDef = NonNullable<AttachmentDef['optic']>;
export type ReticleShape = z.infer<typeof reticleShapeSchema>;

/** Every item by id. The simulation looks stats up here. */
export type ItemDb = ReadonlyMap<string, ItemDef>;

export const ITEM_FORMAT: ContentFormat<ItemDef> = {
  kind: 'item',
  version: ITEM_FORMAT_VERSION,
  schema: itemSchema,
  migrations: {
    // Weapons gained a hearing radius; slots are optional.
    1: (doc) => (doc.type === 'weapon' ? { ...doc, loudness: 150 } : doc),
  },
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
export const attachmentDef = (items: ItemDb, id: string): AttachmentDef =>
  itemOf(items, id, 'attachment');

/** Whether an attachment can go on a gun: the gun has its slot, and it's on its list if any. */
export function fits(weapon: WeaponDef, attachment: AttachmentDef): boolean {
  return (
    !!weapon.slots?.includes(attachment.slot) &&
    (!attachment.weapons || attachment.weapons.includes(weapon.id))
  );
}

/**
 * Checks references between items: a weapon's ammo exists and is ammo, and an
 * attachment's guns exist and have its slot.
 */
export function checkItems(items: ItemDb): void {
  for (const item of items.values()) {
    const source = `content/items/${item.id}.json`;
    if (item.type === 'weapon') {
      const ammo = items.get(item.ammo);
      if (ammo?.type !== 'ammo') {
        throw new ContentError(source, `ammo "${item.ammo}" is not an ammo item`);
      }
    } else if (item.type === 'attachment') {
      for (const id of item.weapons ?? []) {
        const weapon = items.get(id);
        if (weapon?.type !== 'weapon') {
          throw new ContentError(source, `"${id}" in weapons is not a weapon`);
        }
        if (!fits(weapon, item)) {
          throw new ContentError(source, `weapon "${id}" has no ${item.slot} slot`);
        }
      }
    }
  }
}

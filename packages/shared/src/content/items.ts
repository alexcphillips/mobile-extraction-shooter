import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { idSchema } from './schema';

/*
 * Item files (content/items/<id>.json): every kind of item, its size in the inventory
 * grid, and what it does. Times are seconds, angles degrees, distances metres.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');

/**
 * 2 (session 6b): weapons gained loudness and slots; attachments were added.
 * 3 (session 9): every item gained a grid size, ammo a stack size; the other types were added.
 * 4 (session 10b): weapons gained a draw time; the knife gained its stats.
 * 5 (session 13b): every item gained a value; repair kits a use time.
 */
export const ITEM_FORMAT_VERSION = 5;

/** The fixed attachment slots a gun can have. */
export const ATTACHMENT_SLOTS = ['optic', 'muzzle', 'magazine'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];
const slotSchema = z.enum(ATTACHMENT_SLOTS);

const cells = z.int().min(1);
/** A grid size: [width, height] in cells. */
const sizeSchema = z.tuple([cells, cells]);
/** How many fit in one stack (one grid cell's worth of the item). */
const stackSchema = z.int().min(2);

const common = {
  formatVersion: z.literal(ITEM_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** Its size in an inventory grid, [width, height] in cells, unrotated. */
  size: sizeSchema,
  /**
   * What one is worth in money, new (session 13b): vendors sell it for this and buy it
   * for a share of it (VENDOR.sellShare), less for one worn or part-used. 0 for things
   * that can't be bought or sold.
   */
  value: z.int().min(0),
};

const weaponSchema = z.strictObject({
  ...common,
  type: z.literal('weapon'),
  /** The ammo item it fires. */
  ammo: idSchema,
  /**
   * How it's held: a rifle in both hands at the shoulder, a pistol out in front. Picks the
   * animations and, until the item editor's models (session 18b), the placeholder model. Defaults
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
  /** Taking it out: from switching to it until it can fire or aim. */
  drawTime: positive,
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
  /** Loose rounds stack up to this many in one place. */
  stack: stackSchema,
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

/** What a med does. Each use treats one zone, the first in TREATMENT_ORDER that needs it. */
export const MED_EFFECTS = ['bandage', 'splint', 'surgery', 'heal'] as const;
export type MedEffect = (typeof MED_EFFECTS)[number];

const medSchema = z
  .strictObject({
    ...common,
    type: z.literal('med'),
    /**
     * bandage stops a zone bleeding; splint takes away a broken limb's effects (it stays at
     * 0 HP and still spills over); surgery brings a broken limb back to 1 HP; heal restores
     * HP to limbs that aren't broken, from a pool.
     */
    effect: z.enum(MED_EFFECTS),
    /** How long one use takes. */
    useTime: positive,
    /** How many times it can be used. Defaults to 1. Not for heal, which has hp. */
    uses: z.int().min(1).optional(),
    /** heal only: the HP it holds in all, spent across uses. */
    hp: positive.optional(),
  })
  .refine((m) => (m.effect === 'heal') === (m.hp !== undefined), {
    message: 'heal needs hp, and only heal may have it',
    path: ['hp'],
  })
  .refine((m) => m.effect !== 'heal' || m.uses === undefined, {
    message: 'heal uses up its hp, so it has no uses',
    path: ['uses'],
  });

/** Rigs and backpacks: worn in their slot, with a grid of their own. */
const containerSchema = z.strictObject({
  ...common,
  type: z.literal('container'),
  slot: z.enum(['rig', 'backpack']),
  /** The grid inside, [width, height] in cells. */
  grid: sizeSchema,
});

/**
 * The knife. A swing hits the first body part in reach under the crosshair (or close to
 * it), like a shot: zone multipliers, then armour absorbs its share.
 */
const meleeSchema = z.strictObject({
  ...common,
  type: z.literal('melee'),
  /** Damage to the chest; other zones multiply it, as for ammo. */
  damage: positive,
  /** Armour durability lost per point of damage the armour absorbs. Defaults to 1. */
  armourDamage: nonNegative.optional(),
  /** Chance that a hit which gets through starts bleeding. */
  bleedChance: fraction,
  /** Seconds from one swing to the next. */
  swingTime: positive,
  /** How far it reaches from the eye. */
  reach: positive,
  /** Taking it out: from switching to it until it can swing. */
  drawTime: positive,
});

/** Opens the doors that name it. */
const keySchema = z.strictObject({
  ...common,
  type: z.literal('key'),
  /** Unlocks this many times, then it's gone; left out, it never wears out. */
  uses: z.int().min(1).optional(),
});

/** Picked up for a quest. */
const questSchema = z.strictObject({ ...common, type: z.literal('quest') });

/** Valuables, junk and cash: things to sell. */
const lootSchema = z.strictObject({
  ...common,
  type: z.literal('loot'),
  /** Stacks up to this many in one place; left out, it doesn't stack. */
  stack: stackSchema.optional(),
  /**
   * Money you find (session 13b): what comes out of a raid goes into your balance, at its
   * full value.
   */
  money: z.literal(true).optional(),
});

/** Armour repair kits. */
const repairSchema = z.strictObject({
  ...common,
  type: z.literal('repair'),
  /** The durability it can restore in all, spent across repairs. */
  points: positive,
  /** How long a repair takes in a raid (session 13b). Between raids it's at once. */
  useTime: positive,
});

export const itemSchema = z.discriminatedUnion('type', [
  weaponSchema,
  ammoSchema,
  armourSchema,
  attachmentSchema,
  medSchema,
  containerSchema,
  meleeSchema,
  keySchema,
  questSchema,
  lootSchema,
  repairSchema,
]);

export type ItemDef = z.infer<typeof itemSchema>;
export type WeaponDef = z.infer<typeof weaponSchema>;
export type AmmoDef = z.infer<typeof ammoSchema>;
export type ArmourDef = z.infer<typeof armourSchema>;
export type AttachmentDef = z.infer<typeof attachmentSchema>;
export type MedDef = z.infer<typeof medSchema>;
export type MeleeDef = z.infer<typeof meleeSchema>;
export type ContainerDef = z.infer<typeof containerSchema>;
export type RepairDef = z.infer<typeof repairSchema>;
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
    // Grid sizes (and ammo stacks), guessed from the type.
    2: (doc) => {
      switch (doc.type) {
        case 'weapon':
          return { ...doc, size: doc.hold === 'pistol' ? [2, 1] : [4, 2] };
        case 'ammo':
          return { ...doc, size: [1, 1], stack: 60 };
        case 'armour':
          return { ...doc, size: doc.slot === 'helmet' ? [2, 2] : [3, 3] };
        default:
          return { ...doc, size: [1, 1] };
      }
    },
    // Draw times, guessed from the hold, and the knife's stats as first designed.
    3: (doc) => {
      if (doc.type === 'weapon') return { ...doc, drawTime: doc.hold === 'pistol' ? 0.4 : 0.8 };
      if (doc.type === 'melee') {
        return { ...doc, damage: 40, bleedChance: 0.3, swingTime: 0.5, reach: 1.5, drawTime: 0.3 };
      }
      return doc;
    },
    // Values, guessed from the type (the content files set their own), and repair times.
    4: (doc) => ({
      ...doc,
      value: VALUE_GUESSES[doc.type as string] ?? 0,
      ...(doc.type === 'repair' ? { useTime: 8 } : {}),
    }),
  },
};

const VALUE_GUESSES: Record<string, number> = {
  weapon: 10_000,
  ammo: 30,
  armour: 10_000,
  attachment: 5_000,
  med: 1_000,
  container: 5_000,
  melee: 500,
  key: 2_000,
  loot: 1_000,
  repair: 10_000,
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
export const medDef = (items: ItemDb, id: string): MedDef => itemOf(items, id, 'med');
export const meleeDef = (items: ItemDb, id: string): MeleeDef => itemOf(items, id, 'melee');
export const containerDef = (items: ItemDb, id: string): ContainerDef =>
  itemOf(items, id, 'container');
export const repairDef = (items: ItemDb, id: string): RepairDef => itemOf(items, id, 'repair');

export function itemDef(items: ItemDb, id: string): ItemDef {
  const item = items.get(id);
  if (!item) throw new Error(`no item "${id}"`);
  return item;
}

/** How many of an item fit in one place: 1 unless it stacks. */
export function stackSize(def: ItemDef): number {
  return (def.type === 'ammo' || def.type === 'loot') && def.stack ? def.stack : 1;
}

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

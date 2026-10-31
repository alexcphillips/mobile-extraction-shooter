import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import {
  ATTACHMENT_SLOTS,
  attachmentModelSchema,
  meleeModelSchema,
  plainModelSchema,
  slotSchema,
  weaponModelSchema,
  type ModelPart,
} from './models';
import { placeholderModel } from './placeholder-models';
import { idSchema } from './schema';

export { ATTACHMENT_SLOTS, type AttachmentSlot } from './models';

/*
 * Item files (content/items/<id>.json): every kind of item, its size in the inventory
 * grid, and what it does. Times are seconds, angles degrees, distances metres.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');

/**
 * What setting someone alight does (2026-10-31, sim/fire.ts): how long they burn if they
 * don't put it out, and HP a second it takes from every zone, past armour.
 */
const burning = {
  burnTime: positive,
  burnDamage: positive,
};

/**
 * 2 (session 6b): weapons gained loudness and slots; attachments were added.
 * 3 (session 9): every item gained a grid size, ammo a stack size; the other types were added.
 * 4 (session 10b): weapons gained a draw time; the knife gained its stats.
 * 5 (session 13b): every item gained a value; repair kits a use time.
 * 6 (session 18b): every item gained a model (models.ts).
 * 7 (session 19): guns, knives, meds and repair kits gained sounds (sounds.ts).
 * 8: every item gained a rarity.
 * 9: ammo gained a calibre and a level; armour a level in place of absorb; the knife a
 *    level and armour damage (Delta Force-style tiers, design.md → Damage). Grenades came
 *    in at 9 too: a new type changes no existing file, so it needed no new version.
 */
export const ITEM_FORMAT_VERSION = 9;

/**
 * Ammo and armour levels (Delta Force's tiers), 1 to LEVELS: grey, green, blue, purple,
 * gold, red. A round against armour compares levels (sim/health.ts).
 */
export const LEVELS = 6;
const levelSchema = z.int().min(1).max(LEVELS);

/**
 * How rare an item is, which colours its tile (design.md → Item tiles), lowest first:
 * gray, blue, purple, gold.
 */
export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

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
  rarity: z.enum(RARITIES),
};
/** How it's drawn (session 18b): see models.ts. Guns, attachments and knives add points. */
const plainModel = { model: plainModelSchema };
/** A sound file's id (content/sounds). */
const soundId = idSchema;

const weaponSchema = z
  .strictObject({
    ...common,
    type: z.literal('weapon'),
    /**
     * The round it comes loaded with. It fires any round of the same calibre (the one
     * loaded is on the gun, WeaponState.loaded). A grenade makes it a grenade launcher,
     * firing any grenade (see launchSpeed).
     */
    ammo: idSchema,
    /**
     * Grenade launchers only (2026-10-30): how fast a grenade leaves the barrel, in m/s.
     * It flies, bounces and goes off as a thrown one does (sim/grenades.ts).
     */
    launchSpeed: positive.optional(),
    /**
     * Grenade launchers only: its grenades go off when they hit something (the map or
     * someone) once they've flown this far, in metres. One that hits the map sooner never
     * arms: it bounces and goes off on its fuse, as a thrown one does.
     */
    armDistance: nonNegative.optional(),
    /**
     * How it's held: a rifle in both hands at the shoulder, a pistol out in front. Picks the
     * animations and where the gun sits in first person. Defaults to rifle.
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
    /**
     * What it sounds like: firing, firing with a muzzle device that quietens it (a
     * suppressor), and reloading.
     */
    sounds: z.strictObject({ shot: soundId, suppressed: soundId, reload: soundId }),
    model: weaponModelSchema,
    /**
     * Admin guns only (2026-10-30): an enemy type (content/enemies). Where a shot stops,
     * an enemy of it spawns; its shots do no harm and use no rounds. Given only from the
     * admin page, so keep these out of loot tables, loadouts and vendors.
     */
    spawns: idSchema.optional(),
  })
  .superRefine((w, ctx) => {
    const slots = w.slots ?? [];
    for (const slot of slots) {
      if (!w.model.mounts?.[slot]) {
        ctx.addIssue({
          code: 'custom',
          message: `needs a ${slot} mount`,
          path: ['model', 'mounts'],
        });
      }
    }
    for (const slot of ATTACHMENT_SLOTS) {
      if (w.model.mounts?.[slot] && !slots.includes(slot)) {
        ctx.addIssue({
          code: 'custom',
          message: `has a ${slot} mount but no ${slot} slot`,
          path: ['model', 'mounts', slot],
        });
      }
    }
    w.model.parts.forEach((p, i) => {
      if (p.hiddenBy && !slots.includes(p.hiddenBy)) {
        ctx.addIssue({
          code: 'custom',
          message: `hidden by ${p.hiddenBy}, a slot it doesn't have`,
          path: ['model', 'parts', i, 'hiddenBy'],
        });
      }
    });
  });

const ammoSchema = z
  .strictObject({
    ...common,
    type: z.literal('ammo'),
    /** Loose rounds stack up to this many in one place. */
    stack: stackSchema,
    /** Which guns fire it: those whose own round has the same calibre. */
    calibre: z.string().min(1),
    /** Its penetration level, against an armour's level. */
    level: levelSchema,
    /**
     * Damage to the chest; other zones multiply it, then armour may stop some. Per pellet.
     * 0 only for flamethrower fuel, whose harm is the burning (flame).
     */
    damage: nonNegative,
    /** Armour durability lost per hit (per pellet), less against armour above its level. */
    armourDamage: nonNegative,
    /** Chance that a hit which gets through starts bleeding. */
    bleedChance: fraction,
    /** Shotgun shells: one round fires this many pellets, each its own hit. Defaults to 1. */
    pellets: z.int().min(2).optional(),
    /** With pellets: the most each pellet strays from the shot's line, in degrees. */
    pelletSpread: nonNegative.optional(),
    /**
     * Flamethrower fuel (2026-10-31): a shot is a blob of flame flying out to the gun's
     * range (sim/fire.ts), not a bullet. It sets alight whoever it hits, and burns where it
     * lands on the map; anyone touching that is set alight too.
     */
    flame: z
      .strictObject({
        /** How fast a blob leaves the nozzle, in m/s. */
        speed: positive,
        ...burning,
        /** How long it burns where it lands on the map. */
        fireTime: positive,
      })
      .optional(),
    /**
     * Incendiary rounds (2026-10-31): a hit (each pellet's, for shells) has this chance of
     * setting whoever it hits alight, on top of its damage. No fire on the map.
     */
    incendiary: z.strictObject({ chance: fraction, ...burning }).optional(),
    ...plainModel,
  })
  .refine((a) => (a.pellets === undefined) === (a.pelletSpread === undefined), {
    message: 'pellets and pelletSpread go together',
    path: ['pelletSpread'],
  })
  .refine((a) => a.damage > 0 !== !!a.flame, {
    message: 'damage must be above 0, and only flamethrower fuel (flame) does none',
    path: ['damage'],
  })
  .refine((a) => !a.flame || a.pellets === undefined, {
    message: 'fuel has no pellets',
    path: ['pellets'],
  })
  .refine((a) => !a.flame || !a.incendiary, {
    message: 'fuel burns already: it has no incendiary',
    path: ['incendiary'],
  });

const armourSchema = z.strictObject({
  ...common,
  type: z.literal('armour'),
  /** A helmet covers the head, body armour the chest. */
  slot: z.enum(['helmet', 'body']),
  /** Its protection level, against a round's level. */
  level: levelSchema,
  durability: positive,
  ...plainModel,
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
    model: attachmentModelSchema,
  })
  .refine((a) => (a.slot === 'optic') === !!a.optic, {
    message: 'optics need an optic section, and only optics may have one',
    path: ['optic'],
  })
  .refine((a) => (a.slot === 'optic') === !!a.model.sight, {
    message: 'optics need a sight point, and only optics may have one',
    path: ['model', 'sight'],
  })
  .refine((a) => (a.slot === 'muzzle') === !!a.model.muzzle, {
    message: 'muzzle devices need a muzzle point, and only they may have one',
    path: ['model', 'muzzle'],
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
    /** Played as a use starts. */
    sounds: z.strictObject({ use: soundId }),
    ...plainModel,
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
  /**
   * For testing only (2026-10-31): given from the admin page's Admin tab, so keep it out of
   * loot tables, loadouts and vendors (as an admin spawner gun).
   */
  admin: z.literal(true).optional(),
  ...plainModel,
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
  /** Its penetration level, as for ammo. */
  level: levelSchema,
  /** Armour durability lost per hit, as for ammo. */
  armourDamage: nonNegative,
  /** Chance that a hit which gets through starts bleeding. */
  bleedChance: fraction,
  /** Seconds from one swing to the next. */
  swingTime: positive,
  /** How far it reaches from the eye. */
  reach: positive,
  /** Taking it out: from switching to it until it can swing. */
  drawTime: positive,
  sounds: z.strictObject({ swing: soundId }),
  model: meleeModelSchema,
});

/**
 * What a grenade does when it goes off (2026-10-31): frag hurts everyone in its radius;
 * flash blinds whoever is looking at it within its radius; smoke leaves a cloud enemies
 * can't see through; c4 sticks where it lands and waits for its thrower's detonator, then
 * goes off as a frag does; molotov (2026-10-31) breaks on the first thing it hits and
 * spills fire across its radius (sim/fire.ts), setting alight whoever stands in it.
 */
export const GRENADE_EFFECTS = ['frag', 'flash', 'smoke', 'c4', 'molotov'] as const;
export type GrenadeEffect = (typeof GRENADE_EFFECTS)[number];

/**
 * Thrown grenades (2026-10-30): one press throws the first one carried. It bounces off
 * the map and goes off its fuse after the throw, hurting everyone in its radius that it
 * can see, less further out (sim/grenades.ts).
 */
const grenadeSchema = z.strictObject({
  ...common,
  type: z.literal('grenade'),
  /** What it does; left out, a frag. */
  effect: z.enum(GRENADE_EFFECTS).optional(),
  /** Seconds from the throw until it goes off; for c4, from the detonator. */
  fuse: positive,
  /** How fast it leaves the hand, in m/s. */
  throwSpeed: positive,
  /**
   * It hurts out to here, in metres. A flash blinds out to here, and a smoke's cloud is
   * this big.
   */
  radius: positive,
  /**
   * Damage to the chest at the centre; the other zones take their share (GRENADE.zones),
   * and it falls off further out. Then armour stops some, as for ammo. 0 hurts no one
   * (flash and smoke).
   */
  damage: nonNegative,
  /** Its fragments' penetration level, as for ammo. */
  level: levelSchema,
  /** Armour durability lost per zone hit, as for ammo. */
  armourDamage: nonNegative,
  /** Chance that each zone hit which gets through starts bleeding. */
  bleedChance: fraction,
  /** How far away it can be heard going off (by AI), as for a gun. */
  loudness: positive,
  /**
   * Flash only: the longest it blinds someone, in seconds: looking at it, close; less
   * further out.
   */
  blindTime: positive.optional(),
  /** Smoke only: how long its cloud lasts, in seconds. */
  smokeTime: positive.optional(),
  /**
   * Molotov only: its fire, as for flamethrower fuel: how long whoever it sets alight burns,
   * how hard, and how long the fire it spills burns on the map.
   */
  fire: z.strictObject({ ...burning, fireTime: positive }).optional(),
  /** Leaving the hand, hitting something, and going off. */
  sounds: z.strictObject({ throw: soundId, bounce: soundId, explode: soundId }),
  ...plainModel,
});

/** Opens the doors that name it. */
const keySchema = z.strictObject({
  ...common,
  type: z.literal('key'),
  /** Unlocks this many times, then it's gone; left out, it never wears out. */
  uses: z.int().min(1).optional(),
  ...plainModel,
});

/** Picked up for a quest. */
const questSchema = z.strictObject({ ...common, type: z.literal('quest'), ...plainModel });

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
  ...plainModel,
});

/** Armour repair kits. */
const repairSchema = z.strictObject({
  ...common,
  type: z.literal('repair'),
  /** The durability it can restore in all, spent across repairs. */
  points: positive,
  /** How long a repair takes in a raid (session 13b). Between raids it's at once. */
  useTime: positive,
  /** Played as a repair in a raid starts. */
  sounds: z.strictObject({ use: soundId }),
  ...plainModel,
});

export const itemSchema = z.discriminatedUnion('type', [
  weaponSchema,
  ammoSchema,
  armourSchema,
  attachmentSchema,
  medSchema,
  containerSchema,
  meleeSchema,
  grenadeSchema,
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
export type GrenadeDef = z.infer<typeof grenadeSchema>;
export type ContainerDef = z.infer<typeof containerSchema>;
export type RepairDef = z.infer<typeof repairSchema>;
export type AttachmentMods = z.infer<typeof modsSchema>;
export type OpticDef = NonNullable<AttachmentDef['optic']>;
export type ReticleShape = z.infer<typeof reticleShapeSchema>;
export type { ModelPart };

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
    // Models: the placeholders each kind was drawn with.
    5: (doc) => ({ ...doc, model: placeholderModel(doc) }),
    // Sounds: the first ones made, by kind (the content files pick their own).
    6: (doc) => {
      const sounds = defaultSounds(doc);
      return sounds ? { ...doc, sounds } : doc;
    },
    // Rarities: all common until the content files pick their own.
    7: (doc) => ({ ...doc, rarity: 'common' }),
    // Levels. Each round becomes its own calibre so its guns still fire it; armour's level
    // is guessed from how much it absorbed; old armour damage was per point absorbed.
    8: (doc) => {
      switch (doc.type) {
        case 'ammo':
          return {
            ...doc,
            calibre: doc.id,
            level: 1,
            armourDamage: 10 * Number(doc.armourDamage ?? 1),
          };
        case 'melee':
          return { ...doc, level: 1, armourDamage: 5 };
        case 'armour': {
          const { absorb, ...rest } = doc;
          return {
            ...rest,
            level: Math.min(LEVELS, Math.max(1, Math.round(Number(absorb) * LEVELS))),
          };
        }
        default:
          return doc;
      }
    },
  },
};

/**
 * The sounds an item of its kind starts with (session 19): the first ones made, by hold or
 * effect; null for kinds that make none. For the migration, blank items and test items.
 */
export function defaultSounds(doc: {
  type?: unknown;
  hold?: unknown;
  effect?: unknown;
}): Record<string, string> | null {
  const gun = doc.hold === 'pistol' ? 'pistol' : 'rifle';
  switch (doc.type) {
    case 'weapon':
      return { shot: `${gun}-shot`, suppressed: `${gun}-shot-suppressed`, reload: `${gun}-reload` };
    case 'melee':
      return { swing: 'knife-swing' };
    case 'med':
      return {
        use: doc.effect === 'bandage' || doc.effect === 'splint' ? 'bandage-use' : 'med-use',
      };
    case 'repair':
      return { use: 'repair-use' };
    case 'grenade':
      return { throw: 'grenade-throw', bounce: 'grenade-bounce', explode: 'explosion' };
    default:
      return null;
  }
}

const VALUE_GUESSES: Record<string, number> = {
  weapon: 10_000,
  ammo: 30,
  armour: 10_000,
  attachment: 5_000,
  med: 1_000,
  container: 5_000,
  melee: 500,
  grenade: 3_000,
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
export const grenadeDef = (items: ItemDb, id: string): GrenadeDef => itemOf(items, id, 'grenade');
/** What a grenade does: its effect, a frag if it doesn't say. */
export const grenadeEffect = (def: GrenadeDef): GrenadeEffect => def.effect ?? 'frag';

/** How an item sets someone alight: how long they burn and how hard (sim/fire.ts). */
export interface BurnStats {
  readonly burnTime: number;
  readonly burnDamage: number;
}

/**
 * How an item sets someone alight, or null if it doesn't: flamethrower fuel, incendiary
 * rounds, a molotov. Allocates nothing.
 */
export function burnOf(items: ItemDb, id: string): BurnStats | null {
  const def = items.get(id);
  if (def?.type === 'ammo') return def.flame ?? def.incendiary ?? null;
  if (def?.type === 'grenade') return def.fire ?? null;
  return null;
}

/** How long fire an item leaves on the map burns, or 0: fuel's flames and a molotov's. */
export function fireTimeOf(items: ItemDb, id: string): number {
  const def = items.get(id);
  if (def?.type === 'ammo') return def.flame?.fireTime ?? 0;
  if (def?.type === 'grenade') return def.fire?.fireTime ?? 0;
  return 0;
}
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

/** What a gun can be loaded with: ammo, or grenades for a grenade launcher. */
export type RoundDef = AmmoDef | GrenadeDef;

/**
 * An item as something a gun can load, or null if it isn't ammo or a grenade. C4 isn't a
 * round: it's placed by hand, never launched (2026-10-31).
 */
export function roundOf(items: ItemDb, id: string): RoundDef | null {
  const def = items.get(id);
  // Neither C4 nor a molotov can be fired from a launcher.
  if (def?.type === 'grenade') return def.effect === 'c4' || def.effect === 'molotov' ? null : def;
  return def?.type === 'ammo' ? def : null;
}

/** A round's calibre: ammo's own; every grenade is 'grenade', fired by every launcher. */
export const roundCalibre = (round: RoundDef): string =>
  round.type === 'ammo' ? round.calibre : 'grenade';

/** The calibre a gun fires: its own round's. */
export function calibreOf(items: ItemDb, weapon: WeaponDef): string {
  const round = roundOf(items, weapon.ammo);
  if (!round) throw new Error(`item "${weapon.ammo}" is not a round`);
  return roundCalibre(round);
}

/** Whether a gun fires an item: a round of its calibre. */
export function firesRound(items: ItemDb, weapon: WeaponDef, id: string): boolean {
  const round = roundOf(items, id);
  return !!round && roundCalibre(round) === calibreOf(items, weapon);
}

/**
 * Checks references between items: a weapon's ammo exists and is ammo (or a grenade other
 * than c4, with a launch speed), a grenade has the fields its effect needs, and an
 * attachment's guns exist and have its slot.
 */
export function checkItems(items: ItemDb): void {
  for (const item of items.values()) {
    const source = `content/items/${item.id}.json`;
    if (item.type === 'weapon') {
      const ammo = roundOf(items, item.ammo);
      if (!ammo) {
        throw new ContentError(source, `ammo "${item.ammo}" is not an ammo or grenade item`);
      }
      if ((ammo.type === 'grenade') !== (item.launchSpeed !== undefined)) {
        throw new ContentError(source, 'a gun firing grenades needs launchSpeed, and only it');
      }
      if (item.armDistance !== undefined && ammo.type !== 'grenade') {
        throw new ContentError(source, 'only a gun firing grenades has armDistance');
      }
    } else if (item.type === 'grenade') {
      const effect = grenadeEffect(item);
      if ((effect === 'flash') !== (item.blindTime !== undefined)) {
        throw new ContentError(source, 'a flash grenade needs blindTime, and only it');
      }
      if ((effect === 'smoke') !== (item.smokeTime !== undefined)) {
        throw new ContentError(source, 'a smoke grenade needs smokeTime, and only it');
      }
      if ((effect === 'molotov') !== (item.fire !== undefined)) {
        throw new ContentError(source, 'a molotov needs fire, and only it');
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

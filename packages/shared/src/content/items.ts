import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import {
  ATTACHMENT_SLOTS,
  attachmentModelSchema,
  meleeModelSchema,
  plainModelSchema,
  slotSchema,
  weaponModelSchema,
  type AttachmentSlot,
  type ModelPart,
} from './models';
import { placeholderModel } from './placeholder-models';
import { idSchema } from './schema';

export { ATTACHMENT_SLOTS, type AttachmentSlot } from './models';

/*
 * Item files (content/items/<id>.json): every kind of item, its size in the inventory
 * grid, and what it does. Times are seconds, angles degrees, distances meters.
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
 * 6 (session 18b): every item gained a model (models.ts).
 * 7 (session 19): guns, knives, meds and repair kits gained sounds (sounds.ts).
 * 8: every item gained a rarity.
 * 9: ammo gained a caliber and a level; armor a level in place of absorb; the knife a
 *    level and armor damage (Delta Force-style tiers, design.md → Damage). Grenades came
 *    in at 9 too: a new type changes no existing file, so it needed no new version. The
 *    uncommon and mythic rarities came in at 9 for the same reason.
 * 10 (2026-11-04): gun recoil gained a snap, and its recovery became a rate (per second)
 *    rather than degrees per second (sim/recoil.ts). Containers' optional sections,
 *    armor's optional repairLoss and every item's optional shortName came in at 10 too
 *    (2026-11-06), loot's optional category, guns' optional class and meds' optional bleedCost (2026-11-09): an
 *    optional field changes no existing file.
 * 11 (BW-3, 2026-11-12): every item gained a weight in kg (a stacking item's is per one).
 * 12 (2026-11-13): guns' aim and draw times became one ergonomics (ERGO), and an
 *    attachment's `ergonomics` became points added to it; what it was (a recoil recovery
 *    multiplier) is now `recovery`.
 */
export const ITEM_FORMAT_VERSION = 12;

/**
 * Ergonomics (2026-11-13, the user's call, after Tarkov): one handling number per gun, 0 to
 * 100, higher handier, plus its attachments' points. It sets how long aiming in takes (and
 * the sights' lag when turning, which follows aim time), how long taking it out takes, and
 * how much the sights sway when aimed. Fitted so the guns' aim times stayed what they were.
 */
export const ERGO = {
  /** Aim time at 0, and what each point takes off it, in seconds. */
  aimAt0: 0.55,
  aimPerPoint: 0.0045,
  /** Draw time at 0, and what each point takes off it, in seconds. */
  drawAt0: 1.75,
  drawPerPoint: 0.016,
  /** Aimed sway is 1× at this, and this much more (less) for each point below (above). */
  swayAt: 50,
  swayPerPoint: 0.008,
  /** The fastest aim and draw, and the least and most sway, whatever the points. */
  minAim: 0.12,
  minDraw: 0.25,
  minSway: 0.5,
  maxSway: 1.6,
} as const;

/** Clamped to 0–100. */
const ergo = (points: number): number => Math.max(0, Math.min(100, points));
/** Seconds from the hip to fully aimed, for this much ergonomics. */
export const aimTimeAt = (points: number): number =>
  Math.max(ERGO.minAim, ERGO.aimAt0 - ERGO.aimPerPoint * ergo(points));
/** Seconds to take the gun out, for this much ergonomics. */
export const drawTimeAt = (points: number): number =>
  Math.max(ERGO.minDraw, ERGO.drawAt0 - ERGO.drawPerPoint * ergo(points));
/** Aimed sway's scale, for this much ergonomics. */
export const swayAt = (points: number): number =>
  Math.min(
    ERGO.maxSway,
    Math.max(ERGO.minSway, 1 + (ERGO.swayAt - ergo(points)) * ERGO.swayPerPoint),
  );

/**
 * Ammo and armor levels (a round's from its Tarkov penetration), 1 to LEVELS: gray, green, blue, purple,
 * gold, red. A round against armor compares levels (sim/health.ts).
 */
export const LEVELS = 6;
const levelSchema = z.int().min(1).max(LEVELS);

/**
 * How rare an item is, which colors its tile (design.md → Item tiles), lowest first:
 * gray, green, blue, purple, gold, red.
 */
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * What rarity colors say (2026-11-09, the user's call): an armor piece's or a round's
 * level, a loot item's worth, and a rig's or backpack's room. Guns and attachments are all
 * common: a gun is just a gun. checkItems holds content to this.
 */
export const COMMON_TYPES: ReadonlySet<string> = new Set(['weapon', 'attachment']);

/**
 * The most cells a rig or backpack can hold at each rarity, mythic past the last (the
 * user's call, 2026-11-11, replacing 2026-11-09's 8/14/22/32/44). Only the rarity the item
 * editor fills in: content may set another (bagRarity).
 */
export const BAG_RARITY_CELLS: readonly (readonly [Rarity, number])[] = [
  ['common', 6],
  ['uncommon', 8],
  ['rare', 12],
  ['epic', 16],
  ['legendary', 20],
];

/** The cells a rig or backpack holds: its sections', or its whole grid's. */
export function bagCells(bag: {
  grid: readonly [number, number];
  sections?: readonly { size: readonly [number, number] }[] | undefined;
}): number {
  if (bag.sections?.length) return bag.sections.reduce((n, s) => n + s.size[0] * s.size[1], 0);
  return bag.grid[0] * bag.grid[1];
}

/**
 * A rig's or backpack's rarity by the cells it holds (BAG_RARITY_CELLS): what the item
 * editor fills in when its grid or sections change (2026-11-11). A default, not a rule:
 * the editor can set another.
 */
export function bagRarity(bag: Parameters<typeof bagCells>[0]): Rarity {
  const cells = bagCells(bag);
  for (const [rarity, most] of BAG_RARITY_CELLS) if (cells <= most) return rarity;
  return 'mythic';
}

/**
 * Where an item's picture (its inventory tile and its details) is taken from (2026-11-02):
 * straight down with the back (−z) at the top, from the front (+z), from its left side
 * (−x, a gun's barrel to the left, a little from above), or angled (a near-diagonal
 * three-quarter turn from the front-left, the front (−z) to the left, about 18° from above). Every picture faces
 * left (2026-11-09). Left out: side for guns, knives and magazines, else angled.
 * The same three-quarter turn from the other corners too (2026-11-09, the user's call, so
 * a view can be picked rather than turned by hand): frontRight, backLeft, backRight.
 * `angled` is the front-left one, kept under its old name so no item file changes.
 */
export const ITEM_VIEWS = [
  'top',
  'front',
  'side',
  'angled',
  'frontRight',
  'backLeft',
  'backRight',
] as const;
export type ItemView = (typeof ITEM_VIEWS)[number];

const cells = z.int().min(1);
/** A grid size: [width, height] in cells. */
const sizeSchema = z.tuple([cells, cells]);
/** How many fit in one stack (one grid cell's worth of the item). */
const stackSchema = z.int().min(2);

const common = {
  formatVersion: z.literal(ITEM_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /**
   * What its tile says, where the name won't fit (2026-11-06, as Tarkov's short names):
   * "5.56 M855", "Band.". The details and hover card keep the name. The name if left out.
   */
  shortName: z.string().min(1).optional(),
  /** Its size in an inventory grid, [width, height] in cells, unrotated. */
  size: sizeSchema,
  /**
   * What one is worth in money, new (session 13b): vendors sell it for this and buy it
   * for a share of it (VENDOR.sellShare), less for one worn or part-used. 0 for things
   * that can't be bought or sold.
   */
  value: z.int().min(0),
  /**
   * What one weighs in kg (BW-3): a stack's is this times its count. A gun's is without its
   * attachments, which weigh their own; a carrier's without its plates. 0 for things never
   * carried (admin tools).
   */
  weight: nonNegative,
  rarity: z.enum(RARITIES),
  view: z.enum(ITEM_VIEWS).optional(),
};
/** How it's drawn (session 18b): see models.ts. Guns, attachments and knives add points. */
const plainModel = { model: plainModelSchema };
/** A sound file's id (content/sounds). */
const soundId = idSchema;

/** Kinds of gun (WeaponDef.class). */
export const WEAPON_CLASSES = [
  'assault',
  'smg',
  'shotgun',
  'dmr',
  'sniper',
  'lmg',
  'pistol',
  'special',
] as const;
export type WeaponClass = (typeof WEAPON_CLASSES)[number];

const weaponSchema = z
  .strictObject({
    ...common,
    type: z.literal('weapon'),
    /**
     * The round it comes loaded with. It fires any round of the same caliber (the one
     * loaded is on the gun, WeaponState.loaded).
     */
    ammo: idSchema,
    /**
     * How it's held: a rifle in both hands at the shoulder, a pistol out in front. Picks the
     * animations and where the gun sits in first person. Defaults to rifle.
     */
    hold: z.enum(['rifle', 'pistol']).optional(),
    /**
     * What kind of gun it is (2026-11-09), for quick equip (stash-quick-equip.ts): a sniper
     * brings a close-range gun too, and special guns (admin) are never picked. Left out,
     * assault.
     */
    class: z.enum(WEAPON_CLASSES).optional(),
    /** auto keeps firing while the trigger is held; semi fires once per pull. */
    fireMode: z.enum(['auto', 'semi']),
    /** Rounds per minute; for semi, the fastest it can be pulled. */
    rpm: positive,
    /**
     * Rounds it holds. A magazine-fed gun's (feed) is its default magazine's capacity, for
     * the editor's numbers: what it holds is the fitted magazine's.
     */
    magazine: z.int().min(1),
    /**
     * How it's loaded (MG-1, 2026-11-12): 'magazine' takes magazine items (attachments with
     * a capacity) in its magazine slot, and a reload swaps in the fullest one carried. Left
     * out, loose rounds go straight in (tubes, internal magazines, the special guns).
     */
    feed: z.literal('magazine').optional(),
    reloadTime: positive,
    /**
     * Handling, 0 to 100 (ERGO, 2026-11-13): aim time, draw time and aimed sway, with its
     * attachments' points added.
     */
    ergonomics: z.number().min(0).max(100),
    /** Shots stop here. */
    range: positive,
    /** How far away a shot can be heard (by AI, from session 7). Suppressors shrink it. */
    loudness: positive,
    /**
     * A built-in suppressor that can't come off (the AS VAL, 2026-11-05): no muzzle flash.
     * Its loudness and shot sound are already the suppressed ones, and it has no muzzle slot.
     */
    suppressed: z.literal(true).optional(),
    /**
     * The attachments a new one comes with, by slot (WF-1, 2026-11-12: its own stock), from
     * a vendor, loot or a loadout. Each must fit it. Loadouts may put others on top.
     */
    defaults: z.partialRecord(slotSchema, idSchema).optional(),
    /** The attachment slots it has, each at most once. None if left out. */
    slots: z
      .array(slotSchema)
      .refine((a) => new Set(a).size === a.length, 'lists a slot twice')
      .optional(),
    /** The most a shot strays from where you aim, in degrees, from the hip and aimed. */
    hipSpread: nonNegative,
    aimSpread: nonNegative,
    recoil: z.strictObject({
      /** Kick upwards per round. */
      up: nonNegative,
      /** Random kick sideways per round, up to this much either way. */
      side: nonNegative,
      /**
       * How fast the gun reaches each kick: its spring's frequency, per second. Higher is
       * snappier; around 40 lands a kick in about a tenth of a second.
       */
      snap: positive,
      /** How fast the kick wears off, per second: after 1/recovery s, about a third is left. */
      recovery: positive,
      /**
       * Which way up kicks, in degrees off straight up: + is right, − left (2026-11-04). The
       * gun drifts that way every burst, on top of side's noise. Left out, straight up.
       */
      angle: finite.refine((n) => Math.abs(n) <= 45, 'must be from −45 to 45').optional(),
      /**
       * Past this round of a burst the gun stops climbing (and drifting along angle); it
       * still bounces and shakes. Left out, it climbs until kick and recovery balance.
       */
      stableAfter: z.int().min(1).optional(),
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
    for (const slot of Object.keys(w.defaults ?? {}) as AttachmentSlot[]) {
      if (!slots.includes(slot)) {
        ctx.addIssue({
          code: 'custom',
          message: `comes with a ${slot} but has no ${slot} slot`,
          path: ['defaults', slot],
        });
      }
    }
    if (w.model.stockFold && !slots.includes('stock')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a folding stock mount needs a stock slot',
        path: ['model', 'stockFold'],
      });
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
    /** Which guns fire it: those whose own round has the same caliber. */
    caliber: z.string().min(1),
    /** Its penetration level, against an armor's level. */
    level: levelSchema,
    /**
     * Damage to the chest; other zones multiply it, then armor may stop some. Per pellet.
     */
    damage: positive,
    /** Armor durability lost per hit (per pellet), less against armor above its level. */
    armorDamage: nonNegative,
    /** Chance that a hit which gets through starts bleeding. */
    bleedChance: fraction,
    /** Shotgun shells: one round fires this many pellets, each its own hit. Defaults to 1. */
    pellets: z.int().min(2).optional(),
    /** With pellets: the most each pellet strays from the shot's line, in degrees. */
    pelletSpread: nonNegative.optional(),
    ...plainModel,
  })
  .refine((a) => (a.pellets === undefined) === (a.pelletSpread === undefined), {
    message: 'pellets and pelletSpread go together',
    path: ['pelletSpread'],
  });

/** What protects: armor's, and an armored rig's armor (2026-11-11). */
const armorStats = {
  /** Its protection level, against a round's level. */
  level: levelSchema,
  durability: positive,
  /**
   * The share of the durability a repair mends that comes off its max instead (Delta
   * Force's "durability cost", 2026-11-06; sim/repair.ts). REPAIR.loss if left out.
   */
  repairLoss: z.number().min(0).lt(1).optional(),
};

/** A carrier's plate slots (GZ-4): front and back, no sides. */
export const PLATE_SIDES = ['front', 'back'] as const;
export type PlateSide = (typeof PLATE_SIDES)[number];
/** The zones a carrier can cover (GZ-4; the stomach since GZ-3). */
export const COVER_ZONES = ['thorax', 'stomach'] as const;
export type CoverZone = (typeof COVER_ZONES)[number];
/** A plate's material (GZ-4): the item editor's preset; the stats are what count. */
export const PLATE_MATERIALS = ['ceramic', 'steel', 'polyethylene'] as const;

/**
 * Body armor or an armored rig as a plate carrier (GZ-4, 2026-11-12). One check per hit,
 * no layering: a plate in the side hit (front or back, by the hit's direction against
 * the body's facing) on a zone its plates cover; else its own soft rating (its level and
 * durability) on a zone that covers; else flesh. Without this, armor protects as before.
 */
const carrierSchema = z.strictObject({
  /** Its plate slots. Any plate fits any carrier with the slot. None if left out. */
  plates: z
    .array(z.enum(PLATE_SIDES))
    .refine((a) => new Set(a).size === a.length, 'lists a side twice')
    .optional(),
  /** What its plates cover. Left out, the thorax. */
  plateZones: z.array(z.enum(COVER_ZONES)).optional(),
  /** What its own (soft) rating covers. Left out: the thorax without plate slots, else nothing. */
  softZones: z.array(z.enum(COVER_ZONES)).optional(),
  /** The plates a new one comes with, by side (from a vendor, loot or a loadout). */
  comesWith: z.partialRecord(z.enum(PLATE_SIDES), idSchema).optional(),
  /** Bulky: no chest rig over it (as an armored rig shuts the armor slot). */
  blocksRig: z.literal(true).optional(),
  /** Footsteps carry this much further to enemies (1.2–1.3 for a heavy one). Left out, 1. */
  noise: z.number().min(0.5).max(3).optional(),
  /** Seconds to put a plate in, in a raid. Left out, CARRIER.swapTime. */
  swapTime: positive.optional(),
});
export type CarrierDef = z.infer<typeof carrierSchema>;

/** Defaults for carriers (GZ-4). */
export const CARRIER = { swapTime: 6 };

/**
 * What worn gear costs its wearer (GZ-1, 2026-11-12): helmets, body armor, rigs and
 * backpacks. Players only; enemies ignore it. Several worn together multiply. Left out, 1.
 */
const burden = {
  /** Aiming in takes this much longer (×): 1.1 is 10% slower. */
  aimTime: z.number().min(1).max(3).optional(),
  /**
   * Walking, sprinting and crouching speed (×): 0.88 is 12% slower (the user's call,
   * 2026-11-12, on top of weight's slowdown).
   */
  moveSpeed: z.number().min(0.5).max(1).optional(),
};

/** A plate (GZ-4): the protection that goes in a carrier's front or back slot. */
const plateSchema = z.strictObject({
  ...common,
  type: z.literal('plate'),
  ...armorStats,
  material: z.enum(PLATE_MATERIALS).optional(),
  ...plainModel,
});

/**
 * The hard shapes a helmet's view can have (GZ-2, 2026-11-12), drawn over the screen by the
 * client: an angular T-shaped visor slit, or cheek guards closing in at the bottom corners.
 */
export const VISION_SHAPES = ['slit', 'cheeks'] as const;
export type VisionShape = (typeof VISION_SHAPES)[number];

/** How much of the view a helmet (or a visor, GZ-5) takes: drawn over it, never a narrower field of view. */
const visionSchema = z.strictObject({
  /** A soft dark vignette round the edges, 0 (none) to 1 (heavy). */
  vignette: fraction.optional(),
  /** A hard shape (VISION_SHAPES) instead of or with the vignette. */
  shape: z.enum(VISION_SHAPES).optional(),
});

const armorSchema = z
  .strictObject({
    ...common,
    type: z.literal('armor'),
    /** A helmet covers the head, body armor the chest. */
    slot: z.enum(['helmet', 'body']),
    ...armorStats,
    ...burden,
    /**
     * Helmets (GZ-2): how much better (+) or worse (−) the wearer hears, as a share: −0.15
     * is 15% shorter and quieter. Only a helmet that blocks the headset slot may hear better
     * (integrated comms), so a boost never stacks with a headset's.
     */
    hearing: z.number().min(-0.9).max(1).optional(),
    /** Helmets (GZ-2): covers the ears, so no headset goes on with it. */
    blocksHeadset: z.literal(true).optional(),
    /** Helmets (GZ-2): what it takes of the view. */
    vision: visionSchema.optional(),
    /**
     * Helmets (GZ-3): it covers the face too (a full mask, Jug's), so a face hit with no
     * visor fitted meets it. Without it, a face hit with no visor is bare.
     */
    coversFace: z.literal(true).optional(),
    /**
     * Helmets (GZ-5): the mounts it has, a visor's and night vision's. Only one thing is
     * fitted at a time, whichever it is (Item.fitted).
     */
    visor: z.literal(true).optional(),
    nightVision: z.literal(true).optional(),
    /** Body armor (GZ-4): a plate carrier. */
    carrier: carrierSchema.optional(),
    /**
     * A helmet with a full face mask (AI-7, Jug's): worn by a player, it hides `edge` of the
     * view at each side (0–0.4 of the screen's width, fading in) and muffles every sound
     * above `muffle` Hz. Either left out does nothing.
     */
    mask: z
      .strictObject({
        edge: z.number().min(0).max(0.4).optional(),
        muffle: z.number().min(200).max(20000).optional(),
      })
      .optional(),
    ...plainModel,
  })
  .refine(
    (a) =>
      a.slot === 'helmet' ||
      (!a.hearing && !a.blocksHeadset && !a.vision && !a.visor && !a.nightVision && !a.coversFace),
    {
      message: 'only a helmet has hearing, blocksHeadset, vision, coversFace or mounts',
      path: ['hearing'],
    },
  )
  .refine((a) => a.slot === 'body' || !a.carrier, {
    message: 'only body armor is a carrier',
    path: ['carrier'],
  })
  .refine((a) => (a.hearing ?? 0) <= 0 || a.blocksHeadset, {
    message: 'only a helmet that blocks the headset slot hears better (integrated comms)',
    path: ['hearing'],
  });

/**
 * A visor (GZ-5): fitted to a helmet with a visor mount, it's armor for the face (GZ-3: a
 * head hit from the front, under the brow) with its own level and durability, and its
 * own view. Cracks spread over that view as it wears (drawn by the client).
 */
const visorSchema = z.strictObject({
  ...common,
  type: z.literal('visor'),
  ...armorStats,
  vision: visionSchema,
  ...plainModel,
});

/** The shapes night vision's view can have (GZ-5): one tube, or two side by side. */
export const NIGHT_VISION_SHAPES = ['tube', 'dual'] as const;

/**
 * Night vision goggles (GZ-5): fitted to a helmet's night vision mount and switched on, the
 * screen is drawn through them (client only): tinted, grainy, softer and brighter, inside
 * the tube's shape. They do little until there are night raids.
 */
const nightVisionSchema = z.strictObject({
  ...common,
  type: z.literal('nightVision'),
  /** The phosphor's color. */
  tint: z.string().regex(/^#[0-9a-f]{6}$/i, 'must be #rrggbb'),
  /** Grain and static, 0 (none) to 1. */
  noise: fraction,
  /** How soft the picture is, 0 (sharp) to 1: drawn at a lower resolution. */
  softness: fraction,
  /** How much brighter, 1 (none) or more. */
  gain: z.number().min(1).max(8),
  shape: z.enum(NIGHT_VISION_SHAPES),
  ...plainModel,
});

/** A headset (GZ-2): worn in its own slot, it makes the wearer hear further and louder. */
const headsetSchema = z.strictObject({
  ...common,
  type: z.literal('headset'),
  /** How much better the wearer hears, as a share: 0.2 is 20% further and louder. */
  hearing: z.number().min(0).max(1),
  ...plainModel,
});

/**
 * A reticle, drawn over the screen while aiming through an optic. Units are % of the
 * screen height from the aim point, with y down, so 50 reaches the top and bottom edges;
 * a scope's mask has a radius of SCOPE_RADIUS.
 */
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be #rrggbb');
/**
 * Each shape may have its own color (IE-2, 2026-11-09: a red center over black lines),
 * else it takes the reticle's. Arcs and triangles came then too; none changed a format.
 */
const shapeColor = { color: hexColor.optional() };
const reticleShapeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('dot'), x: finite, y: finite, r: positive, ...shapeColor }),
  z.strictObject({
    type: z.literal('line'),
    x1: finite,
    y1: finite,
    x2: finite,
    y2: finite,
    width: positive,
    ...shapeColor,
  }),
  z.strictObject({
    type: z.literal('ring'),
    x: finite,
    y: finite,
    r: positive,
    width: positive,
    ...shapeColor,
  }),
  /**
   * Part of a ring: from `from` clockwise to `to`, in degrees from straight up (0 up, 90
   * right), so `to` is above `from` by no more than a full turn.
   */
  z
    .strictObject({
      type: z.literal('arc'),
      x: finite,
      y: finite,
      r: positive,
      width: positive,
      from: finite,
      to: finite,
      ...shapeColor,
    })
    .refine((a) => a.to > a.from && a.to - a.from <= 360, {
      message: 'an arc runs clockwise from "from" to "to", more than 0 and at most 360 degrees',
      path: ['to'],
    }),
  /** A filled triangle, for chevrons. */
  z.strictObject({
    type: z.literal('triangle'),
    x1: finite,
    y1: finite,
    x2: finite,
    y2: finite,
    x3: finite,
    y3: finite,
    ...shapeColor,
  }),
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
  /** Hip spread only, on top of spread (lasers, 2026-11-11). */
  hipSpread: positive.optional(),
  /** Kick up and sideways. */
  recoil: positive.optional(),
  /** Kick up only, and sideways only, on top of recoil. */
  recoilUp: positive.optional(),
  recoilSide: positive.optional(),
  /** Multiplies how fast recoil wears off (above 1 recovers faster). Was `ergonomics` before 12. */
  recovery: positive.optional(),
  /** Ergonomics points added to the gun's (ERGO), less than 0 to take them off. */
  ergonomics: finite.optional(),
  /** Multiplies aim time after ergonomics (a magnified scope's slower look through it). */
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
    /**
     * Magazines (MG-1): the rounds it holds and their caliber, so it's a magazine item that
     * keeps its own rounds (one round type at a time). Without, a magazine-slot part is an
     * extension (a tube's), adding mods.magazine.
     */
    capacity: z.int().min(1).optional(),
    caliber: z.string().min(1).optional(),
    /** Optics only: how it looks through it. */
    optic: z
      .strictObject({
        /** Magnification. Above 1 is a scope: full-screen zoom behind a mask. */
        zoom: finite.refine((n) => n >= 1, 'must be 1 or more'),
        reticle: z.strictObject({
          color: hexColor,
          shapes: z.array(reticleShapeSchema).min(1),
        }),
      })
      .optional(),
    /**
     * Stocks only (WF-1, 2026-11-12): how many grid cells it adds to the gun's length
     * (its width, unrotated), and folded (`foldedLength`, 0 if left out). A folded stock
     * counts as not there: none of its mods apply. It folds if its model has a fold, or
     * the gun's stock mount does.
     */
    stock: z
      .strictObject({
        length: z.int().min(0),
        foldedLength: z.int().min(0).optional(),
      })
      .optional(),
    /**
     * WF-2 (2026-11-12): rows a fitted magazine adds under the gun (`magazine` slot only),
     * and columns a fitted muzzle device adds to its length (`muzzle` slot only). Most
     * add none; a drum or long magazine adds a row, a suppressor a column.
     */
    rows: z.int().min(0).optional(),
    columns: z.int().min(0).optional(),
    model: attachmentModelSchema,
  })
  .refine((a) => a.rows === undefined || a.slot === 'magazine', {
    message: 'only a magazine adds rows',
    path: ['rows'],
  })
  .refine((a) => a.columns === undefined || a.slot === 'muzzle', {
    message: 'only a muzzle device adds columns',
    path: ['columns'],
  })
  .refine((a) => (a.capacity === undefined) === (a.caliber === undefined), {
    message: 'a magazine needs both capacity and caliber',
    path: ['caliber'],
  })
  .refine((a) => a.capacity === undefined || (a.slot === 'magazine' && !a.mods?.magazine), {
    message: 'only a magazine-slot part holds rounds, and then it adds none (mods.magazine)',
    path: ['capacity'],
  })
  .refine((a) => a.capacity === undefined || !!a.weapons, {
    message: 'a magazine lists the guns it fits (weapons)',
    path: ['weapons'],
  })
  .refine((a) => (a.slot === 'stock') === !!a.stock, {
    message: 'stocks need a stock section, and only stocks may have one',
    path: ['stock'],
  })
  .refine((a) => a.slot === 'stock' || !a.model.fold, {
    message: 'only a stock folds',
    path: ['model', 'fold'],
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
    /**
     * heal only, optional (2026-11-09): it also stops bleeding, each bleeding zone costing
     * this much of its HP (or what's left), before it heals. Without it a heal never stops
     * a bleed.
     */
    bleedCost: positive.optional(),
    /** Played as a use starts. */
    sounds: z.strictObject({ use: soundId }),
    ...plainModel,
  })
  .refine((m) => (m.effect === 'heal') === (m.hp !== undefined), {
    message: 'heal needs hp, and only heal may have it',
    path: ['hp'],
  })
  .refine((m) => m.effect === 'heal' || m.bleedCost === undefined, {
    message: 'only a heal can stop bleeding from its hp',
    path: ['bleedCost'],
  })
  .refine((m) => m.effect !== 'heal' || m.uses === undefined, {
    message: 'heal uses up its hp, so it has no uses',
    path: ['uses'],
  });

/**
 * A section of a rig's or backpack's grid (2026-11-06): its top-left cell and size. An
 * item lies wholly in one section, so a rig of 1×2 pouches holds nothing wider than 1.
 */
const sectionSchema = z.strictObject({
  at: z.tuple([z.int().min(0), z.int().min(0)]),
  size: sizeSchema,
});

/**
 * Rigs and backpacks: worn in their slot, with a grid of their own. And the vault
 * (slot "vault", 2026-11-06): only ever shown equipped beside the player's vault grid
 * (VAULT_ITEM), never an item in the gear, a grid or anywhere else, so it can't be
 * moved, dropped or sold. Its grid is the vault's size (GEAR.vault).
 */
const containerSchema = z
  .strictObject({
    ...common,
    type: z.literal('container'),
    slot: z.enum(['rig', 'backpack', 'vault']),
    ...burden,
    /** The grid inside, [width, height] in cells: with sections, the box around them. */
    grid: sizeSchema,
    /**
     * The grid's sections, drawn apart with a gap (2026-11-06). Left out, the grid is one
     * section. Cells in no section hold nothing.
     */
    sections: z.array(sectionSchema).min(1).optional(),
    /**
     * An armored rig's armor (2026-11-11, the user's call): it covers the chest as body
     * armor does, with the same levels, wear and repairs, and body armor can't be worn
     * with it (gearConflict). Rigs only.
     */
    armor: z.strictObject({ ...armorStats, carrier: carrierSchema.optional() }).optional(),
    /**
     * For testing only (2026-10-31): given from the admin page's Admin tab, so keep it out of
     * loot tables, loadouts and vendors (as an admin spawner gun).
     */
    admin: z.literal(true).optional(),
    ...plainModel,
  })
  .refine((c) => !c.sections || sectionsProblem(c.grid, c.sections) === null, {
    message: 'sections must be inside the grid and not overlap',
    path: ['sections'],
  })
  .refine((c) => c.slot !== 'vault' || (!c.aimTime && !c.moveSpeed), {
    message: 'the vault is never worn, so it has no aim time or move speed',
    path: ['aimTime'],
  })
  .refine((c) => !c.armor || c.slot === 'rig', {
    message: 'only a rig can have armor',
    path: ['armor'],
  });

type SectionDef = z.infer<typeof sectionSchema>;

/** Why sections don't fit a grid of this size (outside it, or overlapping), or null. */
function sectionsProblem(grid: readonly [number, number], sections: readonly SectionDef[]) {
  for (let i = 0; i < sections.length; i++) {
    const {
      at: [x, y],
      size: [w, h],
    } = sections[i]!;
    if (x + w > grid[0] || y + h > grid[1]) return `section ${i + 1} is outside the grid`;
    for (let j = 0; j < i; j++) {
      const {
        at: [ox, oy],
        size: [ow, oh],
      } = sections[j]!;
      if (x < ox + ow && ox < x + w && y < oy + oh && oy < y + h)
        return `sections ${j + 1} and ${i + 1} overlap`;
    }
  }
  return null;
}

/** A rig's or backpack's sections as a grid has them, or undefined for one section. */
export function sectionsOf(
  def: ContainerDef,
): { x: number; y: number; w: number; h: number }[] | undefined {
  return def.sections?.map(({ at: [x, y], size: [w, h] }) => ({ x, y, w, h }));
}

/**
 * The knife. A swing hits the first body part in reach under the crosshair (or close to
 * it), like a shot: zone multipliers, then armor absorbs its share.
 */
const meleeSchema = z.strictObject({
  ...common,
  type: z.literal('melee'),
  /** Damage to the chest; other zones multiply it, as for ammo. */
  damage: positive,
  /** Its penetration level, as for ammo. */
  level: levelSchema,
  /** Armor durability lost per hit, as for ammo. */
  armorDamage: nonNegative,
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
 * smoke leaves a cloud enemies can't see through.
 */
export const GRENADE_EFFECTS = ['frag', 'smoke'] as const;
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
  /** Seconds from the throw until it goes off. */
  fuse: positive,
  /** How fast it leaves the hand, in m/s. */
  throwSpeed: positive,
  /**
   * It hurts out to here, in meters. A smoke's cloud is this big.
   */
  radius: positive,
  /**
   * Damage to the chest at the center; the other zones take their share (GRENADE.zones),
   * and it falls off further out. Then armor stops some, as for ammo. 0 hurts no one
   * (smoke).
   */
  damage: nonNegative,
  /** Its fragments' penetration level, as for ammo. */
  level: levelSchema,
  /** Armor durability lost per zone hit, as for ammo. */
  armorDamage: nonNegative,
  /** Chance that each zone hit which gets through starts bleeding. */
  bleedChance: fraction,
  /** How far away it can be heard going off (by AI), as for a gun. */
  loudness: positive,
  /** Smoke only: how long its cloud lasts, in seconds. */
  smokeTime: positive.optional(),
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
  /**
   * What kind of loot it is (2026-11-09), a name as shown, in title case: "Electronics",
   * "Industrial". Item details shows it as written in place of "Loot". Any name: the
   * item editor offers the ones items already use and makes new ones. Set on the item, not
   * taken from its loot tables, since one item is in several tables. Left out, it shows as
   * "Loot".
   */
  category: z.string().trim().min(1).max(40).optional(),
  ...plainModel,
});

/** Armor repair kits. */
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
  armorSchema,
  attachmentSchema,
  medSchema,
  containerSchema,
  meleeSchema,
  grenadeSchema,
  keySchema,
  questSchema,
  lootSchema,
  repairSchema,
  headsetSchema,
  visorSchema,
  nightVisionSchema,
  plateSchema,
]);

export type ItemDef = z.infer<typeof itemSchema>;
export type WeaponDef = z.infer<typeof weaponSchema>;
export type AmmoDef = z.infer<typeof ammoSchema>;
export type ArmorDef = z.infer<typeof armorSchema>;
export type AttachmentDef = z.infer<typeof attachmentSchema>;
export type MedDef = z.infer<typeof medSchema>;
export type MeleeDef = z.infer<typeof meleeSchema>;
export type GrenadeDef = z.infer<typeof grenadeSchema>;
export type ContainerDef = z.infer<typeof containerSchema>;
export type RepairDef = z.infer<typeof repairSchema>;
export type HeadsetDef = z.infer<typeof headsetSchema>;
export type VisorDef = z.infer<typeof visorSchema>;
export type PlateDef = z.infer<typeof plateSchema>;

/** An item's carrier settings (GZ-4): body armor's or an armored rig's, or null. */
export function carrierOf(def: ItemDef): CarrierDef | null {
  if (def.type === 'armor') return def.carrier ?? null;
  if (def.type === 'container') return def.armor?.carrier ?? null;
  return null;
}

/** What a carrier's own soft rating covers (GZ-4; see softZones). */
export function softZonesOf(carrier: CarrierDef): readonly CoverZone[] {
  return carrier.softZones ?? (carrier.plates?.length ? [] : ['thorax']);
}
export type NightVisionDef = z.infer<typeof nightVisionSchema>;

/** Whether a helmet takes a part (GZ-5): a visor on a visor mount, goggles on a night vision one. */
export function mountsOn(helmet: ItemDef, part: ItemDef): boolean {
  if (helmet.type !== 'armor' || helmet.slot !== 'helmet') return false;
  return (
    (part.type === 'visor' && !!helmet.visor) ||
    (part.type === 'nightVision' && !!helmet.nightVision)
  );
}
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
        case 'armor':
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
    // Levels. Each round becomes its own caliber so its guns still fire it; armor's level
    // is guessed from how much it absorbed; old armor damage was per point absorbed.
    8: (doc) => {
      switch (doc.type) {
        case 'ammo':
          return {
            ...doc,
            caliber: doc.id,
            level: 1,
            armorDamage: 10 * Number(doc.armorDamage ?? 1),
          };
        case 'melee':
          return { ...doc, level: 1, armorDamage: 5 };
        case 'armor': {
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
    // Recoil springs: a middling snap, and recovery from degrees a second to a rate, guessed.
    9: (doc) => {
      if (doc.type !== 'weapon') return doc;
      const recoil = doc.recoil as { recovery: number };
      return {
        ...doc,
        recoil: { ...recoil, snap: 40, recovery: Math.max(1, recoil.recovery / 3) },
      };
    },
    // Weights, guessed from the type (the content files set their own). An older file
    // given its weight by hand keeps it.
    10: (doc) => ({ ...doc, weight: doc.weight ?? weightGuess(doc.type) }),
    // Ergonomics from the aim time (ERGO's fit), and the old ergonomics multiplier as
    // recovery. A stock's aim time becomes points, as the content's were converted.
    11: (doc) => {
      if (doc.type === 'weapon') {
        const { aimTime, drawTime: _, ...rest } = doc as { aimTime?: number; drawTime?: number };
        if (aimTime === undefined) return rest;
        return { ...rest, ergonomics: Math.round((ERGO.aimAt0 - aimTime) / ERGO.aimPerPoint) };
      }
      if (doc.type !== 'attachment' || !doc.mods) return doc;
      const { ergonomics, aimTime, ...mods } = doc.mods as Record<string, number | undefined>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(mods)) if (v !== undefined) out[k] = v;
      if (ergonomics !== undefined) out.recovery = ergonomics;
      if (aimTime !== undefined && doc.slot === 'stock')
        out.ergonomics = Math.round((1 - aimTime) * 60);
      else if (aimTime !== undefined) out.aimTime = aimTime;
      return { ...doc, mods: out };
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

/** A first weight for a new item of a type, in kg (the migration's, and the item editor's). */
export function weightGuess(type: unknown): number {
  return WEIGHT_GUESSES[type as string] ?? 0.5;
}

/** Kg by type, for the format 10 → 11 migration; a stacking item's is per one. */
const WEIGHT_GUESSES: Record<string, number> = {
  weapon: 3,
  ammo: 0.015,
  armor: 2,
  plate: 3,
  attachment: 0.2,
  med: 0.2,
  container: 1,
  melee: 0.3,
  grenade: 0.4,
  key: 0.02,
  loot: 0.5,
  repair: 1.5,
};

const VALUE_GUESSES: Record<string, number> = {
  weapon: 10_000,
  ammo: 30,
  armor: 10_000,
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

/**
 * A gun's ergonomics with its attachments' points (ERGO): a folded stock counts as not
 * there (WF-1). Clamped to 0–100.
 */
export function ergonomicsOf(
  items: ItemDb,
  w: {
    item: string;
    attachments: Readonly<Partial<Record<AttachmentSlot, string | null>>>;
    folded?: boolean | undefined;
  },
): number {
  let points = weaponDef(items, w.item).ergonomics;
  for (const slot of ATTACHMENT_SLOTS) {
    const id = w.attachments[slot];
    if (!id || (slot === 'stock' && w.folded)) continue;
    points += attachmentDef(items, id).mods?.ergonomics ?? 0;
  }
  return Math.max(0, Math.min(100, points));
}
export const ammoDef = (items: ItemDb, id: string): AmmoDef => itemOf(items, id, 'ammo');
export const armorDef = (items: ItemDb, id: string): ArmorDef => itemOf(items, id, 'armor');

/** What protects: armor's level, durability and repair loss, or an armored rig's. */
export type ArmorStats = z.infer<z.ZodObject<typeof armorStats>>;

/** An item's armor (2026-11-11): armor's own, an armored rig's, or null. */
export function armorOf(def: ItemDef): ArmorStats | null {
  if (def.type === 'armor' || def.type === 'visor' || def.type === 'plate') return def;
  if (def.type === 'container') return def.armor ?? null;
  return null;
}

/** An item's armor by id (armorOf); throws if it has none. */
export function armorStatsOf(items: ItemDb, id: string): ArmorStats {
  const a = armorOf(itemDef(items, id));
  if (!a) throw new Error(`item "${id}" has no armor`);
  return a;
}

/** Whether an item is a rig with armor (2026-11-11). */
export const isArmoredRig = (def: ItemDef): boolean =>
  def.type === 'container' && def.slot === 'rig' && !!def.armor;

/** An armor level's rarity, 1–6 common to mythic (2026-11-04): armor's and armored rigs'. */
export const levelRarity = (level: number): Rarity =>
  RARITIES[Math.min(RARITIES.length, Math.max(1, Math.round(level))) - 1]!;
export const attachmentDef = (items: ItemDb, id: string): AttachmentDef =>
  itemOf(items, id, 'attachment');
export const medDef = (items: ItemDb, id: string): MedDef => itemOf(items, id, 'med');
export const meleeDef = (items: ItemDb, id: string): MeleeDef => itemOf(items, id, 'melee');
export const grenadeDef = (items: ItemDb, id: string): GrenadeDef => itemOf(items, id, 'grenade');
/** What a grenade does: its effect, a frag if it doesn't say. */
export const grenadeEffect = (def: GrenadeDef): GrenadeEffect => def.effect ?? 'frag';

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

/** Whether an item is a magazine that holds its own rounds (MG-1). */
export function isMagazine(
  def: ItemDef,
): def is AttachmentDef & { capacity: number; caliber: string } {
  return def.type === 'attachment' && def.capacity !== undefined;
}

/** Whether a gun takes magazine items (MG-1). */
export const magazineFed = (def: WeaponDef): boolean => def.feed === 'magazine';

/** Whether the stock on a gun folds: the stock folds by itself, or the gun's mount does. */
export function stockFolds(
  items: ItemDb,
  gun: { item: string; attachments?: Record<AttachmentSlot, string | null> },
): boolean {
  const id = gun.attachments?.stock;
  if (!id) return false;
  return !!weaponDef(items, gun.item).model.stockFold || !!attachmentDef(items, id).model.fold;
}

/**
 * An item's size in a grid, [width, height] unrotated: its own, and for a gun its length
 * grows by its stock's (folded or not, WF-1) and its muzzle device's columns, and its
 * height by its magazine's rows (WF-2). Allocates nothing unless a gun grows.
 */
export function itemSize(
  items: ItemDb,
  item: { item: string; attachments?: Record<AttachmentSlot, string | null>; folded?: true },
): readonly [number, number] {
  const def = itemDef(items, item.item);
  const a = def.type === 'weapon' ? item.attachments : undefined;
  if (!a) return def.size;
  let w = 0;
  let h = 0;
  if (a.stock) {
    const s = attachmentDef(items, a.stock).stock;
    w += (item.folded ? s?.foldedLength : s?.length) ?? 0;
  }
  if (a.muzzle) w += attachmentDef(items, a.muzzle).columns ?? 0;
  if (a.magazine) h += attachmentDef(items, a.magazine).rows ?? 0;
  return w || h ? [def.size[0] + w, def.size[1] + h] : def.size;
}

/** What a gun can be loaded with: ammo. */
export type RoundDef = AmmoDef;

/** An item as something a gun can load (ammo), or null if it isn't. */
export function roundOf(items: ItemDb, id: string): RoundDef | null {
  const def = items.get(id);
  return def?.type === 'ammo' ? def : null;
}

/** A round's caliber. */
export const roundCaliber = (round: RoundDef): string => round.caliber;

/** The caliber a gun fires: its own round's. */
export function caliberOf(items: ItemDb, weapon: WeaponDef): string {
  const round = roundOf(items, weapon.ammo);
  if (!round) throw new Error(`item "${weapon.ammo}" is not a round`);
  return roundCaliber(round);
}

/** Whether a gun fires an item: a round of its caliber. */
export function firesRound(items: ItemDb, weapon: WeaponDef, id: string): boolean {
  const round = roundOf(items, id);
  return !!round && roundCaliber(round) === caliberOf(items, weapon);
}

/**
 * Checks references between items: a weapon's ammo exists and is ammo, a grenade has the fields its effect needs, and an
 * attachment's guns exist and have its slot.
 */
export function checkItems(items: ItemDb): void {
  for (const item of items.values()) {
    const source = `content/items/${item.id}.json`;
    if (COMMON_TYPES.has(item.type) && item.rarity !== 'common') {
      throw new ContentError(source, `a ${item.type} is always common, not ${item.rarity}`);
    }
    if (item.type === 'weapon') {
      const ammo = roundOf(items, item.ammo);
      if (!ammo) {
        throw new ContentError(source, `ammo "${item.ammo}" is not an ammo item`);
      }
      if (magazineFed(item)) {
        const id = item.defaults?.magazine;
        const mag = id ? items.get(id) : undefined;
        if (!mag || !isMagazine(mag)) {
          throw new ContentError(source, 'a magazine-fed gun comes with a magazine (defaults)');
        }
        if (mag.capacity !== item.magazine) {
          throw new ContentError(
            source,
            `magazine is ${item.magazine}, its magazine holds ${mag.capacity}`,
          );
        }
      }
      for (const [slot, id] of Object.entries(item.defaults ?? {})) {
        const part = items.get(id);
        if (part?.type !== 'attachment' || part.slot !== slot) {
          throw new ContentError(source, `default ${slot} "${id}" is not a ${slot} attachment`);
        }
        if (!fits(item, part)) {
          throw new ContentError(source, `default ${slot} "${id}" doesn't fit it`);
        }
      }
    }
    const carrier = carrierOf(item);
    for (const [side, id] of Object.entries(carrier?.comesWith ?? {})) {
      if (items.get(id)?.type !== 'plate') throw new ContentError(source, `"${id}" is not a plate`);
      if (!carrier!.plates?.includes(side as PlateSide))
        throw new ContentError(source, `comes with a ${side} plate but has no ${side} slot`);
    }
    if (item.type === 'grenade') {
      const effect = grenadeEffect(item);
      if ((effect === 'smoke') !== (item.smokeTime !== undefined)) {
        throw new ContentError(source, 'a smoke grenade needs smokeTime, and only it');
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
        if (item.slot === 'magazine' && isMagazine(item) !== magazineFed(weapon)) {
          throw new ContentError(
            source,
            isMagazine(item)
              ? `weapon "${id}" doesn't take magazines (feed)`
              : `weapon "${id}" takes magazines, and this holds no rounds (capacity)`,
          );
        }
        if (isMagazine(item) && item.caliber !== caliberOf(items, weapon)) {
          throw new ContentError(source, `weapon "${id}" fires ${caliberOf(items, weapon)}`);
        }
      }
    }
  }
}

import { z } from 'zod';
import { ContentError, type ContentFormat } from './format';
import { attachmentDef, firesRound, fits, weaponDef, type ItemDb } from './items';
import type { Shape } from './compile';
import { modelShapes, partSchema } from './models';
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

export const ENEMY_FORMAT_VERSION = 2;
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
  /**
   * Its whole field of view in degrees (AI rework session 2): scavs see less to the sides
   * than PMCs. Left out, AI.fov (120).
   */
  fov: finite.refine((n) => n >= 30 && n <= 180, 'must be from 30 to 180').optional(),
  /**
   * How erratic it moves, 0–1 (AI rework session 2, scavs): sudden stops, crouches and
   * short sprints at random while walking about, and random crouches while fighting. 1 is
   * about one every AI.quirkEvery seconds. Left out, 0: never.
   */
  erratic: fraction.optional(),
  /**
   * Seconds in cover before peeking out again, [min, max] (AI rework session 5): PMCs spend
   * less time in cover than scavs. Left out, AI.coverTime.
   */
  coverTime: z
    .tuple([nonNegative, nonNegative])
    .refine(([min, max]) => min <= max, 'min must not be above max')
    .optional(),
  /**
   * Rounds per burst from an automatic, [min, max], and seconds between bursts, [min, max]
   * (2026-11-08: PMCs fire longer bursts than scavs). Left out, AI.closeBurst or farBurst
   * by distance and AI.burstPause (Jug: JUG.burst and burstPause). The pause still grows
   * with distance, except Jug's.
   */
  burst: z
    .tuple([z.int().min(1), z.int().min(1)])
    .refine(([min, max]) => min <= max, 'min must not be above max')
    .optional(),
  burstPause: z
    .tuple([nonNegative, nonNegative])
    .refine(([min, max]) => min <= max, 'min must not be above max')
    .optional(),
  /**
   * Close in (2026-11-08, PMCs, after Tarkov's): within `range` metres it sprays full auto,
   * bursts of `burst` rounds `pause` seconds apart, in place of `burst` and `burstPause`.
   * Left out, the same bursts at any range.
   */
  spray: z
    .strictObject({
      range: positive,
      burst: z
        .tuple([z.int().min(1), z.int().min(1)])
        .refine(([min, max]) => min <= max, 'min must not be above max'),
      pause: z
        .tuple([nonNegative, nonNegative])
        .refine(([min, max]) => min <= max, 'min must not be above max'),
    })
    .optional(),
  /**
   * Sprints as a move, not to get about (2026-11-08, the user's call; PMCs and bosses):
   * alerted without seeing its target, it sprints to close the gap until it first sees it;
   * leaving the raid, it sprints across open ground. (Flanking, going to cover out of sight,
   * running from grenades and rushing a reload or heal sprint for everyone that does them.)
   */
  sprints: z.boolean().optional(),
  /**
   * Its target breaking line of sight, the chance it decides to rush its position at a
   * sprint, as if it had heard a reload (2026-11-08, PMCs): one of a squad at a time.
   */
  pushChance: fraction.optional(),
  /** Sprints to cover rather than backing into it facing you (AI rework session 5). */
  sprintToCover: z.boolean().optional(),
  /**
   * Hears a player reloading or using a med within this many metres, walls or not, and
   * pushes round the corner at them (AI rework session 5). Left out, 0: never.
   */
  listen: nonNegative.optional(),
  /**
   * Hears this many times as far as anyone else (AI-7, Jug): footsteps, gunfire, blasts
   * and glass. Left out, 1.
   */
  hearing: positive.optional(),
  /**
   * Checks what it hears at once and fast (AI-7, Jug): a short look, then straight there at
   * a full walk, without stopping short to watch, and never held back by AI.responders.
   */
  bold: z.boolean().optional(),
  /**
   * Never takes cover (AI-7, Jug): walks at you firing, and sprints after you out of sight.
   */
  charge: z.boolean().optional(),
  /** Sprint-slides at you and round corners, firing mid-slide (AI-7: Jug's alone). */
  slide: z.boolean().optional(),
  /**
   * Hit by someone, it hunts them along the way they go until one of them is dead (AI-7,
   * Jug): it never searches, gives up or goes back to its patrol meanwhile.
   */
  relentless: z.boolean().optional(),
  /**
   * Keeps to its ground (2026-11-08, Jug): within this many metres of its patrol (its spawn
   * without one). Other AI's gunfire, blasts and glass draw it only from there, as do its
   * allies' fights with AI; players' draw it anywhere. Left out, it goes wherever it hears.
   */
  territory: positive.optional(),
  /**
   * With a territory, how far beyond it a player's noise draws it out to check (2026-11-08,
   * Jug: 45 m): further, it only turns to look and stays on its ground. Left out, any
   * distance it would check at.
   */
  roam: nonNegative.optional(),
  /**
   * Holds its ground (MT-12, the foreman's crew): with a territory, it never closes in on,
   * pushes at or searches for a target further off it than roam (2026-11-11; it was off
   * the territory itself), and out of sight with its target that far off it goes back to
   * its patrol. A flanker (pinFlank) still goes where its spot is.
   */
  anchored: z.boolean().optional(),
  /**
   * Flanks only when you're pinned (MT-12, the foreman's crew): with its target out of the
   * whole squad's sight, everyone holds and fires at its cover; once it has been out of
   * sight `after` seconds within `within` metres of where they last saw it, one member (not
   * the leader) flanks, one at a time. Left out, the usual split (the last half flank).
   */
  pinFlank: z.strictObject({ after: positive, within: positive }).optional(),
  /**
   * Treats itself (2026-11-08, PMCs): bandages bleeding, splints a broken limb and uses a
   * medkit when badly hurt, from what it carries, never a surgery kit. Calm, whenever it
   * needs to; fighting, only out of its target's sight, in cover nearby if there is any.
   */
  heals: z.boolean().optional(),
  /**
   * Kicks doors open and smashes glass in its way while alert (AI-8, Jug): an unlocked door
   * from further off than others open one, without slowing, heard by enemies nearby.
   */
  smash: z.boolean().optional(),
  /**
   * Badly hurt by someone it can't see, it drops a smoke at its feet (if it carries one),
   * fires blind down the line the hits came from and charges through it (AI-8, Jug).
   */
  enrage: z.boolean().optional(),
  /**
   * Heavy rounds throw its aim off hard and stop it firing for a moment (AI-8, Jug): a
   * weakness, not a strength.
   */
  stagger: z.boolean().optional(),
});

/**
 * The body's bones that plating can ride, by body part (L is the body's left, −x facing −z).
 * The client maps them onto its rig.
 */
export const BODY_BONES = [
  'hips',
  'belly',
  'chest',
  'upperChest',
  'neck',
  'head',
  'upperArmL',
  'upperArmR',
  'forearmL',
  'forearmR',
  'handL',
  'handR',
  'thighL',
  'thighR',
  'shinL',
  'shinR',
  'footL',
  'footR',
  'toeL',
  'toeR',
] as const;
export type BodyBone = (typeof BODY_BONES)[number];

/**
 * Shapes that are part of the body, not gear (2026-11-08, Jug's limb plates): drawn always,
 * never looted, and only looks (they stop nothing). Modelled like worn gear, on the body in
 * its rest pose (a T-pose: arms out along x, palms down), each group moving rigidly with
 * its bone. `mirror` draws a copy on the other side too (x flipped, onto the L/R twin).
 */
const platingSchema = z.strictObject({
  bone: z.enum(BODY_BONES),
  mirror: z.boolean().optional(),
  parts: z.array(partSchema).min(1),
});
export type Plating = z.infer<typeof platingSchema>;

/** The colours of its body, by part. Gear is drawn over it. */
export const outfitSchema = z.strictObject({
  skin: hexColourSchema,
  /** Torso and arms. */
  top: hexColourSchema,
  /** Hips and legs. */
  bottom: hexColourSchema,
  hands: hexColourSchema,
  feet: hexColourSchema,
  /** Plating on the body itself, if any (see platingSchema). */
  plating: z.array(platingSchema).optional(),
});

/** A shape reflected across x = 0: the same thing on the body's other side. */
export function mirrorShape(s: Shape): Shape {
  const out = { ...s, x: -s.x, yaw: -s.yaw, roll: -s.roll };
  if (out.kind === 'slab') {
    const [bl, br, fr, fl] = out.corners;
    out.corners = [br, bl, fl, fr];
  } else if (out.kind === 'box') {
    if (out.bulge) {
      const [nx, px, ...rest] = out.bulge;
      out.bulge = [px, nx, ...rest];
    }
    if (out.lean) out.lean = [-out.lean[0], out.lean[1]];
  }
  return out;
}

/** The other side's bone: L for R and R for L; the middle's own. */
function twinBone(bone: BodyBone): BodyBone {
  const last = bone.at(-1);
  if (last === 'L') return `${bone.slice(0, -1)}R` as BodyBone;
  if (last === 'R') return `${bone.slice(0, -1)}L` as BodyBone;
  return bone;
}

/** An outfit's plating as shapes by bone, mirrored groups doubled. */
export function platingShapes(
  plating: readonly Plating[] | undefined,
): { bone: BodyBone; shapes: Shape[] }[] {
  const out: { bone: BodyBone; shapes: Shape[] }[] = [];
  for (const group of plating ?? []) {
    const shapes = modelShapes(group);
    out.push({ bone: group.bone, shapes });
    if (group.mirror) out.push({ bone: twinBone(group.bone), shapes: shapes.map(mirrorShape) });
  }
  return out;
}

/**
 * Who it sides with (format 2, AI rework session 1; design.md → AI → Scavs, PMCs and
 * bosses). Scavs and bosses are allies; PMCs are hostile to everyone, and everyone is
 * hostile to players. See hostile() in sim/ai.ts.
 */
export const FACTIONS = ['scav', 'pmc', 'boss'] as const;
export const factionSchema = z.enum(FACTIONS);

export const enemySchema = z.strictObject({
  formatVersion: z.literal(ENEMY_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  faction: factionSchema,
  /** The loadout it rolls, unless its spawn names another. */
  loadout: idSchema,
  skill: skillSchema,
  /**
   * The looks it can have; each spawn picks one at random (format 2). A plain default
   * outfit if left out.
   */
  outfits: z.array(outfitSchema).min(1).optional(),
  /**
   * Its arms' and legs' HP, as a multiple of everyone's (2026-11-08, the user's call for
   * Jug: 2). Head and chest are as anyone's. 1 if left out.
   */
  limbHealth: positive.optional(),
  /**
   * Its guards (MT-12, the foreman's crew): `count` of enemy type `enemy`, put in round it
   * where it spawns as its squad (it leads), following it on its patrol and sharing it.
   * None if left out; an optional field, so still format 2.
   */
  guards: z.strictObject({ enemy: idSchema, count: z.int().min(1) }).optional(),
  /**
   * What it says (AI rework session 5): sound ids in content/sounds. `callout` is shouted
   * when a squad member spots someone, `grenade` as it throws one (AI-6), and `breathe` and
   * `mutter` now and then while calm or hunting someone gone quiet (AI-8, Jug). Silent if
   * left out.
   */
  voice: z
    .strictObject({
      callout: idSchema.optional(),
      grenade: idSchema.optional(),
      breathe: idSchema.optional(),
      mutter: idSchema.optional(),
    })
    .optional(),
  /**
   * Its footsteps (AI-8: Jug's clanking plates), a sound id in content/sounds, heard
   * further than a footstep. The usual footstep if left out.
   */
  steps: idSchema.optional(),
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

const grenadeOptionSchema = z.strictObject({
  weight: positive,
  /** null: none. A grenade to throw (not a launcher's round). */
  item: idSchema.nullable(),
  /** How many, rolled between these. Defaults to [1, 1]. */
  count: rangeOf(z.int().min(1)).optional(),
});

const medOptionSchema = z.strictObject({
  weight: positive,
  /** null: none. A med (bandage, medkit…). */
  item: idSchema.nullable(),
  /** How many, rolled between these. Defaults to [1, 1]. */
  count: rangeOf(z.int().min(1)).optional(),
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
  /**
   * Grenades it carries (AI-6), stowed first so they're in its pockets: an enemy carrying a
   * frag throws it when it loses you (sim/ai.ts considerThrow). None if left out.
   */
  grenades: z.array(grenadeOptionSchema).optional(),
  /**
   * Meds it carries (2026-11-08): groups, each rolling one option by weight (say medkits:
   * one usually, two sometimes, none sometimes; and bandages), stowed after grenades and
   * before spare rounds so they're in its pockets or rig. An enemy that heals
   * (skill.heals) uses them. None if left out.
   */
  meds: z.array(z.array(medOptionSchema).min(1)).optional(),
  /**
   * Items it always carries (TU-2, 2026-11-09: the tutorial scav's front door key), stowed
   * before anything else so they're in its pockets. None if left out; an optional field,
   * so still format 1.
   */
  carried: z.array(z.strictObject({ item: idSchema, count: z.int().min(1).optional() })).optional(),
});

export type EnemyDef = z.infer<typeof enemySchema>;
export type Faction = z.infer<typeof factionSchema>;
export type EnemySkill = z.infer<typeof skillSchema>;
export type Outfit = z.infer<typeof outfitSchema>;
export type EnemyLoot = NonNullable<EnemyDef['loot']>;
export type MedOption = z.infer<typeof medOptionSchema>;
export type LoadoutDef = z.infer<typeof loadoutSchema>;
export type WeaponOption = z.infer<typeof weaponOptionSchema>;
export type ArmourOption = z.infer<typeof armourOptionSchema>;
export type ContainerOption = z.infer<typeof containerOptionSchema>;
export type GrenadeOption = z.infer<typeof grenadeOptionSchema>;

export const ENEMY_FORMAT: ContentFormat<EnemyDef> = {
  kind: 'enemy',
  version: ENEMY_FORMAT_VERSION,
  schema: enemySchema,
  // Format 2 (AI rework session 1): a faction, scav unless the file says otherwise (the
  // yard boss's file was rewritten as a boss), and a list of outfits in place of one.
  migrations: {
    1: (doc) => {
      const { outfit, ...rest } = doc;
      return {
        ...rest,
        faction: 'scav',
        ...(outfit === undefined ? {} : { outfits: [outfit] }),
      };
    },
  },
};

export const LOADOUT_FORMAT: ContentFormat<LoadoutDef> = {
  kind: 'loadout',
  version: LOADOUT_FORMAT_VERSION,
  schema: loadoutSchema,
  migrations: {},
};

/**
 * Checks references: every enemy's loadout exists, and every loadout's items exist, are
 * the right type (grenades ones to throw), and its attachments fit their gun.
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
    const g = e.guards?.enemy;
    if (g !== undefined && (!enemies.has(g) || enemies.get(g)!.guards)) {
      throw new ContentError(
        `content/enemies/${e.id}.json`,
        enemies.has(g) ? `its guards "${g}" have guards of their own` : `no enemy type "${g}"`,
      );
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
    for (const o of l.grenades ?? []) {
      if (o.item === null) continue;
      const item = items.get(o.item);
      if (item?.type !== 'grenade' || item.calibre !== undefined)
        throw new ContentError(source, `"${o.item}" is not a grenade to throw`);
    }
    for (const group of l.meds ?? [])
      for (const o of group) {
        if (o.item === null) continue;
        if (items.get(o.item)?.type !== 'med')
          throw new ContentError(source, `"${o.item}" is not a med`);
      }
    for (const k of l.carried ?? [])
      if (!items.has(k.item)) throw new ContentError(source, `no item "${k.item}"`);
  }
}

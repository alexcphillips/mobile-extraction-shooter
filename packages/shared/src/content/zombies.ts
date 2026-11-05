import { z } from 'zod';
import type { ContentFormat } from './format';
import { outfitSchema } from './enemies';
import { idSchema } from './schema';

/*
 * Zombies modes (content/zombies/<id>.json), from 2026-11-04 (docs/design.md → Zombies): a
 * separate game, not a raid. A map, the kit everyone starts with, the zombie, how the rounds
 * get harder, the points, and what the mystery box gives. What each buy spot sells and what
 * it costs is on the map's markers, and a door's price on the door.
 */

export const ZOMBIES_FORMAT_VERSION = 1;

/** The power-ups a zombie can drop. */
export const POWERUPS = [
  'instaKill',
  'maxAmmo',
  'doublePoints',
  'carpenter',
  'deathMachine',
] as const;
export type Powerup = (typeof POWERUPS)[number];

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');
const fraction = finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1');
const points = z.int().min(0);

export const zombiesSchema = z.strictObject({
  formatVersion: z.literal(ZOMBIES_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1),
  /** A map id in content/maps, with zombie spawns. */
  map: idSchema,
  /** A starting kit (content/starting-kits) everyone starts with; nothing comes from the stash. */
  kit: idSchema,
  zombie: z.strictObject({
    name: z.string().min(1),
    outfit: outfitSchema,
    /** The melee item it fights with, in its hand. */
    claws: idSchema,
  }),
  rounds: z.strictObject({
    /** Zombies in round 1... */
    first: z.int().min(1),
    /** ...and this many more each round after. */
    perRound: nonNegative,
    /** At most this many alive at once; the rest wait their turn. */
    maxAlive: z.int().min(1),
    /** Seconds between one zombie climbing in and the next. */
    spawnEvery: positive,
    /** Seconds from the last zombie of a round dying to the next round (and before round 1). */
    breakTime: positive,
    /** Its health, as a multiple of a player's, in round 1... */
    health: positive,
    /** ...and this much more each round after. They never get faster. */
    healthPerRound: nonNegative,
  }),
  points: z.strictObject({
    /** What everyone starts with. */
    start: points,
    /** For each hit on a zombie that doesn't kill it (once per zombie per tick). */
    hit: points,
    kill: points,
    /** A kill with the knife. */
    meleeKill: points,
  }),
  /** Players' one health bar (no limbs): its HP, and its refill once not hurt for a while. */
  player: z.strictObject({
    health: positive,
    /** Seconds without being hurt before it refills... */
    regenDelay: nonNegative,
    /** ...at this many HP a second. */
    regenRate: positive,
  }),
  /** Barricaded windows (the map's barricade nodes). */
  barricades: z.strictObject({
    /** Seconds a held use button takes to nail up each plank. */
    rebuildTime: positive,
    /** Points per plank nailed up... */
    rebuildPoints: points,
    /** ...up to this many a player each round. */
    rebuildCap: points,
    /** Seconds a zombie at the window takes to tear off each plank. */
    tearTime: positive,
  }),
  /**
   * Power-ups a zombie may drop where it dies (2026-11-04): picked up by walking over them.
   * Insta-kill and double points last `duration`; max ammo fills every player's spare
   * rounds (not what's loaded); carpenter boards every window back up and pays its points;
   * the death machine puts `minigun` in your hands for `duration`.
   */
  powerups: z.strictObject({
    /** The chance a zombie killed by a player drops one... */
    chance: fraction,
    /** ...up to this many a round. */
    perRound: z.int().min(0),
    /** Seconds one lies there before it goes. */
    lifetime: positive,
    duration: positive,
    carpenterPoints: points,
    /** A weapon item with infiniteAmmo. */
    minigun: idSchema,
    /** Which drops, by weight; one left out never drops. */
    weights: z.partialRecord(z.enum(POWERUPS), positive),
  }),
  /** Buying a gun or its ammo fills its magazine and this many magazines spare. */
  spareMags: z.int().min(0),
  /** The mystery box's guns, by weight. */
  box: z.array(z.strictObject({ weight: positive, item: idSchema })).min(1),
});

export type ZombiesDef = z.infer<typeof zombiesSchema>;

export const ZOMBIES_FORMAT: ContentFormat<ZombiesDef> = {
  kind: 'zombies mode',
  version: ZOMBIES_FORMAT_VERSION,
  schema: zombiesSchema,
  migrations: {},
};

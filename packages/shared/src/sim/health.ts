import { armorDef, armorStatsOf, type AmmoDef, type ItemDb } from '../content/items';
import type { Item } from '../inventory/grid';
import { chance } from '../rng';
import { TICK_SECONDS } from '../tick';
import { hostile } from './factions';
import { chestArmor } from './gear';
import { punchAim } from './recoil';
import { maxDurability } from './repair';
import type { Character, EntityId, SimState } from './state';

/** Hit zones, as indices into Health's arrays. */
export const HEAD = 0;
export const CHEST = 1;
export const LEFT_ARM = 2;
export const RIGHT_ARM = 3;
export const LEFT_LEG = 4;
export const RIGHT_LEG = 5;
export type Zone = 0 | 1 | 2 | 3 | 4 | 5;
export const ZONE_COUNT = 6;
export const ZONE_NAMES = ['head', 'chest', 'left arm', 'right arm', 'left leg', 'right leg'];

/** Damage and health tuning. Arrays are by zone. */
export const HEALTH = {
  maxHp: [35, 85, 60, 60, 65, 65],
  /** Shot damage multipliers. Falls and bleeding ignore them. */
  multiplier: [1, 1, 0.7, 0.7, 0.75, 0.75],
  /**
   * Damage to a broken limb, or beyond what breaks it, is spread evenly over every zone
   * with HP left (head included, as in Tarkov) at this rate.
   */
  spillover: 0.7,
  /**
   * HP per second lost to bleeding in all, however many zones bleed: it's split evenly
   * between them, so more wounds don't bleed faster (design.md → Damage).
   */
  bleedRate: 0.6,
  /** Speed multiplier per broken leg. */
  brokenLegSpeed: 0.75,
  /** Spread and aim time multipliers per broken arm. */
  brokenArmSpread: 1.6,
  brokenArmAimTime: 1.5,
  /** Landing faster than this hurts the legs, by damagePerSpeed per m/s over it, each. */
  safeLandingSpeed: 12.5,
  fallDamagePerSpeed: 15,
  /** A broken limb's HP after surgery. */
  surgeryHp: 1,
} as const;

/**
 * Armor against rounds, by level (a fixed comparison, with Tarkov's numbers; design.md →
 * Damage). Armor with durability left lets through a share of a hit's damage by the
 * round's level against its own, and wears by the round's armor damage. A round below its
 * level gets nothing through (2026-11-08, the user's call: no blunt damage). Broken armor
 * does nothing.
 */
export const ARMOR = {
  /** Damage let through by a round level with the armor's level, one above, and more. */
  through: { level: 0.5, oneAbove: 0.75, above: 1 },
  /**
   * Armor damage multiplier by how many levels the armor is above the round: the first
   * at or below it, the last for that many or more.
   */
  wear: [1, 0.8, 0.6, 0.4],
} as const;

/**
 * The share of a hit's damage armor with durability left lets through: none for a round
 * below its level (2026-11-08, the user's call: it was a quarter through a helmet and a
 * sixth through a vest, as blunt damage, which let low-level rounds kill through the best
 * armor and favored high-damage, low-level rounds).
 */
export function throughArmor(roundLevel: number, armorLevel: number): number {
  const t = ARMOR.through;
  const over = roundLevel - armorLevel;
  return over < 0 ? 0 : over === 0 ? t.level : over === 1 ? t.oneAbove : t.above;
}

/** The armor damage multiplier for a round against armor, by their levels. */
export function armorWear(roundLevel: number, armorLevel: number): number {
  const w = ARMOR.wear;
  return w[Math.min(w.length - 1, Math.max(0, armorLevel - roundLevel))]!;
}

/**
 * A character's limbs. Head or chest at 0 HP is death; any other zone at 0 is broken,
 * unless it's splinted: a splint takes away the effects, but the limb stays at 0 HP and
 * damage to it still spills over.
 */
export interface Health {
  hp: number[];
  bleeding: boolean[];
  splinted: boolean[];
  dead: boolean;
  /**
   * One health bar instead of limbs (zombies mode's players, 2026-11-04): its most HP. All
   * damage goes to the chest's HP, unmultiplied, and nothing bleeds or breaks. Missing for
   * everyone else.
   */
  pool?: number;
}

/** Armor, worn or not: the item and its durability left. */
export interface ArmorState extends Item {
  durability: number;
}

export function createHealth(): Health {
  return {
    hp: [...HEALTH.maxHp],
    bleeding: Array<boolean>(ZONE_COUNT).fill(false),
    splinted: Array<boolean>(ZONE_COUNT).fill(false),
    dead: false,
  };
}

export const TOTAL_HP = HEALTH.maxHp.reduce((a, b) => a + b, 0);

export function totalHp(h: Health): number {
  let sum = 0;
  for (const hp of h.hp) sum += hp;
  return sum;
}

/** A limb at 0 HP: it has broken-limb effects unless splinted. */
export function isBroken(h: Health, zone: Zone): boolean {
  return zone !== HEAD && zone !== CHEST && h.hp[zone]! <= 0 && !h.splinted[zone];
}

export function isBleeding(h: Health): boolean {
  return h.bleeding.includes(true);
}

/** Movement speed multiplier from broken legs. */
export function legSpeedScale(h: Health): number {
  let s = 1;
  if (isBroken(h, LEFT_LEG)) s *= HEALTH.brokenLegSpeed;
  if (isBroken(h, RIGHT_LEG)) s *= HEALTH.brokenLegSpeed;
  return s;
}

/** How many arms are broken: more sway (spread) and slower aiming. */
export function brokenArms(h: Health): number {
  return (isBroken(h, LEFT_ARM) ? 1 : 0) + (isBroken(h, RIGHT_ARM) ? 1 : 0);
}

/** Something that hurt a character this tick, for hit markers and the HUD. */
export interface DamageEvent {
  type: 'damage';
  target: EntityId;
  /** Who shot, or 0 for a fall. */
  by: EntityId;
  zone: Zone;
  /** HP lost, including what spilled over to the chest. */
  amount: number;
  /** What armor stopped. */
  absorbed: number;
  cause: DamageCause;
}

export type DamageCause = 'shot' | 'melee' | 'fall' | 'explosion';

export interface DeathEvent {
  type: 'death';
  target: EntityId;
  /** Who shot, or 0 for a fall or bleeding. */
  by: EntityId;
  /** The killing hit was to the head (for PMC XP's headshot bonus, 2026-11-11). */
  head?: true;
}

/**
 * Takes HP from a zone with no multiplier or armor. A broken limb spreads the damage
 * over the zones with HP left at the spillover rate, and so does whatever a hit has left
 * after breaking a limb. Head or chest at 0 kills. With one health bar (Health.pool) it all
 * comes off the chest. Returns the HP actually lost.
 */
export function dealDamage(
  state: SimState,
  c: Character,
  zone: Zone,
  amount: number,
  by: EntityId,
): number {
  const h = c.health;
  if (h.dead || amount <= 0 || c.admin?.infiniteHealth) return 0;
  const head = zone === HEAD;
  // One health bar: it's all the chest's.
  if (h.pool !== undefined) zone = CHEST;
  let lost = 0;
  let spill = 0;
  if (zone !== HEAD && zone !== CHEST && h.hp[zone]! <= 0) {
    // Broken, splinted or not.
    spill = amount;
  } else {
    const before = h.hp[zone]!;
    const after = Math.max(0, before - amount);
    h.hp[zone] = after;
    lost = before - after;
    if (zone !== HEAD && zone !== CHEST) spill = amount - lost;
  }
  if (spill > 0) lost += spread(h, spill * HEALTH.spillover);
  if (h.hp[HEAD]! <= 0 || h.hp[CHEST]! <= 0) {
    h.dead = true;
    h.bleeding.fill(false);
    state.events.push({ type: 'death', target: c.id, by, ...(head && { head: true as const }) });
  }
  return lost;
}

/**
 * Splits damage evenly over the zones with HP left; a share bigger than a zone has is
 * lost, not passed on. Returns the HP actually lost.
 */
function spread(h: Health, amount: number): number {
  let zones = 0;
  for (const hp of h.hp) if (hp > 0) zones++;
  if (zones === 0) return 0;
  const each = amount / zones;
  let lost = 0;
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    const before = h.hp[zone]!;
    if (before <= 0) continue;
    h.hp[zone] = Math.max(0, before - each);
    lost += before - h.hp[zone]!;
  }
  return lost;
}

/**
 * Kills outright, past armor, HP and the infinite health cheat: giving up a raid.
 * Does nothing to the dead.
 */
export function killCharacter(state: SimState, c: Character, by: EntityId): void {
  const h = c.health;
  if (h.dead) return;
  h.hp[HEAD] = 0;
  h.dead = true;
  h.bleeding.fill(false);
  state.events.push({ type: 'death', target: c.id, by });
}

/** What a hit does: a round's (AmmoDef) or the knife's (MeleeDef). */
export type Wound = Pick<AmmoDef, 'damage' | 'level' | 'armorDamage' | 'bleedChance'>;

/**
 * A bullet or knife hit: the zone's multiplier, then armor on the head or chest lets
 * through its share by level (ARMOR) and wears down, then what got through may start
 * bleeding.
 */
export function shootCharacter(
  state: SimState,
  items: ItemDb,
  c: Character,
  zone: Zone,
  ammo: Wound,
  by: EntityId,
  cause: 'shot' | 'melee' = 'shot',
): void {
  const k = c.health.pool === undefined ? HEALTH.multiplier[zone]! : 1;
  woundZone(state, items, c, zone, ammo.damage * k, ammo, by, cause);
}

/**
 * A hit of this much damage to one zone, after any multiplier: armor on the head or
 * chest lets through its share by the wound's level and wears down, then what got
 * through may start bleeding. Shots, swings and blasts (sim/grenades.ts) all end here.
 * In zombies mode a player's blasts never hurt players (the ray gun's bolts burst close
 * by), and under insta-kill any hit on a zombie kills it. Enemies never hurt their
 * allies (byAlly).
 */
export function woundZone(
  state: SimState,
  items: ItemDb,
  c: Character,
  zone: Zone,
  damage: number,
  wound: Wound,
  by: EntityId,
  cause: DamageCause,
): void {
  if (c.health.dead || byAlly(state, c, by)) return;
  const zombies = state.zombies;
  if (zombies && !c.ai && cause === 'explosion' && by !== 0 && isPlayer(state, by)) return;
  if (zombies && zombies.instaKill > 0 && c.ai?.zombie && by !== 0) damage = INSTA_KILL;
  if (c.admin?.infiniteHealth || harmless(state, by)) {
    // Still a hit, for markers and the HUD, but nothing lost. Also a harmless enemy's
    // (the tutorial's scav, TU-2): felt in full, with nothing at stake.
    state.events.push({ type: 'damage', target: c.id, by, zone, amount: 0, absorbed: 0, cause });
    punchAim(state, c, damage);
    return;
  }
  let absorbed = 0;
  let stopped = false;
  const armor = zone === HEAD ? c.gear.helmet : zone === CHEST ? chestArmor(items, c.gear) : null;
  if (armor && armor.durability > 0) {
    const level = armorStatsOf(items, armor.item).level;
    stopped = wound.level < level;
    absorbed = damage * (1 - throughArmor(wound.level, level));
    const wear = wound.armorDamage * armorWear(wound.level, level);
    armor.durability = Math.max(0, armor.durability - wear);
    damage -= absorbed;
  }
  const amount = dealDamage(state, c, zone, damage, by);
  const bleeds = c.health.pool === undefined;
  if (bleeds && !stopped && !c.health.dead && damage > 0 && chance(state.rng, wound.bleedChance)) {
    c.health.bleeding[zone] = true;
  }
  state.events.push({ type: 'damage', target: c.id, by, zone, amount, absorbed, cause });
  punchAim(state, c, amount + absorbed);
}

/** More than anything has: an insta-kill hit. */
const INSTA_KILL = 1e6;

/**
 * Whether a hit on c by `by` is an enemy's on its ally (the user's call, 2026-11-06):
 * those do nothing, shot, swung, blown up or set alight, so a stray round, a pellet or a
 * fire never thins out a group. The round still stops on the body it hits. Since AI rework
 * session 1, enemies of hostile factions (factions.ts) hurt each other like players.
 */
export function byAlly(state: SimState, c: Character, by: EntityId): boolean {
  if (!c.ai || by === 0) return false;
  for (const e of state.entities) if (e.id === by) return !!e.ai && !hostile(c, e);
  return false;
}

/** Whether `by` is a harmless enemy (AiState.harmless, TU-2), whose hits do no damage. */
function harmless(state: SimState, by: EntityId): boolean {
  if (by === 0) return false;
  for (const e of state.entities) if (e.id === by) return !!e.ai?.harmless;
  return false;
}

/** Whether an entity is a player (there and not an enemy). */
function isPlayer(state: SimState, id: EntityId): boolean {
  for (const e of state.entities) if (e.id === id) return !e.ai;
  return false;
}

/** Fall damage to both legs from the landing speed movement left in c.landingSpeed. */
export function applyFall(state: SimState, c: Character): void {
  const over = c.landingSpeed - HEALTH.safeLandingSpeed;
  if (over <= 0 || c.health.dead) return;
  const each = over * HEALTH.fallDamagePerSpeed;
  fallOn(state, c, LEFT_LEG, each);
  fallOn(state, c, RIGHT_LEG, each);
}

function fallOn(state: SimState, c: Character, zone: Zone, damage: number): void {
  const amount = dealDamage(state, c, zone, damage, 0);
  state.events.push({
    type: 'damage',
    target: c.id,
    by: 0,
    zone,
    amount,
    absorbed: 0,
    cause: 'fall',
  });
}

/** One tick of bleeding, the rate shared between the bleeding zones. */
export function bleed(state: SimState, c: Character): void {
  const h = c.health;
  let zones = 0;
  for (const b of h.bleeding) if (b) zones++;
  if (zones === 0) return;
  const each = (HEALTH.bleedRate * TICK_SECONDS) / zones;
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    if (h.bleeding[zone]) dealDamage(state, c, zone as Zone, each, 0);
  }
}

/** Back to full health with nothing bleeding, and worn armor back to full durability. */
export function restoreHealth(c: Character, items: ItemDb): void {
  const h = c.health;
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    h.hp[zone] = HEALTH.maxHp[zone]!;
    h.bleeding[zone] = false;
    h.splinted[zone] = false;
  }
  // One health bar is all in the chest.
  if (h.pool !== undefined) h.hp[CHEST] = h.pool;
  h.dead = false;
  for (const armor of [c.gear.helmet, chestArmor(items, c.gear)]) {
    if (armor) armor.durability = maxDurability(items, armor);
  }
}

/** New armor, at its durability times condition (0–1). */
export function createArmor(items: ItemDb, id: string, condition = 1): ArmorState {
  return { item: id, count: 1, durability: armorStatsOf(items, id).durability * condition };
}

/** Puts on new armor at full durability, in the slot its item says, replacing what was there. */
export function wearArmor(c: Character, items: ItemDb, id: string): void {
  const a = createArmor(items, id);
  if (armorDef(items, id).slot === 'helmet') c.gear.helmet = a;
  else c.gear.bodyArmor = a;
}

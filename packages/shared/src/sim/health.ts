import { armourDef, type AmmoDef, type ItemDb } from '../content/items';
import type { Item } from '../inventory/grid';
import { chance } from '../rng';
import { TICK_SECONDS } from '../tick';
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
  multiplier: [1.5, 1, 0.7, 0.7, 0.75, 0.75],
  /** Damage to a broken limb, or beyond what breaks it, reaches the chest at this rate. */
  spillover: 0.7,
  /** HP per second lost from each bleeding zone. */
  bleedRate: 1,
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
 * A character's limbs. Head or chest at 0 HP is death; any other zone at 0 is broken,
 * unless it's splinted: a splint takes away the effects, but the limb stays at 0 HP and
 * damage to it still spills over.
 */
export interface Health {
  hp: number[];
  bleeding: boolean[];
  splinted: boolean[];
  dead: boolean;
}

/** Armour, worn or not: the item and its durability left. */
export interface ArmourState extends Item {
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
  /** What armour took. */
  absorbed: number;
  cause: 'shot' | 'fall';
}

export interface DeathEvent {
  type: 'death';
  target: EntityId;
  /** Who shot, or 0 for a fall or bleeding. */
  by: EntityId;
}

/**
 * Takes HP from a zone with no multiplier or armour. A broken limb passes the damage to
 * the chest at the spillover rate, and so does whatever a hit has left after breaking a
 * limb. Head or chest at 0 kills. Returns the HP actually lost.
 */
export function dealDamage(
  state: SimState,
  c: Character,
  zone: Zone,
  amount: number,
  by: EntityId,
): number {
  const h = c.health;
  if (h.dead || amount <= 0) return 0;
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
  if (spill > 0) {
    const before = h.hp[CHEST]!;
    h.hp[CHEST] = Math.max(0, before - spill * HEALTH.spillover);
    lost += before - h.hp[CHEST]!;
  }
  if (h.hp[HEAD]! <= 0 || h.hp[CHEST]! <= 0) {
    h.dead = true;
    h.bleeding.fill(false);
    state.events.push({ type: 'death', target: c.id, by });
  }
  return lost;
}

/**
 * A bullet hit: the zone's multiplier, then armour on the head or chest absorbs its share
 * and wears down, then the rest may start bleeding.
 */
export function shootCharacter(
  state: SimState,
  items: ItemDb,
  c: Character,
  zone: Zone,
  ammo: AmmoDef,
  by: EntityId,
): void {
  if (c.health.dead) return;
  let damage = ammo.damage * HEALTH.multiplier[zone]!;
  let absorbed = 0;
  const armour = zone === HEAD ? c.gear.helmet : zone === CHEST ? c.gear.bodyArmour : null;
  if (armour && armour.durability > 0) {
    absorbed = damage * armourDef(items, armour.item).absorb;
    armour.durability = Math.max(0, armour.durability - absorbed * (ammo.armourDamage ?? 1));
    damage -= absorbed;
  }
  const amount = dealDamage(state, c, zone, damage, by);
  if (!c.health.dead && damage > 0 && chance(state.rng, ammo.bleedChance)) {
    c.health.bleeding[zone] = true;
  }
  state.events.push({ type: 'damage', target: c.id, by, zone, amount, absorbed, cause: 'shot' });
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

/** One tick of bleeding from every bleeding zone. */
export function bleed(state: SimState, c: Character): void {
  const h = c.health;
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    if (h.bleeding[zone]) dealDamage(state, c, zone as Zone, HEALTH.bleedRate * TICK_SECONDS, 0);
  }
}

/** Back to full health with nothing bleeding, and worn armour back to full durability. */
export function restoreHealth(c: Character, items: ItemDb): void {
  const h = c.health;
  for (let zone = 0; zone < ZONE_COUNT; zone++) {
    h.hp[zone] = HEALTH.maxHp[zone]!;
    h.bleeding[zone] = false;
    h.splinted[zone] = false;
  }
  h.dead = false;
  for (const armour of [c.gear.helmet, c.gear.bodyArmour]) {
    if (armour) armour.durability = armourDef(items, armour.item).durability;
  }
}

/** New armour, at its durability times condition (0–1). */
export function createArmour(items: ItemDb, id: string, condition = 1): ArmourState {
  return { item: id, count: 1, durability: armourDef(items, id).durability * condition };
}

/** Puts on new armour at full durability, in the slot its item says, replacing what was there. */
export function wearArmour(c: Character, items: ItemDb, id: string): void {
  const a = createArmour(items, id);
  if (armourDef(items, id).slot === 'helmet') c.gear.helmet = a;
  else c.gear.bodyArmour = a;
}

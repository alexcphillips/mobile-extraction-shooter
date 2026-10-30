import { describe, expect, it } from 'vitest';
import { ammoDef, armourDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_LEG,
  TOTAL_HP,
  bleed,
  brokenArms,
  dealDamage,
  isBroken,
  killCharacter,
  legSpeedScale,
  restoreHealth,
  shootCharacter,
  totalHp,
  wearArmour,
} from './health';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';

const world = new CollisionWorld({
  terrain: {
    minX: -20,
    minZ: -20,
    cellSize: 2,
    cols: 20,
    rows: 20,
    heights: Array(21 * 21).fill(0),
  },
  boxes: [{ x: 0, y: 4, z: 0, hx: 2, hy: 4, hz: 2, yaw: 0 }],
  ramps: [],
  ladders: [],
});

function setup(): { state: SimState; c: Character } {
  const state = createState(1);
  return { state, c: spawnCharacter(state, world, 10, 10) };
}

const round = ammoDef(TEST_ITEMS, 'round');

describe('damage', () => {
  it('applies the zone multiplier to shots', () => {
    const { state, c } = setup();
    shootCharacter(state, TEST_ITEMS, c, LEFT_ARM, round, 0);
    expect(c.health.hp[LEFT_ARM]).toBeCloseTo(60 - 40 * HEALTH.multiplier[LEFT_ARM]);
    expect(state.events).toContainEqual(
      expect.objectContaining({ type: 'damage', zone: LEFT_ARM, cause: 'shot' }),
    );
  });

  it('breaks a limb at 0 HP and spills further damage to the chest', () => {
    const { state, c } = setup();
    dealDamage(state, c, LEFT_LEG, 65, 0);
    expect(isBroken(c.health, LEFT_LEG)).toBe(true);
    expect(c.health.hp[CHEST]).toBe(85);
    dealDamage(state, c, LEFT_LEG, 10, 0);
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - 10 * HEALTH.spillover);
  });

  it('spills what is left after breaking a limb', () => {
    const { state, c } = setup();
    const lost = dealDamage(state, c, LEFT_LEG, 75, 0);
    expect(c.health.hp[LEFT_LEG]).toBe(0);
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - 10 * HEALTH.spillover);
    expect(lost).toBeCloseTo(65 + 10 * HEALTH.spillover);
  });

  it('kills at 0 head or chest HP, once', () => {
    const { state, c } = setup();
    dealDamage(state, c, HEAD, 100, 7);
    expect(c.health.dead).toBe(true);
    expect(dealDamage(state, c, CHEST, 10, 7)).toBe(0);
    expect(state.events.filter((e) => e.type === 'death')).toEqual([
      { type: 'death', target: c.id, by: 7 },
    ]);
  });

  it('kills outright past armour and infinite health, once', () => {
    const { state, c } = setup();
    wearArmour(c, TEST_ITEMS, 'helmet');
    c.admin = { infiniteHealth: true, infiniteAmmo: false, peaceful: false };
    killCharacter(state, c, 0);
    killCharacter(state, c, 0);
    expect(c.health.dead).toBe(true);
    expect(state.events.filter((e) => e.type === 'death')).toEqual([
      { type: 'death', target: c.id, by: 0 },
    ]);
  });

  it('slows movement for broken legs and counts broken arms', () => {
    const { state, c } = setup();
    dealDamage(state, c, LEFT_LEG, 100, 0);
    expect(legSpeedScale(c.health)).toBe(HEALTH.brokenLegSpeed);
    dealDamage(state, c, RIGHT_LEG, 100, 0);
    expect(legSpeedScale(c.health)).toBe(HEALTH.brokenLegSpeed ** 2);
    dealDamage(state, c, LEFT_ARM, 100, 0);
    expect(brokenArms(c.health)).toBe(1);
  });
});

describe('armour', () => {
  it('absorbs its share on its zone and loses durability', () => {
    const { state, c } = setup();
    wearArmour(c, TEST_ITEMS, 'helmet');
    shootCharacter(state, TEST_ITEMS, c, HEAD, ammoDef(TEST_ITEMS, 'bleeder'), 0);
    // 10 × 1.5 = 15; the helmet takes half.
    expect(c.health.hp[HEAD]).toBeCloseTo(35 - 7.5);
    expect(c.gear.helmet?.durability).toBeCloseTo(30 - 7.5);
  });

  it('absorbs nothing when broken, and does not cover other zones', () => {
    const { state, c } = setup();
    wearArmour(c, TEST_ITEMS, 'vest');
    c.gear.bodyArmour!.durability = 0;
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    expect(c.health.hp[CHEST]).toBe(85 - 40);
    shootCharacter(state, TEST_ITEMS, c, LEFT_LEG, round, 0);
    expect(c.health.hp[LEFT_LEG]).toBe(65 - 30);
  });

  it('is restored with health', () => {
    const { state, c } = setup();
    wearArmour(c, TEST_ITEMS, 'vest');
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    restoreHealth(c, TEST_ITEMS);
    expect(totalHp(c.health)).toBe(TOTAL_HP);
    expect(c.gear.bodyArmour?.durability).toBe(50);
  });
});

describe('bleeding', () => {
  it('starts on a hit by chance and drains HP over time', () => {
    const { state, c } = setup();
    shootCharacter(state, TEST_ITEMS, c, LEFT_ARM, ammoDef(TEST_ITEMS, 'bleeder'), 0);
    expect(c.health.bleeding[LEFT_ARM]).toBe(true);
    const before = c.health.hp[LEFT_ARM]!;
    for (let i = 0; i < TICK_RATE * 2; i++) bleed(state, c);
    expect(c.health.hp[LEFT_ARM]).toBeCloseTo(before - 2 * HEALTH.bleedRate);
  });

  it('does not start when armour took the whole hit', () => {
    const { state, c } = setup();
    const items = new Map(TEST_ITEMS);
    items.set('helmet', { ...armourDef(TEST_ITEMS, 'helmet'), absorb: 1 });
    wearArmour(c, items, 'helmet');
    shootCharacter(state, items, c, HEAD, ammoDef(items, 'bleeder'), 0);
    expect(c.health.bleeding[HEAD]).toBe(false);
  });
});

describe('fall damage', () => {
  it('hurts both legs from a high drop and not from a jump', () => {
    const { state, c } = setup();
    const items = TEST_ITEMS;
    // Jumping on the spot is safe.
    const jump = {
      moveX: 0,
      moveY: 0,
      yaw: 0,
      pitch: 0,
      sprint: false,
      crouch: false,
      jump: true,
      fire: false,
      aim: false,
      reload: false,
    };
    for (let i = 0; i < TICK_RATE; i++) step(state, world, items, { [c.id]: jump });
    expect(totalHp(c.health)).toBe(TOTAL_HP);

    // Off the top of an 8 m tower: about 18 m/s, so about 80 damage to each leg.
    const top = spawnCharacter(state, world, 0, 0);
    expect(top.y).toBe(8);
    top.x = 3;
    for (let i = 0; i < TICK_RATE * 2; i++) step(state, world, items, {});
    expect(top.y).toBe(0);
    expect(top.landingSpeed).toBe(0);
    // Both legs broken, and about 15 more from each spilled to the chest.
    expect(isBroken(top.health, LEFT_LEG) && isBroken(top.health, RIGHT_LEG)).toBe(true);
    expect(top.health.dead).toBe(false);
    expect(top.health.hp[CHEST]).toBeGreaterThan(50);
    expect(top.health.hp[CHEST]).toBeLessThan(75);
  });
});

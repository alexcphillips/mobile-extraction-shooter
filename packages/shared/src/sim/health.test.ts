import { describe, expect, it } from 'vitest';
import { ammoDef, armorDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import {
  ARMOR,
  CHEST,
  HEAD,
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  TOTAL_HP,
  bleed,
  applyFall,
  brokenArms,
  dealDamage,
  isBroken,
  killCharacter,
  legSpeedScale,
  armorWear,
  restoreHealth,
  shootCharacter,
  throughArmor,
  totalHp,
  wearArmor,
} from './health';
import { PUNCH, settleRecoil } from './recoil';
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

  it('breaks a limb at 0 HP and spreads further damage over the zones with HP left', () => {
    const { state, c } = setup();
    dealDamage(state, c, LEFT_LEG, 65, 0);
    expect(isBroken(c.health, LEFT_LEG)).toBe(true);
    expect(c.health.hp[CHEST]).toBe(85);
    dealDamage(state, c, LEFT_LEG, 10, 0);
    // Six zones left: head, chest, both arms, the other leg and the stomach.
    const each = (10 * HEALTH.spillover) / 6;
    expect(c.health.hp[HEAD]).toBeCloseTo(35 - each);
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - each);
    expect(c.health.hp[RIGHT_LEG]).toBeCloseTo(65 - each);
    expect(c.health.hp[LEFT_LEG]).toBe(0);
  });

  it('spreads what is left after breaking a limb', () => {
    const { state, c } = setup();
    const lost = dealDamage(state, c, LEFT_LEG, 75, 0);
    expect(c.health.hp[LEFT_LEG]).toBe(0);
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - (10 * HEALTH.spillover) / 6);
    expect(lost).toBeCloseTo(65 + 10 * HEALTH.spillover);
  });

  it('can kill through the head from a broken limb, and a share bigger than a zone has is lost', () => {
    const { state, c } = setup();
    c.health.hp[HEAD] = 1;
    dealDamage(state, c, LEFT_LEG, 65, 0);
    const lost = dealDamage(state, c, LEFT_LEG, 50, 0);
    expect(c.health.dead).toBe(true);
    expect(c.health.hp[HEAD]).toBe(0);
    // 35 spread over six zones is 35/6 each, but the head only had 1.
    expect(lost).toBeCloseTo(1 + (5 * 35) / 6);
  });

  it('kills at 0 head or chest HP, once', () => {
    const { state, c } = setup();
    dealDamage(state, c, HEAD, 100, 7);
    expect(c.health.dead).toBe(true);
    expect(dealDamage(state, c, CHEST, 10, 7)).toBe(0);
    // A kill to the head says so, for PMC XP's headshot bonus (2026-11-11).
    expect(state.events.filter((e) => e.type === 'death')).toEqual([
      { type: 'death', target: c.id, by: 7, head: true },
    ]);
    const other = setup();
    dealDamage(other.state, other.c, CHEST, 100, 7);
    expect(other.state.events.filter((e) => e.type === 'death')).toEqual([
      { type: 'death', target: other.c.id, by: 7 },
    ]);
  });

  it('kills outright past armor and infinite health, once', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'helmet');
    c.admin = {
      infiniteHealth: true,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: false,
    };
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

describe('armor', () => {
  it('lets half through from a round of its level, and wears by its armor damage', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'helmet');
    shootCharacter(state, TEST_ITEMS, c, HEAD, ammoDef(TEST_ITEMS, 'bleeder'), 0);
    // 10 (the head is ×1); a level 3 round against a level 3 helmet: half gets through.
    expect(c.health.hp[HEAD]).toBeCloseTo(35 - 5);
    expect(c.gear.helmet?.durability).toBeCloseTo(30 - 10);
    expect(state.events).toContainEqual(expect.objectContaining({ absorbed: 5 }));
  });

  it('stops a round below its level outright, wearing less the further below', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'vest');
    // A level 3 round against a level 4 vest: nothing gets through (no blunt damage since
    // 2026-11-08), and no bleed; the hit is still an event, all absorbed.
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    expect(c.health.hp[CHEST]).toBe(85);
    expect(state.events).toContainEqual(expect.objectContaining({ amount: 0, absorbed: 40 }));
    expect(c.gear.bodyArmor?.durability).toBeCloseTo(50 - 10 * ARMOR.wear[1]);
    expect(c.health.bleeding[CHEST]).toBe(false);
  });

  it('lets 75% of a round one level above through, and still wears', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'vest');
    shootCharacter(state, TEST_ITEMS, c, CHEST, ammoDef(TEST_ITEMS, 'ap-round'), 0);
    expect(c.health.hp[CHEST]).toBe(85 - 30 * 0.75);
    expect(c.gear.bodyArmor?.durability).toBe(50 - 15);
  });

  it('lets all of a round two levels above through, and still wears', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'vest');
    const round = ammoDef(TEST_ITEMS, 'ap-round');
    shootCharacter(state, TEST_ITEMS, c, CHEST, { ...round, level: round.level + 1 }, 0);
    expect(c.health.hp[CHEST]).toBe(85 - 30);
    expect(c.gear.bodyArmor?.durability).toBe(50 - 15);
  });

  it('compares levels, letting nothing through below', () => {
    expect(throughArmor(1, 2)).toBe(0);
    expect(throughArmor(4, 4)).toBe(0.5);
    expect(throughArmor(5, 4)).toBe(0.75);
    expect(throughArmor(6, 4)).toBe(1);
    expect(armorWear(6, 1)).toBe(1);
    expect(armorWear(1, 6)).toBe(ARMOR.wear[ARMOR.wear.length - 1]);
  });

  it('stops nothing when broken, and does not cover other zones', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'vest');
    c.gear.bodyArmor!.durability = 0;
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    expect(c.health.hp[CHEST]).toBe(85 - 40);
    shootCharacter(state, TEST_ITEMS, c, LEFT_LEG, round, 0);
    expect(c.health.hp[LEFT_LEG]).toBe(65 - 30);
  });

  it('is restored with health', () => {
    const { state, c } = setup();
    wearArmor(c, TEST_ITEMS, 'vest');
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    restoreHealth(c, TEST_ITEMS);
    expect(totalHp(c.health)).toBe(TOTAL_HP);
    expect(c.gear.bodyArmor?.durability).toBe(50);
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

  it('shares one rate between bleeding zones rather than stacking', () => {
    const { state, c } = setup();
    c.health.bleeding[LEFT_ARM] = true;
    c.health.bleeding[RIGHT_ARM] = true;
    for (let i = 0; i < TICK_RATE * 2; i++) bleed(state, c);
    expect(TOTAL_HP - totalHp(c.health)).toBeCloseTo(2 * HEALTH.bleedRate);
    expect(c.health.hp[LEFT_ARM]).toBeCloseTo(c.health.hp[RIGHT_ARM]!);
  });

  it('does not start when armor took the whole hit', () => {
    const { state, c } = setup();
    const items = new Map(TEST_ITEMS);
    items.set('helmet', { ...armorDef(TEST_ITEMS, 'helmet'), level: 6 });
    wearArmor(c, items, 'helmet');
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
    // Both legs broken, and about 15 more from each spread over the rest.
    expect(isBroken(top.health, LEFT_LEG) && isBroken(top.health, RIGHT_LEG)).toBe(true);
    expect(top.health.dead).toBe(false);
    expect(top.health.hp[CHEST]).toBeGreaterThan(75);
    expect(top.health.hp[CHEST]).toBeLessThan(83);
    expect(top.health.hp[HEAD]).toBeLessThan(33);
  });
});

describe('aim punch', () => {
  const DEG = Math.PI / 180;
  const off = (c: Character): number => Math.hypot(c.recoilPitch, c.recoilYaw) / DEG;

  it("throws a hit player's aim, mostly up, and the spring brings it back", () => {
    const { state, c } = setup();
    shootCharacter(state, TEST_ITEMS, c, LEFT_ARM, round, 0);
    const lost = 60 - c.health.hp[LEFT_ARM]!;
    expect(off(c)).toBeCloseTo(Math.min(PUNCH.most, PUNCH.base + PUNCH.perHp * lost));
    expect(c.recoilPitch).toBeGreaterThan(0);
    for (let i = 0; i < TICK_RATE; i++) settleRecoil(c, 30, 6, false);
    expect(off(c)).toBe(0);
  });

  it('punches a hit that does no damage', () => {
    const { state, c } = setup();
    c.admin = {
      infiniteHealth: true,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: false,
    };
    shootCharacter(state, TEST_ITEMS, c, CHEST, round, 0);
    expect(c.health.hp[CHEST]).toBe(85);
    expect(off(c)).toBeGreaterThanOrEqual(PUNCH.base);
  });

  it('never adds up past its most in one go, and leaves enemies and falls alone', () => {
    const { state, c } = setup();
    for (let i = 0; i < 9; i++) shootCharacter(state, TEST_ITEMS, c, LEFT_LEG, round, 0);
    expect(off(c)).toBeLessThanOrEqual(PUNCH.most + 1e-9);
    const enemy = setup();
    enemy.c.ai = {} as Character['ai'];
    shootCharacter(enemy.state, TEST_ITEMS, enemy.c, LEFT_ARM, round, 0);
    expect(off(enemy.c)).toBe(0);
    const faller = setup();
    faller.c.landingSpeed = 30;
    applyFall(faller.state, faller.c);
    expect(off(faller.c)).toBe(0);
  });
});

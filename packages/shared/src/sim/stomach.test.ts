import { describe, expect, it } from 'vitest';
import type { ItemDb, ItemDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip, stow } from './gear';
import {
  CHEST,
  HEAD,
  HEALTH,
  LEFT_LEG,
  PAIN,
  STOMACH,
  createArmor,
  dealDamage,
  painNoise,
  stomachBlacked,
  woundZone,
} from './health';
import { treatments, useMed, zoneToTreat } from './meds';
import { STAMINA, staminaBreath, updateStamina } from './stamina';
import { createState, spawnCharacter } from './state';
import { TEST_ITEMS } from './test-items';

// GZ-3: the stomach, its own zone under the thorax.

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});
const round = { damage: 30, level: 3, armorDamage: 5, bleedChance: 0 };

function setup(items: ItemDb = TEST_ITEMS) {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  c.yaw = 0; // facing −z
  equip(c, items, 'rig', createItem(items, 'rig'));
  return { state, c };
}

/** TEST_ITEMS with the carrier's plates and soft armor covering these zones. */
function covering(plateZones: string[], softZones: string[]): ItemDb {
  const db = new Map(TEST_ITEMS);
  const def = db.get('carrier') as Extract<ItemDef, { type: 'armor' }>;
  db.set('carrier', {
    ...def,
    carrier: { ...def.carrier!, plateZones, softZones },
  } as ItemDef);
  return db;
}

describe('the stomach', () => {
  it('is not vital: at 0 HP it blacks, and anyone lives', () => {
    const { state, c } = setup();
    dealDamage(state, c, STOMACH, 70, 0);
    expect(c.health.dead).toBe(false);
    expect(stomachBlacked(c.health)).toBe(true);
  });

  it('blacked, spreads further damage at 1.5×, the rest of the hit that blacks it too', () => {
    const { state, c } = setup();
    dealDamage(state, c, STOMACH, 80, 0);
    // 10 over, × 1.5, over the six other zones.
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - (10 * HEALTH.stomachSpillover) / 6);
    dealDamage(state, c, STOMACH, 12, 0);
    expect(c.health.hp[HEAD]).toBeCloseTo(35 - (22 * HEALTH.stomachSpillover) / 6);
    // A broken leg still spreads at the limbs' rate.
    const chest = c.health.hp[CHEST]!;
    dealDamage(state, c, LEFT_LEG, c.health.hp[LEFT_LEG]! + 12, 0);
    expect(c.health.hp[CHEST]).toBeCloseTo(chest - (12 * HEALTH.spillover) / 5);
  });

  it('is covered by a carrier whose plates or soft armor cover it, and only then', () => {
    // Plates over the thorax only: a stomach hit from the front is bare.
    const bare = setup();
    equip(bare.c, TEST_ITEMS, 'bodyArmor', createArmor(TEST_ITEMS, 'carrier'));
    woundZone(bare.state, TEST_ITEMS, bare.c, STOMACH, 30, round, 0, 'shot', 0, -10);
    expect(bare.c.health.hp[STOMACH]).toBe(40);
    expect(bare.c.gear.bodyArmor!.plates!.front!.durability).toBe(40);

    // Plates over both: the front plate (level 4) stops a level 3 round.
    const items = covering(['thorax', 'stomach'], []);
    const plated = setup(items);
    equip(plated.c, items, 'bodyArmor', createArmor(items, 'carrier'));
    woundZone(plated.state, items, plated.c, STOMACH, 30, round, 0, 'shot', 0, -10);
    expect(plated.c.health.hp[STOMACH]).toBe(70);
    expect(plated.c.gear.bodyArmor!.plates!.front!.durability).toBeLessThan(40);

    // Soft armor over both: from behind (no back plate), the soft takes it.
    const soft = covering(['thorax'], ['thorax', 'stomach']);
    const s = setup(soft);
    equip(s.c, soft, 'bodyArmor', createArmor(soft, 'carrier'));
    woundZone(s.state, soft, s.c, STOMACH, 30, round, 0, 'shot', 0, 10);
    expect(s.c.gear.bodyArmor!.durability).toBeLessThan(30);
  });

  it('blacked, needs surgery: a splint skips it, a heal skips it, surgery comes before legs', () => {
    const { state, c } = setup();
    for (const m of ['splint', 'surgery', 'medkit']) stow(c, TEST_ITEMS, createItem(TEST_ITEMS, m));
    dealDamage(state, c, STOMACH, 70, 0);
    dealDamage(state, c, LEFT_LEG, 65, 0);
    dealDamage(state, c, CHEST, 10, 0);
    expect(zoneToTreat(c.health, 'splint')).toBe(LEFT_LEG);
    expect(zoneToTreat(c.health, 'surgery')).toBe(STOMACH);
    expect(zoneToTreat(c.health, 'heal')).toBe(CHEST);
    const surgery = treatments(c, TEST_ITEMS).find(
      (r) => c.gear.rig!.grid.items[r.index]?.item.item === 'surgery' && r.grid === 1,
    );
    expect(surgery).toBeDefined();
    useMed(c, TEST_ITEMS, surgery!);
    expect(c.health.hp[STOMACH]).toBe(HEALTH.surgeryHp);
    expect(stomachBlacked(c.health)).toBe(false);
  });

  it('blacked, caps a player’s stamina, slows its refill and shortens breath', () => {
    const { state, c } = setup();
    dealDamage(state, c, STOMACH, 70, 0);
    updateStamina(c, false);
    expect(c.stamina).toBe(STAMINA.stomachCap);
    expect(staminaBreath(c)).toBeCloseTo(STAMINA.stomachBreath);
    c.stamina = 0.2;
    updateStamina(c, false);
    // Standing still, at half the refill rate.
    expect(c.stamina).toBeCloseTo(0.2 + STAMINA.stomachRefill / TICK_RATE / STAMINA.refillStill);
    for (let i = 0; i < 60 * TICK_RATE; i++) updateStamina(c, false);
    expect(c.stamina).toBe(STAMINA.stomachCap);
  });

  it('blacked, groans every few seconds until treated', () => {
    const { state, c } = setup();
    const groans = (seconds: number): number => {
      let n = 0;
      for (let i = 0; i < seconds * TICK_RATE; i++) {
        state.events.length = 0;
        painNoise(state, c);
        n += state.events.filter((e) => e.type === 'pain' && e.by === c.id).length;
      }
      return n;
    };
    expect(groans(10)).toBe(0);
    dealDamage(state, c, STOMACH, 70, 0);
    const n = groans(30);
    expect(n).toBeGreaterThanOrEqual(Math.floor(30 / PAIN.every[1]));
    expect(n).toBeLessThanOrEqual(Math.ceil(30 / PAIN.every[0]) + 1);
    c.health.hp[STOMACH] = HEALTH.surgeryHp;
    expect(groans(10)).toBe(0);
  });
});

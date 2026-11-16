import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../world/collision-world';
import { createItem } from './create-item';
import { equip, stow } from './gear';
import { CHEST, HEAD, HEALTH, LEFT_ARM, LEFT_LEG, RIGHT_ARM, dealDamage } from './health';
import { startUse, treatmentsFor, updateMedUse, useMed } from './meds';
import { createState, spawnCharacter, type Character } from './state';
import { TEST_ITEMS as items } from './test-items';
import { TICK_SECONDS } from '../tick';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

function patient(...meds: string[]) {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'rig', createItem(items, 'rig'));
  for (const m of meds) stow(c, items, createItem(items, m));
  return { state, c };
}
const ids = (c: Character, zone: Parameters<typeof treatmentsFor>[2]): string[] =>
  treatmentsFor(c, items, zone).map((r) => r.item);

describe('meds on a chosen zone (body picker, 2026-11-15)', () => {
  it('offers per zone only what helps that zone, best first', () => {
    const { state, c } = patient('medkit', 'surgery', 'splint', 'bandage', 'med-crate');
    dealDamage(state, c, LEFT_LEG, 100, 0);
    c.health.hp[CHEST] = 40;
    c.health.bleeding[LEFT_ARM] = true;
    c.health.hp[LEFT_ARM] = HEALTH.maxHp[LEFT_ARM]!;
    c.health.hp[RIGHT_ARM] = HEALTH.maxHp[RIGHT_ARM]!; // the leg's spillover reached it
    expect(ids(c, LEFT_LEG)).toEqual(['splint', 'surgery']);
    expect(ids(c, CHEST)).toEqual(['medkit', 'med-crate']);
    expect(ids(c, LEFT_ARM)).toEqual(['bandage', 'med-crate']);
    expect(ids(c, RIGHT_ARM)).toEqual([]);
    expect(treatmentsFor(c, items, CHEST)[0]!.zone).toBe(CHEST);
  });

  it('a medkit on the chest leaves a broken leg and keeps the rest of its pool', () => {
    const { state, c } = patient('medkit');
    dealDamage(state, c, LEFT_LEG, 100, 0);
    c.health.hp[HEAD] = 10;
    c.health.hp[CHEST] = HEALTH.maxHp[CHEST]! - 20;
    const ref = treatmentsFor(c, items, CHEST)[0]!;
    expect(useMed(c, items, ref)).toBe(true);
    expect(c.health.hp[CHEST]).toBe(HEALTH.maxHp[CHEST]);
    expect(c.health.hp[HEAD]).toBe(10); // untouched, though first in the order
    expect(c.health.hp[LEFT_LEG]).toBe(0);
    expect(c.gear.pockets.items[0]?.item.left ?? c.gear.rig!.grid.items[0]!.item.left).toBe(80);
  });

  it('a splint goes on the chosen limb, not the first broken one', () => {
    const { state, c } = patient('splint');
    dealDamage(state, c, LEFT_LEG, 100, 0);
    dealDamage(state, c, RIGHT_ARM, 100, 0);
    expect(useMed(c, items, { ...treatmentsFor(c, items, RIGHT_ARM)[0]! })).toBe(true);
    expect(c.health.splinted[RIGHT_ARM]).toBe(true);
    expect(c.health.splinted[LEFT_LEG]).toBe(false);
  });

  it('a heal with bleedCost on a zone stops only that bleed, then heals it', () => {
    const { c } = patient('med-crate');
    c.health.bleeding[HEAD] = true;
    c.health.bleeding[LEFT_ARM] = true;
    c.health.hp[LEFT_ARM] = HEALTH.maxHp[LEFT_ARM]! - 10;
    useMed(
      c,
      items,
      treatmentsFor(c, items, LEFT_ARM).find((r) => r.item === 'med-crate')!,
    );
    expect(c.health.bleeding[LEFT_ARM]).toBe(false);
    expect(c.health.bleeding[HEAD]).toBe(true);
    expect(c.health.hp[LEFT_ARM]).toBe(HEALTH.maxHp[LEFT_ARM]);
  });

  it('refuses a med that does nothing for the zone, or a zone that is not one', () => {
    const { c } = patient('bandage');
    c.health.bleeding[HEAD] = true;
    const ref = treatmentsFor(c, items, HEAD)[0]!;
    expect(startUse(c, items, { ...ref, zone: CHEST })).toBe(false);
    expect(startUse(c, items, { ...ref, zone: 9 as never })).toBe(false);
    expect(startUse(c, items, ref)).toBe(true);
  });

  it('keeps the zone through the use time', () => {
    const { state, c } = patient('bandage');
    c.health.bleeding[HEAD] = true;
    c.health.bleeding[LEFT_ARM] = true;
    const use = treatmentsFor(c, items, LEFT_ARM)[0]!;
    updateMedUse(state, c, items, { use } as never);
    for (let t = 0; t < 2.1; t += TICK_SECONDS) updateMedUse(state, c, items, undefined);
    expect(c.health.bleeding[LEFT_ARM]).toBe(false);
    expect(c.health.bleeding[HEAD]).toBe(true);
  });
});

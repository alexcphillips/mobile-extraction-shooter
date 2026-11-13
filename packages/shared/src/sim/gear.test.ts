import { describe, expect, it } from 'vitest';
import { addItem, canHold, placeAt, type Item } from '../inventory/grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import {
  carriedAmmo,
  equip,
  fitsSlot,
  heldWeapon,
  stow,
  switchHand,
  unequip,
  type ContainerState,
} from './gear';
import {
  HEALTH,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_LEG,
  CHEST,
  HEAD,
  legSpeedScale,
  dealDamage,
} from './health';
import { startUse, treatments, useMed } from './meds';
import { createState, spawnCharacter, type Character, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  return { state, c };
}

const one = (item: string, count = 1): Item => ({ item, count });
const reload: PlayerInput = {
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  aim: false,
  reload: true,
};

describe('gear', () => {
  it('gives players pockets and a vault, and enemies only pockets', () => {
    const { state, c } = setup();
    // Five 1×1 slots (UX-3): nothing bigger goes in.
    expect(c.gear.pockets).toMatchObject({ w: 5, h: 1, containers: false });
    expect(c.gear.pockets.sections).toHaveLength(5);
    expect(canHold(items, c.gear.pockets, createItem(items, 'scope'))).toBe(true);
    expect(addItem(items, c.gear.pockets, createItem(items, 'scope'))).toBe(1);
    expect(c.gear.vault).toMatchObject({ w: 2, h: 1 });
    const enemy = spawnEnemy(state, world, 5, 0, 5, 0);
    expect(enemy.gear.vault).toBeNull();
  });

  it('only takes the right items in each slot', () => {
    const rifle = createItem(items, 'rifle');
    const pistol = createItem(items, 'pistol');
    expect(fitsSlot(items, 'primary1', rifle)).toBe(true);
    // Pistols only go in the sidearm.
    expect(fitsSlot(items, 'primary1', pistol)).toBe(false);
    expect(fitsSlot(items, 'primary2', pistol)).toBe(false);
    expect(fitsSlot(items, 'sidearm', pistol)).toBe(true);
    expect(fitsSlot(items, 'sidearm', rifle)).toBe(false);
    expect(fitsSlot(items, 'knife', one('knife'))).toBe(true);
    expect(fitsSlot(items, 'helmet', createItem(items, 'vest'))).toBe(false);
    expect(fitsSlot(items, 'bodyArmor', createItem(items, 'vest'))).toBe(true);
    expect(fitsSlot(items, 'rig', createItem(items, 'backpack'))).toBe(false);
    expect(fitsSlot(items, 'backpack', createItem(items, 'backpack'))).toBe(true);
    const { c } = setup();
    expect(() => equip(c, items, 'sidearm', rifle)).toThrow(/can't go in sidearm/);
  });

  it('equips in place of what was there, handing it back', () => {
    const { c } = setup();
    const first = createItem(items, 'rig');
    expect(equip(c, items, 'rig', first)).toBeNull();
    expect(equip(c, items, 'rig', createItem(items, 'rig'))).toBe(first);
    expect(unequip(c, 'rig')).not.toBe(first);
    expect(c.gear.rig).toBeNull();
  });

  it('holds the gun in the slot in hand, and switching stops a reload and aiming', () => {
    const { c } = setup();
    const rifle = giveWeapon(c, items, 'rifle');
    const pistol = giveWeapon(c, items, 'pistol');
    expect(c.gear.hand).toBe('sidearm');
    expect(heldWeapon(c)).toBe(pistol);
    switchHand(c, items, 'primary1');
    expect(heldWeapon(c)).toBe(rifle);
    rifle.reloading = 1;
    c.aim = 1;
    switchHand(c, items, 'knife');
    expect(heldWeapon(c)).toBeNull();
    expect(rifle.reloading).toBe(0);
    expect(c.aim).toBe(0);
    // An empty gun slot in hand is empty hands.
    switchHand(c, items, 'primary2');
    expect(heldWeapon(c)).toBeNull();
  });

  it('stows in pockets, then rig, then backpack, never the vault', () => {
    const { c } = setup();
    equip(c, items, 'rig', createItem(items, 'rig'));
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    // Pockets hold 5 stacks of 100, the 3×2 rig 6 more; the rest goes in the backpack.
    expect(stow(c, items, one('round', 1150))).toBe(0);
    expect(c.gear.pockets.items).toHaveLength(5);
    expect(c.gear.rig!.grid.items).toHaveLength(6);
    expect(c.gear.backpack!.grid.items.map((g) => g.item.count)).toEqual([50]);
    expect(c.gear.vault!.items).toHaveLength(0);
    // A 3×3 vest fits only the backpack.
    expect(stow(c, items, createItem(items, 'vest'))).toBe(0);
    expect(c.gear.backpack!.grid.items).toHaveLength(2);
  });

  it('reloads from what is carried, but not from the vault', () => {
    const { state, c } = setup();
    const w = giveWeapon(c, items, 'rifle');
    w.mag = 0;
    addItem(items, c.gear.vault!, one('round', 50));
    const rig = createItem(items, 'rig') as ContainerState;
    equip(c, items, 'rig', rig);
    placeAt(items, rig.grid, one('round', 12), 0, 0, false);
    placeAt(items, c.gear.pockets, one('round', 5), 0, 0, false);
    expect(carriedAmmo(c, 'round')).toBe(17);
    step(state, world, items, { [c.id]: reload });
    for (let i = 0; i < TICK_RATE * 2.1; i++) step(state, world, items, {});
    expect(w.mag).toBe(17);
    expect(carriedAmmo(c, 'round')).toBe(0);
    expect(c.gear.vault!.items[0]!.item.count).toBe(50);
    // Nothing carried: no reload.
    step(state, world, items, { [c.id]: reload });
    expect(w.reloading).toBe(0);
  });

  it("doesn't reload from the backpack", () => {
    const { state, c } = setup();
    const w = giveWeapon(c, items, 'rifle');
    w.mag = 0;
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    addItem(items, c.gear.backpack!.grid, one('round', 50));
    expect(carriedAmmo(c, 'round')).toBe(0);
    step(state, world, items, { [c.id]: reload });
    expect(w.reloading).toBe(0);
    expect(w.mag).toBe(0);
  });

  it('survives a JSON round trip mid-raid', () => {
    const { state, c } = setup();
    giveWeapon(c, items, 'rifle', ['big-mag']);
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    stow(c, items, one('round', 150));
    stow(c, items, createItem(items, 'medkit'));
    const copy = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(copy).toEqual(state);
  });
});

describe('meds', () => {
  function patient(...meds: string[]): Character {
    const { c } = setup();
    equip(c, items, 'rig', createItem(items, 'rig'));
    for (const m of meds) stow(c, items, createItem(items, m));
    return c;
  }
  const chosen = (c: Character): string[] =>
    treatments(c, items).map((r) => {
      const grid = r.grid === 0 ? c.gear.pockets : c.gear.rig!.grid;
      return grid.items[r.index]!.item.item;
    });

  it('offers nothing when nothing is wrong', () => {
    expect(chosen(patient('bandage', 'medkit'))).toEqual([]);
  });

  it('picks bleeding first, then a splint before surgery, then HP; one of each kind', () => {
    const c = patient('medkit', 'surgery', 'splint', 'bandage', 'bandage');
    const { state } = setup();
    c.health.bleeding[CHEST] = true;
    dealDamage(state, c, LEFT_LEG, 100, 0);
    expect(chosen(c)).toEqual(['bandage', 'splint', 'surgery', 'medkit']);
    c.health.bleeding[CHEST] = false;
    expect(chosen(c)).toEqual(['splint', 'surgery', 'medkit']);
  });

  it('ignores meds in the vault', () => {
    const { c } = setup();
    c.health.bleeding[HEAD] = true;
    addItem(items, c.gear.vault!, createItem(items, 'bandage'));
    expect(treatments(c, items)).toEqual([]);
  });

  it('offers meds in pockets and rig, not the backpack, which the inventory uses by hand', () => {
    const { c } = setup();
    c.health.bleeding[HEAD] = true;
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    addItem(items, c.gear.backpack!.grid, createItem(items, 'bandage'));
    expect(treatments(c, items)).toEqual([]);
    expect(startUse(c, items, { grid: 2, index: 0, item: 'bandage' })).toBe(true);
    equip(c, items, 'rig', createItem(items, 'rig'));
    addItem(items, c.gear.rig!.grid, createItem(items, 'bandage'));
    expect(treatments(c, items)).toEqual([{ grid: 1, index: 0, item: 'bandage' }]);
  });

  it('bandages one zone per use, in the fixed order, and is used up', () => {
    const c = patient('bandage');
    c.health.bleeding[LEFT_ARM] = true;
    c.health.bleeding[CHEST] = true;
    expect(useMed(c, items, treatments(c, items)[0]!)).toBe(true);
    expect(c.health.bleeding[CHEST]).toBe(false);
    expect(c.health.bleeding[LEFT_ARM]).toBe(true);
    expect(c.gear.pockets.items).toHaveLength(0);
  });

  it('splints: the effects go, the limb stays at 0 and still spills over', () => {
    const c = patient('splint');
    const { state } = setup();
    dealDamage(state, c, LEFT_LEG, 100, 0);
    dealDamage(state, c, RIGHT_LEG, 100, 0);
    expect(legSpeedScale(c.health)).toBeCloseTo(HEALTH.brokenLegSpeed ** 2);
    useMed(c, items, treatments(c, items)[0]!);
    expect(c.health.splinted[LEFT_LEG]).toBe(true);
    expect(legSpeedScale(c.health)).toBeCloseTo(HEALTH.brokenLegSpeed);
    // Two uses: the second does the right leg, then it's gone.
    expect(c.gear.pockets.items[0]!.item.left).toBe(1);
    useMed(c, items, treatments(c, items)[0]!);
    expect(legSpeedScale(c.health)).toBe(1);
    expect(c.gear.pockets.items).toHaveLength(0);
    const chest = c.health.hp[CHEST]!;
    dealDamage(state, c, LEFT_LEG, 10, 0);
    expect(c.health.hp[LEFT_LEG]).toBe(0);
    // Spread over head, chest, arms and stomach.
    expect(c.health.hp[CHEST]).toBeCloseTo(chest - (10 * HEALTH.spillover) / 5);
  });

  it('surgery brings a broken limb (splinted or not) back to 1 HP', () => {
    const c = patient('surgery');
    const { state } = setup();
    dealDamage(state, c, LEFT_LEG, 100, 0);
    c.health.splinted[LEFT_LEG] = true;
    useMed(c, items, treatments(c, items)[0]!);
    expect(c.health.hp[LEFT_LEG]).toBe(HEALTH.surgeryHp);
    expect(c.health.splinted[LEFT_LEG]).toBe(false);
  });

  it('offers a heal that stops bleeding for a bleed, after bandages, even at full HP', () => {
    const c = patient('med-crate', 'medkit', 'bandage');
    c.health.bleeding[LEFT_ARM] = true;
    expect(chosen(c)).toEqual(['bandage', 'med-crate']);
    const crate = treatments(c, items)[1]!;
    expect(startUse(c, items, crate)).toBe(true);
  });

  it('stops every bleed for its bleedCost each, then heals with what is left', () => {
    const c = patient('med-crate');
    const { state } = setup();
    dealDamage(state, c, LEFT_ARM, 30, 0);
    c.health.bleeding[CHEST] = true;
    c.health.bleeding[LEFT_ARM] = true;
    expect(useMed(c, items, treatments(c, items)[0]!)).toBe(true);
    expect(c.health.bleeding).not.toContain(true);
    // 100 − 2 × 30 = 40 left to heal with: the arm's 30, then 10 kept.
    expect(c.health.hp[LEFT_ARM]).toBe(60);
    expect(c.gear.rig!.grid.items[0]!.item.left).toBeCloseTo(10);
  });

  it('a plain heal never stops bleeding', () => {
    const c = patient('medkit');
    c.health.bleeding[CHEST] = true;
    expect(chosen(c)).toEqual([]);
    expect(startUse(c, items, { grid: 1, index: 0, item: 'medkit' })).toBe(false);
  });

  it('heals down the order from its pool, skipping broken limbs, and keeps what is left', () => {
    const c = patient('medkit');
    const { state } = setup();
    dealDamage(state, c, HEAD, 20, 0);
    dealDamage(state, c, LEFT_LEG, 100, 0);
    dealDamage(state, c, LEFT_ARM, 30, 0);
    // The leg's spillover, (100 − 65) × 0.7 = 24.5, spread over the six other zones.
    expect(c.health.hp[CHEST]).toBeCloseTo(85 - 24.5 / 6);
    useMed(c, items, treatments(c, items)[0]!);
    expect(c.health.hp[HEAD]).toBe(35);
    expect(c.health.hp[CHEST]).toBe(85);
    expect(c.health.hp[LEFT_LEG]).toBe(0);
    expect(c.health.hp[LEFT_ARM]).toBe(60);
    // A medkit is 1×2: it's in the rig, not the pockets' 1×1 slots.
    const kit = c.gear.rig!.grid.items[0]!.item;
    expect(kit.left).toBeCloseTo(100 - 20 - 24.5 - 30);
    // Not needed now.
    expect(useMed(c, items, { grid: 1, index: 0 })).toBe(false);
    // Spent, it's gone.
    dealDamage(state, c, LEFT_ARM, 50, 0);
    useMed(c, items, { grid: 1, index: 0 });
    expect(c.health.hp[LEFT_ARM]).toBeCloseTo(10 + 25.5);
    expect(c.gear.rig!.grid.items).toHaveLength(0);
  });
});

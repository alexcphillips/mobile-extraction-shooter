import {
  STARTING_KIT_FORMAT,
  addItem,
  checkProfile,
  createItem,
  itemGained,
  loadContent,
  newProfile,
  openStash,
  quickEquip,
  type Item,
  type Profile,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems } from './content';

// Quick equip (2026-11-09) against the real items, since it's about their stats.
const items = loadItems();

/** A profile wearing nothing, with these in the stash. */
function profile(stash: Item[], gear: Record<string, string> = {}): Profile {
  const kit = loadContent(
    STARTING_KIT_FORMAT,
    { formatVersion: 1, id: 't', money: 0, gear, carried: [], stash: [], loaded: {} },
    't.json',
  );
  const p = newProfile(items, kit);
  for (const it of stash) expect(addItem(items, p.stash[0]!, it)).toBe(0);
  return JSON.parse(JSON.stringify(p)) as Profile;
}

const one = (id: string, count = 1): Item => createItem(items, id, count);
const rounds = (p: Profile, id: string): number => {
  let n = 0;
  const walk = (it: Item | null): void => {
    if (!it) return;
    if (it.item === id) n += it.count;
    if (it.mag && (it.loaded ?? null) === id) n += it.mag;
    for (const g of it.grid?.items ?? []) walk(g.item);
  };
  for (const g of p.gear.pockets.items) walk(g.item);
  walk(p.gear.rig);
  walk(p.gear.backpack);
  return n;
};

/** Checks the result is a valid profile with nothing made from nothing. */
function sound(before: Profile, p: Profile): void {
  expect(checkProfile(items, p)).toBeNull();
  expect(itemGained(items, before, p)).toBeNull();
}

describe('quick equip', () => {
  it('picks the gun it has rounds for, the best ammo, armor and bags', () => {
    const p = profile([
      // An M416 with plenty of M855A1, an AK with too few rounds for a load and 3 reloads.
      one('m416'),
      one('ak-74m'),
      one('ammo-556x45', 60),
      one('ammo-556x45-m855a1', 60),
      one('ammo-556x45-m855a1', 60),
      one('ammo-545x39-bp', 60),
      one('soft-vest'),
      one('heavy-plate-carrier'),
      one('steel-helmet'),
      one('small-backpack'),
      one('large-backpack'),
      one('chest-rig'),
    ]);
    const before = JSON.parse(JSON.stringify(p)) as Profile;
    expect(quickEquip(p, items)).toBe('equipped');
    const g = p.gear;
    expect(g.primary1?.item).toBe('m416');
    expect(g.primary1?.loaded).toBe('ammo-556x45-m855a1');
    expect(g.primary2).toBeNull();
    expect(g.bodyArmor?.item).toBe('heavy-plate-carrier');
    expect(g.helmet?.item).toBe('steel-helmet');
    expect(g.backpack?.item).toBe('large-backpack');
    expect(g.rig?.item).toBe('chest-rig');
    expect(g.hand).toBe('primary1');
    sound(before, p);
  });

  it('brings a sidearm, and a close-range gun with a sniper', () => {
    const p = profile([
      one('awm'),
      one('mp5'),
      one('m9a3'),
      one('ammo-338', 40),
      one('ammo-9mm', 200),
      one('ammo-9mm', 200),
    ]);
    expect(quickEquip(p, items)).toBe('equipped');
    expect(p.gear.primary1?.item).toBe('awm');
    expect(p.gear.sidearm?.item).toBe('m9a3');
    expect(p.gear.primary2?.item).toBe('mp5');
  });

  it('with a sniper and no sidearm, takes any second gun', () => {
    const p = profile([
      one('awm'),
      one('ak-74m'),
      one('ammo-338', 40),
      one('ammo-545x39', 60),
      one('ammo-545x39', 60),
    ]);
    expect(quickEquip(p, items)).toBe('equipped');
    expect(p.gear.primary2?.item).toBe('ak-74m');
  });

  it('never picks special guns', () => {
    const p = profile([one('crossbow'), one('crossbow-bolt', 40)]);
    expect(quickEquip(p, items)).toBe('unchanged');
    expect(p.gear.primary1).toBeNull();
  });

  it('carries meds: a heal, surgery, a tourniquet over bandages, a splint', () => {
    const p = profile([
      one('chest-rig'),
      one('field-first-aid-kit'),
      one('surgery-kit'),
      one('bandage'),
      one('bandage'),
      one('cat-tourniquet'),
      one('splint'),
    ]);
    expect(quickEquip(p, items)).toBe('equipped');
    const carried = [...p.gear.pockets.items, ...(p.gear.rig?.grid?.items ?? [])].map(
      (g) => g.item.item,
    );
    expect(carried.sort()).toEqual([
      'cat-tourniquet',
      'field-first-aid-kit',
      'splint',
      'surgery-kit',
    ]);
    // Without the tourniquet, two bandages.
    const q = profile([one('chest-rig'), one('bandage'), one('bandage'), one('bandage')]);
    quickEquip(q, items);
    const n = [...q.gear.pockets.items, ...(q.gear.rig?.grid?.items ?? [])].filter(
      (g) => g.item.item === 'bandage',
    ).length;
    expect(n).toBe(2);
  });

  it('empties the gear first, and twice is the same as once', () => {
    const p = profile([one('ammo-556x45', 60), one('ammo-556x45', 60), one('heavy-helmet')], {
      primary1: 'm416',
      helmet: 'steel-helmet',
      rig: 'chest-rig',
    });
    const before = JSON.parse(JSON.stringify(p)) as Profile;
    expect(quickEquip(p, items)).toBe('equipped');
    expect(p.gear.helmet?.item).toBe('heavy-helmet');
    expect(p.stash[0]!.items.some((g) => g.item.item === 'steel-helmet')).toBe(true);
    expect(rounds(p, 'ammo-556x45')).toBeGreaterThanOrEqual(90);
    sound(before, p);
    expect(quickEquip(p, items)).toBe('unchanged');
  });

  it('changes nothing when what comes off has no room in the stash', () => {
    const p = profile([], { backpack: 'large-backpack' });
    // Fill the backpack, then the stash, so its contents have nowhere to go.
    const bag = p.gear.backpack!.grid!;
    while (addItem(items, bag, one('gold-bar')) === 0);
    while (addItem(items, p.stash[0]!, one('gold-bar')) === 0);
    const before = JSON.stringify(p);
    const s = openStash(p);
    expect(quickEquip(s.profile, items)).toBe('full');
    expect(JSON.stringify(p)).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import { addItem, placeAt } from './inventory/grid';
import {
  PROFILE_FORMAT,
  checkProfile,
  countItems,
  itemGained,
  newProfile,
  parseGear,
  restGear,
  settleGuns,
  type Profile,
} from './profile';
import { createItem } from './sim/create-item';
import { keptGear } from './sim/raid';
import { TEST_ITEMS as items } from './sim/test-items';
import type { WeaponState } from './sim/weapons';

const kit = loadContent(
  STARTING_KIT_FORMAT,
  {
    formatVersion: 1,
    id: 'test',
    money: 500,
    gear: { primary1: 'rifle', sidearm: 'pistol', helmet: 'helmet', rig: 'rig' },
    carried: [{ item: 'round', count: 90 }, { item: 'bandage' }],
    stash: [{ item: 'backpack' }, { item: 'cash', count: 300 }],
  },
  'test.json',
);

/** A fresh profile from the test kit, as stored and loaded again. */
function profile(): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(JSON.stringify(newProfile(items, kit))), 'p');
}

describe('newProfile', () => {
  it('wears the kit, carries its items, fills the stash and adds the knife', () => {
    const p = profile();
    expect(p.money).toBe(500);
    expect(p.gear.knife?.item).toBe('knife');
    expect(p.gear.primary1?.item).toBe('rifle');
    expect(p.gear.hand).toBe('primary1');
    expect(p.gear.vault?.items).toEqual([]);
    const counts = countItems(items, p);
    // 90 carried, 30 in the rifle and 12 in the pistol in the stash.
    expect(counts.get('round')).toBe(132);
    expect(counts.get('cash')).toBe(300);
    expect(counts.get('backpack')).toBe(1);
    expect(checkProfile(items, p)).toBeNull();
  });

  it('refuses a kit that names an item for the wrong slot', () => {
    expect(() => newProfile(items, { ...kit, gear: { sidearm: 'rifle' } })).toThrow(/sidearm/);
  });
});

describe('PROFILE_FORMAT', () => {
  it('turns 5.56 rounds and mags into 7.62×39 ones (format 3 → 4)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 3;
    old.gear.pockets.items[0].item.item = 'ammo-556';
    old.gear.primary1.attachments = { optic: null, muzzle: null, magazine: 'mag-556-45' };
    old.stash[0].items[0].item.item = 'mag-556-45';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.formatVersion).toBe(4);
    expect(p.gear.pockets.items[0]!.item.item).toBe('ammo-762x39');
    expect(p.gear.primary1!.attachments!.magazine).toBe('mag-762x39-45');
    expect(p.gear.primary1!.attachments!.optic).toBeNull();
    expect(p.stash[0]!.items[0]!.item.item).toBe('mag-762x39-45');
    expect(p.gear.primary1!.item).toBe('rifle');
  });
});

describe('checkProfile', () => {
  it('refuses unknown items, oversized stacks and overlaps', () => {
    let p = profile();
    p.gear.pockets.items[0]!.item.item = 'gold-bar';
    expect(checkProfile(items, p)).toMatch(/no item "gold-bar"/);

    p = profile();
    p.gear.pockets.items[0]!.item.count = 1000;
    expect(checkProfile(items, p)).toMatch(/more than a stack/);

    p = profile();
    const vault = p.gear.vault!;
    placeAt(items, vault, createItem(items, 'bandage'), 0, 0, false);
    vault.items.push({ x: 0, y: 0, rotated: false, item: createItem(items, 'bandage') });
    expect(checkProfile(items, p)).toMatch(/overlaps/);
  });

  it('refuses a container in a container, a resized grid and gear in the wrong slot', () => {
    let p = profile();
    addItem(items, p.gear.rig!.grid!, createItem(items, 'rig'));
    // addItem refuses it; force it in.
    p.gear.rig!.grid!.items.push({ x: 0, y: 1, rotated: false, item: createItem(items, 'rig') });
    expect(checkProfile(items, p)).toMatch(/can't go in rig/);

    p = profile();
    p.gear.vault!.w = 6;
    expect(checkProfile(items, p)).toMatch(/vault: must be 2×3/);

    p = profile();
    p.gear.sidearm = p.gear.primary1;
    expect(checkProfile(items, p)).toMatch(/sidearm/);
  });

  it('checks guns, armour and meds against their limits', () => {
    let p = profile();
    (p.gear.primary1 as WeaponState).mag = 31;
    expect(checkProfile(items, p)).toMatch(/more than its magazine/);
    (p.gear.primary1 as WeaponState).attachments.magazine = 'big-mag';
    expect(checkProfile(items, p)).toBeNull();
    (p.gear.sidearm as WeaponState).attachments.magazine = 'big-mag';
    expect(checkProfile(items, p)).toMatch(/doesn't fit/);

    p = profile();
    (p.gear.primary1 as WeaponState).loaded = 'ap-round';
    expect(checkProfile(items, p)).toBeNull();
    (p.gear.primary1 as WeaponState).loaded = 'shell';
    expect(checkProfile(items, p)).toMatch(/doesn't fire "shell"/);

    p = profile();
    p.gear.helmet!.durability = 1e6;
    expect(checkProfile(items, p)).toMatch(/durability/);

    p = profile();
    addItem(items, p.gear.pockets, { item: 'splint', count: 1, left: 9 });
    expect(checkProfile(items, p)).toMatch(/left/);
  });

  it('refuses money over the limit', () => {
    const p = profile();
    p.money = 9e12;
    expect(checkProfile(items, p)).toMatch(/money/);
  });
});

describe('parseGear', () => {
  it('takes gear straight from the sim and refuses junk', () => {
    const gear = profile().gear;
    expect(parseGear(JSON.parse(JSON.stringify(gear)))).toEqual(gear);
    expect(parseGear({ ...gear, pockets: 'lots' })).toBeNull();
    expect(parseGear({ ...gear, extra: 1 })).toBeNull();
  });
});

describe('itemGained', () => {
  it('lets items move and be used up, but not appear', () => {
    const before = profile();
    const after = profile();
    // Rounds out of the gun into the pockets: the same rounds, loaded rounds counted.
    const rifle = after.gear.primary1 as WeaponState;
    after.gear.pockets.items[0]!.item.count += rifle.mag;
    rifle.mag = 0;
    expect(itemGained(items, before, after)).toBeNull();
    after.gear.pockets.items[0]!.item.count += 1;
    expect(itemGained(items, before, after)).toBe('round');
    after.gear.pockets.items[0]!.item.count -= 1;
    after.gear.vault!.items.push({ x: 0, y: 0, rotated: false, item: createItem(items, 'watch') });
    expect(itemGained(items, before, after)).toBe('watch');
  });

  it('counts attachments on guns', () => {
    const before = profile();
    const after = profile();
    (after.gear.primary1 as WeaponState).attachments.optic = 'scope';
    expect(itemGained(items, before, after)).toBe('scope');
  });
});

describe('restGear and keptGear', () => {
  it('puts guns down and keeps only the knife and vault after a death', () => {
    const p = profile();
    const gun = p.gear.primary1 as WeaponState;
    gun.reloading = 1.2;
    gun.triggerHeld = true;
    restGear(p.gear);
    expect(gun.reloading).toBe(0);
    expect(gun.triggerHeld).toBe(false);

    addItem(items, p.gear.vault!, createItem(items, 'watch'));
    expect(keptGear(p.gear, true)).toBe(p.gear);
    const kept = keptGear(p.gear, false);
    expect(kept.primary1).toBeNull();
    expect(kept.rig).toBeNull();
    expect(kept.pockets.items).toEqual([]);
    expect(kept.knife?.item).toBe('knife');
    expect(kept.vault?.items.map((g) => g.item.item)).toEqual(['watch']);
    expect(kept.hand).toBe('knife');
    expect(checkProfile(items, { ...p, gear: kept })).toBeNull();
  });
});

describe('settleGuns', () => {
  it('moves a pistol out of a primary slot: to an empty sidearm, else the stash', () => {
    const p = profile();
    // As saved before pistols left the primaries.
    p.gear.primary2 = p.gear.sidearm;
    p.gear.sidearm = null;
    p.gear.hand = 'primary2';
    expect(checkProfile(items, p)).toMatch(/primary2/);
    settleGuns(items, p.gear, p.stash);
    expect(p.gear.primary2).toBeNull();
    expect((p.gear.sidearm as WeaponState | null)?.item).toBe('pistol');
    expect(p.gear.hand).toBe('sidearm');
    expect(checkProfile(items, p)).toBeNull();

    p.gear.primary2 = createItem(items, 'pistol') as WeaponState;
    p.gear.hand = 'primary2';
    settleGuns(items, p.gear, p.stash);
    expect(p.gear.primary2).toBeNull();
    expect(p.gear.hand).toBe('knife');
    expect(p.stash[0]!.items.some((gi) => gi.item.item === 'pistol')).toBe(true);
    expect(checkProfile(items, p)).toBeNull();
  });
});

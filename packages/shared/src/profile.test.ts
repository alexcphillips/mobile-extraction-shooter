import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import { addItem, placeAt } from './inventory/grid';
import {
  PROFILE_FORMAT,
  PROFILE_FORMAT_VERSION,
  checkProfile,
  countItems,
  itemGained,
  newProfile,
  parseGear,
  restGear,
  settleBags,
  settleFits,
  settleGuns,
  settlePockets,
  settleStash,
  settleHangarSpace,
  sortToCategoryPages,
  vaultSize,
  QUARTERS,
  SECURE_LOCKER,
  type Profile,
} from './profile';
import { createItem } from './sim/create-item';
import { POCKET_SECTIONS } from './sim/gear';
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
    loaded: { rifle: 'round', pistol: 'round' },
  },
  'test.json',
);

/** A fresh profile from the test kit, as stored and loaded again. */
function profile(): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(JSON.stringify(newProfile(items, kit))), 'p');
}

describe('newProfile', () => {
  it("leaves a kit's guns empty unless it names a round for them", () => {
    const { gear, stash } = newProfile(items, {
      ...kit,
      gear: { primary1: 'rifle', sidearm: 'pistol' },
      carried: [],
      stash: [{ item: 'rifle' }, { item: 'pistol' }],
      loaded: { rifle: 'round' },
    });
    expect(gear.primary1?.mag).toBeGreaterThan(0);
    expect(gear.sidearm?.mag).toBe(0);
    const inStash = stash[0]!.items.map((g) => [g.item.item, g.item.mag! > 0]);
    expect(inStash).toEqual([
      ['rifle', true],
      ['pistol', false],
    ]);
  });

  it("fits every copy of a kit's gun with the attachments it names", () => {
    const { gear, stash } = newProfile(items, {
      ...kit,
      stash: [{ item: 'rifle' }],
      fitted: { rifle: ['scope'] },
    });
    expect(gear.primary1?.attachments?.optic).toBe('scope');
    expect(stash[0]!.items[0]!.item.attachments?.optic).toBe('scope');
    expect(gear.sidearm?.attachments?.optic).toBeNull();
  });

  it('refuses a kit fitting a gun with an attachment it cannot take', () => {
    expect(() => newProfile(items, { ...kit, fitted: { pistol: ['scope'] } })).toThrow(/pistol/);
  });

  it('refuses a kit loading a gun with a round it cannot fire', () => {
    expect(() => newProfile(items, { ...kit, loaded: { rifle: 'bandage' } })).toThrow(/rifle/);
  });

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
    expect(p.formatVersion).toBe(PROFILE_FORMAT_VERSION);
    expect(p.gear.pockets.items[0]!.item.item).toBe('ammo-762x39');
    expect(p.gear.primary1!.attachments!.magazine).toBe('mag-762x39-45');
    expect(p.gear.primary1!.attachments!.optic).toBeNull();
    expect(p.stash[0]!.items[0]!.item.item).toBe('mag-762x39-45');
    expect(p.gear.primary1!.item).toBe('rifle');
  });

  it('renames reshaped rounds, loaded ones too (format 4 → 5)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 4;
    old.gear.pockets.items[0].item.item = 'ammo-45acp-match';
    old.stash[0].items[0].item.item = 'ammo-762x54r-t46m';
    old.gear.primary1.loaded = 'ammo-45acp-match';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.gear.pockets.items[0]!.item.item).toBe('ammo-45acp');
    expect(p.stash[0]!.items[0]!.item.item).toBe('ammo-762x54r-hpbt');
    expect(p.gear.primary1!.loaded).toBe('ammo-45acp');
  });

  it('turns pistols into M9A3s, without the optic it takes no longer (format 5 → 6)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 5;
    const attachments = { optic: 'red-dot', muzzle: 'suppressor', magazine: 'mag-9mm-24' };
    old.gear.primary1 = { ...old.gear.primary1, item: 'pistol', attachments };
    old.stash[0].items[0].item.item = 'pistol';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.gear.primary1!.item).toBe('m9a3');
    expect(p.gear.primary1!.attachments).toEqual({ ...attachments, optic: null });
    expect(p.stash[0]!.items[0]!.item.item).toBe('m9a3');
  });

  it('turns sniper rifles into SV-98s on their own round (format 6 → 7)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 6;
    old.gear.primary1 = { ...old.gear.primary1, item: 'sniper-rifle', loaded: 'ammo-762-m61' };
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.gear.primary1!.item).toBe('sv-98');
    expect(p.gear.primary1!.loaded).toBeUndefined();
  });

  it('gives guns named by class their own ids, in the stash and in gear (format 8 → 9)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 8;
    old.gear.primary1 = { ...old.gear.primary1, item: 'assault-rifle' };
    old.gear.primary2 = { ...old.gear.primary1, item: 'shotgun' };
    old.stash[0].items[0].item.item = 'smg';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.gear.primary1!.item).toBe('akm');
    expect(p.gear.primary2!.item).toBe('mp-133');
    expect(p.stash[0]!.items[0]!.item.item).toBe('k10');
  });

  it('turns medkits into field first aid kits (format 9 → 10)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 9;
    old.stash[0].items[0].item.item = 'medkit';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.stash[0]!.items[0]!.item.item).toBe('field-first-aid-kit');
  });

  it('renames encrypted drives and nuclear facility blueprints (format 13 → 14)', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit)));
    old.formatVersion = 13;
    old.stash[0].items[0].item.item = 'encrypted-drive';
    old.stash[0].items[1].item.item = 'nuclear-facility-blueprint';
    const p = loadContent(PROFILE_FORMAT, old, 'p');
    expect(p.stash[0]!.items[0]!.item.item).toBe('encrypted-usb-drive');
    expect(p.stash[0]!.items[1]!.item.item).toBe('nuclear-facility-schematics');
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
    expect(checkProfile(items, p)).toMatch(/vault: must be 2×1/);

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

describe('settleHangarSpace (H4)', () => {
  it('shrinks a vault bigger than the Secure locker gives, moving what hangs off to the stash', () => {
    const p = profile();
    // As saved when the vault was 2×2.
    const vault = p.gear.vault!;
    expect([vault.w, vault.h]).toEqual([2, 1]);
    vault.h = 2;
    placeAt(items, vault, createItem(items, 'bandage'), 0, 0, false);
    placeAt(items, vault, createItem(items, 'watch'), 0, 1, false);
    expect(checkProfile(items, p)).toMatch(/vault: must be 2×1/);
    settleHangarSpace(items, p);
    expect([vault.w, vault.h]).toEqual([2, 1]);
    expect(vault.items.map((g) => g.item.item).sort()).toEqual(['bandage', 'watch']);
    expect(checkProfile(items, p)).toBeNull();
  });

  it('grows the vault with the locker, moving nothing', () => {
    const p = profile();
    placeAt(items, p.gear.vault!, createItem(items, 'watch'), 1, 0, false);
    for (const [level, size] of [
      [1, [2, 2]],
      [2, [3, 2]],
      [3, [3, 3]],
    ] as const) {
      p.hangar[SECURE_LOCKER] = level;
      expect(checkProfile(items, p)).toMatch(/vault: must be/);
      settleHangarSpace(items, p);
      expect(vaultSize(p)).toEqual(size);
      expect([p.gear.vault!.w, p.gear.vault!.h]).toEqual(size);
      expect(p.gear.vault!.items[0]).toMatchObject({ x: 1, y: 0 });
      expect(checkProfile(items, p)).toBeNull();
    }
  });

  it('adds the category pages at Quarters level 3, once, and checks them', () => {
    const p = profile();
    p.hangar[QUARTERS] = 3;
    expect(checkProfile(items, p)).toMatch(/category pages/);
    settleHangarSpace(items, p);
    settleHangarSpace(items, p);
    expect(p.stash.map((g) => g.only ?? null)).toEqual([null, 'guns', 'ammo', 'meds']);
    expect(checkProfile(items, p)).toBeNull();
    // Only their kinds go in.
    expect(addItem(items, p.stash[2]!, createItem(items, 'round', 30))).toBe(0);
    expect(addItem(items, p.stash[2]!, createItem(items, 'watch'))).toBe(1);
    p.stash[3]!.items.push({ x: 0, y: 0, rotated: false, item: createItem(items, 'watch') });
    expect(checkProfile(items, p)).toMatch(/can't go in stash page 4/);
    p.stash[3]!.items = [];
    // Not dropped, nor swapped about.
    p.stash.splice(1, 1);
    expect(checkProfile(items, p)).toMatch(/category pages/);
  });

  it('auto sort moves loose items onto their category page, topping up stacks', () => {
    const p = profile();
    p.hangar[QUARTERS] = 3;
    settleHangarSpace(items, p);
    const page = p.stash[0]!;
    page.items = [];
    addItem(items, page, createItem(items, 'round', 40));
    addItem(items, page, createItem(items, 'bandage'));
    addItem(items, page, createItem(items, 'watch'));
    addItem(items, p.stash[2]!, createItem(items, 'round', 30));
    expect(sortToCategoryPages(items, p)).toBe(true);
    expect(page.items.map((g) => g.item.item)).toEqual(['watch']);
    expect(p.stash[2]!.items.reduce((n, g) => n + g.item.count, 0)).toBe(70);
    expect(p.stash[3]!.items.map((g) => [g.item.item, g.item.count])).toEqual([['bandage', 1]]);
    expect(sortToCategoryPages(items, p)).toBe(false);
    expect(checkProfile(items, p)).toBeNull();
  });
});

describe('settleStash', () => {
  it('reshapes a page saved at an old size, moving only what hangs off', () => {
    const p = profile();
    // As saved while pages were 9×30.
    const page = p.stash[0]!;
    page.w = 9;
    page.h = 30;
    placeAt(items, page, createItem(items, 'watch'), 8, 5, false);
    placeAt(items, page, createItem(items, 'watch'), 0, 25, false);
    expect(checkProfile(items, p)).toMatch(/stash page 1/);
    settleStash(items, p.stash);
    expect([page.w, page.h]).toEqual([10, 20]);
    expect(page.items.filter((g) => g.item.item === 'watch')).toHaveLength(2);
    expect(page.items.find((g) => g.item.item === 'watch')).toMatchObject({ x: 8, y: 5 });
    expect(checkProfile(items, p)).toBeNull();
  });
});

describe('settleBags', () => {
  it("gives a bag saved before its sections its def's shape, moving what crosses them", () => {
    const p = profile();
    const rig = createItem(items, 'pouch-rig');
    expect(rig.grid!.sections).toHaveLength(3);
    // As saved before it had sections: a pistol lying across two pouches.
    delete rig.grid!.sections;
    placeAt(items, rig.grid!, createItem(items, 'pistol'), 0, 0, false);
    placeAt(items, rig.grid!, createItem(items, 'bandage'), 2, 1, false);
    p.gear.rig = rig as typeof p.gear.rig;
    // And one on a stash page, with a medkit that still fits.
    const stored = createItem(items, 'pouch-rig');
    delete stored.grid!.sections;
    placeAt(items, stored.grid!, createItem(items, 'medkit'), 1, 0, false);
    addItem(items, p.stash[0]!, stored);
    expect(checkProfile(items, p)).toMatch(/must be 3×2 in 3 sections/);
    settleBags(items, p.gear, p.stash);
    expect(rig.grid!.sections).toHaveLength(3);
    // The pistol turned upright in the first free pouch; the bandage stayed.
    expect(rig.grid!.items).toMatchObject([
      { x: 2, y: 1, item: { item: 'bandage' } },
      { x: 0, y: 0, rotated: true, item: { item: 'pistol' } },
    ]);
    expect(stored.grid!.items).toMatchObject([{ x: 1, y: 0, item: { item: 'medkit' } }]);
    expect(checkProfile(items, p)).toBeNull();
  });

  it('lets backpacks saved before 2026-11-10 take empty bags, and only backpacks', () => {
    const p = profile();
    const pack = createItem(items, 'backpack');
    expect(pack.grid!.bags).toBe(true);
    expect(createItem(items, 'rig').grid!.bags).toBeUndefined();
    delete pack.grid!.bags;
    p.gear.backpack = pack as typeof p.gear.backpack;
    expect(checkProfile(items, p)).toMatch(/must take empty bags/);
    settleBags(items, p.gear, p.stash);
    expect(pack.grid!.bags).toBe(true);
    expect(addItem(items, pack.grid!, createItem(items, 'rig'))).toBe(0);
    expect(checkProfile(items, p)).toBeNull();
    // A rig claiming to take bags is refused, and so are pockets.
    p.gear.rig!.grid!.bags = true;
    expect(checkProfile(items, p)).toMatch(/mustn't take empty bags/);
    delete p.gear.rig!.grid!.bags;
    p.gear.pockets.bags = true;
    expect(checkProfile(items, p)).toMatch(/can't take bags/);
  });
});

describe('settlePockets', () => {
  it('splits old 4×1 pockets into five slots, moving anything bigger than 1×1 to the stash', () => {
    const p = profile();
    // As saved when the pockets were one 4×1 grid: the kit's rounds and bandage, and a
    // scope (2×1) beside them.
    const pockets = p.gear.pockets;
    pockets.w = 4;
    delete pockets.sections;
    placeAt(items, pockets, createItem(items, 'scope'), 2, 0, false);
    expect(checkProfile(items, p)).toMatch(/pockets: must be 5×1 in 5 sections/);
    settlePockets(items, p.gear, p.stash);
    expect(p.gear.pockets).toMatchObject({ w: 5, h: 1, sections: POCKET_SECTIONS });
    expect(pockets.items.map((g) => g.item.item).sort()).toEqual(['bandage', 'round']);
    expect(p.stash[0]!.items.some((g) => g.item.item === 'scope')).toBe(true);
    expect(checkProfile(items, p)).toBeNull();
  });

  it('leaves any other shape alone', () => {
    const p = profile();
    p.gear.pockets.w = 8;
    delete p.gear.pockets.sections;
    settlePockets(items, p.gear, p.stash);
    expect(p.gear.pockets.w).toBe(8);
    expect(checkProfile(items, p)).toMatch(/pockets: must be 5×1/);
  });
});

describe('settleFits', () => {
  it('moves items that grew out of their spots: in the grid, else to the stash', () => {
    const p = profile();
    const bag = createItem(items, 'backpack');
    p.gear.backpack = bag as typeof p.gear.backpack;
    const grid = bag.grid!;
    // As saved when a rifle was 4×1: one on row 0 with a watch under it (now overlapped).
    grid.items.push({ x: 0, y: 1, rotated: false, item: createItem(items, 'watch') });
    grid.items.push({ x: 0, y: 0, rotated: false, item: createItem(items, 'rifle') });
    // And one in the pockets, which are 1 tall: no room there, so it goes to the stash.
    p.gear.pockets.items.push({ x: 0, y: 0, rotated: false, item: createItem(items, 'rifle') });
    expect(checkProfile(items, p)).toMatch(/outside the grid or overlaps/);
    settleFits(items, p.gear, p.stash);
    expect(grid.items).toMatchObject([
      { x: 0, y: 1, item: { item: 'watch' } },
      { x: 0, y: 2, item: { item: 'rifle' } },
    ]);
    // The kit's rounds and bandage were there first: the rifle moves.
    expect(p.gear.pockets.items.some((g) => g.item.item === 'rifle')).toBe(false);
    expect(p.stash[0]!.items.filter((g) => g.item.item === 'rifle')).toHaveLength(1);
    expect(checkProfile(items, p)).toBeNull();
  });
});

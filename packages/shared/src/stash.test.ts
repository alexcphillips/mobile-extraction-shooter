import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import { addItem, countOf } from './inventory/grid';
import {
  PROFILE,
  PROFILE_FORMAT,
  buyStashPage,
  checkProfile,
  itemGained,
  newProfile,
  nextPagePrice,
  type Profile,
} from './profile';
import { createItem } from './sim/create-item';
import type { InventoryAction, Owner } from './sim/looting';
import { applyStash, openStash, stashOwner } from './stash';
import { TEST_ITEMS as items } from './sim/test-items';

const kit = loadContent(
  STARTING_KIT_FORMAT,
  {
    formatVersion: 1,
    id: 'test',
    money: 0,
    gear: { primary1: 'rifle', helmet: 'helmet', backpack: 'backpack' },
    carried: [{ item: 'round', count: 60 }],
    stash: [{ item: 'pistol' }, { item: 'scope' }, { item: 'watch' }],
  },
  'test.json',
);

function profile(): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(JSON.stringify(newProfile(items, kit))), 'p');
}

const self: Owner = { kind: 'self' };
const stash = { owner: stashOwner(0), grid: 'loot' } as const;
const page1 = { owner: stashOwner(1), grid: 'loot' } as const;

describe('the stash', () => {
  it('moves items between the stash and the gear, editing the profile', () => {
    const p = profile();
    const before = JSON.parse(JSON.stringify(p)) as Profile;
    const s = openStash(p);
    const pistol = p.stash[0]!.items.findIndex((g) => g.item.item === 'pistol');
    // A double-tapped pistol goes in the sidearm slot.
    expect(
      applyStash(s, items, {
        type: 'quick',
        from: { ...stash, index: pistol, item: 'pistol' },
        to: self,
      }),
    ).toBe(true);
    expect(p.gear.sidearm?.item).toBe('pistol');
    // The helmet into the stash, and the scope onto the rifle, from the stash.
    expect(
      applyStash(s, items, {
        type: 'quick',
        from: { owner: self, slot: 'helmet', item: 'helmet' },
        to: stashOwner(0),
      }),
    ).toBe(true);
    expect(p.gear.helmet).toBeNull();
    const scope = p.stash[0]!.items.findIndex((g) => g.item.item === 'scope');
    expect(
      applyStash(s, items, {
        type: 'attach',
        gun: { owner: self, slot: 'primary1', item: 'rifle' },
        from: { ...stash, index: scope, item: 'scope' },
      }),
    ).toBe(true);
    expect(p.gear.primary1?.attachments?.optic).toBe('scope');
    // Still a valid profile, with nothing made from nothing: the server takes it.
    expect(checkProfile(items, p)).toBeNull();
    expect(itemGained(items, before, p)).toBeNull();
  });

  it('unloads a gun in the stash without making rounds', () => {
    const p = profile();
    const before = JSON.parse(JSON.stringify(p)) as Profile;
    const s = openStash(p);
    const pistol = p.stash[0]!.items.findIndex((g) => g.item.item === 'pistol');
    const loaded = p.stash[0]!.items[pistol]!.item.mag!;
    expect(
      applyStash(s, items, {
        type: 'unload',
        gun: { ...stash, index: pistol, item: 'pistol' },
      }),
    ).toBe(true);
    expect(p.stash[0]!.items[pistol]!.item.mag).toBe(0);
    expect(countOf(p.gear.pockets, 'round') + countOf(p.gear.backpack!.grid!, 'round')).toBe(
      60 + loaded,
    );
    expect(itemGained(items, before, p)).toBeNull();
  });

  it('never drops on the ground, and keeps the knife', () => {
    const p = profile();
    const s = openStash(p);
    const drop: InventoryAction = {
      type: 'quick',
      from: { owner: self, slot: 'primary1', item: 'rifle' },
      to: { kind: 'ground' },
    };
    expect(applyStash(s, items, drop)).toBe(false);
    expect(
      applyStash(s, items, {
        type: 'move',
        from: { owner: self, slot: 'helmet', item: 'helmet' },
        to: { owner: { kind: 'ground' } },
      }),
    ).toBe(false);
    expect(
      applyStash(s, items, {
        type: 'quick',
        from: { owner: self, slot: 'knife', item: 'knife' },
        to: stashOwner(0),
      }),
    ).toBe(false);
    expect(p.gear.knife?.item).toBe('knife');
    expect(p.gear.primary1?.item).toBe('rifle');
    expect(p.gear.helmet?.item).toBe('helmet');
    expect(countOf(p.stash[0]!, 'knife')).toBe(0);
  });

  it("puts what the inventory would drop into the stash, or refuses if there's no room", () => {
    const p = profile();
    const s = openStash(p);
    const scope = p.stash[0]!.items.findIndex((g) => g.item.item === 'scope');
    applyStash(s, items, {
      type: 'attach',
      gun: { owner: self, slot: 'primary1', item: 'rifle' },
      from: { ...stash, index: scope, item: 'scope' },
    });
    // Pockets and backpack full: taken off "into what you carry", it lands in the stash.
    for (const grid of [p.gear.pockets, p.gear.backpack!.grid!]) {
      while (addItem(items, grid, createItem(items, 'watch')) === 0);
    }
    const off: InventoryAction = {
      type: 'detach',
      gun: { owner: self, slot: 'primary1', item: 'rifle' },
      slot: 'optic',
      part: 'scope',
      to: null,
    };
    expect(applyStash(s, items, off)).toBe(true);
    expect(countOf(p.stash[0]!, 'scope')).toBe(1);
    expect(s.sim.ground).toEqual([]);

    // With the stash full too, nothing changes.
    const again = p.stash[0]!.items.findIndex((g) => g.item.item === 'scope');
    applyStash(s, items, {
      type: 'attach',
      gun: { owner: self, slot: 'primary1', item: 'rifle' },
      from: { ...stash, index: again, item: 'scope' },
    });
    while (addItem(items, p.stash[0]!, createItem(items, 'watch')) === 0);
    const full = JSON.stringify(p);
    expect(applyStash(s, items, off)).toBe(false);
    expect(JSON.stringify(p)).toBe(full);
    expect(p.gear.primary1?.attachments?.optic).toBe('scope');
  });

  it('leaves the hand alone, but for the knife when its slot is emptied', () => {
    const p = profile();
    const s = openStash(p);
    expect(p.gear.hand).toBe('primary1');
    applyStash(s, items, {
      type: 'quick',
      from: { owner: self, slot: 'primary1', item: 'rifle' },
      to: stashOwner(0),
    });
    expect(p.gear.hand).toBe('knife');
    const pistol = p.stash[0]!.items.findIndex((g) => g.item.item === 'pistol');
    applyStash(s, items, {
      type: 'quick',
      from: { ...stash, index: pistol, item: 'pistol' },
      to: self,
    });
    // A gun put on isn't taken out for you: the knife stays in hand.
    expect(p.gear.hand).toBe('knife');
  });

  it('loads even the gun in hand at once, from rounds anywhere in the stash', () => {
    const p = profile();
    const s = openStash(p);
    addItem(items, p.stash[0]!, createItem(items, 'ap-round', 50));
    const index = p.stash[0]!.items.findIndex((g) => g.item.item === 'ap-round');
    const action: InventoryAction = {
      type: 'load',
      gun: { owner: self, slot: 'primary1', item: 'rifle' },
      from: { ...stash, index, item: 'ap-round' },
    };
    expect(applyStash(s, items, action)).toBe(true);
    expect(p.gear.primary1).toMatchObject({ mag: 30, loaded: 'ap-round', reloading: 0 });
    expect(countOf(p.stash[0]!, 'ap-round')).toBe(20);
    // The 30 rounds it had went into what's carried.
    expect(countOf(p.gear.pockets, 'round') + countOf(p.gear.backpack!.grid!, 'round')).toBe(90);
  });

  it('sends a double-tap to the page shown, then the others', () => {
    const p = profile();
    p.money = PROFILE.pagePrices[0];
    expect(buyStashPage(p)).toBeNull();
    const s = openStash(p);
    // Page 2 shown and full: the helmet goes to page 1.
    while (addItem(items, p.stash[1]!, createItem(items, 'watch')) === 0);
    expect(
      applyStash(s, items, {
        type: 'quick',
        from: { owner: self, slot: 'helmet', item: 'helmet' },
        to: stashOwner(1),
      }),
    ).toBe(true);
    expect(countOf(p.stash[0]!, 'helmet')).toBe(1);
    // A stack split across pages: 60 rounds with room for 20 on page 2 and the rest on 1.
    p.stash[1]!.items.splice(-1, 1);
    const rounds = p.gear.pockets.items.findIndex((g) => g.item.item === 'round');
    const n = p.gear.pockets.items[rounds]!.item.count;
    p.stash[1]!.items.push({ x: 9, y: 29, rotated: false, item: createItem(items, 'round', 40) });
    applyStash(
      s,
      items,
      {
        type: 'quick',
        from: { owner: self, grid: 'pockets', index: rounds, item: 'round' },
        to: stashOwner(1),
      },
      1,
    );
    expect(countOf(p.stash[1]!, 'round') + countOf(p.stash[0]!, 'round')).toBe(40 + n);
    expect(countOf(p.gear.pockets, 'round')).toBe(0);
    // And dragged from page 2 to page 1, as on any loot container.
    const at = p.stash[1]!.items.findIndex((g) => g.item.item === 'round');
    expect(
      applyStash(s, items, {
        type: 'move',
        from: { ...page1, index: at, item: 'round' },
        to: { ...stash, x: 9, y: 0, rotated: false },
      }),
    ).toBe(true);
    expect(checkProfile(items, p)).toBeNull();
  });
});

describe('stash pages', () => {
  it('cost money, one after another, up to the last', () => {
    const p = profile();
    expect(nextPagePrice(p)).toBe(PROFILE.pagePrices[0]);
    expect(buyStashPage(p)).toMatch(/costs/);
    expect(p.stash).toHaveLength(1);
    p.money = PROFILE.pagePrices.reduce((a, b) => a + b, 0) + 5;
    for (let i = 0; i < PROFILE.pagePrices.length; i++) expect(buyStashPage(p)).toBeNull();
    expect(p.stash).toHaveLength(PROFILE.pagePrices.length + 1);
    expect(p.money).toBe(5);
    expect(nextPagePrice(p)).toBeNull();
    expect(buyStashPage(p)).toMatch(/every page/);
    expect(checkProfile(items, p)).toBeNull();
    p.stash.push(p.stash[0]!);
    expect(checkProfile(items, p)).toMatch(/more than there can be/);
  });

  it('turns an old one-grid stash into the first page', () => {
    const old = JSON.parse(JSON.stringify(profile())) as Record<string, unknown>;
    old.formatVersion = 1;
    old.stash = (old.stash as unknown[])[0];
    const p = loadContent(PROFILE_FORMAT, old, 'old');
    expect(p.stash).toHaveLength(1);
    expect(p.stash[0]!.items.map((g) => g.item.item)).toEqual(['pistol', 'scope', 'watch']);
  });
});

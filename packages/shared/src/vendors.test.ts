import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import { VENDOR_FORMAT, checkVendors, type VendorDef } from './content/vendors';
import { addItem, countOf, createGrid } from './inventory/grid';
import { PROFILE, PROFILE_FORMAT, newProfile, overRepaired, type Profile } from './profile';
import { createItem } from './sim/create-item';
import { applyStash, openStash, stashOwner } from './stash';
import { TEST_ITEMS as items } from './sim/test-items';
import {
  VENDOR,
  buyOffer,
  buyPrice,
  cantSell,
  depositInto,
  sellAll,
  sellAllPrice,
  sellItems,
  sellParts,
  sellPrice,
} from './vendors';

const kit = loadContent(
  STARTING_KIT_FORMAT,
  {
    formatVersion: 1,
    id: 'test',
    money: 10_000,
    gear: { primary1: 'rifle', bodyArmour: 'vest', backpack: 'backpack' },
    carried: [{ item: 'round', count: 30 }],
    stash: [{ item: 'watch' }, { item: 'repair-kit' }],
  },
  'test.json',
);

function profile(): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(JSON.stringify(newProfile(items, kit))), 'p');
}

const shop = (sells: unknown[]): VendorDef =>
  loadContent(VENDOR_FORMAT, { formatVersion: 1, id: 'shop', name: 'Shop', sells }, 'shop.json');

const vendor = shop([{ item: 'bandage' }, { item: 'round', count: 30 }, { item: 'backpack' }]);

const self = { kind: 'self' } as const;
const page0 = { owner: stashOwner(0), grid: 'loot' } as const;
const clone = (p: Profile): Profile => JSON.parse(JSON.stringify(p)) as Profile;

describe('vendors', () => {
  it("sell for an item's value and buy for a share of it, less when worn, more with parts", () => {
    const share = VENDOR.sellShare;
    expect(buyPrice(items, { item: 'round', count: 30 })).toBe(3000);
    expect(sellPrice(items, createItem(items, 'watch'))).toBe(100 * share);
    const vest = createItem(items, 'vest');
    vest.durability = 25;
    expect(sellPrice(items, vest)).toBe(100 * share * 0.5);
    // The rifle with its 30 rounds loaded and a scope on it.
    const rifle = createItem(items, 'rifle');
    rifle.attachments!.optic = 'scope';
    expect(sellPrice(items, rifle)).toBe((100 + 100 + 30 * 100) * share);
    // Part by part, for the item details: the gun, the scope, then the rounds.
    expect(sellParts(items, rifle)).toEqual([
      { id: 'rifle', count: 1, price: 100 * share },
      { id: 'scope', count: 1, price: 100 * share },
      { id: rifle.loaded ?? 'round', count: 30, price: 30 * 100 * share },
    ]);
    // Money is worth its full value.
    expect(sellPrice(items, createItem(items, 'cash', 250))).toBe(250);
    // A backpack with something in it isn't bought.
    const pack = createItem(items, 'backpack');
    expect(cantSell(items, pack)).toBeNull();
    addItem(items, pack.grid!, createItem(items, 'watch'));
    expect(cantSell(items, pack)).toMatch(/empty/i);
  });

  it('checks offers: items that exist, have a value, fit a stack and are not money', () => {
    const ok = new Map([['shop', vendor]]);
    expect(() => checkVendors(ok, items)).not.toThrow();
    for (const [sells, why] of [
      [[{ item: 'nothing' }], /no item/],
      [[{ item: 'cash' }], /money/],
      [[{ item: 'round', count: 500 }], /stack/],
    ] as const) {
      expect(() => checkVendors(new Map([['shop', shop([...sells])]]), items)).toThrow(why);
    }
  });

  it('buys into the stash page asked for, and refuses without the money or the room', () => {
    const p = profile();
    p.stash.push(createGrid(PROFILE.stash[0], PROFILE.stash[1], true));
    expect(buyOffer(p, items, vendor, 1, 1)).toBeNull();
    expect(p.money).toBe(7000);
    expect(countOf(p.stash[1]!, 'round')).toBe(30);
    expect(buyOffer(p, items, vendor, 0)).toBeNull();
    expect(countOf(p.stash[0]!, 'bandage')).toBe(1);
    expect(p.money).toBe(6900);
    expect(buyOffer(p, items, vendor, 7)).toMatch(/no offer/);

    p.money = 99;
    expect(buyOffer(p, items, vendor, 0)).toMatch(/costs 100/);
    // Every page full of watches: no room, and nothing changes.
    p.money = 10_000;
    for (const page of p.stash) while (addItem(items, page, createItem(items, 'watch')) === 0);
    const before = clone(p);
    expect(buyOffer(p, items, vendor, 2)).toMatch(/no room/);
    expect(p).toEqual(before);
  });

  it('sells from a gear slot, a carried grid or the stash; not the knife or a full backpack', () => {
    const p = profile();
    const watch = p.stash[0]!.items.findIndex((g) => g.item.item === 'watch');
    expect(sellItems(p, items, [{ ...page0, index: watch, item: 'watch' }])).toBeNull();
    expect(p.money).toBe(10_050);
    expect(countOf(p.stash[0]!, 'watch')).toBe(0);
    // A stale ref sells nothing.
    expect(sellItems(p, items, [{ ...page0, index: 0, item: 'watch' }])).toMatch(/moved/);

    // The rifle in hand: sold with its rounds, and the knife comes out.
    expect(p.gear.hand).toBe('primary1');
    expect(sellItems(p, items, [{ owner: self, slot: 'primary1', item: 'rifle' }])).toBeNull();
    expect(p.money).toBe(10_050 + 50 + 30 * 50);
    expect(p.gear.primary1).toBeNull();
    expect(p.gear.hand).toBe('knife');

    expect(sellItems(p, items, [{ owner: self, slot: 'knife', item: 'knife' }])).toMatch(/knife/);
    addItem(items, p.gear.backpack!.grid!, createItem(items, 'watch'));
    expect(sellItems(p, items, [{ owner: self, slot: 'backpack', item: 'backpack' }])).toMatch(
      /empty/,
    );
    const inPack = { owner: self, grid: 'backpack', index: 0, item: 'watch' } as const;
    expect(sellItems(p, items, [inPack])).toBeNull();
    expect(sellItems(p, items, [{ owner: self, slot: 'backpack', item: 'backpack' }])).toBeNull();
    expect(p.gear.backpack).toBeNull();
  });

  it('sells several at once, all or none: a backpack with its contents, items from one grid', () => {
    const p = profile();
    const pack = p.gear.backpack!.grid!;
    addItem(items, pack, createItem(items, 'watch'));
    addItem(items, pack, createItem(items, 'watch'));
    const watch = (index: number) =>
      ({ owner: self, grid: 'backpack', index, item: 'watch' }) as const;
    const backpack = { owner: self, slot: 'backpack', item: 'backpack' } as const;
    // The backpack with only one of its watches: refused, nothing sold.
    const before = clone(p);
    expect(sellItems(p, items, [backpack, watch(0)])).toMatch(/empty the backpack/);
    expect(p).toEqual(before);
    expect(sellItems(p, items, [watch(0), watch(0)])).toMatch(/twice/);
    expect(sellItems(p, items, [watch(0), { owner: self, slot: 'knife', item: 'knife' }])).toMatch(
      /knife/,
    );
    // Both watches and the backpack, the first watch's index going stale as it's removed.
    expect(sellItems(p, items, [watch(0), watch(1), backpack])).toBeNull();
    expect(p.gear.backpack).toBeNull();
    expect(p.money).toBe(10_000 + 2 * 50 + 50);
    expect(sellItems(p, items, [])).toMatch(/nothing/);
  });

  it('sells everything: gear, carried and stashed, but not the knife or what no one wants', () => {
    const p = profile();
    addItem(items, p.gear.backpack!.grid!, createItem(items, 'watch'));
    addItem(items, p.gear.vault!, createItem(items, 'watch'));
    // A worthless key (value 0) stays, and so does the stash backpack holding it.
    const key = { ...createItem(items, 'key') };
    const stored = createItem(items, 'backpack');
    addItem(items, stored.grid!, key);
    addItem(items, p.stash[0]!, stored);
    const keyDef = items.get('key')!;
    const db = new Map(items).set('key', { ...keyDef, value: 0 });
    const refs = sellAll(p, db);
    const price = sellAllPrice(p, db);
    const money = p.money;
    // The worn backpack comes after its contents, and the knife isn't there.
    const slots = refs.flatMap((r) => ('slot' in r ? [r.slot] : []));
    expect(slots).toEqual(['primary1', 'bodyArmour', 'backpack']);
    expect(refs.findIndex((r) => 'grid' in r && r.grid === 'backpack')).toBeLessThan(
      refs.findIndex((r) => 'slot' in r && r.slot === 'backpack'),
    );
    expect(sellItems(p, db, refs)).toBeNull();
    expect(p.money - money).toBe(price);
    expect(price).toBeGreaterThan(0);
    expect(p.gear.primary1 ?? p.gear.bodyArmour ?? p.gear.backpack).toBeNull();
    expect(p.gear.knife).not.toBeNull();
    expect(p.gear.pockets.items).toHaveLength(0);
    expect(p.gear.vault!.items).toHaveLength(0);
    expect(p.stash[0]!.items.map((g) => g.item.item)).toEqual(['backpack']);
    expect(sellAll(p, db)).toEqual([]);
  });

  it('deposits the money a raid brings out, from every grid, and leaves the rest', () => {
    const p = profile();
    addItem(items, p.gear.pockets, createItem(items, 'cash', 300));
    addItem(items, p.gear.vault!, createItem(items, 'cash', 1000));
    addItem(items, p.gear.vault!, createItem(items, 'cash', 200));
    addItem(items, p.gear.backpack!.grid!, createItem(items, 'cash', 5));
    expect(depositInto(p, items)).toBe(1505);
    expect(p.money).toBe(11_505);
    expect(countOf(p.gear.vault!, 'cash') + countOf(p.gear.pockets, 'cash')).toBe(0);
    expect(countOf(p.gear.pockets, 'round')).toBe(30);
    p.money = PROFILE.maxMoney - 10;
    addItem(items, p.gear.pockets, createItem(items, 'cash', 300));
    depositInto(p, items);
    expect(p.money).toBe(PROFILE.maxMoney);
  });
});

describe('repairs in the stash', () => {
  it('mend at once with a kit from anywhere, and the server can tell honest ones', () => {
    const p = profile();
    p.gear.bodyArmour!.durability = 5;
    const before = clone(p);
    const s = openStash(p);
    const kitAt = p.stash[0]!.items.findIndex((g) => g.item.item === 'repair-kit');
    const repair = {
      type: 'repair',
      kit: { ...page0, index: kitAt, item: 'repair-kit' },
      armour: { owner: self, slot: 'bodyArmour', item: 'vest' },
    } as const;
    expect(applyStash(s, items, repair)).toBe(true);
    // The vest takes 45 of the kit's 50 points.
    expect(p.gear.bodyArmour!.durability).toBe(50);
    expect(p.stash[0]!.items[kitAt]!.item.left).toBe(5);
    expect(overRepaired(items, before, p)).toBe(false);
    // Full now: nothing to do.
    expect(applyStash(s, items, repair)).toBe(false);
    // Spent: the last 5 points, and the kit is gone.
    p.gear.bodyArmour!.durability = 40;
    expect(applyStash(s, items, repair)).toBe(true);
    expect(p.gear.bodyArmour!.durability).toBe(45);
    expect(countOf(p.stash[0]!, 'repair-kit')).toBe(0);

    // A client that mends armour for free is caught.
    const forged = clone(before);
    forged.gear.bodyArmour!.durability = 50;
    expect(overRepaired(items, before, forged)).toBe(true);
  });
});

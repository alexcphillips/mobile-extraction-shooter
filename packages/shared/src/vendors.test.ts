import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import { VENDOR_FORMAT, checkVendors, type VendorDef } from './content/vendors';
import { addItem, countOf, createGrid } from './inventory/grid';
import { PROFILE, PROFILE_FORMAT, newProfile, overRepaired, type Profile } from './profile';
import { completeQuest } from './quests';
import { QUEST_FORMAT } from './content/quests';
import { createItem } from './sim/create-item';
import { keptItems, markBrought, settleFound } from './sim/raid';
import type { Character } from './sim/state';
import { applyStash, openStash, stashOwner } from './stash';
import { TEST_ITEMS as items } from './sim/test-items';
import {
  MAX_BUY,
  VENDOR,
  buyOffer,
  buyPrice,
  nextRestock,
  standingOf,
  vendorLevel,
  vendorStock,
  cantSell,
  depositInto,
  raidGains,
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
    gear: { primary1: 'rifle', bodyArmor: 'vest', backpack: 'backpack' },
    carried: [{ item: 'round', count: 30 }],
    stash: [{ item: 'watch' }, { item: 'repair-kit' }],
    loaded: { rifle: 'round', pistol: 'round' },
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

describe('raidGains', () => {
  const stack = (id: string, count: number) => ({ ...createItem(items, id), count });

  it('prices what was found, not what you brought', () => {
    const kept = [stack('round', 15), { ...stack('round', 30), brought: true as const }];
    expect(raidGains(items, kept)).toEqual([
      { id: 'round', count: 15, price: sellPrice(items, stack('round', 15)) },
    ]);
  });

  it('is empty when nothing found was kept', () => {
    expect(raidGains(items, [])).toEqual([]);
    expect(raidGains(items, [{ ...createItem(items, 'watch'), brought: true }])).toEqual([]);
  });

  it('leaves out what was found in an earlier raid and taken back in (2026-11-11)', () => {
    const vault = createGrid(2, 2);
    addItem(items, vault, { ...createItem(items, 'watch'), found: true });
    const c = { gear: { vault, knife: null } } as unknown as Character;
    markBrought(c);
    addItem(items, vault, stack('round', 15)); // looted in this raid
    const kept = keptItems(c.gear, false);
    expect(raidGains(items, kept).map((g) => g.id)).toEqual(['round']);
    settleFound(c.gear);
    // Both come out found, with no raid marks left for the stored profile.
    expect(vault.items.map((g) => g.item)).toEqual([
      { ...createItem(items, 'watch'), found: true },
      { ...stack('round', 15), found: true },
    ]);
  });
});

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

  it('sells a gun empty, with no rounds or attachments, so it sells back for the gun alone', () => {
    const p = profile();
    expect(buyOffer(p, items, shop([{ item: 'rifle' }]), 0)).toBeNull();
    const rifle = p.stash[0]!.items.find((g) => g.item.item === 'rifle')!.item;
    expect(rifle.mag).toBe(0);
    expect(Object.values(rifle.attachments!).every((a) => a === null)).toBe(true);
    expect(sellPrice(items, rifle)).toBe(
      Math.floor(buyPrice(items, { item: 'rifle' }) * VENDOR.sellShare),
    );
  });

  it('sells a gun with the attachments its offer fits, priced in', () => {
    const p = profile();
    const offer = { item: 'rifle', attachments: ['scope'] };
    expect(buyPrice(items, offer)).toBe(100 + 100);
    expect(buyOffer(p, items, shop([offer]), 0)).toBeNull();
    const rifle = p.stash[0]!.items.find((g) => g.item.item === 'rifle')!.item;
    expect(rifle.attachments!.optic).toBe('scope');
    expect(rifle.mag).toBe(0);
    // An attachment that isn't for the gun, or a second one for a slot, is a content error.
    for (const attachments of [['scope', 'scope'], ['round']])
      expect(() =>
        checkVendors(new Map([['shop', shop([{ item: 'rifle', attachments }])]]), items),
      ).toThrow(/doesn't fit/);
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
    p.gear.bodyArmor!.durability = 5;
    const before = clone(p);
    const s = openStash(p);
    const kitAt = p.stash[0]!.items.findIndex((g) => g.item.item === 'repair-kit');
    const repair = {
      type: 'repair',
      kit: { ...page0, index: kitAt, item: 'repair-kit' },
      armor: { owner: self, slot: 'bodyArmor', item: 'vest' },
    } as const;
    expect(applyStash(s, items, repair)).toBe(true);
    // The vest takes 45 of the kit's 50 points.
    expect(p.gear.bodyArmor!.durability).toBe(50);
    expect(p.stash[0]!.items[kitAt]!.item.left).toBe(5);
    expect(overRepaired(items, before, p)).toBe(false);
    // Full now: nothing to do.
    expect(applyStash(s, items, repair)).toBe(false);
    // Spent: the last 5 points, and the kit is gone.
    p.gear.bodyArmor!.durability = 40;
    expect(applyStash(s, items, repair)).toBe(true);
    expect(p.gear.bodyArmor!.durability).toBe(45);
    expect(countOf(p.stash[0]!, 'repair-kit')).toBe(0);

    // A client that mends armor for free is caught.
    const forged = clone(before);
    forged.gear.bodyArmor!.durability = 50;
    expect(overRepaired(items, before, forged)).toBe(true);
    // And so is one that gives worn armor its max back.
    const worn = clone(before);
    worn.gear.bodyArmor!.max = 40;
    const unworn = clone(worn);
    delete unworn.gear.bodyArmor!.max;
    expect(overRepaired(items, worn, unworn)).toBe(true);
  });
  it("mends armor that isn't worn: on a stash page, or in a bag stored there", () => {
    const p = profile();
    const vest = createItem(items, 'vest');
    vest.durability = 20;
    addItem(items, p.stash[0]!, vest);
    const bag = createItem(items, 'backpack');
    const helmet = createItem(items, 'helmet');
    helmet.durability = 10;
    addItem(items, bag.grid!, helmet);
    addItem(items, p.stash[0]!, bag);
    const before = clone(p);
    const s = openStash(p);
    const at = (item: string) => p.stash[0]!.items.findIndex((g) => g.item.item === item);
    const kit = { ...page0, index: at('repair-kit'), item: 'repair-kit' } as const;
    // The vest on the page takes 30 of the kit's 50 points, at once.
    expect(
      applyStash(s, items, {
        type: 'repair',
        kit,
        armor: { ...page0, index: at('vest'), item: 'vest' },
      }),
    ).toBe(true);
    expect(vest.durability).toBe(50);
    // The helmet in the stored backpack takes the other 20.
    expect(
      applyStash(s, items, {
        type: 'repair',
        kit,
        armor: {
          ...page0,
          inside: { index: at('backpack'), item: 'backpack' },
          index: 0,
          item: 'helmet',
        },
      }),
    ).toBe(true);
    expect(helmet.durability).toBe(30);
    expect(countOf(p.stash[0]!, 'repair-kit')).toBe(0);
    expect(overRepaired(items, before, p)).toBe(false);
  });
});

/** A vendor with levels: level 2 needs 0.2 rep and 1,000 spent, 3 more, 4 more still. */
const leveled = (extra: Record<string, unknown> = {}): VendorDef =>
  loadContent(
    VENDOR_FORMAT,
    {
      formatVersion: 2,
      id: 'smith',
      name: 'Smith',
      levels: [
        { rep: 0.2, spent: 1000 },
        { rep: 0.4, spent: 5000 },
        { rep: 0.6, spent: 20_000 },
      ],
      sells: [{ item: 'bandage' }, { item: 'watch', level: 2 }, { item: 'scope', level: 4 }],
      ...extra,
    },
    'smith.json',
  );

describe('vendor levels', () => {
  it('go up with rep and money spent, each needing both and the levels before', () => {
    const v = leveled();
    expect(vendorLevel(v, { rep: 0, spent: 0 })).toBe(1);
    // Money alone, or rep alone, isn't enough.
    expect(vendorLevel(v, { rep: 0, spent: 1_000_000 })).toBe(1);
    expect(vendorLevel(v, { rep: 1, spent: 999 })).toBe(1);
    expect(vendorLevel(v, { rep: 0.2, spent: 1000 })).toBe(2);
    expect(vendorLevel(v, { rep: 0.45, spent: 6000 })).toBe(3);
    expect(vendorLevel(v, { rep: 5, spent: 1e9 })).toBe(4);
  });

  it('gate offers, and buying counts toward the next level', () => {
    const v = leveled();
    const p = profile();
    expect(buyOffer(p, items, v, 1)).toMatch(/from level 2/);
    expect(p.money).toBe(10_000);
    // A bandage at 100 a time, ten of them in one go.
    expect(buyOffer(p, items, v, 0, 0, 10)).toBeNull();
    expect(p.money).toBe(9000);
    expect(standingOf(p, 'smith')).toEqual({ rep: 0, spent: 1000 });
    expect(countOf(p.stash[0]!, 'bandage')).toBe(10);
    expect(buyOffer(p, items, v, 0, 0, MAX_BUY + 1)).toMatch(/at a time/);
    // Spent enough, but no rep yet: still level 1. A quest's rep takes it to 2.
    expect(buyOffer(p, items, v, 1)).toMatch(/from level 2/);
    const quest = loadContent(
      QUEST_FORMAT,
      {
        formatVersion: 1,
        id: 'q',
        name: 'Q',
        vendor: 'smith',
        description: 'A job.',
        objectives: [{ id: 'w', type: 'handOver', item: 'watch', count: 1 }],
        rewards: { rep: 0.2 },
      },
      'q.json',
    );
    p.quests.q = { status: 'active', progress: { w: 1 } };
    expect(completeQuest(p, items, quest)).toBeNull();
    expect(standingOf(p, 'smith')).toEqual({ rep: 0.2, spent: 1000 });
    expect(buyOffer(p, items, v, 1)).toBeNull();
  });

  it('mark prices up, and a rotation shows the same few to everyone for a while', () => {
    const v = leveled({
      markup: 1.5,
      rotation: { shown: 2, hours: 2 },
      sells: [
        { item: 'bandage' },
        { item: 'watch' },
        { item: 'medkit' },
        { item: 'round', count: 10 },
        { item: 'splint' },
      ],
    });
    expect(buyPrice(items, v.sells[0]!, v)).toBe(150);
    const t = Date.UTC(2026, 10, 6, 12, 30);
    const now = vendorStock(v, t);
    expect(now).toHaveLength(2);
    expect(vendorStock(v, t + 60 * 60_000)).toEqual(now);
    expect(nextRestock(v, t)).toBe(Date.UTC(2026, 10, 6, 14));
    // Over a day, the picks change.
    const seen = new Set<string>();
    for (let h = 0; h < 24; h += 2) seen.add(vendorStock(v, t + h * 3_600_000).join());
    expect(seen.size).toBeGreaterThan(3);
    // What's not in stock now can't be bought.
    const gone = [0, 1, 2, 3, 4].find((i) => !now.includes(i))!;
    const p = profile();
    expect(buyOffer(p, items, v, gone, 0, 1, t)).toMatch(/stock has changed/);
    expect(buyOffer(p, items, v, now[0]!, 0, 1, t)).toBeNull();
  });

  it('refuses levels that need less than the one before', () => {
    const bad = leveled({
      levels: [
        { rep: 0.2, spent: 1000 },
        { rep: 0.1, spent: 5000 },
        { rep: 0.6, spent: 20_000 },
      ],
    });
    expect(() => checkVendors(new Map([['smith', bad]]), items)).toThrow(/needs less/);
  });
});

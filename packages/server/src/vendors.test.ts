import { describe, expect, it } from 'vitest';
import {
  addItem,
  countOf,
  createItem,
  sellPrice,
  stashOwner,
  type EndRaidRequest,
  type Gear,
} from '@mes/shared';
import { loadItems, vendorDef } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();

async function signedIn() {
  const client = new TestClient(testEnv());
  await client.register();
  return client;
}

const page0 = { owner: stashOwner(0), grid: 'loot' } as const;

describe('vendors', () => {
  it('buy into the stash with money, once per version, and not in a raid', async () => {
    const client = await signedIn();
    const medic = vendorDef('medic')!;
    const bandage = medic.sells.findIndex((o) => o.item === 'bandage');
    const me = await client.ok('GET', '/profile');
    const broke = await client.fails('POST', '/vendors/medic/buy', {
      version: me.version,
      offer: bandage,
    });
    expect(broke.message).toMatch(/costs/);
    await client.setMoney(1000);
    const bought = await client.ok('POST', '/vendors/medic/buy', {
      version: me.version,
      offer: bandage,
    });
    expect(countOf(bought.profile.stash[0]!, 'bandage')).toBe(1);
    expect(bought.profile.money).toBe(1000 - items.get('bandage')!.value);
    // A retry with the old version doesn't buy another.
    const again = { version: me.version, offer: bandage };
    expect((await client.fails('POST', '/vendors/medic/buy', again)).error).toBe('stale');
    const nobody = { version: bought.version, offer: 0 };
    expect((await client.fails('POST', '/vendors/nobody/buy', nobody)).error).toBe('not-found');
    await client.ok('POST', '/raids', { raid: 'test-raid' });
    const v = (await client.ok('GET', '/profile')).version;
    const inRaid = { version: v, offer: bandage };
    expect((await client.fails('POST', '/vendors/medic/buy', inRaid)).error).toBe('in-raid');
  });

  it('sell from the gear or the stash for money, and refuse the knife or a bad ref', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const helmet = me.profile.gear.helmet!;
    const sold = await client.ok('POST', '/vendors/sell', {
      version: me.version,
      from: [{ owner: { kind: 'self' }, slot: 'helmet', item: helmet.item }],
    });
    expect(sold.profile.gear.helmet).toBeNull();
    expect(sold.profile.money).toBe(sellPrice(items, helmet));
    const knife = await client.fails('POST', '/vendors/sell', {
      version: sold.version,
      from: [{ owner: { kind: 'self' }, slot: 'knife', item: 'knife' }],
    });
    expect(knife.message).toMatch(/knife/);
    const empty = await client.fails('POST', '/vendors/sell', {
      version: sold.version,
      from: [{ ...page0, index: 0, item: 'gold-watch' }],
    });
    expect(empty.message).toMatch(/moved/);
    const bad = await client.fails('POST', '/vendors/sell', {
      version: sold.version,
      from: [{ owner: { kind: 'self' }, slot: 'hand', item: 'x' }],
    });
    expect(bad.error).toBe('bad-request');
  });

  it('sells several items in one request, or none if one is refused', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const self = { kind: 'self' } as const;
    const helmet = { owner: self, slot: 'helmet', item: me.profile.gear.helmet!.item } as const;
    const armour = {
      owner: self,
      slot: 'bodyArmour',
      item: me.profile.gear.bodyArmour!.item,
    } as const;
    const knife = { owner: self, slot: 'knife', item: 'knife' } as const;
    const refused = await client.fails('POST', '/vendors/sell', {
      version: me.version,
      from: [helmet, armour, knife],
    });
    expect(refused.message).toMatch(/knife/);
    const sold = await client.ok('POST', '/vendors/sell', {
      version: me.version,
      from: [helmet, armour],
    });
    expect(sold.profile.gear.helmet).toBeNull();
    expect(sold.profile.gear.bodyArmour).toBeNull();
    expect(sold.profile.money).toBe(
      sellPrice(items, me.profile.gear.helmet!) + sellPrice(items, me.profile.gear.bodyArmour!),
    );
  });

  it('refuses a stash edit that mends armour without spending a repair kit', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const worn = await client.env.DB.prepare('SELECT data FROM profiles').first<{ data: string }>();
    const p = JSON.parse(worn!.data) as typeof me.profile;
    p.gear.helmet!.durability = 10;
    await client.env.DB.prepare('UPDATE profiles SET data = ?').bind(JSON.stringify(p)).run();
    const mended = structuredClone(p);
    mended.gear.helmet!.durability = 40;
    const res = await client.fails('PUT', '/profile', { version: me.version, profile: mended });
    expect(res.message).toMatch(/repair/);
    // The infinite consumables cheat's free repairs count only on the dev server.
    const cheat = { version: me.version, profile: mended, freeRepairs: true };
    expect((await client.fails('PUT', '/profile', cheat)).message).toMatch(/repair/);
    const dev = new TestClient({ ...client.env, ADMIN: '1' });
    dev.cookie = client.cookie;
    const saved = await dev.ok('PUT', '/profile', cheat);
    expect(saved.profile.gear.helmet!.durability).toBe(40);
  });
});

describe('cash from a raid', () => {
  function withCash(gear: Gear): Gear {
    const g = structuredClone(gear);
    expect(addItem(items, g.backpack!.grid!, createItem(items, 'cash', 300))).toBe(0);
    expect(addItem(items, g.vault!, createItem(items, 'cash', 1000))).toBe(0);
    return g;
  }
  const end = (gear: Gear, how: EndRaidRequest['how']): EndRaidRequest => ({
    how,
    gear,
    seconds: 300,
    kills: 0,
  });

  it('goes into the money: all of it after extracting, the vault’s after dying', async () => {
    for (const [how, money] of [
      ['extracted', 1300],
      ['killed', 1000],
    ] as const) {
      const client = await signedIn();
      const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
      const after = await client.ok(
        'POST',
        `/raids/${raid!.id}/end`,
        end(withCash(profile.gear), how),
      );
      expect(after.profile.money).toBe(money);
      expect(countOf(after.profile.gear.vault!, 'cash')).toBe(0);
      expect(countOf(after.profile.gear.backpack?.grid ?? after.profile.gear.pockets, 'cash')).toBe(
        0,
      );
    }
  });
});

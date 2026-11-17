import { describe, expect, it } from 'vitest';
import { addItem, countItems, createItem, MODULE_LEVELS, POWER_GRID } from '@mes/shared';
import { loadHangar, loadItems } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();

async function withBandages(n: number) {
  const client = new TestClient(testEnv());
  await client.register();
  await client.editProfile((p) => {
    for (let i = 0; i < n; i++) addItem(items, p.stash[0]!, createItem(items, 'bandage'));
  });
  return client;
}

const bandages = (p: Parameters<typeof countItems>[1]) => countItems(items, p).get('bandage') ?? 0;

describe('the Hangar', () => {
  it('has every module, each with the Power grid able to power its levels', () => {
    const modules = loadHangar();
    expect(modules.get(POWER_GRID)?.levels.length).toBe(MODULE_LEVELS);
    expect(modules.size).toBe(3);
  });

  it('upgrades a module a level for its cost, once per version, within the Power grid', async () => {
    const client = await withBandages(10);
    let me = await client.ok('GET', '/profile');
    expect(me.profile.hangar).toEqual({});
    const before = bandages(me.profile);
    const noPower = await client.fails('POST', '/hangar/secure-locker/upgrade', {
      version: me.version,
    });
    expect(noPower.message).toMatch(/Power grid at level 1/);

    me = await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
    expect(me.profile.hangar).toEqual({ [POWER_GRID]: 1 });
    expect(bandages(me.profile)).toBe(before - 1);
    const retry = await client.fails('POST', `/hangar/${POWER_GRID}/upgrade`, {
      version: me.version - 1,
    });
    expect(retry.error).toBe('stale');

    me = await client.ok('POST', '/hangar/secure-locker/upgrade', { version: me.version });
    expect(me.profile.hangar['secure-locker']).toBe(1);
    const capped = await client.fails('POST', '/hangar/secure-locker/upgrade', {
      version: me.version,
    });
    expect(capped.message).toMatch(/level 2/);

    for (let l = 2; l <= MODULE_LEVELS; l++)
      me = await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
    const top = await client.fails('POST', `/hangar/${POWER_GRID}/upgrade`, {
      version: me.version,
    });
    expect(top.message).toMatch(/top level/);
    expect(bandages(me.profile)).toBe(before - 1 - MODULE_LEVELS);
  });

  it('grows the vault with the Secure locker and adds category pages with Stash (H4)', async () => {
    const client = await withBandages(10);
    await client.editProfile((p) => (p.hangar[POWER_GRID] = MODULE_LEVELS));
    let me = await client.ok('GET', '/profile');
    expect(me.profile.gear.vault).toMatchObject({ w: 2, h: 1 });
    for (let l = 1; l <= MODULE_LEVELS; l++) {
      me = await client.ok('POST', '/hangar/secure-locker/upgrade', { version: me.version });
      me = await client.ok('POST', '/hangar/stash/upgrade', { version: me.version });
    }
    expect(me.profile.gear.vault).toMatchObject({ w: 3, h: 3 });
    expect(me.profile.stash.map((g) => g.only ?? null)).toEqual([null, 'guns', 'ammo', 'meds']);
    // PUT can't drop a category page, nor shrink the vault back.
    const dropped = await client.fails('PUT', '/profile', {
      version: me.version,
      profile: { ...me.profile, stash: me.profile.stash.slice(0, 3) },
    });
    expect(dropped.error).toBe('invalid');
    const small = structuredClone(me.profile);
    small.gear.vault!.h = 2;
    expect(
      (await client.fails('PUT', '/profile', { version: me.version, profile: small })).message,
    ).toMatch(/vault: must be 3×3/);
    // A page bought now goes before them.
    await client.setMoney(1_000_000);
    me = await client.ok('POST', '/stash/pages', { version: me.version });
    expect(me.profile.stash.map((g) => g.only ?? null)).toEqual([
      null,
      null,
      'guns',
      'ammo',
      'meds',
    ]);
  });

  it('refuses an upgrade without the items, and leaves the stash alone', async () => {
    const client = await withBandages(0);
    await client.editProfile((p) => {
      for (const page of p.stash) page.items = page.items.filter((g) => g.item.item !== 'bandage');
      for (const page of p.stash)
        for (const g of page.items)
          if (g.item.grid)
            g.item.grid.items = g.item.grid.items.filter((x) => x.item.item !== 'bandage');
    });
    const me = await client.ok('GET', '/profile');
    const bad = await client.fails('POST', `/hangar/${POWER_GRID}/upgrade`, {
      version: me.version,
    });
    expect(bad.message).toMatch(/aren't enough "bandage"/);
    expect((await client.ok('GET', '/profile')).version).toBe(me.version);
  });

  it('refuses unknown modules, upgrades in a raid, and PUT changing it', async () => {
    const client = await withBandages(5);
    let me = await client.ok('GET', '/profile');
    expect(
      (await client.fails('POST', '/hangar/nothing/upgrade', { version: me.version })).error,
    ).toBe('not-found');
    const put = await client.fails('PUT', '/profile', {
      version: me.version,
      profile: { ...me.profile, hangar: { [POWER_GRID]: 3 } },
    });
    expect(put.message).toMatch(/Hangar/);
    await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
    await client.ok('POST', '/raids', { raid: 'northpoint' });
    me = await client.ok('GET', '/profile');
    const inRaid = await client.fails('POST', `/hangar/${POWER_GRID}/upgrade`, {
      version: me.version,
    });
    expect(inRaid.error).toBe('in-raid');
  });
});

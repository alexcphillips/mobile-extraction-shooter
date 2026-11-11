import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addItem,
  checkRecipes,
  countItems,
  createItem,
  MODULE_LEVELS,
  POWER_GRID,
  type RecipeDef,
} from '@mes/shared';
import { loadHangar, loadItems, loadRecipes, recipeDef } from './content';
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
    expect(modules.size).toBe(7);
  });

  it('upgrades a module a level for its cost, once per version, within the Power grid', async () => {
    const client = await withBandages(10);
    let me = await client.ok('GET', '/profile');
    expect(me.profile.hangar).toEqual({});
    const before = bandages(me.profile);
    const noPower = await client.fails('POST', '/hangar/trauma-bay/upgrade', {
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

    me = await client.ok('POST', '/hangar/trauma-bay/upgrade', { version: me.version });
    expect(me.profile.hangar['trauma-bay']).toBe(1);
    const capped = await client.fails('POST', '/hangar/trauma-bay/upgrade', {
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

  it('grows the vault with the Secure locker and adds category pages with Quarters (H4)', async () => {
    const client = await withBandages(10);
    await client.editProfile((p) => (p.hangar[POWER_GRID] = MODULE_LEVELS));
    let me = await client.ok('GET', '/profile');
    expect(me.profile.gear.vault).toMatchObject({ w: 2, h: 1 });
    for (let l = 1; l <= MODULE_LEVELS; l++) {
      me = await client.ok('POST', '/hangar/secure-locker/upgrade', { version: me.version });
      me = await client.ok('POST', '/hangar/quarters/upgrade', { version: me.version });
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

describe('Hangar crafting', () => {
  const MIN = 60_000;
  let clock = Date.now();
  beforeEach(() => {
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  /** A client with the Power grid and the Trauma bay at level 1, and the first aid kit's inputs. */
  async function ready() {
    const client = await withBandages(6);
    await client.editProfile((p) => {
      addItem(items, p.stash[0]!, createItem(items, 'duct-tape'));
    });
    let me = await client.ok('GET', '/profile');
    me = await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
    me = await client.ok('POST', '/hangar/trauma-bay/upgrade', { version: me.version });
    return { client, me };
  }

  it('has recipes checked against the modules and items', () => {
    const recipes = loadRecipes();
    expect(recipes.size).toBeGreaterThan(0);
    for (const r of recipes.values()) expect(loadHangar().has(r.module)).toBe(true);
    const base = recipeDef('trauma-first-aid-kit')!;
    const check = (r: Partial<RecipeDef>) => () =>
      checkRecipes(new Map([[base.id, { ...base, ...r }]]), loadHangar(), items);
    expect(check({ output: { item: 'cash' } })).toThrow(/makes money/);
    expect(check({ output: { item: 'test-notes-item' } })).toThrow(/quest item/);
    expect(check({ output: { item: 'bandage', count: 1000 } })).toThrow(/than a stack/);
    expect(check({ module: 'nothing' })).toThrow(/no Hangar module/);
    expect(check({ level: 4 })).toThrow(/no level 4/);
    const vendors = new Map([['fence', {}]]);
    const rolled = (r: Partial<RecipeDef>) => () =>
      checkRecipes(new Map([[base.id, { ...base, ...r }]]), loadHangar(), items, vendors);
    const results = [{ weight: 1, vendor: 'fence', rep: 0.1 }];
    expect(rolled({ results })).toThrow(/not both/);
    expect(rolled({ output: undefined })).toThrow(/not both/);
    expect(rolled({ output: undefined, results })).not.toThrow();
    expect(
      rolled({ output: undefined, results: [{ weight: 1, vendor: 'nobody', rep: 0.1 }] }),
    ).toThrow(/no vendor "nobody"/);
    expect(rolled({ output: undefined, results: [{ weight: 1, item: 'cash' }] })).toThrow(
      /makes money/,
    );
  });

  it('crafts on the server clock, and keeps the output until collected', async () => {
    const { client, me: start } = await ready();
    let me = start;
    const recipe = recipeDef('trauma-first-aid-kit')!;
    const kits = (p: typeof me.profile) => countItems(items, p).get('field-first-aid-kit') ?? 0;
    const hadKits = kits(me.profile);
    const hadBandages = bandages(me.profile);

    me = await client.ok('POST', '/hangar/trauma-bay/craft', {
      version: me.version,
      recipe: recipe.id,
    });
    const craft = me.profile.crafts['trauma-bay']!;
    expect(craft).toEqual({
      recipe: recipe.id,
      item: 'field-first-aid-kit',
      count: 1,
      done: clock + recipe.minutes * MIN,
    });
    expect(me.now).toBe(clock);
    expect(bandages(me.profile)).toBe(hadBandages - 2);

    const busy = await client.fails('POST', '/hangar/trauma-bay/craft', {
      version: me.version,
      recipe: recipe.id,
    });
    expect(busy.message).toMatch(/already making/);
    const early = await client.fails('POST', '/hangar/trauma-bay/collect', { version: me.version });
    expect(early.message).toMatch(/hasn't finished/);

    // Long after, as if the app was closed: it waits.
    clock += recipe.minutes * MIN * 10;
    me = await client.ok('POST', '/hangar/trauma-bay/collect', { version: me.version });
    expect(me.profile.crafts).toEqual({});
    expect(kits(me.profile)).toBe(hadKits + 1);
    const again = await client.fails('POST', '/hangar/trauma-bay/collect', { version: me.version });
    expect(again.message).toMatch(/nothing to collect/);
  });

  it('refuses a recipe of another module, above its level, or without the inputs', async () => {
    const { client, me } = await ready();
    const other = await client.fails('POST', '/hangar/trauma-bay/craft', {
      version: me.version,
      recipe: 'armour-repair-kit',
    });
    expect(other.message).toMatch(/doesn't make that/);
    const level = await client.fails('POST', '/hangar/trauma-bay/craft', {
      version: me.version,
      recipe: 'trauma-surgery-kit',
    });
    expect(level.message).toMatch(/level 2/);
    const unknown = await client.fails('POST', '/hangar/trauma-bay/craft', {
      version: me.version,
      recipe: 'nothing',
    });
    expect(unknown.message).toMatch(/no such recipe/);
    await client.editProfile((p) => {
      for (const page of p.stash)
        page.items = page.items.filter((g) => g.item.item !== 'duct-tape');
    });
    const now = await client.ok('GET', '/profile');
    const short = await client.fails('POST', '/hangar/trauma-bay/craft', {
      version: now.version,
      recipe: 'trauma-first-aid-kit',
    });
    expect(short.message).toMatch(/aren't enough "duct-tape"/);
  });

  it('keeps a finished craft in the module while the stash is full, and refuses PUT changing it', async () => {
    const { client, me: start } = await ready();
    let me = await client.ok('POST', '/hangar/trauma-bay/craft', {
      version: start.version,
      recipe: 'trauma-first-aid-kit',
    });
    const put = await client.fails('PUT', '/profile', {
      version: me.version,
      profile: { ...me.profile, crafts: {} },
    });
    expect(put.message).toMatch(/Hangar/);
    clock += 9 * 60 * MIN;
    await client.editProfile((p) => {
      for (const page of p.stash)
        while (addItem(items, page, createItem(items, 'bandage', 1)) === 0);
    });
    me = await client.ok('GET', '/profile');
    const full = await client.fails('POST', '/hangar/trauma-bay/collect', { version: me.version });
    expect(full.message).toMatch(/no room/);
    expect((await client.ok('GET', '/profile')).profile.crafts['trauma-bay']).toBeDefined();
  });
});

describe('the Intel desk (H5)', () => {
  const MIN = 60_000;
  let clock = Date.now();
  beforeEach(() => {
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  /** A client with the Power grid and the Intel desk at `level`, and two flash drives. */
  async function desk(level: number) {
    const client = await withBandages(level * 2);
    await client.editProfile((p) => {
      for (let i = 0; i < 2; i++) addItem(items, p.stash[0]!, createItem(items, 'flash-drive'));
    });
    let me = await client.ok('GET', '/profile');
    for (let i = 0; i < level; i++) {
      me = await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
      me = await client.ok('POST', '/hangar/intel-desk/upgrade', { version: me.version });
    }
    return { client, me };
  }

  it('rolls a decryption when it starts, and gives an item or vendor rep when collected', async () => {
    const { client, me: start } = await desk(1);
    const recipe = recipeDef('intel-flash-drive')!;
    const drives = (p: typeof start.profile) => countItems(items, p).get('flash-drive') ?? 0;

    // The first result (a key).
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let me = await client.ok('POST', '/hangar/intel-desk/craft', {
      version: start.version,
      recipe: recipe.id,
    });
    expect(drives(me.profile)).toBe(1);
    expect(me.profile.crafts['intel-desk']).toEqual({
      recipe: recipe.id,
      item: 'kiln-key',
      count: 1,
      done: clock + recipe.minutes * MIN,
    });
    clock += recipe.minutes * MIN;
    me = await client.ok('POST', '/hangar/intel-desk/collect', { version: me.version });
    expect(countItems(items, me.profile).get('kiln-key')).toBe(1);

    // The last result (rep with the Fence).
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    me = await client.ok('POST', '/hangar/intel-desk/craft', {
      version: me.version,
      recipe: recipe.id,
    });
    expect(me.profile.crafts['intel-desk']).toMatchObject({ vendor: 'fence', rep: 0.05 });
    const put = await client.fails('PUT', '/profile', {
      version: me.version,
      profile: { ...me.profile, crafts: {} },
    });
    expect(put.message).toMatch(/Hangar/);
    clock += recipe.minutes * MIN;
    const rep = me.profile.vendors['fence']?.rep ?? 0;
    me = await client.ok('POST', '/hangar/intel-desk/collect', { version: me.version });
    expect(me.profile.vendors['fence']!.rep).toBeCloseTo(rep + 0.05);
    expect(me.profile.crafts).toEqual({});
  });

  it('needs level 2 for hard drives, and decrypts in half the time at level 3', async () => {
    const low = await desk(1);
    await low.client.editProfile((p) => {
      addItem(items, p.stash[0]!, createItem(items, 'hard-drive'));
    });
    const me1 = await low.client.ok('GET', '/profile');
    const locked = await low.client.fails('POST', '/hangar/intel-desk/craft', {
      version: me1.version,
      recipe: 'intel-hard-drive',
    });
    expect(locked.message).toMatch(/level 2/);

    const { client, me } = await desk(3);
    const recipe = recipeDef('intel-flash-drive')!;
    const after = await client.ok('POST', '/hangar/intel-desk/craft', {
      version: me.version,
      recipe: recipe.id,
    });
    expect(after.profile.crafts['intel-desk']!.done).toBe(clock + (recipe.minutes * MIN) / 2);
  });
});

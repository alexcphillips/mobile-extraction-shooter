import { describe, expect, it } from 'vitest';
import { addItem, createItem, type EndRaidRequest, type Gear } from '@mes/shared';
import { loadItems } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();

async function signedIn(admin = false) {
  const env = { ...testEnv(), ...(admin ? { ADMIN: '1' } : {}) };
  const client = new TestClient(env);
  await client.register();
  return client;
}

/** The raid's gear at the end: what went in, plus a gold watch in the backpack and one in the vault. */
function looted(gear: Gear): Gear {
  const g = structuredClone(gear);
  addItem(items, g.backpack!.grid!, createItem(items, 'gold-watch'));
  addItem(items, g.vault!, createItem(items, 'gold-watch'));
  return g;
}

function end(gear: Gear, how: EndRaidRequest['how'] = 'extracted'): EndRaidRequest {
  return { how, gear, seconds: 300, kills: 2, detail: 'Pond dock' };
}

describe('raids', () => {
  it('opens a raid and locks the profile until it ends', async () => {
    const client = await signedIn();
    const started = await client.ok('POST', '/raids', { raid: 'test-raid' });
    expect(started.raid?.raid).toBe('test-raid');
    expect(started.version).toBe(2);
    const put = await client.fails('PUT', '/profile', {
      version: started.version,
      profile: started.profile,
    });
    expect(put.error).toBe('in-raid');
  });

  it('keeps everything after extracting', async () => {
    const client = await signedIn();
    const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const after = await client.ok('POST', `/raids/${raid!.id}/end`, end(looted(profile.gear)));
    expect(after.raid).toBeNull();
    expect(after.profile.gear.primary1?.item).toBe('assault-rifle');
    expect(after.profile.gear.backpack?.grid?.items.some((g) => g.item.item === 'gold-watch')).toBe(
      true,
    );
    expect(after.profile.gear.vault?.items.map((g) => g.item.item)).toEqual(['gold-watch']);
  });

  it('keeps only the knife and the vault after dying or going missing', async () => {
    for (const how of ['killed', 'mia'] as const) {
      const client = await signedIn();
      const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
      const after = await client.ok(
        'POST',
        `/raids/${raid!.id}/end`,
        end(looted(profile.gear), how),
      );
      const gear = after.profile.gear;
      expect(gear.primary1).toBeNull();
      expect(gear.backpack).toBeNull();
      expect(gear.pockets.items).toEqual([]);
      expect(gear.knife?.item).toBe('knife');
      expect(gear.vault?.items.map((g) => g.item.item)).toEqual(['gold-watch']);
    }
  });

  it('keeps everything after a death with the keep-gear cheat, on the dev server only', async () => {
    for (const admin of [true, false]) {
      const client = await signedIn(admin);
      const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
      const after = await client.ok('POST', `/raids/${raid!.id}/end`, {
        ...end(looted(profile.gear), 'killed'),
        keepGear: true,
      });
      expect(after.profile.gear.primary1 === null).toBe(!admin);
    }
  });

  it('takes the same result twice, but not a different one', async () => {
    const client = await signedIn();
    const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const result = end(looted(profile.gear));
    const first = await client.ok('POST', `/raids/${raid!.id}/end`, result);
    const again = await client.ok('POST', `/raids/${raid!.id}/end`, result);
    expect(again.version).toBe(first.version);
    const other = await client.fails('POST', `/raids/${raid!.id}/end`, {
      ...result,
      how: 'killed',
    });
    expect(other.error).toBe('raid-over');
  });

  it('counts a raid that never reported as missing when the next one starts', async () => {
    const client = await signedIn();
    const first = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const second = await client.ok('POST', '/raids', { raid: 'test-raid' });
    expect(second.raid?.id).not.toBe(first.raid?.id);
    expect(second.profile.gear.primary1).toBeNull();
    expect(second.profile.gear.knife?.item).toBe('knife');
    // The first raid's result turning up late (say, from another phone) is refused.
    const late = await client.fails(
      'POST',
      `/raids/${first.raid!.id}/end`,
      end(first.profile.gear),
    );
    expect(late.error).toBe('raid-over');
  });

  it('counts a raid that never reported as missing when asked, unlocking the profile', async () => {
    const client = await signedIn();
    const { raid } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const after = await client.ok('POST', `/raids/${raid!.id}/abandon`);
    expect(after.raid).toBeNull();
    expect(after.profile.gear.primary1).toBeNull();
    expect(after.profile.gear.knife?.item).toBe('knife');
    // Asking again changes nothing; the stash can be edited; the late result is refused.
    expect((await client.ok('POST', `/raids/${raid!.id}/abandon`)).version).toBe(after.version);
    await client.ok('PUT', '/profile', { version: after.version, profile: after.profile });
    const late = await client.fails('POST', `/raids/${raid!.id}/end`, end(after.profile.gear));
    expect(late.error).toBe('raid-over');
    expect((await client.fails('POST', '/raids/nope/abandon')).error).toBe('not-found');
  });

  it('applies sanity limits to results', async () => {
    const client = await signedIn();
    const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const path = `/raids/${raid!.id}/end`;

    const forged = looted(profile.gear);
    forged.vault!.items[0]!.item.item = 'no-such-item';
    expect((await client.fails('POST', path, end(forged))).message).toMatch(/no item "no-such-item"/);

    const stacked = looted(profile.gear);
    stacked.pockets.items[0]!.item.count = 1e9;
    expect((await client.fails('POST', path, end(stacked))).message).toMatch(/more than a stack/);

    expect((await client.fails('POST', path, { ...end(profile.gear), seconds: 9e9 })).error).toBe(
      'invalid',
    );
    expect((await client.fails('POST', path, { ...end(profile.gear), gear: 'lots' })).status).toBe(
      400,
    );
    expect((await client.fails('POST', path, { ...end(profile.gear), how: 'won' })).status).toBe(
      400,
    );
    // None of that ended it.
    expect((await client.ok('GET', '/profile')).raid?.id).toBe(raid!.id);
  });

  it("refuses unknown raids and other players' raids", async () => {
    const client = await signedIn();
    expect((await client.fails('POST', '/raids', { raid: 'moon' })).error).toBe('invalid');
    const { raid, profile } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const other = new TestClient(client.env);
    await other.register('bob');
    expect((await other.fails('POST', `/raids/${raid!.id}/end`, end(profile.gear))).error).toBe(
      'not-found',
    );
  });
});

describe('PUT /profile', () => {
  it('saves things moved around, and needs the current version', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const { profile } = me;
    // A bandage from the rig into the vault.
    const rig = profile.gear.rig!.grid!;
    const i = rig.items.findIndex((g) => g.item.item === 'bandage');
    const [bandage] = rig.items.splice(i, 1);
    profile.gear.vault!.items.push({ ...bandage!, x: 0, y: 0 });

    const saved = await client.ok('PUT', '/profile', { version: me.version, profile });
    expect(saved.version).toBe(me.version + 1);
    expect(saved.profile.gear.vault?.items[0]?.item.item).toBe('bandage');
    const stale = await client.fails('PUT', '/profile', { version: me.version, profile });
    expect(stale.error).toBe('stale');
  });

  it('refuses items from nothing and money changing', async () => {
    const client = await signedIn();
    const { version, profile } = await client.ok('GET', '/profile');
    addItem(items, profile.stash[0]!, createItem(items, 'gold-watch'));
    expect((await client.fails('PUT', '/profile', { version, profile })).message).toMatch(
      /more "gold-watch"/,
    );
    profile.stash[0]!.items = [];
    profile.money += 1000;
    expect((await client.fails('PUT', '/profile', { version, profile })).message).toMatch(/money/);
    profile.money -= 1000;
    profile.stash.push(structuredClone(profile.stash[0]!));
    expect((await client.fails('PUT', '/profile', { version, profile })).message).toMatch(
      /only added by buying/,
    );
  });
});

describe('POST /stash/pages', () => {
  it('buys a page with money, once per version, and not in a raid', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const broke = await client.fails('POST', '/stash/pages', { version: me.version });
    expect(broke.message).toMatch(/costs 100000/);
    await client.setMoney(120_000);
    const bought = await client.ok('POST', '/stash/pages', { version: me.version });
    expect(bought.profile.stash).toHaveLength(2);
    expect(bought.profile.stash[1]!.items).toEqual([]);
    expect(bought.profile.money).toBe(20_000);
    // A retry with the old version doesn't buy another.
    expect((await client.fails('POST', '/stash/pages', { version: me.version })).error).toBe(
      'stale',
    );
    const { raid } = await client.ok('POST', '/raids', { raid: 'test-raid' });
    const v = (await client.ok('GET', '/profile')).version;
    expect((await client.fails('POST', '/stash/pages', { version: v })).error).toBe('in-raid');
    expect(raid).not.toBeNull();
  });
});

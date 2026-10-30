import { describe, expect, it } from 'vitest';
import { countOf, itemDef, stackSize } from '@mes/shared';
import { MAX_GIVE_STACKS } from './admin';
import { loadItems } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();

async function signedIn(admin: boolean) {
  const client = new TestClient({ ...testEnv(), ...(admin ? { ADMIN: '1' } : {}) });
  await client.register();
  return client;
}

describe('admin', () => {
  it('is not there without ADMIN', async () => {
    const client = await signedIn(false);
    const me = await client.ok('GET', '/profile');
    const give = { version: me.version, item: 'bandage', count: 1 };
    expect((await client.fails('POST', '/admin/give', give)).error).toBe('not-found');
    // Not even a hint for someone signed out.
    const out = new TestClient(testEnv());
    expect((await out.fails('POST', '/admin/give', give)).error).toBe('not-found');
  });

  it('gives items into the stash in stacks, once per version, and not in a raid', async () => {
    const client = await signedIn(true);
    const me = await client.ok('GET', '/profile');
    const before = countOf(me.profile.stash[0]!, 'ammo-9mm');
    const stack = stackSize(itemDef(items, 'ammo-9mm'));
    const given = await client.ok('POST', '/admin/give', {
      version: me.version,
      item: 'ammo-9mm',
      count: stack + 1,
    });
    expect(countOf(given.profile.stash[0]!, 'ammo-9mm')).toBe(before + stack + 1);
    expect(given.profile.money).toBe(me.profile.money);
    const again = { version: me.version, item: 'ammo-9mm', count: 1 };
    expect((await client.fails('POST', '/admin/give', again)).error).toBe('stale');
    const v = given.version;
    expect(
      (await client.fails('POST', '/admin/give', { version: v, item: 'nope', count: 1 })).error,
    ).toBe('not-found');
    const many = { version: v, item: 'pistol', count: MAX_GIVE_STACKS + 1 };
    expect((await client.fails('POST', '/admin/give', many)).error).toBe('invalid');
    await client.ok('POST', '/raids', { raid: 'test-raid' });
    const inRaid = {
      version: (await client.ok('GET', '/profile')).version,
      item: 'bandage',
      count: 1,
    };
    expect((await client.fails('POST', '/admin/give', inRaid)).error).toBe('in-raid');
  });
});

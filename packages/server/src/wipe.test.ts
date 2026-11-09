import { describe, expect, it } from 'vitest';
import type { Profile } from '@mes/shared';
import type { Env } from './env';
import { TestClient } from './test/client';
import { testEnv } from './test/d1';
import { wipeSql, wipeTargetsSql, wipedProfile, type WipeTarget } from './wipe';

/** Two players with progress: money, an extra stash page and a finished quest. */
async function players() {
  const env = testEnv();
  const ana = new TestClient(env);
  const bob = new TestClient(env);
  await ana.register('ana');
  await bob.register('bob');
  const { results } = await env.DB.prepare('SELECT account_id, data FROM profiles').all<{
    account_id: string;
    data: string;
  }>();
  for (const row of results) {
    const p = JSON.parse(row.data) as Profile;
    p.money = 5000;
    p.stash.push(structuredClone(p.stash[0]!));
    p.quests['some-quest'] = { status: 'done' };
    await env.DB.prepare('UPDATE profiles SET data = ? WHERE account_id = ?')
      .bind(JSON.stringify(p), row.account_id)
      .run();
  }
  return { env, ana, bob };
}

async function wipe(env: Env, target: WipeTarget) {
  await env.DB.batch(wipeSql(target, Date.now()).map((sql) => env.DB.prepare(sql)));
}

describe('wiping accounts', () => {
  it('puts a named account back to a new profile, whatever the case, and no other', async () => {
    const { env, ana, bob } = await players();
    const before = await ana.ok('GET', '/profile');
    await wipe(env, ['ANA']);
    const after = await ana.ok('GET', '/profile');
    expect(after.profile).toEqual(wipedProfile());
    expect(after.version).toBe(before.version + 1);
    const other = await bob.ok('GET', '/profile');
    expect(other.profile.money).toBe(5000);
    expect(other.version).toBe(before.version);
  });

  it('wipes everyone with all', async () => {
    const { env, ana, bob } = await players();
    await wipe(env, 'all');
    expect((await ana.ok('GET', '/profile')).profile).toEqual(wipedProfile());
    expect((await bob.ok('GET', '/profile')).profile).toEqual(wipedProfile());
  });

  it('keeps the login and the session', async () => {
    const { env, ana } = await players();
    await wipe(env, ['ana']);
    await ana.ok('GET', '/profile');
    await ana.request('POST', '/logout');
    await ana.ok('POST', '/login', { username: 'ana', password: 'hunter22' });
  });

  it('closes an open raid, so its result puts nothing back', async () => {
    const { env, ana } = await players();
    const { raid, profile } = await ana.ok('POST', '/raids', { raid: 'northpoint' });
    await wipe(env, ['ana']);
    expect((await ana.ok('GET', '/profile')).raid).toBeNull();
    const end = { how: 'extracted', gear: profile.gear, seconds: 300, kills: 2, detail: 'Dock' };
    expect((await ana.fails('POST', `/raids/${raid!.id}/end`, end)).error).toBe('raid-over');
    expect((await ana.ok('GET', '/profile')).profile).toEqual(wipedProfile());
  });

  it('refuses a save from a device holding the old profile', async () => {
    const { env, ana } = await players();
    const old = await ana.ok('GET', '/profile');
    await wipe(env, ['ana']);
    const put = await ana.fails('PUT', '/profile', { version: old.version, profile: old.profile });
    expect(put.error).toBe('stale');
  });

  it("calls off a just-started party raid for the target's party only", async () => {
    const { env } = await players();
    const { results } = await env.DB.prepare(
      'SELECT id, username FROM accounts ORDER BY username',
    ).all<{ id: string; username: string }>();
    for (const { id, username } of results) {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO parties (id, code, leader, raid, created_at, started_at, session, host)
           VALUES (?, ?, ?, 'northpoint', 1, 1, 's', ?)`,
        ).bind(username, username, id, id),
        env.DB.prepare(
          'INSERT INTO party_members (account_id, party_id, joined_at) VALUES (?, ?, 1)',
        ).bind(id, username),
      ]);
    }
    await wipe(env, ['ana']);
    const parties = await env.DB.prepare('SELECT id, started_at FROM parties ORDER BY id').all();
    expect(parties.results).toEqual([
      { id: 'ana', started_at: null },
      { id: 'bob', started_at: 1 },
    ]);
  });

  it('reads back what a target has, and survives a quote in a name', async () => {
    const { env } = await players();
    const row = await env.DB.prepare(wipeTargetsSql(['ana'])).first();
    expect(row).toMatchObject({
      username: 'ana',
      money: 5000,
      stash_pages: 2,
      quests: 1,
      open_raids: 0,
    });
    await wipe(env, ["x' OR '1'='1"]);
    expect(await env.DB.prepare(wipeTargetsSql(['ana'])).first()).toMatchObject({ money: 5000 });
  });
});

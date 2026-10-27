import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@mes/shared';
import { AUTH, hashPassword, verifyPassword } from './auth';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

describe('passwords', () => {
  it('verifies the right password and stores its own iteration count', async () => {
    const stored = await hashPassword('hunter22', 1000);
    expect(stored).toMatch(/^pbkdf2-sha256\$1000\$/);
    expect(await verifyPassword('hunter22', stored)).toBe(true);
    expect(await verifyPassword('hunter23', stored)).toBe(false);
    expect(await verifyPassword('hunter22', 'md5$abc')).toBe(false);
  });
});

describe('register', () => {
  it('makes an account with the new-player kit and signs in', async () => {
    const env = testEnv();
    const client = new TestClient(env);
    const res = await client.request('POST', '/register', {
      username: 'Ana',
      password: 'hunter22',
    });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).not.toMatch(/Secure/);

    const me = await client.ok('GET', '/profile');
    expect(me.username).toBe('Ana');
    expect(me.version).toBe(1);
    expect(me.raid).toBeNull();
    expect(me.profile.gear.knife?.item).toBe('knife');
    expect(me.profile.gear.primary1?.item).toBe('assault-rifle');
  });

  it('sets a Secure cookie over HTTPS', async () => {
    const client = new TestClient(testEnv(), 'https://example.com');
    const res = await client.request('POST', '/register', {
      username: 'ana',
      password: 'hunter22',
    });
    expect(res.headers.get('set-cookie')).toMatch(/Secure/);
  });

  it('refuses a taken name (ignoring case), bad names and short passwords', async () => {
    const env = testEnv();
    await new TestClient(env).register('ana');
    const other = new TestClient(env);
    expect(
      (await other.fails('POST', '/register', { username: 'ANA', password: 'hunter22' })).error,
    ).toBe('username-taken');
    expect(
      (await other.fails('POST', '/register', { username: 'a b', password: 'hunter22' })).status,
    ).toBe(400);
    expect(
      (await other.fails('POST', '/register', { username: 'bob', password: 'short' })).status,
    ).toBe(400);
  });
});

describe('login and sessions', () => {
  it('signs in with the right password only, and logout ends the session', async () => {
    const env = testEnv();
    await new TestClient(env).register('ana', 'hunter22');
    const client = new TestClient(env);
    expect((await client.fails('GET', '/profile')).error).toBe('signed-out');
    expect(
      (await client.fails('POST', '/login', { username: 'ana', password: 'nope-nope' })).error,
    ).toBe('wrong-login');
    expect(
      (await client.fails('POST', '/login', { username: 'bob', password: 'hunter22' })).error,
    ).toBe('wrong-login');
    expect(
      (await client.ok('POST', '/login', { username: 'ANA', password: 'hunter22' })).username,
    ).toBe('ana');
    expect((await client.ok('GET', '/profile')).username).toBe('ana');

    const stolen = client.cookie;
    expect((await client.request('POST', '/logout')).status).toBe(204);
    client.cookie = stolen;
    expect((await client.fails('GET', '/profile')).error).toBe('signed-out');
  });

  it('locks the account after too many wrong passwords', async () => {
    const env = testEnv();
    await new TestClient(env).register('ana', 'hunter22');
    const client = new TestClient(env);
    for (let i = 1; i < AUTH.maxFailures; i++) {
      expect(
        (await client.fails('POST', '/login', { username: 'ana', password: 'wrong-pass' })).error,
      ).toBe('wrong-login');
    }
    expect(
      (await client.fails('POST', '/login', { username: 'ana', password: 'wrong-pass' })).error,
    ).toBe('locked');
    expect(
      (await client.fails('POST', '/login', { username: 'ana', password: 'hunter22' })).error,
    ).toBe('locked');
  });

  it('refuses a session past its expiry', async () => {
    const env = testEnv();
    const client = new TestClient(env);
    await client.register();
    await env.DB.prepare('UPDATE sessions SET expires_at = 0').run();
    expect((await client.fails('GET', '/profile')).error).toBe('signed-out');
  });
});

describe('settings', () => {
  it('keeps the newest settings from any device', async () => {
    const env = testEnv();
    const phone = new TestClient(env);
    await phone.register();
    expect((await phone.ok('GET', '/profile')).settings).toBeNull();

    const s = { ...defaultSettings(), invertY: true };
    expect((await phone.request('PUT', '/settings', { settings: s, at: 2000 })).status).toBe(204);
    // An older change, from a device that was offline, doesn't undo it.
    const old = { ...defaultSettings(), lookSensitivity: 2 };
    await phone.request('PUT', '/settings', { settings: old, at: 1000 });
    const saved = (await phone.ok('GET', '/profile')).settings;
    expect(saved?.at).toBe(2000);
    expect(saved?.settings.invertY).toBe(true);
    expect(saved?.settings.lookSensitivity).toBe(1);
  });

  it('falls back to defaults for bad fields and needs a session', async () => {
    const env = testEnv();
    const client = new TestClient(env);
    expect((await client.fails('PUT', '/settings', { settings: {}, at: 1 })).error).toBe(
      'signed-out',
    );
    await client.register();
    await client.request('PUT', '/settings', {
      settings: { formatVersion: 1, aim: 'sideways', invertY: true },
      at: 5,
    });
    const saved = (await client.ok('GET', '/profile')).settings!.settings;
    expect(saved.aim).toBe('hold');
    expect(saved.invertY).toBe(true);
  });
});

import type { ApiError, ProfileResponse } from '@mes/shared';
import type { Env } from '../env';
import { app } from '../index';

/** A signed-in (or not) client for tests: requests to the app with a cookie jar of one. */
export class TestClient {
  cookie = '';

  constructor(
    readonly env: Env,
    readonly origin = 'http://localhost',
  ) {}

  async request(method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (json !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(
      `${this.origin}/api${path}`,
      { method, headers, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) },
      this.env,
    );
    const set = res.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0]!;
      this.cookie = /Max-Age=0\b/i.test(set) || pair.endsWith('=') ? '' : pair;
    }
    return res;
  }

  /** A request that should succeed: the profile it replies with. */
  async ok(method: string, path: string, json?: unknown): Promise<ProfileResponse> {
    const res = await this.request(method, path, json);
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json<ProfileResponse>();
  }

  /** A request that should fail: its status and error. */
  async fails(method: string, path: string, json?: unknown) {
    const res = await this.request(method, path, json);
    if (res.ok) throw new Error(`${method} ${path} succeeded`);
    return { status: res.status, ...(await res.json<ApiError>()) };
  }

  /** Sets the (only) account's money, straight in the database. */
  async setMoney(money: number) {
    const db = this.env.DB;
    const row = await db.prepare('SELECT data FROM profiles').first<{ data: string }>();
    const p = JSON.parse(row!.data) as { money: number };
    p.money = money;
    await db.prepare('UPDATE profiles SET data = ?').bind(JSON.stringify(p)).run();
  }

  register(username = 'ana', password = 'hunter22') {
    return this.ok('POST', '/register', { username, password });
  }
}

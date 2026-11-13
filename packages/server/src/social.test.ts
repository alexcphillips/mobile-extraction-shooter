import { describe, expect, it } from 'vitest';
import {
  SOCIAL,
  xpForLevel,
  type FriendsResponse,
  type IceResponse,
  type PartyResponse,
  type SignalsResponse,
} from '@mes/shared';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

async function json<T>(client: TestClient, method: string, path: string, body?: unknown) {
  const res = await client.request(method, path, body);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json<T>();
}

const friendsOf = (c: TestClient) => json<FriendsResponse>(c, 'GET', '/friends');
const partyOf = (c: TestClient) => json<PartyResponse>(c, 'GET', '/party');

/** Signed-in clients, one per name, all on one database. */
async function players(...names: string[]) {
  const env = testEnv();
  const out: TestClient[] = [];
  for (const n of names) {
    const c = new TestClient(env);
    await c.register(n);
    out.push(c);
  }
  return out;
}

/** Makes a and b friends; b's account id. */
async function befriend(a: TestClient, b: TestClient, bName: string): Promise<string> {
  await json(a, 'POST', '/friends/requests', { username: bName });
  const req = (await friendsOf(b)).incoming[0]!;
  const done = await json<FriendsResponse>(b, 'POST', `/friends/requests/${req.id}/accept`);
  const aId = done.friends[0]!.id;
  return (await friendsOf(a)).friends.find((f) => f.id !== aId)?.id ?? '';
}

describe('friends', () => {
  it('asks by username (ignoring case), and the other accepts', async () => {
    const [ana, bob] = await players('ana', 'bob');
    const sent = await json<FriendsResponse>(ana!, 'POST', '/friends/requests', {
      username: 'BOB',
    });
    expect(sent.outgoing.map((r) => r.username)).toEqual(['bob']);
    const theirs = await friendsOf(bob!);
    expect(theirs.incoming.map((r) => r.username)).toEqual(['ana']);
    const done = await json<FriendsResponse>(
      bob!,
      'POST',
      `/friends/requests/${theirs.incoming[0]!.id}/accept`,
    );
    expect(done.friends.map((f) => f.username)).toEqual(['ana']);
    expect(done.incoming).toEqual([]);
    const mine = await friendsOf(ana!);
    expect(mine.friends).toMatchObject([{ username: 'bob', activity: 'offline', inParty: false }]);
    expect(mine.outgoing).toEqual([]);
  });

  it('accepts when asking someone who already asked you', async () => {
    const [ana, bob] = await players('ana', 'bob');
    await json(ana!, 'POST', '/friends/requests', { username: 'bob' });
    const back = await json<FriendsResponse>(bob!, 'POST', '/friends/requests', {
      username: 'ana',
    });
    expect(back.friends.map((f) => f.username)).toEqual(['ana']);
  });

  it('refuses yourself, unknown names, friends again, and too many waiting', async () => {
    const env = testEnv();
    const ana = new TestClient(env);
    await ana.register('ana');
    for (let i = 0; i < SOCIAL.maxOutgoing + 1; i++) await new TestClient(env).register(`pl${i}`);
    expect((await ana.fails('POST', '/friends/requests', { username: 'ana' })).error).toBe(
      'invalid',
    );
    expect((await ana.fails('POST', '/friends/requests', { username: 'zed' })).error).toBe(
      'not-found',
    );
    expect((await ana.fails('POST', '/friends/requests', {})).error).toBe('bad-request');
    for (let i = 0; i < SOCIAL.maxOutgoing; i++)
      await json(ana, 'POST', '/friends/requests', { username: `pl${i}` });
    // Asking the same person again changes nothing.
    await json(ana, 'POST', '/friends/requests', { username: 'pl0' });
    expect(
      (await ana.fails('POST', '/friends/requests', { username: `pl${SOCIAL.maxOutgoing}` }))
        .message,
    ).toMatch(/waiting/);
  });

  it('declines, takes back, and unfriends', async () => {
    const [ana, bob] = await players('ana', 'bob');
    await json(ana!, 'POST', '/friends/requests', { username: 'bob' });
    const req = (await friendsOf(bob!)).incoming[0]!;
    // Taken back by the sender.
    await json(ana!, 'POST', `/friends/requests/${req.id}/decline`);
    expect((await friendsOf(bob!)).incoming).toEqual([]);
    const bobId = await befriend(ana!, bob!, 'bob');
    expect((await friendsOf(ana!)).friends).toHaveLength(1);
    const after = await json<FriendsResponse>(ana!, 'DELETE', `/friends/${bobId}`);
    expect(after.friends).toEqual([]);
    expect((await friendsOf(bob!)).friends).toEqual([]);
  });

  it('shows a friend online from the menu, on their device, and in a raid', async () => {
    const [ana, bob] = await players('ana', 'bob');
    await befriend(ana!, bob!, 'bob');
    await json(bob!, 'POST', '/presence', { device: 'pc' });
    expect((await friendsOf(ana!)).friends[0]).toMatchObject({ activity: 'menu', device: 'pc' });
    await bob!.ok('POST', '/raids', { raid: 'northpoint' });
    expect((await friendsOf(ana!)).friends[0]!.activity).toBe('raid');
    expect((await bob!.fails('POST', '/presence', { device: 'fridge' })).error).toBe('bad-request');
  });

  it("counts friends online and requests to you in the menu's heartbeat (UX-5)", async () => {
    const [ana, bob, cas, dee] = await players('ana', 'bob', 'cas', 'dee', 'eve');
    await befriend(ana!, bob!, 'bob');
    await befriend(ana!, cas!, 'cas');
    await json(dee!, 'POST', '/friends/requests', { username: 'ana' });
    // One ana sent herself isn't a request to her.
    await json(ana!, 'POST', '/friends/requests', { username: 'eve' });
    let seen = await json<PartyResponse>(ana!, 'POST', '/presence', { device: 'pc' });
    expect(seen).toMatchObject({ friendCount: 2, friendsOnline: 0, friendRequests: 1 });
    await json(bob!, 'POST', '/presence', { device: 'phone' });
    // In a raid counts as online too; dee, only asking, isn't counted.
    await cas!.ok('POST', '/raids', { raid: 'northpoint' });
    await json(dee!, 'POST', '/presence', { device: 'pc' });
    seen = await json<PartyResponse>(ana!, 'POST', '/presence', { device: 'pc' });
    expect(seen).toMatchObject({ friendCount: 2, friendsOnline: 2, friendRequests: 1 });
  });
});

describe('the party', () => {
  it('invites a friend, who accepts and sees the same party', async () => {
    const [ana, bob] = await players('ana', 'bob');
    const bobId = await befriend(ana!, bob!, 'bob');
    const mine = await json<PartyResponse>(ana!, 'POST', '/party/invites', { friend: bobId });
    expect(mine.party!.members.map((m) => m.username)).toEqual(['ana']);
    // Bob picks it up with the menu's heartbeat.
    const seen = await json<PartyResponse>(bob!, 'POST', '/presence', { device: 'phone' });
    expect(seen.party).toBeNull();
    expect(seen.invites).toMatchObject([{ username: 'ana', size: 1 }]);
    const joined = await json<PartyResponse>(
      bob!,
      'POST',
      `/party/invites/${seen.invites[0]!.id}/accept`,
    );
    expect(joined.party!.members.map((m) => m.username)).toEqual(['ana', 'bob']);
    expect(joined.party!.members[1]).toMatchObject({ device: 'phone', online: true });
    expect(joined.invites).toEqual([]);
    expect((await partyOf(ana!)).party!.id).toBe(joined.party!.id);
    expect((await friendsOf(ana!)).friends[0]!.inParty).toBe(true);
  });

  it('only invites friends, and refuses a lapsed invite', async () => {
    const [ana, bob, cat] = await players('ana', 'bob', 'cat');
    const bobId = await befriend(ana!, bob!, 'bob');
    const catId = (await json<FriendsResponse>(cat!, 'GET', '/friends')).friends[0]?.id;
    expect(catId).toBeUndefined();
    expect((await ana!.fails('POST', '/party/invites', { friend: 'nobody' })).error).toBe(
      'invalid',
    );
    await json(ana!, 'POST', '/party/invites', { friend: bobId });
    await ana!.env.DB.prepare('UPDATE party_invites SET created_at = 0').run();
    expect((await partyOf(bob!)).invites).toEqual([]);
    const id = (await ana!.env.DB.prepare('SELECT id FROM party_invites').first<{
      id: string;
    }>())!.id;
    expect((await bob!.fails('POST', `/party/invites/${id}/accept`)).error).toBe('not-found');
  });

  it('joins by link code, up to the party size', async () => {
    const names = ['ana', 'bob', 'cat', 'dan', 'eve'];
    const all = await players(...names);
    const made = await json<PartyResponse>(all[0]!, 'POST', '/party');
    const code = made.party!.code;
    expect(code).toMatch(SOCIAL.code);
    for (const c of all.slice(1, SOCIAL.maxParty))
      await json(c, 'POST', '/party/join', { code: code.toLowerCase() });
    expect((await partyOf(all[0]!)).party!.members).toHaveLength(SOCIAL.maxParty);
    expect((await all[4]!.fails('POST', '/party/join', { code })).message).toMatch(/full/);
    expect((await all[4]!.fails('POST', '/party/join', { code: 'ZZZZZZZZ' })).error).toBe(
      'not-found',
    );
    expect((await all[4]!.fails('POST', '/party/join', { code: 'nope' })).error).toBe(
      'bad-request',
    );
  });

  it('passes the lead on when the leader leaves, and breaks up when empty', async () => {
    const [ana, bob] = await players('ana', 'bob');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    await json(bob!, 'POST', '/party/join', { code });
    const left = await json<PartyResponse>(ana!, 'POST', '/party/leave');
    expect(left.party).toBeNull();
    const bobs = (await partyOf(bob!)).party!;
    expect(bobs.members.map((m) => m.username)).toEqual(['bob']);
    expect(bobs.leader).toBe(bobs.members[0]!.id);
    await json(bob!, 'POST', '/party/leave');
    expect(await ana!.env.DB.prepare('SELECT count(*) AS n FROM parties').first()).toEqual({
      n: 0,
    });
  });

  it('lets only the leader kick and pick the raid; a new raid clears ready', async () => {
    const [ana, bob] = await players('ana', 'bob');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    const joined = (await json<PartyResponse>(bob!, 'POST', '/party/join', { code })).party!;
    const bobId = joined.members[1]!.id;
    const ready = await json<PartyResponse>(bob!, 'POST', '/party/ready', { ready: true });
    expect(ready.party!.members[1]!.ready).toBe(true);
    expect((await bob!.fails('POST', '/party/raid', { raid: 'northpoint' })).error).toBe('invalid');
    expect((await ana!.fails('POST', '/party/raid', { raid: 'nope' })).error).toBe('not-found');
    const picked = await json<PartyResponse>(ana!, 'POST', '/party/raid', { raid: 'northpoint' });
    expect(picked.party!.raid).toBe('northpoint');
    expect(picked.party!.members[1]!.ready).toBe(false);
    expect((await bob!.fails('POST', '/party/kick', { account: bobId })).error).toBe('invalid');
    const kicked = await json<PartyResponse>(ana!, 'POST', '/party/kick', { account: bobId });
    expect(kicked.party!.members).toHaveLength(1);
    expect((await partyOf(bob!)).party).toBeNull();
  });

  it('drops members away too long, but not one in a raid, and not a returning one', async () => {
    const [ana, bob, cat] = await players('ana', 'bob', 'cat');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    await json(bob!, 'POST', '/party/join', { code });
    const catId = (await json<PartyResponse>(cat!, 'POST', '/party/join', { code })).party!
      .members[2]!.id;
    const db = ana!.env.DB;
    const old = Date.now() - SOCIAL.awayMs - 60_000;
    await db.prepare('UPDATE party_members SET joined_at = ?').bind(old).run();
    await db.prepare('UPDATE accounts SET seen_at = ?').bind(old).run();
    // Cat is in a raid that started 10 minutes ago.
    await db
      .prepare(
        "INSERT INTO raids (id, account_id, raid, started_at) VALUES ('r1', ?, 'northpoint', ?)",
      )
      .bind(catId, Date.now() - 10 * 60_000)
      .run();
    // Ana comes back hours later: she drops out first, then Bob is dropped from the old party.
    const back = await json<PartyResponse>(ana!, 'POST', '/presence', { device: 'pc' });
    expect(back.party).toBeNull();
    const left = (await partyOf(cat!)).party!;
    expect(left.members.map((m) => m.username)).toEqual(['cat']);
    expect((await partyOf(bob!)).party).toBeNull();
  });

  it('accepting an invite leaves the party you were in', async () => {
    const [ana, bob, cat] = await players('ana', 'bob', 'cat');
    const catId = await befriend(ana!, cat!, 'cat');
    const { code } = (await json<PartyResponse>(bob!, 'POST', '/party')).party!;
    await json(cat!, 'POST', '/party/join', { code });
    await json(ana!, 'POST', '/party/invites', { friend: catId });
    const invite = (await partyOf(cat!)).invites[0]!;
    await json(cat!, 'POST', `/party/invites/${invite.id}/accept`);
    expect((await partyOf(bob!)).party!.members.map((m) => m.username)).toEqual(['bob']);
    expect((await partyOf(ana!)).party!.members.map((m) => m.username)).toEqual(['ana', 'cat']);
  });
});

describe('connection signals', () => {
  it('passes an offer and an answer between members, once each', async () => {
    const [ana, bob, cat] = await players('ana', 'bob', 'cat');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    const p = (await json<PartyResponse>(bob!, 'POST', '/party/join', { code })).party!;
    const [anaId, bobId] = [p.members[0]!.id, p.members[1]!.id];
    const offer = { to: bobId, session: 's1', kind: 'offer', sdp: 'v=0 offer' };
    expect((await ana!.request('POST', '/party/signal', offer)).status).toBe(204);
    expect((await partyOf(bob!)).signals).toBe(1);
    const got = await json<SignalsResponse>(bob!, 'GET', '/party/signals');
    expect(got.signals).toMatchObject([{ from: anaId, session: 's1', kind: 'offer' }]);
    expect((await json<SignalsResponse>(bob!, 'GET', '/party/signals')).signals).toEqual([]);
    const answer = { to: anaId, session: 's1', kind: 'answer', sdp: 'v=0 answer' };
    await bob!.request('POST', '/party/signal', answer);
    expect((await json<SignalsResponse>(ana!, 'GET', '/party/signals')).signals[0]!.sdp).toBe(
      'v=0 answer',
    );
    // Only to someone in your party.
    expect((await cat!.fails('POST', '/party/signal', { ...offer, to: anaId })).error).toBe(
      'invalid',
    );
    expect((await ana!.fails('POST', '/party/signal', { ...offer, kind: 'hello' })).error).toBe(
      'bad-request',
    );
  });

  it('gives STUN only without a TURN key', async () => {
    const [ana] = await players('ana');
    const ice = await json<IceResponse>(ana!, 'POST', '/party/ice');
    expect(ice.relay).toBe(false);
    expect(ice.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
  });
});

describe('starting a party raid', () => {
  it('lets the leader start once everyone is ready, and picks a PC to host', async () => {
    const [ana, bob] = await players('ana', 'bob');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    await json(bob!, 'POST', '/party/join', { code });
    await json(ana!, 'POST', '/presence', { device: 'phone' });
    await json(bob!, 'POST', '/presence', { device: 'pc' });
    await json(ana!, 'POST', '/party/raid', { raid: 'silver-creek' });
    expect((await ana!.fails('POST', '/party/start')).message).toMatch(/waiting for bob/);
    await json(bob!, 'POST', '/party/ready', { ready: true });
    expect((await bob!.fails('POST', '/party/start')).message).toMatch(/leader/);
    const started = (await json<PartyResponse>(ana!, 'POST', '/party/start')).party!;
    const bobId = started.members.find((m) => m.username === 'bob')!.id;
    expect(started.start).toMatchObject({ raid: 'silver-creek', host: bobId });
    expect(started.members.every((m) => !m.ready)).toBe(true);
    expect((await partyOf(bob!)).party!.start!.session).toBe(started.start!.session);
    await ana!.env.DB.prepare('UPDATE parties SET started_at = 1').run();
    expect((await partyOf(bob!)).party!.start).toBeNull();
  });

  it("won't start a locked map until everyone has its level, and says who is short", async () => {
    const [ana, bob] = await players('ana', 'bob');
    const { code } = (await json<PartyResponse>(ana!, 'POST', '/party')).party!;
    await json(bob!, 'POST', '/party/join', { code });
    await json(ana!, 'POST', '/presence', { device: 'pc' });
    await json(bob!, 'POST', '/presence', { device: 'pc' });
    await json(ana!, 'POST', '/party/raid', { raid: 'northpoint' });
    await json(bob!, 'POST', '/party/ready', { ready: true });
    const level2 = xpForLevel(2);
    await ana!.env.DB.prepare(
      `UPDATE profiles SET data = json_set(data, '$.xp', ?) WHERE account_id IN
       (SELECT id FROM accounts WHERE username = 'ana')`,
    )
      .bind(level2)
      .run();
    const before = await partyOf(ana!);
    expect(before.party!.members.map((m) => [m.username, m.level])).toEqual([
      ['ana', 2],
      ['bob', 1],
    ]);
    expect((await ana!.fails('POST', '/party/start')).message).toBe('bob needs level 2');
    await ana!.env.DB.prepare(`UPDATE profiles SET data = json_set(data, '$.xp', ?)`)
      .bind(level2)
      .run();
    expect((await json<PartyResponse>(ana!, 'POST', '/party/start')).party!.start).not.toBeNull();
  });
});

import { Hono, type Context } from 'hono';
import {
  SIGNAL,
  pickHost,
  SOCIAL,
  type Activity,
  type Device,
  type Friend,
  type FriendRequest,
  type FriendsResponse,
  type IceResponse,
  type Party,
  type PartyInvite,
  type PartyMember,
  type PartyResponse,
  type Signal,
  type SignalsResponse,
} from '@mes/shared';
import type { AppEnv } from './auth';
import { raidDef } from './content';
import { body, fail, isObject } from './errors';

/*
 * Friends, presence and the party (docs/coop.md, C1–C3). Plain routes over D1: the menu
 * says it's there every SOCIAL.heartbeatMs and picks up the party and invites in the
 * reply, so nothing here needs a live connection.
 */

type Db = D1Database;

const DEVICES = new Set<string>(['phone', 'pc']);

/** Letters and digits without look-alikes, matching SOCIAL.code. */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function device(v: unknown): Device | null {
  return typeof v === 'string' && DEVICES.has(v) ? (v as Device) : null;
}

// Friends

interface FriendRow {
  id: string;
  from_account: string;
  created_at: number;
  accepted_at: number | null;
  other: string;
  username: string;
  seen_at: number;
  device: string | null;
  in_party: number | null;
  in_raid: number | null;
}

export async function friendsResponse(db: Db, me: string): Promise<FriendsResponse> {
  const now = Date.now();
  const { results } = await db
    .prepare(
      `SELECT f.id, f.from_account, f.created_at, f.accepted_at, a.id AS other, a.username,
         a.seen_at, a.device,
         (SELECT 1 FROM party_members p WHERE p.account_id = a.id) AS in_party,
         (SELECT 1 FROM raids r WHERE r.account_id = a.id AND r.ended_at IS NULL
           AND r.started_at > ?) AS in_raid
       FROM friends f
       JOIN accounts a ON a.id = CASE WHEN f.from_account = ? THEN f.to_account
         ELSE f.from_account END
       WHERE f.from_account = ? OR f.to_account = ?
       ORDER BY a.username COLLATE NOCASE`,
    )
    .bind(now - SOCIAL.raidMs, me, me, me)
    .all<FriendRow>();
  const out: FriendsResponse = { friends: [], incoming: [], outgoing: [] };
  for (const r of results) {
    if (r.accepted_at === null) {
      const req: FriendRequest = {
        id: r.id,
        account: r.other,
        username: r.username,
        at: r.created_at,
      };
      (r.from_account === me ? out.outgoing : out.incoming).push(req);
      continue;
    }
    const activity: Activity = r.in_raid
      ? 'raid'
      : now - r.seen_at <= SOCIAL.onlineMs
        ? 'menu'
        : 'offline';
    const friend: Friend = {
      id: r.other,
      username: r.username,
      activity,
      device: device(r.device),
      inParty: !!r.in_party,
    };
    out.friends.push(friend);
  }
  return out;
}

async function friendCount(db: Db, account: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count(*) AS n FROM friends
       WHERE accepted_at IS NOT NULL AND (from_account = ? OR to_account = ?)`,
    )
    .bind(account, account)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM friends WHERE accepted_at IS NOT NULL
       AND ((from_account = ? AND to_account = ?) OR (from_account = ? AND to_account = ?))`,
    )
    .bind(a, b, b, a)
    .first();
  return !!row;
}

/** Accepts a request to me, if both still have room for a friend. Null, or why not. */
async function accept(db: Db, me: string, id: string, from: string): Promise<string | null> {
  if ((await friendCount(db, me)) >= SOCIAL.maxFriends)
    return `you have ${SOCIAL.maxFriends} friends already`;
  if ((await friendCount(db, from)) >= SOCIAL.maxFriends)
    return `they have ${SOCIAL.maxFriends} friends already`;
  await db
    .prepare('UPDATE friends SET accepted_at = ? WHERE id = ? AND to_account = ?')
    .bind(Date.now(), id, me)
    .run();
  return null;
}

export const friends = new Hono<AppEnv>();

friends.get('/', async (c) => c.json(await friendsResponse(c.env.DB, c.var.account)));

/** Asks someone by username; if they've already asked you, accepts theirs. */
friends.post('/requests', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.username !== 'string')
    return fail(c, 'bad-request', 'username is required');
  const db = c.env.DB;
  const me = c.var.account;
  const them = await db
    .prepare('SELECT id FROM accounts WHERE username = ?')
    .bind(raw.username)
    .first<{ id: string }>();
  if (!them) return fail(c, 'not-found', 'no one has that username');
  if (them.id === me) return fail(c, 'invalid', "you can't add yourself");
  const existing = await db
    .prepare(
      `SELECT id, from_account, accepted_at FROM friends
       WHERE (from_account = ? AND to_account = ?) OR (from_account = ? AND to_account = ?)`,
    )
    .bind(me, them.id, them.id, me)
    .first<{ id: string; from_account: string; accepted_at: number | null }>();
  if (existing?.accepted_at) return fail(c, 'invalid', "you're friends already");
  if (existing && existing.from_account === them.id) {
    const why = await accept(db, me, existing.id, them.id);
    if (why) return fail(c, 'invalid', why);
  } else if (!existing) {
    if ((await friendCount(db, me)) >= SOCIAL.maxFriends)
      return fail(c, 'invalid', `you have ${SOCIAL.maxFriends} friends already`);
    const out = await db
      .prepare('SELECT count(*) AS n FROM friends WHERE from_account = ? AND accepted_at IS NULL')
      .bind(me)
      .first<{ n: number }>();
    if ((out?.n ?? 0) >= SOCIAL.maxOutgoing)
      return fail(c, 'invalid', `you have ${SOCIAL.maxOutgoing} requests waiting already`);
    try {
      await db
        .prepare(
          'INSERT INTO friends (id, from_account, to_account, created_at) VALUES (?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), me, them.id, Date.now())
        .run();
    } catch (err) {
      // Both asking each other at once: the second loses on the pair index.
      if (!String(err).includes('UNIQUE')) throw err;
    }
  }
  return c.json(await friendsResponse(db, me));
});

friends.post('/requests/:id/accept', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  const req = await db
    .prepare(
      'SELECT from_account FROM friends WHERE id = ? AND to_account = ? AND accepted_at IS NULL',
    )
    .bind(c.req.param('id'), me)
    .first<{ from_account: string }>();
  if (!req) return fail(c, 'not-found', 'that request has gone');
  const why = await accept(db, me, c.req.param('id'), req.from_account);
  if (why) return fail(c, 'invalid', why);
  return c.json(await friendsResponse(db, me));
});

/** Declines a request to you, or takes back one you sent. */
friends.post('/requests/:id/decline', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  await db
    .prepare(
      `DELETE FROM friends WHERE id = ? AND accepted_at IS NULL
       AND (from_account = ? OR to_account = ?)`,
    )
    .bind(c.req.param('id'), me, me)
    .run();
  return c.json(await friendsResponse(db, me));
});

friends.delete('/:account', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  const them = c.req.param('account');
  await db
    .prepare(
      `DELETE FROM friends WHERE accepted_at IS NOT NULL
       AND ((from_account = ? AND to_account = ?) OR (from_account = ? AND to_account = ?))`,
    )
    .bind(me, them, them, me)
    .run();
  return c.json(await friendsResponse(db, me));
});

// The party

interface PartyRow {
  id: string;
  code: string;
  leader: string;
  raid: string | null;
  started_at: number | null;
  session: string | null;
  host: string | null;
}

async function partyOf(db: Db, me: string): Promise<PartyRow | null> {
  return db
    .prepare(
      `SELECT p.id, p.code, p.leader, p.raid, p.started_at, p.session, p.host
       FROM party_members m
       JOIN parties p ON p.id = m.party_id WHERE m.account_id = ?`,
    )
    .bind(me)
    .first<PartyRow>();
}

async function memberCount(db: Db, party: string): Promise<number> {
  const row = await db
    .prepare('SELECT count(*) AS n FROM party_members WHERE party_id = ?')
    .bind(party)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function partyResponse(db: Db, me: string): Promise<PartyResponse> {
  const now = Date.now();
  const row = await partyOf(db, me);
  let party: Party | null = null;
  if (row) {
    const { results } = await db
      .prepare(
        `SELECT a.id, a.username, a.seen_at, a.device, m.ready FROM party_members m
         JOIN accounts a ON a.id = m.account_id WHERE m.party_id = ? ORDER BY m.joined_at`,
      )
      .bind(row.id)
      .all<{
        id: string;
        username: string;
        seen_at: number;
        device: string | null;
        ready: number;
      }>();
    const members: PartyMember[] = results.map((m) => ({
      id: m.id,
      username: m.username,
      ready: !!m.ready,
      device: device(m.device),
      online: m.id === me || now - m.seen_at <= SOCIAL.onlineMs,
    }));
    // The leader first; the rest in the order they joined.
    members.sort((a, b) => Number(b.id === row.leader) - Number(a.id === row.leader));
    const start =
      row.started_at && row.session && row.host && row.raid && now - row.started_at < SOCIAL.startMs
        ? { session: row.session, raid: row.raid, host: row.host, at: row.started_at }
        : null;
    party = { id: row.id, code: row.code, leader: row.leader, raid: row.raid, members, start };
  }
  const { results } = await db
    .prepare(
      `SELECT i.id, i.from_account, a.username, i.created_at,
         (SELECT count(*) FROM party_members m WHERE m.party_id = i.party_id) AS size
       FROM party_invites i JOIN accounts a ON a.id = i.from_account
       WHERE i.to_account = ? AND i.created_at > ? AND i.party_id IS NOT ?
       ORDER BY i.created_at DESC`,
    )
    .bind(me, now - SOCIAL.inviteMs, row?.id ?? null)
    .all<{
      id: string;
      from_account: string;
      username: string;
      created_at: number;
      size: number;
    }>();
  const invites: PartyInvite[] = results.map((i) => ({
    id: i.id,
    from: i.from_account,
    username: i.username,
    size: i.size,
    at: i.created_at,
  }));
  const waiting = row
    ? await db
        .prepare(
          `SELECT count(*) AS n FROM party_signals
           WHERE to_account = ? AND party_id = ? AND created_at > ?`,
        )
        .bind(me, row.id, now - SIGNAL.lifeMs)
        .first<{ n: number }>()
    : null;
  const friends = await db
    .prepare(
      `SELECT count(f.accepted_at) AS friends,
         count(CASE WHEN f.accepted_at IS NOT NULL AND (a.seen_at >= ? OR EXISTS (
           SELECT 1 FROM raids r WHERE r.account_id = a.id AND r.ended_at IS NULL
             AND r.started_at > ?)) THEN 1 END) AS online,
         count(CASE WHEN f.accepted_at IS NULL AND f.to_account = ? THEN 1 END) AS requests
       FROM friends f
       JOIN accounts a ON a.id = CASE WHEN f.from_account = ? THEN f.to_account
         ELSE f.from_account END
       WHERE f.from_account = ? OR f.to_account = ?`,
    )
    .bind(now - SOCIAL.onlineMs, now - SOCIAL.raidMs, me, me, me, me)
    .first<{ friends: number; online: number; requests: number }>();
  return {
    party,
    invites,
    signals: waiting?.n ?? 0,
    friendCount: friends?.friends ?? 0,
    friendsOnline: friends?.online ?? 0,
    friendRequests: friends?.requests ?? 0,
  };
}

/** Makes a party with me leading, if I'm not in one. Its id. */
async function ensureParty(db: Db, me: string): Promise<string> {
  const row = await partyOf(db, me);
  if (row) return row.id;
  const id = crypto.randomUUID();
  const now = Date.now();
  for (;;) {
    try {
      await db.batch([
        db
          .prepare('INSERT INTO parties (id, code, leader, created_at) VALUES (?, ?, ?, ?)')
          .bind(id, newCode(), me, now),
        db
          .prepare('INSERT INTO party_members (account_id, party_id, joined_at) VALUES (?, ?, ?)')
          .bind(me, id, now),
      ]);
      return id;
    } catch (err) {
      // A code already taken (one in 31^8): try another.
      if (!String(err).includes('parties.code')) throw err;
    }
  }
}

/**
 * Takes me out of my party, if any. The earliest to join after me leads if I did; a party
 * left empty is deleted (with its invites).
 */
async function leaveParty(db: Db, me: string): Promise<void> {
  const row = await partyOf(db, me);
  if (!row) return;
  await db.prepare('DELETE FROM party_members WHERE account_id = ?').bind(me).run();
  const next = await db
    .prepare('SELECT account_id FROM party_members WHERE party_id = ? ORDER BY joined_at LIMIT 1')
    .bind(row.id)
    .first<{ account_id: string }>();
  if (!next) await db.prepare('DELETE FROM parties WHERE id = ?').bind(row.id).run();
  else if (row.leader === me)
    await db
      .prepare('UPDATE parties SET leader = ? WHERE id = ?')
      .bind(next.account_id, row.id)
      .run();
}

/** Puts me in a party (leaving mine), if it has room. Null, or why not. */
async function joinParty(db: Db, me: string, party: string): Promise<string | null> {
  const mine = await partyOf(db, me);
  if (mine?.id === party) return null;
  if ((await memberCount(db, party)) >= SOCIAL.maxParty)
    return `that party is full (${SOCIAL.maxParty})`;
  await leaveParty(db, me);
  await db.batch([
    db
      .prepare('INSERT INTO party_members (account_id, party_id, joined_at) VALUES (?, ?, ?)')
      .bind(me, party, Date.now()),
    db.prepare('DELETE FROM party_invites WHERE party_id = ? AND to_account = ?').bind(party, me),
  ]);
  return null;
}

const reply = async (c: Context<AppEnv>) => c.json(await partyResponse(c.env.DB, c.var.account));

export const party = new Hono<AppEnv>();

party.get('/', reply);

/** Makes a party with you leading (for its invite link), or replies with yours. */
party.post('/', async (c) => {
  await ensureParty(c.env.DB, c.var.account);
  return reply(c);
});

party.post('/invites', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.friend !== 'string')
    return fail(c, 'bad-request', 'friend is required');
  const db = c.env.DB;
  const me = c.var.account;
  const friend = raw.friend;
  if (!(await areFriends(db, me, friend))) return fail(c, 'invalid', 'you can only invite friends');
  const id = await ensureParty(db, me);
  const theirs = await partyOf(db, friend);
  if (theirs?.id === id) return fail(c, 'invalid', "they're in your party already");
  if ((await memberCount(db, id)) >= SOCIAL.maxParty)
    return fail(c, 'invalid', `your party is full (${SOCIAL.maxParty})`);
  // Asking again starts its 5 minutes over.
  await db
    .prepare(
      `INSERT INTO party_invites (id, party_id, from_account, to_account, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (party_id, to_account) DO UPDATE SET
         from_account = excluded.from_account, created_at = excluded.created_at`,
    )
    .bind(crypto.randomUUID(), id, me, friend, Date.now())
    .run();
  return reply(c);
});

party.post('/invites/:id/accept', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  const invite = await db
    .prepare(
      'SELECT party_id FROM party_invites WHERE id = ? AND to_account = ? AND created_at > ?',
    )
    .bind(c.req.param('id'), me, Date.now() - SOCIAL.inviteMs)
    .first<{ party_id: string }>();
  if (!invite) return fail(c, 'not-found', 'that invite has run out');
  const why = await joinParty(db, me, invite.party_id);
  if (why) return fail(c, 'invalid', why);
  return reply(c);
});

party.post('/invites/:id/decline', async (c) => {
  await c.env.DB.prepare('DELETE FROM party_invites WHERE id = ? AND to_account = ?')
    .bind(c.req.param('id'), c.var.account)
    .run();
  return reply(c);
});

/** Joins by the invite link's code: anyone with the link, friend or not. */
party.post('/join', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.code !== 'string' || !SOCIAL.code.test(raw.code.toUpperCase()))
    return fail(c, 'bad-request', 'a party code is 8 letters and digits');
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT id FROM parties WHERE code = ?')
    .bind(raw.code.toUpperCase())
    .first<{ id: string }>();
  if (!row) return fail(c, 'not-found', 'that party has broken up');
  const why = await joinParty(db, c.var.account, row.id);
  if (why) return fail(c, 'invalid', why);
  return reply(c);
});

party.post('/leave', async (c) => {
  await leaveParty(c.env.DB, c.var.account);
  return reply(c);
});

party.post('/kick', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.account !== 'string')
    return fail(c, 'bad-request', 'account is required');
  const db = c.env.DB;
  const me = c.var.account;
  const row = await partyOf(db, me);
  if (!row || row.leader !== me) return fail(c, 'invalid', 'only the leader can remove someone');
  if (raw.account === me) return fail(c, 'invalid', 'leave the party instead');
  await db
    .prepare('DELETE FROM party_members WHERE account_id = ? AND party_id = ?')
    .bind(raw.account, row.id)
    .run();
  return reply(c);
});

party.post('/ready', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.ready !== 'boolean')
    return fail(c, 'bad-request', 'ready is true or false');
  await c.env.DB.prepare('UPDATE party_members SET ready = ? WHERE account_id = ?')
    .bind(raw.ready ? 1 : 0, c.var.account)
    .run();
  return reply(c);
});

/** The leader picks the raid; everyone's ready is cleared, so they agree to the new one. */
party.post('/raid', async (c) => {
  const raw = await body(c);
  if (!isObject(raw) || typeof raw.raid !== 'string')
    return fail(c, 'bad-request', 'raid is required');
  if (!raidDef(raw.raid)) return fail(c, 'not-found', 'no such raid');
  const db = c.env.DB;
  const me = c.var.account;
  const row = await partyOf(db, me);
  if (!row || row.leader !== me) return fail(c, 'invalid', 'only the leader picks the raid');
  if (row.raid !== raw.raid) {
    await db.batch([
      db.prepare('UPDATE parties SET raid = ? WHERE id = ?').bind(raw.raid, row.id),
      db.prepare('UPDATE party_members SET ready = 0 WHERE party_id = ?').bind(row.id),
    ]);
  }
  return reply(c);
});

/** The menu is showing: you're online, on this device. Replies with the party and invites. */
export const presence = new Hono<AppEnv>();

presence.post('/', async (c) => {
  const raw = await body(c);
  const d = isObject(raw) ? device(raw.device) : null;
  if (!d) return fail(c, 'bad-request', 'device is phone or pc');
  await c.env.DB.prepare('UPDATE accounts SET seen_at = ?, device = ? WHERE id = ?')
    .bind(Date.now(), d, c.var.account)
    .run();
  return reply(c);
});

// Connecting devices directly (C4): offers and answers through the server.

party.post('/signal', async (c) => {
  const raw = await body(c);
  if (
    !isObject(raw) ||
    typeof raw.to !== 'string' ||
    typeof raw.session !== 'string' ||
    raw.session.length > 64 ||
    (raw.kind !== 'offer' && raw.kind !== 'answer') ||
    typeof raw.sdp !== 'string'
  )
    return fail(c, 'bad-request', 'to, session, kind (offer or answer) and sdp are required');
  if (raw.sdp.length > SIGNAL.maxSdp) return fail(c, 'invalid', 'that description is too long');
  const db = c.env.DB;
  const me = c.var.account;
  const row = await partyOf(db, me);
  const theirs = await partyOf(db, raw.to);
  if (!row || theirs?.id !== row.id || raw.to === me)
    return fail(c, 'invalid', "they're not in your party");
  await db
    .prepare(
      `INSERT INTO party_signals
         (id, party_id, from_account, to_account, session, kind, sdp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (from_account, to_account, kind) DO UPDATE SET
         id = excluded.id, party_id = excluded.party_id, session = excluded.session,
         sdp = excluded.sdp, created_at = excluded.created_at`,
    )
    .bind(crypto.randomUUID(), row.id, me, raw.to, raw.session, raw.kind, raw.sdp, Date.now())
    .run();
  return c.body(null, 204);
});

/** The signals to you, oldest first; they're deleted as they're handed over. */
party.get('/signals', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  const { results } = await db
    .prepare(
      `DELETE FROM party_signals WHERE to_account = ?
       RETURNING from_account, session, kind, sdp, created_at`,
    )
    .bind(me)
    .all<{
      from_account: string;
      session: string;
      kind: string;
      sdp: string;
      created_at: number;
    }>();
  const live = Date.now() - SIGNAL.lifeMs;
  const signals: Signal[] = results
    .filter((r) => r.created_at > live && (r.kind === 'offer' || r.kind === 'answer'))
    .sort((a, b) => a.created_at - b.created_at)
    .map((r) => ({
      from: r.from_account,
      session: r.session,
      kind: r.kind as Signal['kind'],
      sdp: r.sdp,
      at: r.created_at,
    }));
  return c.json<SignalsResponse>({ signals });
});

const STUN = { urls: 'stun:stun.cloudflare.com:3478' };
/** TURN credentials last this long (s): longer than a raid and the menu before it. */
const TURN_TTL = 4 * 60 * 60;

/**
 * The ICE servers to connect with: Cloudflare's STUN, plus short-lived TURN credentials
 * if the Worker has a TURN key. Port 53 URLs are left out: browsers block them, and
 * without trickle ICE a dead URL only slows gathering down.
 */
party.post('/ice', async (c) => {
  const { TURN_KEY_ID: id, TURN_KEY_TOKEN: token } = c.env;
  if (!id || !token) return c.json<IceResponse>({ iceServers: [STUN], relay: false });
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL }),
    },
  );
  if (!res.ok) {
    console.error('TURN credentials failed', res.status, await res.text());
    return c.json<IceResponse>({ iceServers: [STUN], relay: false });
  }
  const got = await res.json<IceResponse>();
  const iceServers = got.iceServers.map((s) => {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
    return { ...s, urls };
  });
  return c.json<IceResponse>({
    iceServers,
    relay: iceServers.some((s) => s.urls.some((u) => u.startsWith('turn'))),
  });
});

/**
 * The leader starts the party's raid (C5): everyone online and ready, the raid picked. The
 * host is picked now (pickHost), everyone's ready is cleared for next time, and each
 * member's menu sees `start` on its next heartbeat and joins.
 */
party.post('/start', async (c) => {
  const db = c.env.DB;
  const me = c.var.account;
  const { party: p } = await partyResponse(db, me);
  if (!p || p.leader !== me) return fail(c, 'invalid', 'only the leader starts the raid');
  if (p.members.length < 2) return fail(c, 'invalid', 'a party raid needs two or more');
  if (!p.raid) return fail(c, 'invalid', 'pick a raid first');
  const waiting = p.members.filter((m) => m.id !== me && (!m.online || !m.ready));
  if (waiting.length)
    return fail(c, 'invalid', `waiting for ${waiting.map((m) => m.username).join(', ')}`);
  const host = pickHost(p);
  if (!host) return fail(c, 'invalid', 'no one is online to host');
  await db.batch([
    db
      .prepare('UPDATE parties SET started_at = ?, session = ?, host = ? WHERE id = ?')
      .bind(Date.now(), crypto.randomUUID(), host, p.id),
    db.prepare('UPDATE party_members SET ready = 0 WHERE party_id = ?').bind(p.id),
  ]);
  return reply(c);
});

import type {
  EndRaidRequest,
  EntityId,
  ProfileResponse,
  SimState,
  StartRaidRequest,
} from '@mes/shared';
import { AccountError, call } from './account';

/*
 * Raids on the server (session 12b). A raid starts on the server, which hands back the
 * gear to wear. Its result is written to local storage before it's sent, and only
 * removed once the server has it (or has refused it), so a raid that ends offline, or
 * with the app closed straight after, is sent before the next raid starts. Sending the
 * same result twice is harmless. See design.md → Raids and maps → Saving raids.
 */

const PENDING_KEY = 'mes.pendingRaid';

interface Pending {
  /** The server's raid id. */
  raid: string;
  end: EndRaidRequest;
}

/** What became of a raid's result. */
export type SaveStatus =
  | { kind: 'saved' }
  /** Not sent (no connection, or signed out): kept here and sent before the next raid. */
  | { kind: 'queued' }
  /** The server won't take it; it's been dropped. */
  | { kind: 'refused'; message: string };

function readPending(): Pending | null {
  try {
    const text = localStorage.getItem(PENDING_KEY);
    return text ? (JSON.parse(text) as Pending) : null;
  } catch {
    return null;
  }
}

function writePending(p: Pending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Private mode or full storage: it's only sent now, not kept for later.
  }
}

async function send(p: Pending): Promise<SaveStatus> {
  for (let attempt = 0; ; attempt++) {
    try {
      await call('POST', `/raids/${encodeURIComponent(p.raid)}/end`, p.end);
      writePending(null);
      return { kind: 'saved' };
    } catch (err) {
      if (!(err instanceof AccountError)) throw err;
      if (err.code === 'offline' || err.code === 'signed-out') return { kind: 'queued' };
      // The profile changed under it (another device): the server reads it afresh.
      if (err.code === 'stale' && attempt === 0) continue;
      writePending(null);
      return {
        kind: 'refused',
        message:
          err.code === 'raid-over'
            ? 'That raid had already been counted as missing in action, so nothing from it was saved.'
            : err.code === 'not-found'
              ? "That raid isn't on this account, so nothing from it was saved."
              : `The server refused that raid's result: ${err.message}`,
      };
    }
  }
}

/** Keeps a raid's result on the phone, then sends it. */
export function saveResult(raid: string, end: EndRaidRequest): Promise<SaveStatus> {
  const p = { raid, end };
  writePending(p);
  return send(p);
}

/**
 * Sends a result left from an earlier raid, if there is one. Returns whether there was,
 * and anything to tell the player. Throws an AccountError (offline) if it can't be sent.
 */
export async function sendPending(): Promise<{ sent: boolean; notice: string | null }> {
  const p = readPending();
  if (!p) return { sent: false, notice: null };
  const status = await send(p);
  if (status.kind === 'queued')
    throw new AccountError('offline', "Can't reach the server. Check your connection.");
  return { sent: true, notice: status.kind === 'refused' ? status.message : null };
}

/** Starts a raid on the server: the profile it replies with has the gear to wear. */
export async function startServerRaid(raid: string): Promise<ProfileResponse> {
  const body: StartRaidRequest = { raid };
  try {
    return (await (await call('POST', '/raids', body)).json()) as ProfileResponse;
  } catch (err) {
    // Another device changed the profile between reading and starting: once more.
    if (err instanceof AccountError && err.code === 'stale')
      return (await (await call('POST', '/raids', body)).json()) as ProfileResponse;
    throw err;
  }
}

/** Counts a raid that never reported as missing in action now, so the stash can be edited. */
export async function abandonRaid(id: string): Promise<ProfileResponse> {
  return (await (
    await call('POST', `/raids/${encodeURIComponent(id)}/abandon`)
  ).json()) as ProfileResponse;
}

/*
 * Resuming a raid (session 13, the user's call 2026-10-27). iOS may unload a home-screen
 * app while it's in the background, say while you read a text; without this, the reload
 * would count the raid as missing in action. So each time the page is hidden, the whole
 * raid is written here (the sim state is plain JSON by design), and the next start offers
 * to carry on from that moment. Swiping the app closed resumes too. Cleared when the raid
 * ends for you.
 */

const SNAPSHOT_KEY = 'mes.raidSnapshot';

/** A raid in progress, as saved when the page was last hidden. */
export interface RaidSnapshot {
  version: 1;
  /** The server's raid id: only resumed while that raid is still open. */
  serverRaid: string;
  /** The raid config's id. */
  raid: string;
  /** The player spawn's id (for the stats line). */
  spawn: string;
  player: EntityId;
  /** Each enemy spawn marker's id, and the entity spawned there. */
  enemies: Record<string, EntityId>;
  kills: number;
  sim: SimState;
}

export function saveSnapshot(s: RaidSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
  } catch (err) {
    // Full storage or private mode: an unloaded page will count as missing, as before.
    console.warn('raid not saved for resuming', err);
  }
}

/** The saved raid, if it's the open one on the server; anything else is thrown away. */
export function readSnapshot(serverRaid: string | null): RaidSnapshot | null {
  try {
    const text = localStorage.getItem(SNAPSHOT_KEY);
    const s = text ? (JSON.parse(text) as RaidSnapshot) : null;
    if (s?.version === 1 && s.serverRaid === serverRaid) return s;
  } catch {
    // Unreadable: thrown away below.
  }
  clearSnapshot();
  return null;
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // Nothing to clear.
  }
}

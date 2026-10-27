import type { EndRaidRequest, ProfileResponse, StartRaidRequest } from '@mes/shared';
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

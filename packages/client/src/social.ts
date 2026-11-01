import { SOCIAL, type Device, type FriendsResponse, type PartyResponse } from '@mes/shared';
import { AccountError, call } from './account';

/*
 * Friends, presence and the party on the server (docs/coop.md, C1–C3). The menu runs a
 * PartyWatch while it's showing: it says it's there every SOCIAL.heartbeatMs and gets the
 * party and invites back.
 */

/** A phone (or tablet) by touch, or a PC with a mouse: it decides who hosts co-op. */
export function deviceKind(): Device {
  return matchMedia('(hover: hover) and (pointer: fine)').matches ? 'pc' : 'phone';
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

export const fetchFriends = () => json<FriendsResponse>('GET', '/friends');
export const askFriend = (username: string) =>
  json<FriendsResponse>('POST', '/friends/requests', { username });
export const acceptFriend = (id: string) =>
  json<FriendsResponse>('POST', `/friends/requests/${id}/accept`);
/** Declines a request to you, or takes back one you sent. */
export const declineFriend = (id: string) =>
  json<FriendsResponse>('POST', `/friends/requests/${id}/decline`);
export const unfriend = (account: string) =>
  json<FriendsResponse>('DELETE', `/friends/${encodeURIComponent(account)}`);

export const makeParty = () => json<PartyResponse>('POST', '/party');
export const inviteFriend = (friend: string) =>
  json<PartyResponse>('POST', '/party/invites', { friend });
export const acceptInvite = (id: string) =>
  json<PartyResponse>('POST', `/party/invites/${id}/accept`);
export const declineInvite = (id: string) =>
  json<PartyResponse>('POST', `/party/invites/${id}/decline`);
export const joinParty = (code: string) => json<PartyResponse>('POST', '/party/join', { code });
export const leaveParty = () => json<PartyResponse>('POST', '/party/leave');
export const kickMember = (account: string) =>
  json<PartyResponse>('POST', '/party/kick', { account });
export const setReady = (ready: boolean) => json<PartyResponse>('POST', '/party/ready', { ready });
/** The leader starts the party's raid (C5). */
export const startPartyRaid = () => json<PartyResponse>('POST', '/party/start');
export const pickPartyRaid = (raid: string) => json<PartyResponse>('POST', '/party/raid', { raid });

/** The invite link for a party's code. */
export function joinLink(code: string): string {
  return `${location.origin}/join/${code}`;
}

/** A /join/<code> link's code, if the page was opened from one. */
export function joinCodeIn(path: string): string | null {
  const m = /^\/join\/([A-Za-z0-9]+)\/?$/.exec(path);
  const code = m?.[1]?.toUpperCase();
  return code && SOCIAL.code.test(code) ? code : null;
}

/**
 * Keeps the party and invites fresh while the menu shows: a heartbeat now and every
 * SOCIAL.heartbeatMs, and at once when the page comes back into view. Calls `onParty` with
 * each reply; a failed heartbeat is skipped quietly (the next one tries again).
 */
export class PartyWatch {
  private timer = 0;
  private stopped = false;

  constructor(private readonly onParty: (p: PartyResponse) => void) {
    document.addEventListener('visibilitychange', this.onVisible);
    void this.beat();
  }

  /** Sends a heartbeat now, after a change made elsewhere (a raid picked, say). */
  beat = async (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.stopped) return;
    if (document.visibilityState === 'visible') {
      try {
        this.onParty(await json<PartyResponse>('POST', '/presence', { device: deviceKind() }));
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
      }
    }
    if (!this.stopped) this.timer = window.setTimeout(() => void this.beat(), SOCIAL.heartbeatMs);
  };

  /** Shows a reply from a party route at once, without waiting for the next beat. */
  show(p: PartyResponse): void {
    if (!this.stopped) this.onParty(p);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.beat();
  };
}

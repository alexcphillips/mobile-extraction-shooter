import { SOCIAL, type Activity, type Friend, type FriendsResponse, type Party } from '@mes/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountError } from '../account';
import { fetchFriends } from '../social';

/*
 * What the friends page and the party drawer share (docs/coop.md, C1–C3): the friends list,
 * polled while shown, and how a friend's row reads.
 */

const ACTIVITY: Record<Friend['activity'], string> = {
  offline: 'Offline',
  menu: 'Online',
  raid: 'In a raid',
};

export function friendLine(f: Friend, party: Party | null): string {
  const parts = [ACTIVITY[f.activity]];
  if (f.device && f.activity !== 'offline') parts.push(f.device === 'pc' ? 'PC' : 'phone');
  if (party?.members.some((m) => m.id === f.id)) parts.push('in your party');
  else if (f.inParty) parts.push('in a party');
  return parts.join(' · ');
}

/**
 * Your friends and requests, fetched on mount and every SOCIAL.heartbeatMs while mounted.
 * The setter takes a friends route's reply, so it shows at once.
 */
export function useFriends(
  onError: (message: string) => void,
): [FriendsResponse | null, (r: FriendsResponse) => void] {
  const [data, setData] = useState<FriendsResponse | null>(null);
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  }, [onError]);
  useEffect(() => {
    let live = true;
    const load = (): void => {
      fetchFriends().then(
        (r) => live && setData(r),
        (err: unknown) => {
          if (!(err instanceof AccountError)) throw err;
          if (live) report.current(err.message);
        },
      );
    };
    load();
    const timer = window.setInterval(load, SOCIAL.heartbeatMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return [data, setData];
}

/** A player's initial in a square, with a dot for where they are: offline, in the menu, in a raid. */
export function Avatar({ name, activity }: { name: string; activity?: Activity }): ReactNode {
  return (
    <span className="friends-avatar" aria-hidden>
      {name[0]?.toUpperCase()}
      {activity && <span className={`friends-dot ${activity}`} />}
    </span>
  );
}

import type { Party } from '../protocol';

/**
 * Who hosts a party's co-op raid (docs/coop.md, C5): its device runs the simulation and
 * the others connect to it. A PC if one's online, since it has mains power, a faster CPU,
 * and a tab in the background only slows rather than stopping as a locked phone does;
 * then the leader; then whoever's online first. Members are in the party's order (the
 * leader first). Null if no one's online.
 */
export function pickHost(party: Party): string | null {
  const online = party.members.filter((m) => m.online);
  const pc = online.find((m) => m.device === 'pc');
  if (pc) return pc.id;
  if (online.some((m) => m.id === party.leader)) return party.leader;
  return online[0]?.id ?? null;
}

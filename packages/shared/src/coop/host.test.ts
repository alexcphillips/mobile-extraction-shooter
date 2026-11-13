import { describe, expect, it } from 'vitest';
import type { Party, PartyMember } from '../protocol';
import { pickHost } from './host';

const member = (id: string, device: PartyMember['device'], online = true): PartyMember => ({
  id,
  username: id,
  ready: true,
  device,
  online,
  level: 1,
});

const party = (...members: PartyMember[]): Party => ({
  id: 'p',
  code: 'ABCDEFGH',
  leader: members[0]!.id,
  raid: null,
  members,
  start: null,
});

describe('pickHost', () => {
  it('picks a PC first, then the leader, then whoever is online', () => {
    expect(pickHost(party(member('a', 'phone'), member('b', 'pc')))).toBe('b');
    expect(pickHost(party(member('a', 'phone'), member('b', 'phone')))).toBe('a');
    expect(pickHost(party(member('a', 'pc'), member('b', 'pc')))).toBe('a');
    expect(pickHost(party(member('a', 'pc', false), member('b', 'phone')))).toBe('b');
    expect(pickHost(party(member('a', null, false)))).toBeNull();
  });
});

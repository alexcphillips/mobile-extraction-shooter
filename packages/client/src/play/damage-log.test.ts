import { describe, expect, it } from 'vitest';
import { CHEST, HEAD, LEFT_LEG, type DamageEvent } from '@mes/shared';
import {
  describeFightHit,
  describeSource,
  fightWith,
  logBleed,
  logFight,
  logHit,
  logKiller,
  logKillingHit,
  type DamageLog,
  type FightLog,
} from './damage-log';

const hit = (by: number, zone: DamageEvent['zone'], amount: number, absorbed = 0): DamageEvent => ({
  type: 'damage',
  target: 1,
  by,
  zone,
  amount,
  absorbed,
  cause: 'shot',
});

describe('the damage log', () => {
  it('adds up hits by who fired them, with bleeding and the killer', () => {
    const log: DamageLog = [];
    logHit(log, hit(5, CHEST, 40, 12), 'Jug');
    logHit(log, hit(7, LEFT_LEG, 20), 'Scav');
    logBleed(log, 3.4);
    logBleed(log, -1);
    const key = logHit(log, hit(5, HEAD, 35), 'Jug');
    logKiller(log, key);
    expect(log.map(describeSource)).toEqual([
      'Jug shot you 2 times for 75 (chest, head) · armour took 12',
      'Scav shot you once for 20 (left leg)',
      'Bleeding took 3',
    ]);
    expect(log.filter((s) => s.killed).map((s) => s.name)).toEqual(['Jug']);
  });
});

describe('the fight log', () => {
  const at = (target: number, by: number, zone: DamageEvent['zone'], amount: number) => ({
    ...hit(by, zone, amount),
    target,
  });

  it('lists the fight with one enemy both ways, newest first, pellets in a tick as one row', () => {
    const log: FightLog = [];
    logFight(log, at(5, 1, CHEST, 30), 1, 10); // you hit the Jug
    logFight(log, at(1, 7, HEAD, 10), 1, 12); // a Scav hits you: another fight
    logFight(log, at(1, 5, CHEST, 20), 1, 15); // two pellets from the Jug
    logFight(log, at(1, 5, LEFT_LEG, 5), 1, 15);
    logFight(log, at(1, 0, LEFT_LEG, 5), 1, 16); // a fall: no one's
    logFight(log, at(5, 1, HEAD, 0), 1, 17); // did nothing
    logFight(log, at(1, 5, HEAD, 50), 1, 20);
    logKillingHit(log, 5);
    const rows = fightWith(log, 5);
    expect(rows.map((h) => describeFightHit(h, 'Jug'))).toEqual([
      'Jug shot you · head · 50',
      'Jug shot you · chest, left leg ×2 · 25',
      'You shot Jug · chest · 30',
    ]);
    expect(rows.map((h) => !!h.killing)).toEqual([true, false, false]);
  });
});

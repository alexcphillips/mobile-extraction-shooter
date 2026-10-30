import { describe, expect, it } from 'vitest';
import { CHEST, HEAD, LEFT_LEG, type DamageEvent } from '@mes/shared';
import { describeSource, logBleed, logHit, logKiller, type DamageLog } from './damage-log';

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
    logHit(log, hit(5, CHEST, 40, 12), 'Yard boss');
    logHit(log, hit(7, LEFT_LEG, 20), 'Scav');
    logBleed(log, 3.4);
    logBleed(log, -1);
    const key = logHit(log, hit(5, HEAD, 35), 'Yard boss');
    logKiller(log, key);
    expect(log.map(describeSource)).toEqual([
      'Yard boss shot you 2 times for 75 (chest, head) · armour took 12',
      'Scav shot you once for 20 (left leg)',
      'Bleeding took 3',
    ]);
    expect(log.filter((s) => s.killed).map((s) => s.name)).toEqual(['Yard boss']);
  });
});

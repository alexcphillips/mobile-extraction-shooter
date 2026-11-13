import { describe, expect, it } from 'vitest';
import { XP, enemyXp, levelOf, levelProgress, raidXp, underLevel, xpForLevel } from './xp';

const enemies = new Map([
  ['scav', { faction: 'scav' as const }],
  ['pmc', { faction: 'pmc' as const }],
  ['foreman', { faction: 'boss' as const, xp: 600 }],
]);

describe('PMC levels', () => {
  it('follow the curve from level 1 to the top', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(1000);
    expect(xpForLevel(10)).toBe(45000);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(999)).toBe(1);
    expect(levelOf(1000)).toBe(2);
    expect(levelOf(1e12)).toBe(XP.maxLevel);
    expect(levelProgress(1500)).toEqual({ level: 2, into: 500, need: 2000 });
    expect(levelProgress(1e12).need).toBeNull();
  });

  it("price a kill by the enemy's own XP, else its faction's", () => {
    expect(enemyXp({ faction: 'scav' })).toBe(40);
    expect(enemyXp({ faction: 'boss', xp: 600 })).toBe(600);
  });
});

describe('raid XP', () => {
  it('adds kills, headshots and searches, more for getting out', () => {
    const killed = [{ enemy: 'pmc', head: true as const }, { enemy: 'foreman' }, { enemy: 'gone' }];
    const died = raidXp('killed', 900, killed, 5, enemies);
    // An enemy type no longer in content is worth nothing.
    expect(died).toMatchObject({ kills: 700, headshots: 50, searching: 50, base: 800 });
    expect(died).toMatchObject({ multiplier: 1, runThrough: false, total: 800 });
    expect(raidXp('mia', 900, killed, 5, enemies).total).toBe(800);
    expect(raidXp('extracted', 900, killed, 5, enemies).total).toBe(1040);
  });

  it('halves a run-through: out early with little done', () => {
    const quick = raidXp('extracted', 100, [{ enemy: 'scav' }], 2, enemies);
    expect(quick).toMatchObject({ base: 60, runThrough: true, multiplier: 0.5, total: 30 });
    // Late enough, or enough done, and it isn't one; dying never is.
    expect(raidXp('extracted', 240, [{ enemy: 'scav' }], 2, enemies).runThrough).toBe(false);
    expect(
      raidXp('extracted', 100, [{ enemy: 'pmc' }, { enemy: 'scav' }], 1, enemies).runThrough,
    ).toBe(false);
    expect(raidXp('killed', 100, [], 0, enemies).runThrough).toBe(false);
  });
});

describe('underLevel', () => {
  const m = (username: string, level: number) => ({ username, level });
  it('names whoever is below the level', () => {
    expect(underLevel([m('ana', 2), m('bob', 3)], 2)).toBeNull();
    expect(underLevel([m('ana', 2), m('bob', 1)], 2)).toBe('bob needs level 2');
    expect(underLevel([m('ana', 1), m('bob', 1), m('cas', 1)], 2)).toBe(
      'ana, bob and cas need level 2',
    );
  });
});

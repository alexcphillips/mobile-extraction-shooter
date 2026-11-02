import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { createRng } from '../rng';
import { oneOfPicks, rollEnemySpawns } from './spawn-roll';

const spawn = (id: string, extra: { chance?: number; oneOf?: string } = {}) => ({
  type: 'enemySpawn',
  id,
  enemy: 'scav',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  ...extra,
});

describe('rollEnemySpawns', () => {
  it('uses every spawn with no chance or group, and none with chance 0', () => {
    const map = {
      markers: [spawn('a'), spawn('never', { chance: 0 }), spawn('b', { chance: 1 })],
    } as unknown as CompiledMap;
    expect(rollEnemySpawns(createRng(3), map).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('spawns at about its chance, the same for a seed', () => {
    const map = { markers: [spawn('boss', { chance: 0.4 })] } as unknown as CompiledMap;
    let n = 0;
    for (let seed = 1; seed <= 1000; seed++) n += rollEnemySpawns(createRng(seed), map).length;
    expect(n).toBeGreaterThan(340);
    expect(n).toBeLessThan(460);
    expect(rollEnemySpawns(createRng(7), map)).toEqual(rollEnemySpawns(createRng(7), map));
  });

  it('uses one of the spawns sharing a oneOf name, picked at random', () => {
    const map = {
      markers: [
        spawn('a', { oneOf: 'yard' }),
        spawn('b', { oneOf: 'yard' }),
        spawn('c', { oneOf: 'yard' }),
        spawn('d'),
      ],
    } as unknown as CompiledMap;
    const used = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const ids = rollEnemySpawns(createRng(seed), map).map((m) => m.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain('d');
      used.add(ids.find((id) => id !== 'd')!);
    }
    expect([...used].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps enemy and loot spawn groups apart', () => {
    const markers = [
      spawn('e', { oneOf: 'key' }),
      { type: 'lootSpawn', id: 'l', lootTable: 't', oneOf: 'key', x: 0, y: 0, z: 0, yaw: 0 },
    ] as unknown as CompiledMap['markers'];
    expect([...oneOfPicks(createRng(1), markers, 'enemySpawn')]).toEqual(['e']);
    expect([...oneOfPicks(createRng(1), markers, 'lootSpawn')]).toEqual(['l']);
  });
});

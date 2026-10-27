import { CollisionWorld } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  checkDoorKeys,
  checkEnemySpawns,
  checkLootContainers,
  loadEnemies,
  loadItems,
  loadLootTables,
  loadMap,
  loadRaid,
  mapIds,
  raidIds,
} from './content';

// Validates every file in content/ the way the game loads it.
describe('content', () => {
  it.each(mapIds())('map %s loads, compiles and builds a collision world', (id) => {
    const map = loadMap(id);
    expect(() => new CollisionWorld(map.world)).not.toThrow();
    expect(map.markers.some((m) => m.type === 'playerSpawn')).toBe(true);
    expect(map.markers.some((m) => m.type === 'extraction')).toBe(true);
    expect(new Set(map.markers.map((m) => m.id)).size).toBe(map.markers.length);
    expect(() => checkEnemySpawns(map)).not.toThrow();
    expect(() => checkDoorKeys(map)).not.toThrow();
    expect(() => checkLootContainers(map)).not.toThrow();
  });

  it('enemy types and loadouts load and their references are sound', () => {
    expect(loadEnemies().types.size).toBeGreaterThan(0);
  });

  it('items load and their references are sound', () => {
    expect(loadItems().size).toBeGreaterThan(0);
  });

  it('loot tables load and their items are sound', () => {
    expect(loadLootTables().size).toBeGreaterThan(0);
  });

  it.each(raidIds())('raid %s loads and names a map', (id) => {
    expect(() => loadRaid(id)).not.toThrow();
  });

  it('includes the test map and raid', () => {
    expect(mapIds()).toContain('test-map');
    expect(raidIds()).toContain('test-raid');
  });
});

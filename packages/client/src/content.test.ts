import { CollisionWorld } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadItems, loadMap, mapIds } from './content';

// Validates every file in content/ the way the game loads it.
describe('content', () => {
  it.each(mapIds())('map %s loads, compiles and builds a collision world', (id) => {
    const map = loadMap(id);
    expect(() => new CollisionWorld(map.world)).not.toThrow();
    expect(map.markers.some((m) => m.type === 'playerSpawn')).toBe(true);
    expect(map.markers.some((m) => m.type === 'extraction')).toBe(true);
    expect(new Set(map.markers.map((m) => m.id)).size).toBe(map.markers.length);
  });

  it('items load and their references are sound', () => {
    expect(loadItems().size).toBeGreaterThan(0);
  });

  it('includes the test map', () => {
    expect(mapIds()).toContain('test-map');
  });
});

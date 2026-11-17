// The jewelry case (2026-11-17): its jewelry is loose, inside a box with a real door, so it
// can only be taken once the door's open (ground loot is taken only in sight).
import { describe, expect, it } from 'vitest';
import { build, lib } from './sim.mjs';

describe('the jewelry case', () => {
  it("holds its loose roll behind its door: out of reach shut, in reach open", () => {
    // on a bench-height block, its door facing +z
    const { map, world } = build([
      { type: 'box', pos: [0, 0, 0], size: [1.2, 0.9, 0.8], color: '#8a6a48' },
      { type: 'prefab', prefab: 'jewelry-case', pos: [0, 0.9, 0] },
    ]);
    const spot = map.markers.find((m) => m.type === 'lootSpawn');
    expect(spot).toBeDefined();
    expect(map.markers.some((m) => m.type === 'lootContainer')).toBe(false);
    const state = lib.createState(1);
    // you, standing in front of the case, looking at it
    const you = lib.spawnCharacter(state, world, 0, 0.9, 0, 0.1);
    you.yaw = 0;
    const item = { x: spot.x, y: spot.y, z: spot.z, item: { item: 'gold-bar', count: 1 } };
    expect(lib.groundInReach(you, item, world)).toBe(false);
    world.setDoorOpen(0, true);
    expect(lib.groundInReach(you, item, world)).toBe(true);
  });
});

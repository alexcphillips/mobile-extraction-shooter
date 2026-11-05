import {
  CollisionWorld,
  NavGrid,
  VENDOR,
  buyPrice,
  createState,
  // exposedSpawns, (with its check, off for now)
  createItem,
  spawnCharacter,
  spawnEnemy,
  step,
  syncDoors,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  checkDoorKeys,
  checkQuestMarkers,
  checkEnemySpawns,
  checkLootContainers,
  checkZombieMarkers,
  loadEnemies,
  loadItems,
  loadLootTables,
  loadMap,
  loadQuests,
  loadRaid,
  loadVendors,
  loadZombies,
  mapIds,
  raidIds,
  zombiesIds,
} from './content';

// Validates every file in content/ the way the game loads it.
describe('content', () => {
  it.each(mapIds())('map %s loads, compiles and builds a collision world', (id) => {
    const map = loadMap(id);
    expect(() => new CollisionWorld(map.world)).not.toThrow();
    expect(map.markers.some((m) => m.type === 'playerSpawn')).toBe(true);
    // A zombies map (2026-11-04) has zombie spawns and nowhere to extract. Off for now
    // (2026-11-05, the user's call): zombies maps being built (isaac, isaacs-map) have
    // neither zombie spawns nor an extraction yet.
    // const zombies = map.markers.some((m) => m.type === 'zombieSpawn');
    // expect(map.markers.some((m) => m.type === 'extraction')).toBe(!zombies);
    expect(() => checkZombieMarkers(map)).not.toThrow();
    expect(new Set(map.markers.map((m) => m.id)).size).toBe(map.markers.length);
    expect(() => checkEnemySpawns(map)).not.toThrow();
    expect(() => checkDoorKeys(map)).not.toThrow();
    expect(() => checkLootContainers(map)).not.toThrow();
    // Raids start out of the enemies' sight (the map editor warns about these too). Off for
    // now (2026-11-05, the user's call): northpoint has enemy spawns within 60 m of its
    // player spawn, none in sight of it, to be settled later.
    // expect(exposedSpawns(map.markers, new CollisionWorld(map.world))).toEqual([]);
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

  it('vendors load and sell items that exist, for money', () => {
    const items = loadItems();
    expect(loadVendors().size).toBeGreaterThan(0);
    for (const v of loadVendors().values())
      for (const o of v.sells) expect(buyPrice(items, o)).toBeGreaterThan(0);
  });

  it("repairing armour never makes money: a kit's points cost more than they add", () => {
    const defs = [...loadItems().values()];
    for (const kit of defs) {
      if (kit.type !== 'repair') continue;
      for (const a of defs) {
        if (a.type !== 'armour') continue;
        // What a point of durability adds to the armour's sell price, against its cost.
        expect(
          (a.value * VENDOR.sellShare) / a.durability,
          `${kit.id} on ${a.id}`,
        ).toBeLessThanOrEqual(kit.value / kit.points);
      }
    }
  });

  it('quests load, and their vendors, items and markers exist', () => {
    expect(loadQuests().size).toBeGreaterThan(0);
    expect(() => checkQuestMarkers()).not.toThrow();
  });

  it.each(raidIds())('raid %s loads and names a map', (id) => {
    expect(() => loadRaid(id)).not.toThrow();
  });

  it.each(zombiesIds())('zombies mode %s loads, and its map, kit and guns exist', (id) => {
    expect(() => loadZombies(id)).not.toThrow();
  });

  it('zombies: the couches open the upper floor, and the yard stays outside', () => {
    const map = loadMap('zombies-two-rooms');
    const world = new CollisionWorld(map.world);
    const nav = new NavGrid(world);
    const state = createState(1);
    syncDoors(state, world, nav);
    const at = (x: number, y: number, z: number): number => {
      const n = nav.nearest(x, y, z);
      expect(n).toBeGreaterThanOrEqual(0);
      return nav.component[n]!;
    };
    const start = (): number => at(-5, 0, -1);
    const back = (): number => at(7, 0, 3);
    const upper = (): number => at(6, 3.2, 0);
    const yard = (): number => at(-20, 0, 0);
    expect(new Set([start(), back(), upper(), yard()]).size).toBe(4);
    const buy = (id: string): void => {
      const d = state.doors[map.doors.findIndex((x) => x.id === id)]!;
      d.locked = false;
      d.gone = true;
      d.open = true;
      syncDoors(state, world, nav);
    };
    buy('couch-spiral');
    expect(upper()).toBe(start());
    expect(back()).not.toBe(start());
    buy('couch-stairs');
    expect(back()).toBe(start());
    expect(yard()).not.toBe(start());
  });

  it.each(['couch-spiral', 'couch-stairs'])(
    'zombies: with %s bought, a zombie upstairs walks down to the player',
    (couch) => {
      const map = loadMap('zombies-two-rooms');
      const world = new CollisionWorld(map.world);
      const nav = new NavGrid(world);
      const items = loadItems();
      const state = createState(1);
      // The player in the room the couch is in (the middle door stays shut).
      const [px, pz] = couch === 'couch-spiral' ? [-5, -1] : [7, 3];
      const player = spawnCharacter(state, world, px, pz, 0, 1);
      const d = map.doors.findIndex((x) => x.id === couch);
      syncDoors(state, world, nav);
      Object.assign(state.doors[d]!, { locked: false, gone: true, open: true });
      const z = spawnEnemy(state, world, 6, 3.2, 0, 0);
      z.ai!.zombie = { dead: 0, window: -1 };
      z.gear.knife = createItem(items, 'zombie-claws');
      z.gear.hand = 'knife';
      expect(z.y).toBeGreaterThan(3);
      let reached = false;
      for (let i = 0; i < 60 * 50 && !reached; i++) {
        step(state, world, items, {}, nav);
        reached =
          Math.hypot(z.x - player.x, z.z - player.z) < 1.5 && Math.abs(z.y - player.y) < 0.5;
      }
      expect(reached).toBe(true);
    },
  );

  it('includes the test map and raid', () => {
    expect(mapIds()).toContain('test-map');
    expect(raidIds()).toContain('test-raid');
  });
});

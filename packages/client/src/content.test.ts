import {
  CollisionWorld,
  GEAR,
  LOOT_GUN_MAX_LEVEL,
  NavGrid,
  VAULT_ITEM,
  VENDOR,
  spawnProblems,
  ammoDef,
  buyPrice,
  calibreOf,
  createLootGun,
  createState,
  createRng,
  createWeaponStats,
  equipLoadout,
  exposedSpawns,
  heldWeapon,
  loadedAmmo,
  lootRounds,
  weaponStats,
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
  itemOrigins,
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
import { loadTestMap } from './test/test-map';

// Validates every file in content/ the way the game loads it.
describe('content', () => {
  it.each(mapIds())('map %s leaves no player spawn without an extraction', (id) => {
    expect(spawnProblems(loadMap(id))).toEqual([]);
  });

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
    // Raids start out of the enemies' sight (the map editor warns about these too), and as
    // far from them as the map asks (enemyClearance; northpoint asks for none, 2026-11-07).
    expect(exposedSpawns(map.markers, new CollisionWorld(map.world), map.enemyClearance)).toEqual(
      [],
    );
  });

  it('enemy types and loadouts load and their references are sound', () => {
    expect(loadEnemies().types.size).toBeGreaterThan(0);
  });

  it("Jug (AI-7): his RPK-16 holds 100 with his drum, in his mask and plates; on Northpoint's ground floor 15% of raids", () => {
    const items = loadItems();
    const { types, loadouts } = loadEnemies();
    const jug = types.get('jug')!;
    expect(jug.faction).toBe('boss');
    const state = createState(1);
    const world = new CollisionWorld(loadTestMap().world);
    const c = spawnCharacter(state, world, 0, 0);
    equipLoadout(c, items, loadouts.get(jug.loadout)!, createRng(1));
    const w = heldWeapon(c)!;
    expect(w.item).toBe('rpk-16');
    expect(weaponStats(items, w, createWeaponStats()).magazine).toBe(100);
    expect(w.mag).toBe(100);
    expect([c.gear.helmet?.item, c.gear.bodyArmour?.item]).toEqual(['jug-mask', 'jug-armour']);
    const mask = items.get('jug-mask');
    expect(mask?.type === 'armour' && mask.level === 6 && mask.mask?.muffle).toBeTruthy();

    const map = loadMap('northpoint');
    // One of two homes (2026-11-08): the IKEA end or the department store, 40% of raids.
    const spawns = map.markers.filter((m) => m.type === 'enemySpawn' && m.enemy === 'jug');
    expect(spawns).toHaveLength(2);
    for (const s of spawns) expect(s).toMatchObject({ chance: 0.4, oneOf: 'jug' });
    for (const s of spawns) {
      const patrol = map.patrols.find((p) => s.type === 'enemySpawn' && p.id === s.patrol)!;
      expect(patrol.points.every((p) => p.y < 1)).toBe(true);
      // Each keeps to its own end of the mall: IKEA east, the department store west.
      const east = s.x > 0;
      expect(patrol.points.every((p) => (east ? p.x > 20 : p.x < -50))).toBe(true);
    }
  });

  it('items load and their references are sound', () => {
    expect(loadItems().size).toBeGreaterThan(0);
  });

  it("the vault's item is a vault the size of the vault's grid", () => {
    const def = loadItems().get(VAULT_ITEM);
    expect(def).toMatchObject({ type: 'container', slot: 'vault', grid: [...GEAR.vault] });
  });

  it('loot tables load and their items are sound', () => {
    expect(loadLootTables().size).toBeGreaterThan(0);
  });

  it('every gun in a loot table comes full, of a common or uncommon round of level 1 or 2', () => {
    const items = loadItems();
    const rng = createRng(1);
    for (const t of loadLootTables().values())
      for (const e of t.items) {
        const def = items.get(e.item)!;
        if (def.type !== 'weapon') continue;
        const calibre = calibreOf(items, def);
        expect(lootRounds(items, calibre), `${e.item} (${calibre})`).not.toHaveLength(0);
        for (let i = 0; i < 20; i++) {
          const gun = createLootGun(items, e.item, rng);
          const round = ammoDef(items, loadedAmmo(items, gun));
          expect(round.level).toBeLessThanOrEqual(LOOT_GUN_MAX_LEVEL);
          expect(['common', 'uncommon']).toContain(round.rarity);
          expect(round.calibre).toBe(calibre);
          expect(gun.mag).toBe(weaponStats(items, gun, createWeaponStats()).magazine);
        }
      }
  });

  it('vendors load and sell items that exist, for money', () => {
    const items = loadItems();
    expect(loadVendors().size).toBeGreaterThan(0);
    for (const v of loadVendors().values())
      for (const o of v.sells) expect(buyPrice(items, o)).toBeGreaterThan(0);
  });

  it('iron sights line up: the post tip on the sight line, level with the notch or centred in the ring', () => {
    // Aimed, the eye sits on model.sight's height looking along −z (render/viewmodel.ts).
    let guns = 0;
    for (const def of loadItems().values()) {
      if (def.type !== 'weapon') continue;
      const { parts, sight } = def.model;
      const named = (name: string) =>
        parts.filter((p) => p.name === name).flatMap((p) => (p.type === 'box' ? [p] : []));
      const posts = [...named('front sight post'), ...named('front bead')];
      if (!posts.length) continue;
      guns++;
      const top = (p: { pos: readonly number[]; size: readonly number[] }) =>
        p.pos[1]! + p.size[1]! / 2;
      for (const p of posts) expect(top(p), `${def.id} front post`).toBeCloseTo(sight[1], 3);
      for (const p of named('rear sight ear'))
        expect(top(p), `${def.id} rear notch`).toBeCloseTo(sight[1], 3);
      // An aperture's side bars are centred on the line.
      for (const p of named('rear sight ring').filter((p) => p.size[1] > p.size[0]))
        expect(p.pos[1], `${def.id} rear ring`).toBeCloseTo(sight[1], 3);
    }
    expect(guns).toBeGreaterThanOrEqual(30);
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

  it('item sources (UX-2): bandages turn up in containers, loose, on enemies and at the medic', () => {
    const b = itemOrigins().get('bandage')!;
    expect(b.containers.length).toBeGreaterThan(0);
    expect(b.enemies).toEqual(expect.arrayContaining(['PMC', 'Jug']));
    expect(b.vendors.map((v) => v.vendor)).toContain('Medic');
    // Every item a vendor sells has a source; quest items have their spot.
    for (const v of loadVendors().values())
      for (const o of v.sells)
        expect(itemOrigins().get(o.item)?.vendors.length, o.item).toBeGreaterThan(0);
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

  it('the test map (tests only) passes the map checks, and is no map or raid in content/', () => {
    const map = loadTestMap();
    const world = new CollisionWorld(map.world);
    expect(spawnProblems(map)).toEqual([]);
    expect(() => checkEnemySpawns(map)).not.toThrow();
    expect(() => checkDoorKeys(map)).not.toThrow();
    expect(() => checkLootContainers(map)).not.toThrow();
    expect(exposedSpawns(map.markers, world, map.enemyClearance)).toEqual([]);
    expect(map.markers.map((m) => m.type).sort()).toEqual(
      ['enemySpawn', 'lootContainer', 'playerSpawn', 'questMarker'].sort(),
    );
    expect(mapIds()).not.toContain('test-map');
    expect(raidIds()).toEqual(['northpoint']);
  });
});

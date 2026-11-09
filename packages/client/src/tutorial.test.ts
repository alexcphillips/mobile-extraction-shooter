import {
  CollisionWorld,
  NavGrid,
  TICK_RATE,
  advanceTutorial,
  carriedGrid,
  createState,
  heldWeapon,
  markBrought,
  newProfile,
  openExtractions,
  rollLootSpawns,
  spawnCharacter,
  startEnemies,
  startRaid,
  startTutorial,
  step,
  tutorialDone,
  type Character,
  type InventoryAction,
  type PlayerInput,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import {
  loadEnemies,
  loadItems,
  loadLootTables,
  loadMap,
  loadRaid,
  loadStartingKit,
  loadTutorial,
  raidIds,
  tutorialIds,
} from './content';

/*
 * The tutorial (TU-2) played through in the sim, the way TU-3's client will run it: its
 * raid on its map, in its kit, a scripted player doing each step, the step checker
 * following along. It checks the house works as laid out (the vault, the crawl and its
 * wire, the bandage, the scav, the key, the door, the yard) as well as the content.
 */

const DEG = Math.PI / 180;

function idle(parts: Partial<PlayerInput> = {}): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    crouch: false,
    jump: false,
    fire: false,
    aim: false,
    reload: false,
    ...parts,
  };
}

function setup() {
  const tutorial = loadTutorial('tutorial');
  const raid = loadRaid(tutorial.raid);
  const map = loadMap(raid.map);
  const world = new CollisionWorld(map.world);
  const nav = new NavGrid(world);
  const items = loadItems();
  const tables = loadLootTables();
  const { types, loadouts } = loadEnemies();
  const patrols = new Map(map.patrols.map((p) => [p.id, p]));
  const state = createState(3);
  const spawn = map.markers.find((m) => m.type === 'playerSpawn')!;
  const player = spawnCharacter(state, world, spawn.x, spawn.z, spawn.yaw, spawn.y + 0.5);
  player.gear = structuredClone(newProfile(items, loadStartingKit(tutorial.kit)).gear);
  markBrought(player);
  rollLootSpawns(state, map, items, tables);
  startRaid(state, map, raid.duration);
  openExtractions(state, player, spawn);
  startEnemies(state, world, map, items, { types, loadouts, tables, patrols });
  const progress = startTutorial(player);
  const done: string[] = [];
  /** One tick with this input, then the step checker, as the client will. */
  const tick = (inp: PlayerInput): void => {
    step(state, world, items, { [player.id]: inp }, nav);
    const before = progress.step;
    if (advanceTutorial(tutorial, progress, state, player.id))
      for (let s = before; s < progress.step; s++) done.push(tutorial.steps[s]!.id);
  };
  const yawTo = (x: number, z: number) => Math.atan2(-(x - player.x), -(z - player.z));
  /** Walks to (x, z), with extra input; false if it doesn't get there in time. */
  const goTo = (x: number, z: number, extra: Partial<PlayerInput> = {}, seconds = 10): boolean => {
    for (let t = 0; t < seconds * TICK_RATE; t++) {
      if (Math.hypot(x - player.x, z - player.z) < 0.3) return true;
      tick(idle({ moveY: 1, yaw: yawTo(x, z), ...extra }));
    }
    return false;
  };
  const wait = (seconds: number, inp: PlayerInput = idle({ yaw: player.yaw })): void => {
    for (let t = 0; t < seconds * TICK_RATE; t++) tick(inp);
  };
  return { tutorial, map, state, world, items, player, progress, done, tick, goTo, wait, yawTo };
}

describe('the tutorial (TU-2)', () => {
  it('loads, its raid is offline and not in the raid list', () => {
    expect(tutorialIds()).toContain('tutorial');
    const t = loadTutorial('tutorial');
    expect(loadRaid(t.raid).offline).toBe(true);
    expect(raidIds()).not.toContain(t.raid);
    expect(t.steps.length).toBeGreaterThan(5);
  });

  it('plays through: every step in order, from waking up to extracting', () => {
    const s = setup();
    const { player, state, done } = s;

    // 1–2. Walk to the fallen ceiling and climb over it.
    expect(s.goTo(10.6, 0.4)).toBe(true);
    expect(done).toEqual(['move']);
    for (let t = 0; t < 2 * TICK_RATE && player.x < 12.4; t++)
      s.tick(idle({ moveY: 1, yaw: -90 * DEG, jump: t % 10 < 5 }));
    expect(player.x, 'over the debris').toBeGreaterThan(12);
    expect(done).toContain('vault');

    // 3. Standing, the barricade stops you; crouched, through the gap and its wire.
    expect(s.goTo(14.3, 0)).toBe(true);
    expect(s.goTo(16.6, 0, {}, 3), 'too tall for the gap standing').toBe(false);
    expect(player.x).toBeLessThan(15.2);
    expect(s.goTo(16.6, 0, { crouch: true })).toBe(true);
    expect(player.health.bleeding.includes(true), 'the wire cut you').toBe(true);
    expect(done).toContain('crawl');
    s.wait(0.5);

    // 4. The bandage lies at its marker; take it.
    const marker = s.tutorial.steps.find((x) => x.id === 'bandage')!.markerPos!;
    const g = state.ground.findIndex((x) => x.item.item === 'bandage');
    expect(g).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(state.ground[g]!.x - marker.x, state.ground[g]!.z - marker.z)).toBeLessThan(
      0.5,
    );
    expect(s.goTo(marker.x - 0.8, marker.z)).toBe(true);
    const take: InventoryAction = {
      type: 'quick',
      from: { owner: { kind: 'ground' }, ground: g, item: 'bandage' },
      to: { kind: 'self' },
    };
    s.tick(idle({ inventory: [take] }));
    expect(done).toContain('bandage');

    // 5. Use it, and the bleeding stops.
    let at: { grid: number; index: number } | null = null;
    for (let grid = 0; grid < 2 && !at; grid++) {
      const i =
        carriedGrid(player.gear, grid)?.items.findIndex((x) => x.item.item === 'bandage') ?? -1;
      if (i >= 0) at = { grid, index: i };
    }
    expect(at).not.toBeNull();
    s.tick(idle({ use: { ...at!, item: 'bandage' } }));
    s.wait(4);
    expect(player.health.bleeding.includes(true)).toBe(false);
    expect(done).toContain('heal');

    // 6. Into the living room. The scav hasn't noticed; shot, he fires back, harmlessly.
    expect(s.goTo(21, -1.2)).toBe(true);
    expect(s.goTo(24, -1.2)).toBe(true);
    const scav = state.entities.find((e) => e.ai) as Character;
    expect(scav.ai!.awareness).toBe('unaware');
    const hp = [...player.health.hp];
    for (let t = 0; t < 10 * TICK_RATE && !scav.health.dead; t++) {
      const dx = scav.x - player.x;
      const dz = scav.z - player.z;
      const eye = player.y + player.height - 0.1;
      const pitch = Math.atan2(scav.y + 1.2 - eye, Math.hypot(dx, dz));
      // A burst, then a pause for the gun to settle, so it doesn't climb off him.
      s.tick(idle({ yaw: s.yawTo(scav.x, scav.z), pitch, aim: true, fire: t > 20 && t % 12 < 3 }));
      if ((heldWeapon(player)?.mag ?? 1) === 0) s.tick(idle({ reload: true }));
    }
    expect(scav.health.dead, 'killed the scav').toBe(true);
    expect(player.health.hp).toEqual(hp);
    expect(done).toContain('shoot');

    // 7. Reload.
    s.wait(0.1);
    s.tick(idle({ yaw: player.yaw, reload: true }));
    expect(done).toContain('reload');
    s.wait(3);

    // 8–9. Search his body: the key is in his pocket; take it.
    expect(s.goTo(scav.x - 1, scav.z)).toBe(true);
    s.wait(2, idle({ yaw: player.yaw, looting: `b:${scav.id}` }));
    expect(done).toContain('search');
    const k = scav.gear.pockets.items.findIndex((x) => x.item.item === 'front-door-key');
    expect(k, 'the key in his pocket').toBeGreaterThanOrEqual(0);
    s.tick(
      idle({
        looting: `b:${scav.id}`,
        inventory: [
          {
            type: 'quick',
            from: {
              owner: { kind: 'body', id: scav.id },
              grid: 'pockets',
              index: k,
              item: 'front-door-key',
            },
            to: { kind: 'self' },
          },
        ],
      }),
    );
    expect(done).toContain('key');

    // 10. The front door is locked; the key opens it.
    const door = s.map.doors.findIndex((d) => d.id === 'front-door');
    expect(state.doors[door]!.locked).toBe(true);
    expect(s.goTo(26, 2.3)).toBe(true);
    s.tick(idle({ yaw: 180 * DEG, door }));
    expect(state.doors[door]!.locked).toBe(false);
    expect(done).toContain('door');

    // 11. Out into the yard and extract.
    expect(s.goTo(26.6, 4.6)).toBe(true);
    expect(s.goTo(26.6, 6.5)).toBe(true);
    s.wait(9);
    expect(
      state.entities.some((e) => e.id === player.id),
      'left the raid',
    ).toBe(false);
    expect(done).toEqual(s.tutorial.steps.map((x) => x.id));
    expect(tutorialDone(s.tutorial, s.progress)).toBe(true);
  });
});

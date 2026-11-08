import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { addItem, createGrid } from '../inventory/grid';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { DEFAULT_SKILL, joinSquad, spawnEnemy, squadLeader, updateAi } from './ai';
import { createItem } from './create-item';
import { equip } from './gear';
import { CHEST, shootCharacter } from './health';
import { ammoDef } from '../content/items';
import type { LootContainer } from './looting';
import { startRaid } from './raid';
import { ROUTES, newSquad, squadState, startPois } from './routes';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';

function makeWorld(half = 80): CollisionWorld {
  const n = Math.ceil(half / 4) * 2;
  return new CollisionWorld({
    terrain: {
      minX: -half,
      minZ: -half,
      cellSize: 4,
      cols: n,
      rows: n,
      heights: Array((n + 1) ** 2).fill(0),
    },
    boxes: [],
    ramps: [],
    ladders: [],
  });
}

const poi = (id: string, kind: 'loot' | 'choke', x: number, z: number, radius?: number) => ({
  type: 'poi',
  id,
  kind,
  x,
  y: 0,
  z,
  yaw: 0,
  ...(radius !== undefined && { radius }),
});

/** A square extraction zone, side 6 m, around (x, z). */
const exit = (x: number, z: number) => ({
  id: 'exit',
  name: 'Exit',
  points: [
    [x - 3, z - 3],
    [x + 3, z - 3],
    [x + 3, z + 3],
    [x - 3, z + 3],
  ],
  extraction: { y: 0 },
});

const mapOf = (markers: object[], zones: object[] = []): CompiledMap =>
  ({ markers, zones, patrols: [] }) as unknown as CompiledMap;

/** A squad of n PMCs at (x, z), each with a rifle, a rig and a backpack. */
function squadAt(state: SimState, world: CollisionWorld, n: number, x = 0, z = 0): Character[] {
  const team: Character[] = [];
  for (let i = 0; i < n; i++) {
    const c = spawnEnemy(state, world, x + i * 2, 0, z + i * 2, 0, {
      faction: 'pmc',
      skill: DEFAULT_SKILL,
    });
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    equip(c, items, 'rig', createItem(items, 'rig'));
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    team.push(c);
  }
  team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
  return team;
}

function crate(id: string, x: number, z: number, what: [string, number][]): LootContainer {
  const grid = createGrid(4, 4, true);
  for (const [item, count] of what) addItem(items, grid, createItem(items, item, count));
  return { id, def: 'crate', x, y: 0, z, grid };
}

function run(state: SimState, world: CollisionWorld, seconds: number, nav: NavGrid): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) step(state, world, items, {}, nav);
}

const carried = (c: Character): number =>
  (c.gear.rig?.grid?.items.length ?? 0) + (c.gear.backpack?.grid?.items.length ?? 0);

describe('PMC routes', () => {
  it('walks from one point of interest to the next, its squad following', () => {
    const state = createState(4);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 3);
    startPois(
      state,
      mapOf([
        poi('a', 'choke', 0, -35),
        poi('b', 'choke', 35, 0),
        poi('c', 'choke', 0, 35),
        poi('d', 'choke', -35, 0),
      ]),
    );
    const sq = newSquad(state, world, team[0]!.id);
    let worst = 0;
    for (let t = 0; t < 120 * TICK_RATE; t++) {
      run(state, world, 1 / TICK_RATE, nav);
      if (t < 5 * TICK_RATE) continue;
      for (const m of team.slice(1))
        worst = Math.max(worst, Math.hypot(m.x - team[0]!.x, m.z - team[0]!.z));
    }
    // Several stops, never the same one twice running.
    expect(sq.visited.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < sq.visited.length; i++) expect(sq.visited[i]).not.toBe(sq.visited[i - 1]);
    expect(worst).toBeLessThan(12);
    expect(sq.leaving).toBe(false);
  });

  it('searches the containers at a loot spot, shared out, and takes what it finds', () => {
    const state = createState(2);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    state.loot.push(
      crate('left', 18, -3, [
        ['bandage', 1],
        ['round', 20],
      ]),
      crate('right', 22, 3, [['bandage', 1]]),
    );
    startPois(state, mapOf([poi('shop', 'loot', 20, 0)]));
    newSquad(state, world, team[0]!.id);
    const searched = new Map<string, number>();
    for (let t = 0; t < 40 * TICK_RATE; t++) {
      run(state, world, 1 / TICK_RATE, nav);
      for (const e of state.events) if (e.type === 'search') searched.set(e.container, e.by);
    }
    for (const l of state.loot) {
      expect(l.searched).toBe(true);
      expect(l.grid.items).toHaveLength(0);
    }
    // One each: the follower helped.
    expect(new Set(searched.values()).size).toBe(2);
    expect(carried(team[0]!) + carried(team[1]!)).toBe(3);
  });

  it('heads for its extraction when its time comes, and the squad leaves the raid', () => {
    const state = createState(5);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 3);
    const map = mapOf([poi('a', 'choke', -30, 0)], [exit(40, 0)]);
    startRaid(state, map, 1200);
    startPois(state, map);
    const sq = newSquad(state, world, team[0]!.id);
    expect(sq.extract).toBe('exit');
    expect(sq.leaveTick).toBeGreaterThan(state.tick + 1200 * TICK_RATE * 0.3);
    // Its time to leave is now.
    sq.leaveTick = state.tick;
    const left: number[] = [];
    for (let t = 0; t < 60 * TICK_RATE; t++) {
      run(state, world, 1 / TICK_RATE, nav);
      for (const e of state.events) if (e.type === 'leave') left.push(e.by);
    }
    expect(left.sort()).toEqual(team.map((c) => c.id).sort());
    for (const c of team) expect(state.entities.includes(c)).toBe(false);
    // Not counted among the players who left.
    expect(state.left).toHaveLength(0);
  });

  it('heads straight out with little raid time left', () => {
    const state = createState(6);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    const map = mapOf([poi('a', 'choke', -30, 0)], [exit(30, 0)]);
    startRaid(state, map, ROUTES.leaveBy - 10);
    startPois(state, map);
    const sq = newSquad(state, world, team[0]!.id);
    run(state, world, 1, nav);
    expect(sq.leaving).toBe(true);
    expect(sq.visited).toHaveLength(0);
  });

  it('walks to a body it killed and takes what it carried', () => {
    const state = createState(7);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    startPois(state, mapOf([poi('a', 'choke', -40, -40)]));
    const sq = newSquad(state, world, team[0]!.id);
    const you = spawnCharacter(state, world, 20, 10, 0, 1);
    addItem(items, you.gear.pockets, createItem(items, 'bandage'));
    addItem(items, you.gear.pockets, createItem(items, 'round', 30));
    you.health.dead = true;
    // The follower killed you: the squad remembers.
    state.events.push({ type: 'death', target: you.id, by: team[1]!.id });
    updateAi(state, world, items, nav);
    expect(sq.kills).toEqual([you.id]);
    run(state, world, 20, nav);
    expect(you.gear.pockets.items).toHaveLength(0);
    expect(carried(team[0]!)).toBe(2);
    expect(sq.kills).toHaveLength(0);
  });

  it('turns its route towards far gunfire, and advances on nearer gunfire past the scavs’ cap', () => {
    const state = createState(8);
    const world = makeWorld(150);
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    startPois(
      state,
      mapOf([
        poi('west', 'choke', -40, 0),
        poi('east', 'choke', 40, 0),
        poi('north', 'choke', 0, -40),
      ]),
    );
    const sq = newSquad(state, world, team[0]!.id);
    run(state, world, 0.5, nav);
    const leader = team[0]!;
    const shooter = spawnCharacter(state, world, 140, 0, 0, 1);
    const shot = (x: number, loudness: number) => {
      state.events.length = 0;
      state.events.push({
        type: 'shot',
        by: shooter.id,
        fromX: x,
        fromY: 1.5,
        fromZ: 0,
        toX: x + 1,
        toY: 1.5,
        toZ: 0,
        hit: 'none',
        target: 0,
        loudness,
        pellet: 0,
        grenade: 0,
      } as never);
      updateAi(state, world, items, nav);
    };
    // Far off (90% of its loudness), east: on to the east stop, without stopping.
    shot(leader.x + 135, 150);
    expect(state.pois![sq.stop]!.id).toBe('east');
    expect(leader.ai!.awareness).toBe('unaware');
    expect(leader.ai!.activity).toBe('route');
    // Nearer (50%): it goes to check, with care, though nobody else counts against it.
    shot(leader.x + 75, 150);
    expect(leader.ai!.awareness).toBe('suspicious');
    expect(leader.ai!.investigate).toBe(true);
    expect(leader.ai!.cautious).toBe(true);
    // Within 20%: alert to the shooter.
    shot(leader.x + 25, 150);
    expect(leader.ai!.awareness).toBe('alert');
    expect(leader.ai!.target).toBe(shooter.id);
  });

  it('gives up a hunt 15–20 s after losing its target, and goes back to its route', () => {
    const state = createState(9);
    const world = makeWorld(150);
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    startPois(state, mapOf([poi('a', 'choke', -40, 0), poi('b', 'choke', 0, -40)]));
    newSquad(state, world, team[0]!.id);
    run(state, world, 0.5, nav);
    const leader = team[0]!;
    const you = spawnCharacter(state, world, leader.x + 12, leader.z, 0, 1);
    you.health.hp.fill(1e6);
    leader.health.hp.fill(1e6);
    shootCharacter(state, items, leader, CHEST, ammoDef(items, 'round'), you.id);
    updateAi(state, world, items, nav);
    expect(leader.ai!.awareness).toBe('alert');
    // You vanish far away, out of sight and earshot.
    you.x = 140;
    you.z = 140;
    let calm = -1;
    for (let t = 0; t < 40 * TICK_RATE; t++) {
      run(state, world, 1 / TICK_RATE, nav);
      if (leader.ai!.awareness === 'unaware') {
        calm = t / TICK_RATE;
        break;
      }
    }
    expect(calm).toBeGreaterThanOrEqual(ROUTES.huntTime[0] - 1);
    expect(calm).toBeLessThanOrEqual(ROUTES.huntTime[1] + 2);
    run(state, world, 0.5, nav);
    expect(['route', 'wait', 'loot']).toContain(leader.ai!.activity);
    expect(squadLeader(state, team[1]!)).toBe(leader);
  });

  it('keeps its route in a saved raid, and carries on the same', () => {
    const state = createState(10);
    const world = makeWorld();
    const nav = new NavGrid(world);
    const team = squadAt(state, world, 2);
    const map = mapOf([poi('a', 'choke', -30, 0), poi('b', 'choke', 30, 0)], [exit(0, 40)]);
    startRaid(state, map, 1200);
    startPois(state, map);
    newSquad(state, world, team[0]!.id);
    run(state, world, 10, nav);
    const saved = JSON.parse(JSON.stringify(state)) as SimState;
    expect(squadState(saved, team[0]!.id)).toEqual(squadState(state, team[0]!.id));
    run(state, world, 10, nav);
    run(saved, world, 10, nav);
    const a = state.entities.find((e) => e.id === team[0]!.id)!;
    const b = saved.entities.find((e) => e.id === team[0]!.id)!;
    expect([b.x, b.z]).toEqual([a.x, a.z]);
  });

  it('a map without points of interest leaves squads guarding, as before', () => {
    const state = createState(11);
    const world = makeWorld();
    const team = squadAt(state, world, 2);
    startPois(state, mapOf([]));
    expect(state.pois).toEqual([]);
    expect(squadState(state, team[0]!.id)).toBeUndefined();
  });
});

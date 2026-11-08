import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import type { EnemyDef, LoadoutDef } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { createRng } from '../rng';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { DEFAULT_SKILL, joinSquad, spawnEnemy, squadLeader, updateAi } from './ai';
import { hostile } from './factions';
import { heldWeapon } from './gear';
import { CHEST, shootCharacter } from './health';
import { ammoDef } from './../content/items';
import { startRaid } from './raid';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { PMC_SQUADS, squadSizes } from './squads';
import { TEST_ITEMS as items } from './test-items';
import { startEnemies, type EnemyContent } from './waves';

function makeWorld(half = 150, boxes: BoxDef[] = []): CollisionWorld {
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
    boxes,
    ramps: [],
    ladders: [],
  });
}

const pmcType: EnemyDef = {
  formatVersion: 2,
  id: 'pmc',
  name: 'PMC',
  faction: 'pmc',
  loadout: 'kit',
  skill: DEFAULT_SKILL,
};
const kit: LoadoutDef = {
  formatVersion: 1,
  id: 'kit',
  weapons: [{ weight: 1, item: 'rifle', spare: [30, 30] }],
};
const content: EnemyContent = {
  types: new Map([['pmc', pmcType]]),
  loadouts: new Map([['kit', kit]]),
  tables: new Map(),
  patrols: new Map(),
};

const playerSpawn = (id: string, x: number, z: number) => ({
  type: 'playerSpawn',
  id,
  x,
  y: 0,
  z,
  yaw: 0,
});

/** Player spawns in a ring 100 m out, every 30°. */
const ring = Array.from({ length: 12 }, (_, i) =>
  playerSpawn(`p${i}`, Math.cos((i * Math.PI) / 6) * 100, Math.sin((i * Math.PI) / 6) * 100),
);

const mapOf = (markers: object[], pmcs?: CompiledMap['pmcs']): CompiledMap =>
  ({ markers, zones: [], patrols: [], pmcs }) as unknown as CompiledMap;

const pmcs = (state: SimState): Character[] =>
  state.entities.filter((e) => e.ai?.faction === 'pmc' && !e.health.dead);

function run(state: SimState, world: CollisionWorld, seconds: number, nav?: NavGrid): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) step(state, world, items, {}, nav);
}

describe('PMC squads', () => {
  it('splits PMCs into squads of 2–4', () => {
    const rng = createRng(7);
    for (let n = 2; n <= 12; n++) {
      for (let k = 0; k < 50; k++) {
        const sizes = squadSizes(rng, n);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        for (const s of sizes) {
          expect(s).toBeGreaterThanOrEqual(PMC_SQUADS.size[0]);
          expect(s).toBeLessThanOrEqual(PMC_SQUADS.size[1]);
        }
      }
    }
    expect(squadSizes(rng, 1)).toEqual([1]);
    expect(squadSizes(rng, 0)).toEqual([]);
  });

  it('starts them armed, at player spawns nobody uses, away from you and each other', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createState(seed);
      const world = makeWorld();
      const map = mapOf(ring, { count: [3, 6] });
      // You at p0.
      const you = spawnCharacter(state, world, 100, 0, 0, 1);
      startRaid(state, map, 1200);
      const started = startEnemies(state, world, map, items, content);
      const all = pmcs(state);
      expect(started).toEqual(all);
      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(all.length).toBeLessThanOrEqual(6);
      const squads = new Map<number, Character[]>();
      for (const c of all) {
        expect(c.look?.type).toBe('pmc');
        expect(heldWeapon(c)).toBeTruthy();
        expect(Math.hypot(c.x - you.x, c.z - you.z)).toBeGreaterThan(PMC_SQUADS.minDistance);
        const s = squads.get(c.ai!.squad!) ?? [];
        s.push(c);
        squads.set(c.ai!.squad!, s);
      }
      const leaders = [...squads.values()].map((s) => s[0]!);
      for (const s of squads.values()) {
        expect(s.length).toBeGreaterThanOrEqual(2);
        expect(s.length).toBeLessThanOrEqual(4);
        // The first leads from a spawn; the rest stand close behind it.
        expect(squadLeader(state, s[1]!)).toBe(s[0]);
        expect(s[0]!.ai!.activity).toBe('guard');
        for (const m of s.slice(1)) {
          expect(m.ai!.activity).toBe('follow');
          expect(Math.hypot(m.x - s[0]!.x, m.z - s[0]!.z)).toBeLessThan(8);
          expect(hostile(m, s[0]!)).toBe(false);
        }
        expect(ring.some((p) => Math.hypot(p.x - s[0]!.x, p.z - s[0]!.z) < 0.1)).toBe(true);
      }
      for (const a of leaders)
        for (const b of leaders) {
          if (a === b) continue;
          expect(hostile(a, b)).toBe(true);
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(PMC_SQUADS.apart);
        }
    }
  });

  it('puts in fewer squads when there are too few clear spawns, and none without pmcs', () => {
    const state = createState(1);
    const world = makeWorld();
    // Two spawns: yours, and one other.
    const map = mapOf([playerSpawn('a', 0, 0), playerSpawn('b', 100, 0)], { count: [6, 6] });
    spawnCharacter(state, world, 0, 0, 0, 1);
    startRaid(state, map, 1200);
    startEnemies(state, world, map, items, content);
    const all = pmcs(state);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.length).toBeLessThanOrEqual(4);
    for (const c of all) expect(Math.hypot(c.x - 100, c.z)).toBeLessThan(8);

    const quiet = createState(1);
    startEnemies(quiet, world, mapOf(ring), items, content);
    expect(pmcs(quiet)).toHaveLength(0);
  });

  it('follows its leader in formation, spread out, and stands its own side when it stops', () => {
    const state = createState(3);
    const world = makeWorld(60);
    const nav = new NavGrid(world);
    // A leader walking out 30 m and back, stopping at each end.
    const patrol = {
      points: [
        { x: 0, y: 0, z: -20, wait: 4, radius: 0 },
        { x: 0, y: 0, z: 10, wait: 4, radius: 0 },
      ],
      repeatFrom: 0,
      loop: true,
    };
    const leader = spawnEnemy(state, world, 0, 0, 10, 0, { faction: 'pmc', patrol });
    const team = [leader];
    for (let i = 1; i < 4; i++)
      team.push(spawnEnemy(state, world, i * 2, 0, 14, 0, { faction: 'pmc' }));
    team.forEach((c, i) => joinSquad(c, leader.id, i));
    let worst = 0;
    let closest = Infinity;
    for (let t = 0; t < 40 * TICK_RATE; t++) {
      run(state, world, 1 / TICK_RATE, nav);
      if (t < 5 * TICK_RATE) continue;
      for (const m of team.slice(1))
        worst = Math.max(worst, Math.hypot(m.x - leader.x, m.z - leader.z));
      for (let i = 1; i < 4; i++)
        for (let j = i + 1; j < 4; j++)
          closest = Math.min(closest, Math.hypot(team[i]!.x - team[j]!.x, team[i]!.z - team[j]!.z));
    }
    // Kept up the whole way, and never bunched up.
    expect(worst).toBeLessThan(10);
    expect(closest).toBeGreaterThan(1.2);
    // The leader moved; they came along.
    expect(team.every((m) => m.ai!.activity === 'follow' || m === leader)).toBe(true);
  });

  it('the next in line leads when the leader dies', () => {
    const state = createState(3);
    const world = makeWorld(60);
    const nav = new NavGrid(world);
    const team = [0, 1, 2].map((i) => spawnEnemy(state, world, i * 3, 0, 0, 0, { faction: 'pmc' }));
    team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
    team[0]!.health.dead = true;
    run(state, world, 1, nav);
    expect(squadLeader(state, team[2]!)).toBe(team[1]);
    expect(team[1]!.ai!.activity).toBe('guard');
    expect(team[2]!.ai!.activity).toBe('follow');
  });

  it('the whole squad knows where you are as soon as one of them does', () => {
    const state = createState(1);
    // A wall between you and the followers.
    const world = makeWorld(60, [{ x: 10, y: 1.5, z: 5, hx: 0.2, hy: 1.5, hz: 20, yaw: 0 }]);
    const nav = new NavGrid(world);
    const you = spawnCharacter(state, world, 20, 0, 0, 1);
    you.health.hp.fill(1e6);
    const team = [0, 1, 2].map((i) => spawnEnemy(state, world, 0, 0, i * 3, 0, { faction: 'pmc' }));
    team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
    // You shoot the leader.
    shootCharacter(state, items, team[0]!, CHEST, ammoDef(items, 'round'), you.id);
    updateAi(state, world, items, nav);
    for (let t = 0; t < AI_PERCEIVE + 1; t++) run(state, world, 1 / TICK_RATE, nav);
    for (const m of team) {
      expect(m.ai!.awareness).toBe('alert');
      expect(m.ai!.target).toBe(you.id);
    }
  });

  it('a follower that hears something tells its leader, who goes to check; it keeps its place', () => {
    const state = createState(2);
    // A wall behind the squad, so nobody sees you.
    const world = makeWorld(60, [{ x: 0, y: 1.5, z: 10, hx: 20, hy: 1.5, hz: 0.2, yaw: 0 }]);
    const nav = new NavGrid(world);
    const team = [0, 1].map((i) => spawnEnemy(state, world, 0, 0, i * 3, 0, { faction: 'pmc' }));
    team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
    const [leader, follower] = team as [Character, Character];
    run(state, world, 3, nav);
    // You sprint past the wall: in earshot of the follower only.
    const you = spawnCharacter(state, world, follower.x - 3, follower.z + 12, 0, 1);
    expect(Math.hypot(you.x - leader.x, you.z - leader.z)).toBeGreaterThan(15);
    for (let t = 0; t < 6; t++) {
      you.vx = 7;
      state.tick++;
      updateAi(state, world, items, nav);
    }
    you.vx = 0;
    you.x = 50;
    expect(follower.ai!.awareness).toBe('suspicious');
    expect(leader.ai!.awareness).toBe('unaware');
    run(state, world, 2, nav);
    expect(leader.ai!.awareness).toBe('suspicious');
    expect(leader.ai!.investigate).toBe(true);
    expect(follower.ai!.activity).toBe('follow');
  });
});

const AI_PERCEIVE = 3;

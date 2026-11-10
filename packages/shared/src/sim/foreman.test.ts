import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import type { EnemyDef, EnemySkill, LoadoutDef } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { DEFAULT_SKILL, joinSquad, spawnEnemy, type PatrolDef } from './ai';
import { startRaid } from './raid';
import { createState, spawnCharacter, type Character, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { startEnemies, type EnemyContent } from './waves';
import { giveWeapon } from './weapons';

/*
 * The foreman's crew (MT-12; design/ai-scavs-pmcs-bosses.md → Foreman): a boss who spawns
 * with guards as his squad, who hold their ground (skill.anchored) and send one guard to
 * flank only once you're pinned (skill.pinFlank).
 */

function makeWorld(boxes: BoxDef[] = [], half = 80): CollisionWorld {
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

/** A wall 3 m tall from (x0, z0) to (x1, z1), 0.4 m thick, along x or z. */
function wall(x0: number, z0: number, x1: number, z1: number): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: 1.5,
    z: (z0 + z1) / 2,
    hx: Math.max(0.2, Math.abs(x1 - x0) / 2),
    hy: 1.5,
    hz: Math.max(0.2, Math.abs(z1 - z0) / 2),
    yaw: 0,
  };
}

const CREW: EnemySkill = {
  ...DEFAULT_SKILL,
  holdChance: 1,
  coverTime: [0.6, 1.4],
  sprintToCover: true,
  territory: 25,
  roam: 0,
  anchored: true,
  pinFlank: { after: 4, within: 3 },
};

function crew(state: SimState, world: CollisionWorld, xs: number[], z: number): Character[] {
  const team = xs.map((x) => {
    const c = spawnEnemy(state, world, x, 0, z, Math.PI, { faction: 'boss', skill: CREW });
    giveWeapon(c, items, 'rifle');
    return c;
  });
  team.forEach((c, i) => joinSquad(c, team[0]!.id, i));
  return team;
}

/** You, at (x, z), too tough to die. */
function you(state: SimState, world: CollisionWorld, x: number, z: number): Character {
  const c = spawnCharacter(state, world, x, z);
  c.health.hp.fill(1e6);
  return c;
}

function run(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  seconds: number,
  each?: (t: number) => void,
): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(state, world, items, {}, nav);
    each?.((i + 1) / TICK_RATE);
  }
}

/** Who flanked when, by id, over `seconds` after you went behind the wall. */
function flanks(seed: number, moveTo?: number): Map<number, number> {
  const world = makeWorld([wall(-9, -2, 9, -2)]);
  const nav = new NavGrid(world);
  const state = createState(seed);
  const team = crew(state, world, [-3, -1, 1, 3], -20);
  const me = you(state, world, 11, 0);
  run(state, world, nav, 5);
  expect(team.every((m) => m.ai!.awareness === 'alert')).toBe(true);
  me.x = 0;
  me.z = 0;
  const out = new Map<number, number>();
  run(state, world, nav, 6, (t) => {
    // Not pinned: you get up and move along the wall.
    if (moveTo !== undefined && t > 2) me.x = moveTo;
    for (const m of team) if (m.ai!.activity === 'flank' && !out.has(m.id)) out.set(m.id, t);
  });
  expect(out.has(team[0]!.id)).toBe(false);
  return out;
}

describe('the foreman’s crew (MT-12)', () => {
  it('spawns with his guards round him as his squad, each on his patrol', () => {
    const type = (id: string, extra: Partial<EnemyDef> = {}): EnemyDef => ({
      formatVersion: 2,
      id,
      name: id,
      faction: 'boss',
      loadout: 'kit',
      skill: CREW,
      ...extra,
    });
    const kit: LoadoutDef = {
      formatVersion: 1,
      id: 'kit',
      weapons: [{ weight: 1, item: 'rifle', spare: [30, 30] }],
    };
    const patrol: PatrolDef = {
      points: [
        { x: 0, y: 0, z: 0, wait: 2, radius: 1 },
        { x: 10, y: 0, z: 0, wait: 2, radius: 1 },
      ],
      repeatFrom: 0,
      loop: true,
    };
    const content: EnemyContent = {
      types: new Map([
        ['foreman', type('foreman', { guards: { enemy: 'guard', count: 3 } })],
        ['guard', type('guard')],
      ]),
      loadouts: new Map([['kit', kit]]),
      tables: new Map(),
      patrols: new Map([['pt', patrol]]),
    };
    const map = {
      markers: [
        { type: 'enemySpawn', id: 'b', enemy: 'foreman', x: 0, y: 0, z: 0, yaw: 0, patrol: 'pt' },
      ],
      zones: [],
      patrols: [],
    } as unknown as CompiledMap;
    const state = createState(3);
    const world = makeWorld();
    spawnCharacter(state, world, 70, 70, 0, 1);
    startRaid(state, map, 1200);
    const out = startEnemies(state, world, map, items, content);
    expect(out.map((c) => c.look?.type)).toEqual(['foreman', 'guard', 'guard', 'guard']);
    const boss = out[0]!;
    expect(out.map((c) => [c.ai!.squad, c.ai!.squadSlot])).toEqual(
      [0, 1, 2, 3].map((slot) => [boss.id, slot]),
    );
    for (const c of out) {
      expect(c.ai!.patrol.length).toBeGreaterThan(0);
      expect(Math.hypot(c.x - boss.x, c.z - boss.z)).toBeLessThan(7);
    }
    // He walks his patrol, past its waits, his guards with him (not standing guard).
    const nav = new NavGrid(world);
    run(state, world, nav, 20);
    expect(boss.ai!.activity === 'patrol' || boss.ai!.activity === 'wait').toBe(true);
    expect(out.slice(1).every((c) => c.ai!.activity === 'follow')).toBe(true);
    const visited = new Set<number>();
    run(state, world, nav, 20, () => visited.add(Math.round(boss.x / 10)));
    expect(visited).toEqual(new Set([0, 1]));
  });

  it('pinned behind cover, you draw exactly one flanker, not him, and only after a while', () => {
    for (const seed of [4, 5, 6]) {
      const out = flanks(seed);
      expect(out.size).toBe(1);
      expect([...out.values()][0]!).toBeGreaterThanOrEqual(CREW.pinFlank!.after - 1);
    }
  });

  it('moving behind your cover, you draw no flanker: they hold', () => {
    for (const seed of [4, 5, 6]) expect(flanks(seed, 7).size).toBe(0);
  });

  it('holds its ground: it never goes after you off it, and goes back once it loses you', () => {
    // You seen 40 m off from beyond its ground, then out of sight behind a wall.
    const far = (anchored: boolean): number => {
      const world = makeWorld([wall(-6, 38, 6, 38)]);
      const nav = new NavGrid(world);
      const state = createState(7);
      const skill = { ...CREW, holdChance: 0, anchored, pinFlank: undefined };
      const c = spawnEnemy(state, world, 0, 0, 0, Math.PI, { faction: 'boss', skill });
      giveWeapon(c, items, 'rifle');
      const me = you(state, world, 12, 40);
      run(state, world, nav, 10);
      expect(c.ai!.awareness).toBe('alert');
      me.x = 0;
      let most = 0;
      run(state, world, nav, 30, () => {
        most = Math.max(most, Math.hypot(c.x, c.z));
      });
      return most;
    };
    expect(far(true)).toBeLessThan(CREW.territory! + 1);
    // Without it, it goes looking for you.
    expect(far(false)).toBeGreaterThan(CREW.territory! + 1);
  });
});

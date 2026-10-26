import { describe, expect, it } from 'vitest';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef, type WorldDef } from '../world/collision-world';
import { AI, resetEnemy, spawnEnemy, type PatrolDef } from './ai';
import { MOVEMENT } from './movement';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';

/** Flat ground, half metres each way from the origin. */
function makeWorld(boxes: BoxDef[] = [], half = 60): CollisionWorld {
  const n = Math.ceil(half / 4) * 2;
  const def: WorldDef = {
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
  };
  return new CollisionWorld(def);
}

function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    z: (z0 + z1) / 2,
    hx: (x1 - x0) / 2,
    hy: (y1 - y0) / 2,
    hz: (z1 - z0) / 2,
    yaw: 0,
  };
}

function input(parts: Partial<PlayerInput> = {}): PlayerInput {
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

interface Setup {
  state: SimState;
  world: CollisionWorld;
  nav: NavGrid;
  enemy: Character;
  player: Character;
  /** Runs ticks with the player holding one input. */
  run: (seconds: number, inp?: PlayerInput) => void;
}

/**
 * An enemy at the origin facing −z (yaw 0), and a player at (px, pz). The player has the
 * rifle, so it can shoot.
 */
function setup(
  px: number,
  pz: number,
  options: { boxes?: BoxDef[]; patrol?: PatrolDef; yaw?: number; half?: number } = {},
): Setup {
  const world = makeWorld(options.boxes, options.half);
  const nav = new NavGrid(world);
  const state = createState(7);
  const enemy = spawnEnemy(state, world, 0, 0, 0, options.yaw ?? 0, { patrol: options.patrol });
  const player = spawnCharacter(state, world, px, pz);
  const run = (seconds: number, inp = input()): void => {
    for (let i = 0; i < seconds * TICK_RATE; i++)
      step(state, world, TEST_ITEMS, { [player.id]: inp }, nav);
  };
  return { state, world, nav, enemy, player, run };
}

/** The player shoots straight up, so nothing is hit: only the sound carries. */
function shootUp(s: Setup): void {
  s.player.weapon = {
    item: 'rifle',
    mag: 30,
    reserve: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { optic: null, muzzle: null, magazine: null },
  };
  s.run(1 / TICK_RATE, input({ pitch: 1.4, fire: true }));
}

describe('enemy sight', () => {
  it('notices someone standing in front, faster when closer', () => {
    const near = setup(0, -10);
    near.run(0.5);
    expect(near.enemy.ai!.awareness).not.toBe('unaware');
    near.run(1.5);
    expect(near.enemy.ai!.awareness).toBe('alert');
    expect(near.enemy.ai!.target).toBe(near.player.id);

    const far = setup(0, -60, { half: 80 });
    far.run(2);
    expect(far.enemy.ai!.awareness).not.toBe('alert');
    far.run(15);
    expect(far.enemy.ai!.awareness).toBe('alert');
  });

  it("doesn't see behind itself, past its range, or through walls", () => {
    expect(runFor(setup(0, 10), 5)).toBe('unaware');
    expect(runFor(setup(0, -(AI.sightRange + 5), { half: 80 }), 5)).toBe('unaware');
    const wall = setup(0, -10, { boxes: [aabb(-5, 0, -5.2, 5, 3, -5)] });
    expect(runFor(wall, 5)).toBe('unaware');
  });

  it('sees you over a low wall, but not crouched behind it', () => {
    // Close in front of the player, so a crouched head is below the line over it.
    const boxes = [aabb(-5, 0, -9.2, 5, 1.2, -9)];
    expect(runFor(setup(0, -10, { boxes }), 3)).toBe('alert');
    expect(runFor(setup(0, -10, { boxes }), 3, input({ crouch: true }))).toBe('unaware');
  });

  it('notices at once up close, and turns to face what it noticed', () => {
    const s = setup(1, -2);
    s.run(0.2);
    expect(s.enemy.ai!.awareness).toBe('alert');
    s.run(1);
    // Facing the player: forward (−sin yaw, −cos yaw) points at it.
    const fx = -Math.sin(s.enemy.yaw);
    const fz = -Math.cos(s.enemy.yaw);
    const dx = s.player.x - s.enemy.x;
    const dz = s.player.z - s.enemy.z;
    expect((fx * dx + fz * dz) / Math.hypot(dx, dz)).toBeGreaterThan(0.95);
  });
});

function stop(x: number, z: number, wait: number, radius = 0): PatrolDef['points'][number] {
  return { x, y: 0, z, wait, radius };
}

function via(x: number, z: number): PatrolDef['points'][number] {
  return { x, y: 0, z, wait: 0, radius: 0 };
}

function runFor(s: Setup, seconds: number, inp?: PlayerInput): string {
  s.run(seconds, inp);
  return s.enemy.ai!.awareness;
}

describe('enemy hearing', () => {
  it('reacts to a shot by how far away it was', () => {
    // The test rifle is heard 150 m away: alert within 15%, investigate within half.
    const loud = 150;
    for (const [d, awareness, investigate] of [
      [loud * 0.1, 'alert', true],
      [loud * 0.4, 'suspicious', true],
      [loud * 0.8, 'suspicious', false],
      [loud * 1.1, 'unaware', false],
    ] as const) {
      // Behind the enemy, so it can't see the shooter.
      const s = setup(0, d, { half: 170 });
      shootUp(s);
      expect(s.enemy.ai!.awareness, `${d} m`).toBe(awareness);
      if (awareness === 'suspicious') expect(s.enemy.ai!.investigate, `${d} m`).toBe(investigate);
    }
  });

  it('is alarmed by a near miss however far the shot came from', () => {
    const s = setup(0, 40, { yaw: 0 });
    s.player.weapon = {
      item: 'rifle',
      mag: 30,
      reserve: 0,
      cooldown: 0,
      reloading: 0,
      triggerHeld: false,
      attachments: { optic: null, muzzle: null, magazine: null },
    };
    // Shoots towards the enemy (yaw 0 faces −z), a little to the side.
    s.enemy.x = 1.5;
    s.run(1 / TICK_RATE, input({ yaw: 0, fire: true }));
    expect(s.enemy.ai!.awareness).toBe('alert');
  });

  it('hears footsteps nearby, but not crouch-walking', () => {
    // Walking in circles behind the enemy, 4 m away.
    const walk = setup(0, 4);
    expect(runFor(walk, 1, input({ moveX: 1 }))).not.toBe('unaware');
    const crouched = setup(0, 4);
    expect(runFor(crouched, 1, input({ moveX: 1, crouch: true }))).toBe('unaware');
    const sprinting = setup(0, 12);
    expect(runFor(sprinting, 1, input({ moveY: 1, yaw: Math.PI / 2, sprint: true }))).not.toBe(
      'unaware',
    );
  });

  it('turns to look, walks over to investigate, then calms down', () => {
    const s = setup(0, 30);
    s.player.z = 60;
    shootUp(s);
    expect(s.enemy.ai!.activity).toBe('look');
    s.player.x = 50;
    s.player.z = 0;
    s.run(AI.lookTime + 1);
    expect(s.enemy.ai!.activity).toBe('investigate');
    s.run(30);
    // Got near where the shot came from, looked around, and went back to guarding.
    expect(s.enemy.ai!.awareness).toBe('unaware');
    expect(s.enemy.ai!.activity).toBe('guard');
  });
});

describe('enemy behaviour', () => {
  it('walks its patrol, standing at stops and walking through the rest', () => {
    // In along x = 0, then back and forth between two stops by way of (15, 15). The
    // straight way between the stops is along z = 10, so going near (15, 15) shows the
    // route follows the points.
    const patrol: PatrolDef = {
      points: [via(0, 10), stop(10, 10, 1), via(15, 15), stop(20, 10, 1)],
      repeatFrom: 1,
      loop: false,
    };
    // The player is out of sight range.
    const s = setup(-58, 58, { patrol });
    const visited: number[] = [];
    let waitedAtVia = false;
    let nearBend = false;
    for (let t = 0; t < 40 * TICK_RATE; t++) {
      s.run(1 / TICK_RATE);
      const ai = s.enemy.ai!;
      if (visited.at(-1) !== ai.patrolIndex) visited.push(ai.patrolIndex);
      if (ai.activity === 'wait' && ai.patrolWaits[ai.patrolIndex] === 0) waitedAtVia = true;
      if (Math.hypot(s.enemy.x - 15, s.enemy.z - 15) < 1.5) nearBend = true;
    }
    expect(visited.slice(0, 7)).toEqual([0, 1, 2, 3, 2, 1, 2]);
    expect(waitedAtVia).toBe(false);
    expect(nearBend).toBe(true);
  });

  it("goes to a random spot within a stop's radius on each visit", () => {
    const patrol: PatrolDef = {
      points: [stop(0, 0, 0.5, 3), stop(12, 0, 0.5, 3)],
      repeatFrom: 0,
      loop: true,
    };
    const s = setup(-58, 58, { patrol });
    const spots: number[][] = [];
    for (let t = 0; t < 60 * TICK_RATE; t++) {
      const was = s.enemy.ai!.activity;
      s.run(1 / TICK_RATE);
      if (was !== 'wait' && s.enemy.ai!.activity === 'wait' && s.enemy.ai!.patrolIndex === 1)
        spots.push([s.enemy.x, s.enemy.z]);
    }
    expect(spots.length).toBeGreaterThan(2);
    for (const [x, z] of spots) expect(Math.hypot(x! - 12, z!)).toBeLessThan(3 + AI.arrive + 0.5);
    expect(
      new Set(spots.map(([x, z]) => `${x!.toFixed(1)},${z!.toFixed(1)}`)).size,
    ).toBeGreaterThan(1);
  });

  it('spawns at a random clear spot within the spawn radius', () => {
    // A crate right on the spawn point.
    const world = makeWorld([aabb(-1, 0, -1, 1, 1.2, 1)]);
    const spots = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const e = spawnEnemy(createState(seed), world, 0, 0, 0, 0, { radius: 4 });
      expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(4);
      // Not in or on the crate.
      expect(Math.max(Math.abs(e.x), Math.abs(e.z))).toBeGreaterThan(1 + MOVEMENT.radius - 1e-6);
      expect(e.ai!.homeX).toBe(e.x);
      spots.add(`${e.x.toFixed(2)},${e.z.toFixed(2)}`);
    }
    expect(spots.size).toBeGreaterThan(10);
  });

  it('goes round a wall to investigate', () => {
    // A wall between the enemy and the noise, with a way round at x > 8.
    const boxes = [aabb(-30, 0, 5, 8, 3, 5.4)];
    const s = setup(0, 30, { boxes });
    shootUp(s);
    expect(s.enemy.ai!.investigate).toBe(true);
    s.player.x = 50;
    s.run(15);
    // It went round the end of the wall and reached the spot (with some error).
    expect(s.enemy.z).toBeGreaterThan(10);
  });

  it('closes in when alert, then searches and gives up after losing you', () => {
    const s = setup(0, -30, { half: 80 });
    s.run(4);
    expect(s.enemy.ai!.awareness).toBe('alert');
    expect(s.enemy.z).toBeLessThan(-5);
    // Vanish behind it: for a moment it still knows where you went...
    s.player.x = 55;
    s.player.z = 55;
    s.run(AI.intuition + 0.5);
    expect(s.enemy.ai!.focusX).toBeCloseTo(55);
    // ...but not once you've moved on, out of sight range.
    s.player.x = 75;
    s.player.z = -75;
    s.run(AI.loseTrack);
    expect(s.enemy.ai!.awareness).toBe('searching');
    expect(s.enemy.ai!.focusX).toBeCloseTo(55);
    s.run(60);
    expect(s.enemy.ai!.awareness).toBe('unaware');
  });

  it('forgets a target that died, and resets to its spawn', () => {
    const s = setup(0, -10);
    s.run(2);
    expect(s.enemy.ai!.awareness).toBe('alert');
    s.player.health.dead = true;
    s.run(0.2);
    expect(s.enemy.ai!.awareness).toBe('unaware');
    s.enemy.x = 20;
    resetEnemy(s.enemy, s.world);
    expect(s.enemy.x).toBe(0);
    expect(s.enemy.ai!.activity).toBe('guard');
  });

  it('pushes bodies apart', () => {
    const s = setup(0.2, 0);
    s.run(1 / TICK_RATE);
    expect(Math.hypot(s.player.x - s.enemy.x, s.player.z - s.enemy.z)).toBeCloseTo(
      MOVEMENT.radius * 2,
    );
  });

  it('carries on identically after a JSON save and restore', () => {
    const a = setup(0, 20);
    shootUp(a);
    a.run(2);
    const b = { ...a, state: JSON.parse(JSON.stringify(a.state)) as SimState };
    const walk = input({ moveX: 1 });
    for (let i = 0; i < TICK_RATE * 5; i++) {
      step(a.state, a.world, TEST_ITEMS, { [a.player.id]: walk }, a.nav);
      step(b.state, b.world, TEST_ITEMS, { [a.player.id]: walk }, a.nav);
    }
    expect(b.state).toEqual(a.state);
  });
});

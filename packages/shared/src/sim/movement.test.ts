import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../tick';
import {
  CollisionWorld,
  type BoxDef,
  type LadderDef,
  type RampDef,
  type WorldDef,
} from '../world/collision-world';
import { MOVEMENT } from './movement';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';

const R = MOVEMENT.radius;
const NO_ITEMS = new Map();

function flatTerrain(h = 0): WorldDef['terrain'] {
  return { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights: Array(51 * 51).fill(h) };
}

function makeWorld(parts: Partial<WorldDef> = {}): CollisionWorld {
  return new CollisionWorld({
    terrain: flatTerrain(),
    boxes: [],
    ramps: [],
    ladders: [],
    ...parts,
  });
}

/** An axis-aligned box from its min and max corners. */
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
  c: Character;
  /** Runs ticks with the same input; returns the highest feet height seen. */
  run: (ticks: number, inp?: PlayerInput) => number;
}

/** Spawns on the highest surface at (x, z), or the highest below y. */
function setup(world: CollisionWorld, x = 0, z = 0, yaw = 0, y = Infinity): Setup {
  const state = createState(1);
  const c = spawnCharacter(state, world, x, z, yaw, y);
  const run = (ticks: number, inp = input({ yaw: c.yaw })): number => {
    let top = -Infinity;
    for (let i = 0; i < ticks; i++) {
      step(state, world, NO_ITEMS, { [c.id]: inp });
      top = Math.max(top, c.y);
    }
    return top;
  };
  return { state, world, c, run };
}

// yaw 0 faces −z.
const FORWARD = input({ moveY: 1 });
const BACK = input({ moveY: -1 });

describe('walking', () => {
  it('walks, sprints and crouch-walks at their speeds', () => {
    for (const [inp, speed] of [
      [FORWARD, MOVEMENT.walkSpeed],
      [input({ moveY: 1, sprint: true }), MOVEMENT.sprintSpeed],
      [input({ moveY: 1, crouch: true }), MOVEMENT.crouchSpeed],
    ] as const) {
      const { c, run } = setup(makeWorld());
      // The first ticks of crouching are still at standing speed.
      run(TICK_RATE, inp);
      const z = c.z;
      run(TICK_RATE, inp);
      expect(z - c.z).toBeCloseTo(speed, 5);
      expect(c.x).toBeCloseTo(0);
      expect(c.mode).toBe('ground');
    }
  });

  it('only sprints forwards, and clamps the stick to length 1', () => {
    const { c, run } = setup(makeWorld());
    run(TICK_RATE, input({ moveY: -1, sprint: true }));
    expect(c.z).toBeCloseTo(MOVEMENT.walkSpeed);
    const { c: d, run: runD } = setup(makeWorld());
    runD(TICK_RATE, input({ moveX: 1, moveY: 1 }));
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(MOVEMENT.walkSpeed);
  });

  it('turns with yaw', () => {
    const { c, run } = setup(makeWorld());
    // yaw −π/2 faces +x.
    run(TICK_RATE, input({ moveY: 1, yaw: -Math.PI / 2 }));
    expect(c.x).toBeCloseTo(MOVEMENT.walkSpeed);
    expect(c.z).toBeCloseTo(0);
  });

  it('stops at a wall and slides along it', () => {
    const world = makeWorld({ boxes: [aabb(-10, 0, -6, 10, 3, -5)] });
    const { c, run } = setup(world);
    run(TICK_RATE * 3, FORWARD);
    expect(c.z).toBeCloseTo(-5 + R);
    expect(c.vz).toBeCloseTo(0);
    // Pushing diagonally into it still moves along it.
    run(TICK_RATE, input({ moveY: 1, moveX: 1 }));
    expect(c.z).toBeCloseTo(-5 + R);
    expect(c.x).toBeGreaterThan(2);
  });

  it('stays put and keeps its look with no input', () => {
    const { state, world, c } = setup(makeWorld(), 0, 0, 1.2);
    for (let i = 0; i < 10; i++) step(state, world, NO_ITEMS, {});
    expect([c.x, c.y, c.z, c.yaw]).toEqual([0, 0, 0, 1.2]);
  });

  it('ignores non-finite input', () => {
    const { c, run } = setup(makeWorld());
    run(5, input({ moveX: NaN, moveY: Infinity, yaw: NaN }));
    expect([c.x, c.z, c.yaw]).toEqual([0, 0, 0]);
  });
});

describe('steps, ledges and falling', () => {
  it('walks up onto a low step but not a high one', () => {
    const low = setup(makeWorld({ boxes: [aabb(-2, 0, -4, 2, 0.4, -3)] }));
    low.run(TICK_RATE * 2, FORWARD);
    expect(low.c.z).toBeLessThan(-4);
    const high = setup(makeWorld({ boxes: [aabb(-2, 0, -4, 2, 0.6, -3)] }));
    high.run(TICK_RATE * 2, FORWARD);
    expect(high.c.z).toBeCloseTo(-3 + R);
    expect(high.c.y).toBe(0);
  });

  it('walks off a ledge, falls and lands', () => {
    const world = makeWorld({ boxes: [aabb(-5, 0, -5, 5, 3, 5)] });
    const { c, run } = setup(world);
    expect(c.y).toBe(3);
    run(1, FORWARD);
    expect(c.mode).toBe('ground');
    // 5 m to the edge, then the fall.
    run(TICK_RATE * 3, FORWARD);
    expect(c.mode).toBe('ground');
    expect(c.y).toBe(0);
    expect(c.z).toBeLessThan(-5 - R);
  });

  it('follows the ground down a small drop without falling', () => {
    const world = makeWorld({ boxes: [aabb(-5, 0, -2, 5, 0.3, 5)] });
    const { c, run } = setup(world);
    run(TICK_RATE * 2, FORWARD);
    expect(c.y).toBe(0);
    expect(c.mode).toBe('ground');
  });

  it("doesn't fall through a thin floor however fast", () => {
    const world = makeWorld({ boxes: [aabb(-5, 4.9, -5, 5, 5, 5)] });
    const { c, run } = setup(world, 0, 0, 0);
    c.y = 200;
    c.mode = 'air';
    run(TICK_RATE * 10);
    expect(c.y).toBeCloseTo(5);
    expect(c.mode).toBe('ground');
  });
});

describe('jumping', () => {
  it('jumps to jumpHeight and lands, once per press', () => {
    const { c, run } = setup(makeWorld());
    const top = run(TICK_RATE, input({ jump: true }));
    expect(top).toBeGreaterThan(MOVEMENT.jumpHeight - 0.05);
    expect(top).toBeLessThan(MOVEMENT.jumpHeight + 0.05);
    expect(c.mode).toBe('ground');
    // Still holding jump: no second jump.
    expect(run(TICK_RATE, input({ jump: true }))).toBe(0);
  });

  it('mantles onto a 1 m box from standing against it', () => {
    const world = makeWorld({ boxes: [aabb(-2, 0, -6, 2, 1, -3)] });
    const { c, run } = setup(world);
    run(TICK_RATE, FORWARD);
    expect(c.z).toBeCloseTo(-3 + R);
    run(TICK_RATE, input({ moveY: 1, jump: true }));
    expect(c.y).toBe(1);
    expect(c.mode).toBe('ground');
  });

  it('keeps sprint speed through a jump', () => {
    const { c, run } = setup(makeWorld());
    const sprint = input({ moveY: 1, sprint: true });
    run(TICK_RATE, sprint);
    run(5, { ...sprint, jump: true });
    expect(c.mode).toBe('air');
    expect(-c.vz).toBeCloseTo(MOVEMENT.sprintSpeed);
  });

  it("can't mantle a 1.3 m wall", () => {
    const world = makeWorld({ boxes: [aabb(-2, 0, -6, 2, 1.3, -3)] });
    const { c, run } = setup(world);
    run(TICK_RATE / 2, FORWARD);
    run(TICK_RATE * 2, input({ moveY: 1, jump: true }));
    expect(c.y).toBe(0);
    expect(c.z).toBeCloseTo(-3 + R);
  });

  it('bumps its head on a low ceiling', () => {
    const world = makeWorld({ boxes: [aabb(-5, 2, -5, 5, 2.2, 5)] });
    const { run } = setup(world, 0, 0, 0, 1);
    expect(run(TICK_RATE, input({ jump: true }))).toBeCloseTo(2 - MOVEMENT.standHeight);
  });

  it("can't jump while crouched", () => {
    const { run } = setup(makeWorld());
    run(TICK_RATE, input({ crouch: true }));
    expect(run(TICK_RATE, input({ crouch: true, jump: true }))).toBe(0);
  });
});

describe('stairs', () => {
  it('walks up a ramp onto a platform and back down', () => {
    // Platform 3 m up from z = −10 to −15; stairs rise from z = −2 to −10 (towards −z).
    const ramp: RampDef = { x: 0, z: -6, hx: 1, hz: 4, yaw: Math.PI, bottom: 0, low: 0, high: 3 };
    const world = makeWorld({ boxes: [aabb(-3, 0, -15, 3, 3, -10)], ramps: [ramp] });
    const { c, run } = setup(world);
    run(TICK_RATE * 4, FORWARD);
    expect(c.y).toBe(3);
    expect(c.z).toBeLessThan(-10);
    expect(c.mode).toBe('ground');
    run(TICK_RATE * 5, BACK);
    expect(c.y).toBe(0);
    expect(c.z).toBeGreaterThan(-2);
  });

  it('is blocked by the side of the stairs', () => {
    const ramp: RampDef = { x: 0, z: -6, hx: 1, hz: 4, yaw: Math.PI, bottom: 0, low: 0, high: 3 };
    const world = makeWorld({ ramps: [ramp] });
    // Beside the high end, walking towards +x into the side.
    const { c, run } = setup(world, -4, -9, -Math.PI / 2);
    run(TICK_RATE * 2, input({ moveY: 1, yaw: -Math.PI / 2 }));
    expect(c.x).toBeCloseTo(-1 - R);
  });
});

describe('crouching', () => {
  // A beam from 1.4 to 1.6 m spanning the path between z = −3 and −5.
  const beam = (): CollisionWorld => makeWorld({ boxes: [aabb(-5, 1.4, -5, 5, 1.6, -3)] });

  it('blocks a standing player but lets a crouching one under', () => {
    const standing = setup(beam());
    standing.run(TICK_RATE * 2, FORWARD);
    expect(standing.c.z).toBeCloseTo(-3 + R);
    const crouching = setup(beam());
    crouching.run(TICK_RATE * 4, input({ moveY: 1, crouch: true }));
    expect(crouching.c.z).toBeLessThan(-5 - R);
  });

  it("can't stand up underneath", () => {
    const { c, run } = setup(beam(), 0, -4, 0, 1);
    // Start crouched, or the first tick pushes the standing capsule out from under it.
    c.height = MOVEMENT.crouchHeight;
    run(TICK_RATE, input({ crouch: true }));
    expect(c.height).toBe(MOVEMENT.crouchHeight);
    run(TICK_RATE);
    expect(c.height).toBeLessThanOrEqual(1.4);
    expect(c.height).toBeGreaterThan(1.39);
    run(TICK_RATE, input({ moveY: 1 }));
    expect(c.z).toBeLessThan(-5);
    expect(c.height).toBe(MOVEMENT.standHeight);
  });

  it('stands up to sprint', () => {
    const { c, run } = setup(makeWorld());
    run(TICK_RATE, input({ crouch: true }));
    run(TICK_RATE, input({ crouch: true, sprint: true, moveY: 1 }));
    expect(c.height).toBe(MOVEMENT.standHeight);
  });
});

describe('prone', () => {
  it('lies down, crawls slowly and gets back up', () => {
    const { c, run } = setup(makeWorld());
    run(TICK_RATE, input({ prone: true }));
    expect(c.height).toBe(MOVEMENT.proneHeight);
    run(TICK_RATE, input({ prone: true, moveY: 1 }));
    expect(Math.hypot(c.vx, c.vz)).toBeCloseTo(MOVEMENT.proneSpeed);
    run(TICK_RATE);
    expect(c.height).toBe(MOVEMENT.standHeight);
  });

  it('wins over crouch, and gets up to sprint', () => {
    const { c, run } = setup(makeWorld());
    run(TICK_RATE, input({ prone: true, crouch: true }));
    expect(c.height).toBe(MOVEMENT.proneHeight);
    run(TICK_RATE, input({ prone: true, sprint: true, moveY: 1 }));
    expect(c.height).toBe(MOVEMENT.standHeight);
  });

  it('crawls under a gap too low to crouch under', () => {
    const world = makeWorld({ boxes: [aabb(-5, 0.8, -5, 5, 1, -3)] });
    const { c, run } = setup(world);
    run(TICK_RATE, input({ prone: true }));
    run(TICK_RATE * 8, input({ prone: true, moveY: 1 }));
    expect(c.z).toBeLessThan(-5 - R);
    // Can't get up under it.
    const under = setup(world, 0, -4, 0, 0.5);
    under.c.height = MOVEMENT.proneHeight;
    under.run(TICK_RATE, input({ crouch: true }));
    expect(under.c.height).toBeLessThanOrEqual(0.8);
  });

  it("can't jump or vault", () => {
    const { c, run } = setup(makeWorld({ boxes: [aabb(-5, 0, -3.3, 5, 0.9, -3)] }), 0, -2.5);
    run(TICK_RATE, input({ prone: true }));
    expect(run(TICK_RATE, input({ prone: true, jump: true }))).toBe(0);
    expect(c.z).toBeGreaterThan(-3);
  });
});

describe('vaulting', () => {
  /**
   * A 3 m wall across z = −3 to −3 − thick, with a window from x = −w/2 to w/2 between
   * the sill and 2 m up.
   */
  function window(sill = 0.9, w = 1, thick = 0.3, extra: BoxDef[] = []): CollisionWorld {
    const z0 = -3 - thick;
    return makeWorld({
      boxes: [
        aabb(-5, 0, z0, 5, sill, -3),
        aabb(-5, sill, z0, -w / 2, 3, -3),
        aabb(w / 2, sill, z0, 5, 3, -3),
        aabb(-w / 2, 2, z0, w / 2, 3, -3),
        ...extra,
      ],
    });
  }
  const JUMP = input({ jump: true });

  it('vaults through a window to the floor beyond', () => {
    const { c, run } = setup(window(), 0.2, -2.5);
    run(1, JUMP);
    expect(c.mode).toBe('vault');
    const top = run(TICK_RATE, JUMP);
    expect(top).toBeCloseTo(0.9);
    expect(c.mode).toBe('ground');
    expect(c.y).toBe(0);
    expect(c.z).toBeLessThan(-3.3 - R + 1e-6);
    // Slid sideways to fit the opening.
    expect(Math.abs(c.x)).toBeLessThanOrEqual(0.5 - R);
    expect(c.height).toBe(MOVEMENT.standHeight);
  });

  it('ducks halfway, so the eye stays under the window top', () => {
    const { c, run } = setup(window(), 0, -2.5);
    let eye = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      run(1, JUMP);
      eye = Math.max(eye, c.y + c.height - MOVEMENT.eyeBelowTop);
    }
    expect(eye).toBeLessThan(2);
  });

  it('vaults from a crouch, and over a low wall', () => {
    const crouched = setup(window(), 0, -2.5);
    crouched.run(TICK_RATE, input({ crouch: true }));
    crouched.run(TICK_RATE, input({ crouch: true, jump: true }));
    expect(crouched.c.z).toBeLessThan(-3.3);
    expect(crouched.c.height).toBe(MOVEMENT.crouchHeight);

    const wall = setup(makeWorld({ boxes: [aabb(-5, 0, -3.3, 5, 0.7, -3)] }), 0, -2.5);
    wall.run(TICK_RATE, JUMP);
    expect(wall.c.z).toBeLessThan(-3.3);
    expect(wall.c.y).toBe(0);
  });

  it('lands crouched where there is no room to stand', () => {
    const { c, run } = setup(window(0.9, 1, 0.3, [aabb(-5, 1.75, -6, 5, 1.9, -3.3)]), 0, -2.5);
    run(TICK_RATE, JUMP);
    expect(c.z).toBeLessThan(-3.3);
    expect(c.height).toBeLessThanOrEqual(1.75);
  });

  it('jumps instead when it can’t vault', () => {
    const cases: [string, CollisionWorld, number][] = [
      ['a solid wall', makeWorld({ boxes: [aabb(-5, 0, -3.3, 5, 3, -3)] }), -2.5],
      ['a window too narrow', window(0.9, 0.5), -2.5],
      ['a sill too high', window(1.3), -2.5],
      ['a wall too thick', window(0.9, 1, 1.2), -2.5],
      ['no room beyond', window(0.9, 1, 0.3, [aabb(-5, 0, -4, 5, 3, -3.3)]), -2.5],
      ['too far away', window(), -1.5],
    ];
    for (const [what, world, z] of cases) {
      const { c, run } = setup(world, 0, z);
      run(1, JUMP);
      expect(c.mode, what).toBe('air');
      run(TICK_RATE, JUMP);
      expect(c.z, what).toBeGreaterThan(-3);
    }
  });

  it('only vaults what it faces', () => {
    const { c, run } = setup(window(), 0, -2.5, Math.PI);
    run(1, input({ jump: true, yaw: Math.PI }));
    expect(c.mode).toBe('air');
  });
});

describe('ladders', () => {
  // A 4 m block from z = −15 to −5, with a ladder on its +z face.
  const ladder: LadderDef = { x: 0, z: -5, yaw: 0, halfWidth: 0.3, bottom: 0, top: 4 };
  const ladderWorld = (): CollisionWorld =>
    makeWorld({ boxes: [aabb(-5, 0, -15, 5, 4, -5)], ladders: [ladder] });

  it('climbs up and over the top, then back down', () => {
    const { c, run } = setup(ladderWorld(), 0, -3);
    run(TICK_RATE, FORWARD);
    expect(c.mode).toBe('ladder');
    run(TICK_RATE * 3, FORWARD);
    expect(c.mode).toBe('ground');
    expect(c.y).toBe(4);
    expect(c.z).toBeLessThan(-5);

    // Backing off the edge grabs the ladder and climbs down.
    run(TICK_RATE * 2, BACK);
    expect(c.mode).toBe('ladder');
    run(TICK_RATE * 3, BACK);
    expect(c.mode).toBe('ground');
    expect(c.y).toBe(0);
    expect(c.z).toBeGreaterThan(-5);
  });

  it('climbs whichever way you look: pushing towards the wall goes up', () => {
    const { c, run } = setup(ladderWorld(), 0, -3);
    run(TICK_RATE, FORWARD);
    // Turn around (face +z) and pull the stick back: still towards the wall.
    run(TICK_RATE / 2, input({ moveY: -1, yaw: Math.PI }));
    expect(c.mode).toBe('ladder');
    expect(c.y).toBeGreaterThan(1);
  });

  it("doesn't grab a ladder when walking past it", () => {
    const { c, run } = setup(ladderWorld(), -3, -4.5, -Math.PI / 2);
    run(TICK_RATE * 2, input({ moveY: 1, yaw: -Math.PI / 2 }));
    expect(c.mode).toBe('ground');
    expect(c.x).toBeGreaterThan(2);
  });

  it('lets go when jumping', () => {
    const { c, run } = setup(ladderWorld(), 0, -3);
    run(TICK_RATE * 2, FORWARD);
    expect(c.mode).toBe('ladder');
    const y = c.y;
    run(1, input({ jump: true }));
    expect(c.mode).toBe('air');
    run(TICK_RATE * 2);
    expect(c.mode).toBe('ground');
    expect(c.y).toBe(0);
    expect(y).toBeGreaterThan(1);
  });
});

describe('terrain slopes', () => {
  /** Flat for x < 0, then rising with the given slope towards +x. */
  function slopeWorld(slope: number): CollisionWorld {
    const heights: number[] = [];
    for (let j = 0; j <= 50; j++)
      for (let i = 0; i <= 50; i++) heights.push(Math.max(0, -50 + i * 2) * slope);
    return new CollisionWorld({
      terrain: { minX: -50, minZ: -50, cellSize: 2, cols: 50, rows: 50, heights },
      boxes: [],
      ramps: [],
      ladders: [],
    });
  }
  const EAST = input({ moveY: 1, yaw: -Math.PI / 2 });

  it('walks up a gentle slope', () => {
    const { c, run } = setup(slopeWorld(0.5), -2);
    run(TICK_RATE * 2, EAST);
    expect(c.x).toBeGreaterThan(4);
    expect(c.y).toBeCloseTo(c.x * 0.5, 5);
  });

  it("can't walk up a steep one, but can come down it", () => {
    const { c, run } = setup(slopeWorld(2), -2);
    run(TICK_RATE * 2, EAST);
    expect(c.x).toBeLessThan(0.3);
    expect(c.y).toBeLessThan(0.6);
    const top = setup(slopeWorld(2), 5);
    top.run(TICK_RATE * 2, input({ moveY: 1, yaw: Math.PI / 2 }));
    expect(top.c.y).toBe(0);
  });
});

describe('state', () => {
  it('continues identically after a JSON round trip', () => {
    const world = makeWorld({ boxes: [aabb(-2, 0, -6, 2, 1, -3)] });
    const script = (t: number): PlayerInput =>
      input({
        moveY: 1,
        moveX: Math.sin(t / 10),
        yaw: t / 50,
        jump: t % 40 === 20,
        crouch: t % 90 > 60,
      });
    const a = createState(9);
    const id = spawnCharacter(a, world, 0, 0).id;
    for (let t = 0; t < 50; t++) step(a, world, NO_ITEMS, { [id]: script(t) });
    const b = JSON.parse(JSON.stringify(a)) as SimState;
    for (let t = 50; t < 200; t++) {
      step(a, world, NO_ITEMS, { [id]: script(t) });
      step(b, world, NO_ITEMS, { [id]: script(t) });
    }
    expect(b).toEqual(a);
    expect(a.tick).toBe(200);
  });
});

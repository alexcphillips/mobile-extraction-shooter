import { describe, expect, it } from 'vitest';
import type { EnemySkill } from '../content/enemies';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { AI, DEFAULT_SKILL, spawnEnemy, updateAi } from './ai';
import { createItem } from './create-item';
import { stow } from './gear';
import { CHEST, killCharacter, shootCharacter } from './health';
import { MOVEMENT, moveCharacter } from './movement';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { giveWeapon } from './weapons';
import { ammoDef } from '../content/items';

/*
 * Jug (AI-7; design.md → AI → Jug): the sprint-slide, his hearing, checking noises boldly,
 * charging rather than taking cover, and the hunt along your path once you've hit him.
 */

function makeWorld(boxes: BoxDef[] = [], half = 60): CollisionWorld {
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
function wall(x0: number, z0: number, x1: number, z1: number, height = 3): BoxDef {
  return {
    x: (x0 + x1) / 2,
    y: height / 2,
    z: (z0 + z1) / 2,
    hx: Math.max(0.2, Math.abs(x1 - x0) / 2),
    hy: height / 2,
    hz: Math.max(0.2, Math.abs(z1 - z0) / 2),
    yaw: 0,
  };
}

const JUG_SKILL: EnemySkill = {
  ...DEFAULT_SKILL,
  holdChance: 0,
  hearing: 2,
  bold: true,
  charge: true,
  slide: true,
  relentless: true,
};

function jug(
  state: SimState,
  world: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  skill: EnemySkill = JUG_SKILL,
): Character {
  const c = spawnEnemy(state, world, x, 0, z, yaw, { faction: 'boss', skill });
  giveWeapon(c, items, 'rifle');
  stow(c, items, createItem(items, 'round', 300));
  return c;
}

/** You, at (x, z), too tough to die. */
function you(state: SimState, world: CollisionWorld, x: number, z: number, y?: number): Character {
  const c = spawnCharacter(state, world, x, z, 0, y);
  c.health.hp.fill(1e6);
  return c;
}

function run(
  state: SimState,
  world: CollisionWorld,
  nav: NavGrid,
  seconds: number,
  each?: () => void,
  inputs: () => Record<number, PlayerInput> = () => ({}),
): void {
  for (let i = 0; i < seconds * TICK_RATE; i++) {
    step(state, world, items, inputs(), nav);
    each?.();
  }
}

function stand(): PlayerInput {
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
  };
}

/** Input walking (or sprinting) c towards (x, z), or standing once there. */
function toward(c: Character, x: number, z: number, sprint = false): PlayerInput {
  const input = stand();
  const d = Math.hypot(x - c.x, z - c.z);
  if (d < 0.3) return input;
  input.yaw = Math.atan2(-(x - c.x), -(z - c.z));
  input.moveY = 1;
  input.sprint = sprint;
  return input;
}

/** You hit c with a round, as from a gun: it knows straight away. */
function hit(state: SimState, world: CollisionWorld, nav: NavGrid, c: Character, by: Character) {
  state.events.length = 0;
  shootCharacter(state, items, c, CHEST, { ...ammoDef(items, 'round'), damage: 1 }, by.id);
  updateAi(state, world, items, nav);
}

describe('the sprint-slide', () => {
  /** Sprints c forward (−z) a second, presses slide, and measures what follows. */
  function slideOf(c: Character, world: CollisionWorld) {
    const input = stand();
    input.moveY = 1;
    input.sprint = true;
    for (let i = 0; i < TICK_RATE; i++) moveCharacter(c, input, world);
    input.sprint = false;
    input.slide = true;
    const z0 = c.z;
    moveCharacter(c, input, world);
    input.slide = false;
    let ticks = 1;
    let low = c.height;
    while (c.slide && ticks < 5 * TICK_RATE) {
      moveCharacter(c, input, world);
      low = Math.min(low, c.height);
      ticks++;
    }
    return { slid: ticks > 1, distance: z0 - c.z, seconds: ticks / TICK_RATE, low };
  }

  it('goes low and fast for under a second, only for an enemy with the skill', () => {
    const world = makeWorld();
    const state = createState(1);
    const s = slideOf(jug(state, world, 0, 30, 0), world);
    expect(s.slid).toBe(true);
    expect(s.seconds).toBeCloseTo(MOVEMENT.slideTime, 1);
    // Faster than a walk from the slide's time: 3–4.5 m.
    expect(s.distance).toBeGreaterThan(3);
    expect(s.distance).toBeLessThan(4.5);
    expect(s.low).toBeLessThanOrEqual(MOVEMENT.slideHeight + 0.01);

    // A player pressing it, or another enemy, doesn't slide.
    for (const c of [
      spawnCharacter(state, world, 10, 30),
      spawnEnemy(state, world, 20, 0, 30, 0, { skill: DEFAULT_SKILL }),
    ]) {
      const other = slideOf(c, world);
      expect(other.slid).toBe(false);
      expect(c.slide ?? null).toBeNull();
    }
  });

  it('ends against a wall in the way', () => {
    // A wall 2.5 m past where the sprint ends.
    const world = makeWorld([wall(-3, 21, 3, 21)]);
    const state = createState(1);
    const c = jug(state, world, 0, 30, 0);
    const s = slideOf(c, world);
    expect(s.slid).toBe(true);
    expect(s.seconds).toBeLessThan(MOVEMENT.slideTime - 0.2);
    expect(c.z).toBeGreaterThan(21);
  });
});

describe('Jug', () => {
  it('hears footsteps twice as far as anyone', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const heard = (skill: EnemySkill): boolean => {
      const state = createState(3);
      // Facing away (−z), you sprinting across 25 m behind it.
      const c = jug(state, world, 0, 0, 0, skill);
      const me = you(state, world, -10, 25);
      run(state, world, nav, 1.5, undefined, () => ({ [me.id]: toward(me, 10, 25, true) }));
      return c.ai!.awareness !== 'unaware';
    };
    expect(heard(JUG_SKILL)).toBe(true);
    expect(heard(DEFAULT_SKILL)).toBe(false);
  });

  it('checks gunfire straight away at a walk, past the responder cap, without stopping to watch', () => {
    // You fire behind a wall 30 m off; of three scavs nearer it, two go to check (the cap).
    const world = makeWorld([wall(-6, -26, 6, -26)]);
    const nav = new NavGrid(world);
    const check = (skill: EnemySkill) => {
      const state = createState(4);
      const scavs = [-4, 0, 4].map((x) => spawnEnemy(state, world, x, 0, -14, 0, {}));
      const c = jug(state, world, 0, 2, 0, skill);
      const me = you(state, world, 0, -30);
      giveWeapon(me, items, 'rifle');
      const shoot = stand();
      shoot.fire = true;
      shoot.pitch = 1;
      run(state, world, nav, 0.2, undefined, () => ({ [me.id]: shoot }));
      expect(scavs.filter((s) => s.ai!.investigate)).toHaveLength(AI.responders);
      const activities = new Set<string>();
      let fastest = 0;
      run(state, world, nav, 6, () => {
        activities.add(c.ai!.activity);
        fastest = Math.max(fastest, Math.hypot(c.vx, c.vz));
      });
      return { going: c.ai!.investigate, activities, fastest, z: c.z };
    };
    const bold = check(JUG_SKILL);
    expect(bold.going).toBe(true);
    expect(bold.activities.has('watch')).toBe(false);
    expect(bold.fastest).toBeGreaterThan(MOVEMENT.walkSpeed * 0.9);
    // In 6 s it's covered most of the way.
    expect(bold.z).toBeLessThan(-12);

    // An ordinary boss is held back by the cap and stays put.
    const held = check({ ...DEFAULT_SKILL, hearing: 2 });
    expect(held.going).toBe(false);
    expect(held.z).toBeGreaterThan(0);
  });

  it('walks at you firing, never into cover, and slides in firing', () => {
    const world = makeWorld();
    const nav = new NavGrid(world);
    const state = createState(6);
    const c = jug(state, world, 0, 0, 0);
    const me = you(state, world, 0, -28);
    let slides = 0;
    let shotSliding = 0;
    let wasSliding = false;
    let closest = Infinity;
    const activities = new Set<string>();
    run(state, world, nav, 12, () => {
      // Hurt every so often: it still doesn't hide.
      if (state.tick % TICK_RATE === 0) c.ai!.hurt = true;
      activities.add(c.ai!.activity);
      if (c.slide && !wasSliding) slides++;
      wasSliding = !!c.slide;
      if (c.slide && state.events.some((e) => e.type === 'shot' && e.by === c.id)) shotSliding++;
      closest = Math.min(closest, Math.hypot(me.x - c.x, me.z - c.z));
    });
    expect(c.ai!.awareness).toBe('alert');
    expect(activities.has('takeCover')).toBe(false);
    expect(activities.has('cover')).toBe(false);
    expect(slides).toBeGreaterThanOrEqual(1);
    expect(shotSliding).toBeGreaterThan(0);
    expect(closest).toBeLessThan(5);
  });

  /**
   * Two long walls east–west, 12 m apart: Jug south of the first, you between them, out of
   * his sight. Your way out: west past their ends, north round the second, then back east.
   */
  const corridors = (): CollisionWorld => makeWorld([wall(-30, 0, 30, 0), wall(-30, -12, 30, -12)]);
  const ROUTE = [
    [-34, -4],
    [-34, -20],
    [-8, -20],
  ] as const;

  /**
   * You running ROUTE a leg at a time, from leg `start`: the inputs, a step to call after
   * each tick, and the leg you're on.
   */
  function runRoute(me: Character, start = 0) {
    let leg = start;
    return {
      leg: () => leg,
      inputs: () => {
        const [x, z] = ROUTE[leg]!;
        return { [me.id]: toward(me, x, z, true) };
      },
      after: () => {
        const [x, z] = ROUTE[leg]!;
        if (leg < ROUTE.length - 1 && Math.hypot(me.x - x, me.z - z) < 0.5) leg++;
      },
    };
  }

  it('once hit, hunts you along the way you went, unlike anyone else', () => {
    const chase = (skill: EnemySkill) => {
      const world = corridors();
      const nav = new NavGrid(world);
      const state = createState(7);
      const c = jug(state, world, 0, 6, 0, skill);
      const me = you(state, world, 0, -4);
      hit(state, world, nav, c, me);
      const r = runRoute(me);
      let corner = Infinity;
      const activities = new Set<string>();
      run(
        state,
        world,
        nav,
        45,
        () => {
          r.after();
          activities.add(c.ai!.activity);
          corner = Math.min(corner, Math.hypot(c.x - ROUTE[0][0], c.z - ROUTE[0][1]));
        },
        r.inputs,
      );
      return { state, world, nav, c, me, corner, activities };
    };
    // Round the walls' end the way you went, never searching, and on to you.
    const { state, world, nav, c, me, corner, activities } = chase(JUG_SKILL);
    expect(c.ai!.quarry).toBe(me.id);
    expect(corner).toBeLessThan(4);
    expect(activities.has('search')).toBe(false);
    expect(c.ai!.awareness).toBe('alert');
    expect(c.ai!.seesTarget).toBe(true);
    expect(Math.hypot(c.x - me.x, c.z - me.z)).toBeLessThan(10);

    // An ordinary boss goes to where it was hit from, searches about, and loses you.
    const other = chase(DEFAULT_SKILL);
    expect(other.activities.has('search')).toBe(true);
    expect(other.c.ai!.awareness).not.toBe('alert');
    expect(Math.hypot(other.c.x - other.me.x, other.c.z - other.me.z)).toBeGreaterThan(15);

    // Over once you're dead.
    killCharacter(state, me, 0);
    run(state, world, nav, 1);
    expect(c.ai!.quarry ?? 0).toBe(0);
  });

  it('never gives up a hunt on you out of reach, unlike anyone else', () => {
    // You shut in a walled pen with no way in.
    const world = makeWorld([
      wall(-3, -13, 3, -13),
      wall(-3, -7, 3, -7),
      wall(-3, -13, -3, -7),
      wall(3, -13, 3, -7),
    ]);
    const nav = new NavGrid(world);
    const hunts = (skill: EnemySkill): boolean => {
      const state = createState(8);
      const c = jug(state, world, 0, 8, 0, skill);
      const me = you(state, world, 0, -10);
      hit(state, world, nav, c, me);
      let calmed = false;
      run(state, world, nav, AI.giveUp + 15, () => (calmed ||= c.ai!.awareness !== 'alert'));
      expect(c.ai!.reachable).toBe(false);
      return !calmed && c.ai!.target === me.id;
    };
    expect(hunts(JUG_SKILL)).toBe(true);
    expect(hunts({ ...JUG_SKILL, relentless: false })).toBe(false);
  });

  it('a raid saved mid-hunt carries on the same', () => {
    const world = corridors();
    const nav = new NavGrid(world);
    const state = createState(9);
    const c = jug(state, world, 0, 6, 0);
    const me = you(state, world, 0, -4);
    hit(state, world, nav, c, me);
    const r = runRoute(me);
    run(state, world, nav, 3, r.after, r.inputs);
    expect(c.ai!.seesTarget).toBe(false);
    expect(c.ai!.trail!.length).toBeGreaterThan(3);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    const meCopy = copy.entities.find((e) => e.id === me.id)!;
    const rc = runRoute(meCopy, r.leg());
    run(state, world, nav, 4, r.after, r.inputs);
    run(copy, world, nav, 4, rc.after, rc.inputs);
    expect(copy.entities.map((e) => [e.x, e.z])).toEqual(state.entities.map((e) => [e.x, e.z]));
  });
});

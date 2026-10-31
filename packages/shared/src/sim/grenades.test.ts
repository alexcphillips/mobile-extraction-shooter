import { describe, expect, it } from 'vitest';
import { grenadeDef } from '../content/items';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { carriedAmmo, stow } from './gear';
import { GRENADE, blastShare, carriedGrenades } from './grenades';
import { CHEST, HEAD, TOTAL_HP, totalHp } from './health';
import {
  createState,
  spawnCharacter,
  type Character,
  type PlayerInput,
  type SimState,
} from './state';
import { step } from './step';
import { TEST_ITEMS } from './test-items';
import { giveWeapon } from './weapons';

function makeWorld(boxes: BoxDef[] = []): CollisionWorld {
  return new CollisionWorld({
    terrain: {
      minX: -50,
      minZ: -50,
      cellSize: 2,
      cols: 50,
      rows: 50,
      heights: Array(51 * 51).fill(0),
    },
    boxes,
    ramps: [],
    ladders: [],
  });
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

/** A thrower at the origin facing −z with `n` grenades in its pockets. */
function setup(n = 1, boxes: BoxDef[] = []) {
  const world = makeWorld(boxes);
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  for (let i = 0; i < n; i++) stow(c, TEST_ITEMS, { item: 'grenade', count: 1 });
  return { world, state, c };
}

function run(state: SimState, world: CollisionWorld, ticks: number, inputs = {}): void {
  for (let i = 0; i < ticks; i++) step(state, world, TEST_ITEMS, inputs);
}

const FUSE_TICKS = Math.round(grenadeDef(TEST_ITEMS, 'grenade').fuse * TICK_RATE);

describe('throwing', () => {
  it('throws the first grenade carried, once per press and cooldown', () => {
    const { world, state, c } = setup(2);
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(2);
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    expect(state.grenades).toHaveLength(1);
    expect(state.events.some((e) => e.type === 'throw' && e.by === c.id)).toBe(true);
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(1);
    // Pressed again straight away: still cooling down.
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    expect(state.grenades).toHaveLength(1);
    run(state, world, Math.ceil(GRENADE.cooldown * TICK_RATE));
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    expect(state.grenades).toHaveLength(2);
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(0);
  });

  it('does nothing with none carried', () => {
    const { world, state, c } = setup(0);
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    expect(state.grenades).toHaveLength(0);
  });

  it('keeps the grenade with the infinite consumables cheat', () => {
    const { world, state, c } = setup(1);
    c.admin = {
      infiniteHealth: true,
      infiniteAmmo: false,
      peaceful: false,
      infiniteConsumables: true,
    };
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    expect(state.grenades).toHaveLength(1);
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(1);
  });

  it('flies along the look, lofted, and comes to rest on the ground', () => {
    const { world, state, c } = setup();
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    const g = state.grenades[0]!;
    expect(g.vz).toBeLessThan(-10);
    expect(g.vy).toBeGreaterThan(0);
    run(state, world, FUSE_TICKS - 10);
    expect(g.resting).toBe(true);
    expect(g.z).toBeLessThan(-8);
    expect(g.y).toBeCloseTo(GRENADE.size, 2);
  });
});

describe('bouncing', () => {
  it('bounces back off a wall', () => {
    // A wall 3 m ahead, taller than the throw.
    const wall = { x: 0, y: 3, z: -3.2, hx: 5, hy: 3, hz: 0.2, yaw: 0 };
    const { world, state, c } = setup(1, [wall]);
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    let bounced = false;
    for (let i = 0; i < FUSE_TICKS - 10; i++) {
      step(state, world, TEST_ITEMS, {});
      bounced ||= state.events.some((e) => e.type === 'bounce');
    }
    const g = state.grenades[0]!;
    expect(bounced).toBe(true);
    // Back on the thrower's side, never through.
    expect(g.z).toBeGreaterThan(-3);
    expect(g.resting).toBe(true);
  });
});

describe('going off', () => {
  /** A grenade lying still at (x, z), as if thrown there, with its fuse nearly out. */
  function place(state: SimState, by: Character, x: number, z: number, fuse = 0.01) {
    state.grenades.push({
      id: state.nextId++,
      item: 'grenade',
      by: by.id,
      x,
      y: GRENADE.size,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      fuse,
      resting: true,
    });
  }

  it('goes off after its fuse from the throw, and is gone', () => {
    const { world, state, c } = setup();
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    let at = -1;
    for (let i = 1; i < FUSE_TICKS + 5 && at < 0; i++) {
      step(state, world, TEST_ITEMS, {});
      if (state.events.some((e) => e.type === 'explosion')) at = i;
    }
    // The throw's tick counts down too.
    expect(at).toBe(FUSE_TICKS - 1);
    expect(state.grenades).toHaveLength(0);
  });

  it('kills close by, hurts further out, and misses beyond the radius', () => {
    const { world, state, c } = setup(0);
    const close = spawnCharacter(state, world, 20, 1);
    const mid = spawnCharacter(state, world, 20, 5);
    const far = spawnCharacter(state, world, 20, 8);
    place(state, c, 20, 0);
    step(state, world, TEST_ITEMS, {});
    expect(close.health.dead).toBe(true);
    expect(mid.health.dead).toBe(false);
    expect(totalHp(mid.health)).toBeLessThan(TOTAL_HP);
    expect(totalHp(far.health)).toBe(TOTAL_HP);
    // The thrower, 20 m away, is fine; the hits are credited to it.
    expect(totalHp(c.health)).toBe(TOTAL_HP);
    const hits = state.events.filter((e) => e.type === 'damage');
    expect(hits.every((e) => e.type === 'damage' && e.by === c.id && e.cause === 'explosion')).toBe(
      true,
    );
    expect(hits.some((e) => e.type === 'damage' && e.target === mid.id && e.zone === HEAD)).toBe(
      true,
    );
    expect(hits.some((e) => e.type === 'damage' && e.target === mid.id && e.zone === CHEST)).toBe(
      true,
    );
  });

  it('is stopped by a wall in the way', () => {
    const wall = { x: 20, y: 2, z: 1.5, hx: 3, hy: 2, hz: 0.1, yaw: 0 };
    const { world, state, c } = setup(0, [wall]);
    const hidden = spawnCharacter(state, world, 20, 2.5);
    place(state, c, 20, 0);
    step(state, world, TEST_ITEMS, {});
    expect(totalHp(hidden.health)).toBe(TOTAL_HP);
  });

  it('falls off from full near the middle to nothing at the radius', () => {
    const { world, state } = setup(0);
    const def = grenadeDef(TEST_ITEMS, 'grenade');
    const at = (z: number): number => {
      const t = spawnCharacter(state, world, 0, z);
      return blastShare(world, def, 0, GRENADE.size + GRENADE.lift, 0, t);
    };
    expect(at(1)).toBe(1);
    expect(at(4)).toBeGreaterThan(0.2);
    expect(at(4)).toBeLessThan(0.8);
    expect(at(def.radius + 0.1)).toBe(0);
  });

  it('survives a JSON save and restore in flight', () => {
    const { world, state, c } = setup();
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true }) });
    run(state, world, 10);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, 40);
    run(copy, world, 40);
    expect(copy.grenades).toEqual(state.grenades);
  });
});

describe('grenade launcher', () => {
  /** A shooter at the origin facing −z with a loaded launcher and `n` spare grenades. */
  function armed(n = 0) {
    const s = setup(n);
    const w = giveWeapon(s.c, TEST_ITEMS, 'launcher');
    return { ...s, w };
  }

  it('fires a grenade per pull, much faster than a throw, with a shot event and no hit', () => {
    const { world, state, c, w } = armed();
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
    expect(w.mag).toBe(5);
    expect(state.grenades).toHaveLength(1);
    const g = state.grenades[0]!;
    expect(g.by).toBe(c.id);
    expect(Math.hypot(g.vx, g.vy, g.vz)).toBeCloseTo(40, 0);
    const shot = state.events.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ hit: 'none', grenade: g.id, loudness: 120 });
    expect(state.events.some((e) => e.type === 'throw')).toBe(false);
    // Semi: holding the trigger fires no more.
    run(state, world, 60, { [c.id]: input({ fire: true }) });
    expect(w.mag).toBe(5);
  });

  /** Ticks until the first explosion, and the explosion, or null. */
  function untilExplosion(state: SimState, world: CollisionWorld) {
    for (let i = 0; i < FUSE_TICKS + 5; i++) {
      step(state, world, TEST_ITEMS, {});
      for (const e of state.events) if (e.type === 'explosion') return { tick: i, e };
    }
    return null;
  }

  it('goes off where it first lands, far beyond where a throw lands, armed by then', () => {
    const { world, state, c } = armed();
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
    const hit = untilExplosion(state, world)!;
    // Well before its fuse, on the ground; a level throw lands at about 8 m.
    expect(hit.tick).toBeLessThan(FUSE_TICKS / 2);
    expect(-hit.e.z).toBeGreaterThan(30);
    expect(hit.e.y).toBeLessThan(0.5);
    expect(state.grenades).toHaveLength(0);
  });

  it("bounces off a wall it hits before it's armed, and goes off on its fuse", () => {
    const wall = { x: 0, y: 3, z: -5.2, hx: 5, hy: 3, hz: 0.2, yaw: 0 };
    const world = makeWorld([wall]);
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    giveWeapon(c, TEST_ITEMS, 'launcher');
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
    let bounced = false;
    let at = -1;
    for (let i = 0; i < FUSE_TICKS + 5 && at < 0; i++) {
      step(state, world, TEST_ITEMS, {});
      bounced ||= state.events.some((e) => e.type === 'bounce');
      if (state.events.some((e) => e.type === 'explosion')) at = i;
    }
    expect(bounced).toBe(true);
    // On its fuse (the shot's tick counts down too, and i counts from 0 here).
    expect(at).toBe(FUSE_TICKS - 2);
  });

  it('goes off on someone it hits once armed, passing through anyone closer', () => {
    const { world, state, c } = armed();
    const near = spawnCharacter(state, world, 0, -5);
    const far = spawnCharacter(state, world, 0, -20);
    // Aimed a little low, against the loft, so it reaches the far one's chest.
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true, pitch: -0.07 }) });
    const hit = untilExplosion(state, world)!;
    expect(Math.abs(hit.e.z - far.z)).toBeLessThan(1);
    expect(hit.e.y).toBeGreaterThan(0.5);
    expect(far.health.dead).toBe(true);
    // The near one was flown through, and is beyond the blast.
    expect(totalHp(near.health)).toBe(TOTAL_HP);
  });

  it('reloads from the grenades carried, and those are what the throw button counts', () => {
    const { world, state, c, w } = armed(3);
    w.mag = 0;
    step(state, world, TEST_ITEMS, { [c.id]: input({ reload: true }) });
    expect(w.reloading).toBeGreaterThan(0);
    run(state, world, 5 * TICK_RATE + 1);
    expect(w.mag).toBe(3);
    expect(carriedAmmo(c, 'grenade')).toBe(0);
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(0);
  });

  it('survives a JSON save and restore with a grenade in flight', () => {
    const { world, state, c } = armed();
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
    run(state, world, 5);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, 30);
    run(copy, world, 30);
    expect(copy.grenades).toEqual(state.grenades);
  });
});

import { describe, expect, it } from 'vitest';
import { ammoDef, firesRound, grenadeDef, roundOf, weaponDef } from '../content/items';
import { NavGrid } from '../nav/nav-grid';
import { findPath } from '../nav/path';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef } from '../world/collision-world';
import { DEFAULT_SKILL, spawnEnemy } from './ai';
import { FIRE } from './fire';
import { carriedGrenades } from './grenades';
import { stow } from './gear';
import { TOTAL_HP, totalHp } from './health';
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

const FUEL = ammoDef(TEST_ITEMS, 'fuel').flame!;
/** A wall across the way 6 m in front of the origin, facing it. */
const WALL: BoxDef = { x: 0, y: 2, z: -6.2, hx: 5, hy: 2, hz: 0.2, yaw: 0 };

/** A shooter at the origin facing −z with a full flamethrower. */
function setup(boxes: BoxDef[] = []) {
  const world = makeWorld(boxes);
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  const w = giveWeapon(c, TEST_ITEMS, 'flamer');
  return { world, state, c, w };
}

function run(state: SimState, world: CollisionWorld, ticks: number, inputs = {}): void {
  for (let i = 0; i < ticks; i++) step(state, world, TEST_ITEMS, inputs);
}

const ticks = (seconds: number): number => Math.round(seconds * TICK_RATE);

/** Fires one flame (one tick on the trigger), then lets go. */
function burst(state: SimState, world: CollisionWorld, c: Character): void {
  step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
}

describe('flamethrower', () => {
  it('fires a flame per shot as a shot that goes nowhere, using fuel, doing no harm itself', () => {
    const { world, state, c, w } = setup();
    burst(state, world, c);
    expect(w.mag).toBe(99);
    expect(state.flames).toHaveLength(1);
    const f = state.flames[0]!;
    expect(f.by).toBe(c.id);
    expect(Math.hypot(f.vx, f.vy, f.vz)).toBeCloseTo(FUEL.speed, 0);
    const shot = state.events.find((e) => e.type === 'shot');
    expect(shot).toMatchObject({ hit: 'none', flame: f.id, grenade: 0 });
  });

  it('burns out in the air at its range, a little lower, leaving no fire', () => {
    const { world, state, c } = setup();
    burst(state, world, c);
    let last = state.flames[0]!;
    for (let i = 0; i < TICK_RATE && state.flames.length; i++) {
      last = { ...state.flames[0]! };
      run(state, world, 1);
    }
    expect(state.flames).toHaveLength(0);
    expect(-last.z).toBeGreaterThan(13);
    expect(-last.z).toBeLessThanOrEqual(15);
    expect(last.y).toBeLessThan(1.4);
    expect(last.y).toBeGreaterThan(0.2);
    expect(state.fires).toHaveLength(0);
  });

  it('leaves fire where it hits the map, for its fireTime, fed rather than doubled', () => {
    const { world, state, c } = setup([WALL]);
    // Three flames (one every 3 ticks), all landing about the same spot on the wall.
    run(state, world, 9, { [c.id]: input({ fire: true }) });
    while (state.flames.length) run(state, world, 1);
    expect(state.fires).toHaveLength(1);
    const p = state.fires[0]!;
    expect(p.z).toBeGreaterThan(-6 - 0.01);
    expect(p.z).toBeLessThan(-5.9);
    expect(p.time).toBe(FUEL.fireTime);
    run(state, world, ticks(FUEL.fireTime) - 3);
    expect(state.fires).toHaveLength(1);
    run(state, world, 4);
    expect(state.fires).toHaveLength(0);
  });

  it('caps the fires burning at once', () => {
    const { world, state, c } = setup([WALL]);
    // Sweeping along the wall, each flame far enough from the last to light its own.
    // One flame every 3 ticks.
    for (let i = 0; i < FIRE.maxPatches + 10; i++) {
      const yaw = -0.6 + (1.2 * i) / (FIRE.maxPatches + 10);
      const pitch = -0.4 + (0.5 * ((i * 7) % 11)) / 11;
      run(state, world, 3, { [c.id]: input({ fire: true, yaw, pitch }) });
    }
    run(state, world, 20);
    expect(state.fires.length).toBeLessThanOrEqual(FIRE.maxPatches);
    expect(state.fires.length).toBeGreaterThan(FIRE.maxPatches / 2);
  });
});

describe('burning', () => {
  it('sets alight whoever a flame hits, who burns every zone for its burnTime', () => {
    const { world, state, c } = setup();
    const t = spawnCharacter(state, world, 0, -5);
    burst(state, world, c);
    let lit = false;
    for (let i = 0; i < 15 && !t.burn; i++) {
      run(state, world, 1);
      lit ||= state.events.some((e) => e.type === 'ignite' && e.target === t.id && e.by === c.id);
    }
    expect(lit).toBe(true);
    expect(t.burn).toMatchObject({ by: c.id, item: 'fuel' });
    expect(state.fires).toHaveLength(0);
    run(state, world, ticks(FUEL.burnTime) + 2);
    expect(t.burn).toBeNull();
    // Every zone, past armour: about burnDamage × 6 zones × burnTime.
    const lost = TOTAL_HP - totalHp(t.health);
    expect(lost).toBeCloseTo(FUEL.burnDamage * 6 * FUEL.burnTime, -1);
    expect(t.health.hp.every((hp, z) => hp < [35, 85, 60, 60, 65, 65][z]!)).toBe(true);
  });

  it('is lit again, not stacked, by more flames: one ignite event', () => {
    const { world, state, c } = setup();
    const t = spawnCharacter(state, world, 0, -5);
    let ignites = 0;
    for (let i = 0; i < 30; i++) {
      step(state, world, TEST_ITEMS, { [c.id]: input({ fire: i < 20 }) });
      ignites += state.events.filter((e) => e.type === 'ignite').length;
    }
    expect(ignites).toBe(1);
    expect(t.burn!.left).toBeGreaterThan(FUEL.burnTime - 1);
  });

  it('sets alight whoever walks into fire on the map, but not once it has burnt out', () => {
    const { world, state, c } = setup([WALL]);
    // Aimed at the foot of the wall, so the fire lies in the way along it.
    run(state, world, 1, { [c.id]: input({ fire: true, pitch: -0.25 }) });
    run(state, world, 20);
    expect(state.fires).toHaveLength(1);
    const p = state.fires[0]!;
    // In front of the wall, not on top of it.
    const walker = spawnCharacter(state, world, p.x + 3, p.z + 0.5);
    // Walking along the wall (−x, yaw π/2) through the fire.
    const walk = input({ yaw: Math.PI / 2, moveY: 1 });
    for (let i = 0; i < 60 && !walker.burn; i++) {
      step(state, world, TEST_ITEMS, { [walker.id]: walk });
    }
    expect(walker.burn).toMatchObject({ by: c.id });

    // A second walker, after it has gone out.
    run(state, world, ticks(FUEL.fireTime));
    expect(state.fires).toHaveLength(0);
    const late = spawnCharacter(state, world, p.x + 3, p.z + 0.5);
    for (let i = 0; i < 60; i++) step(state, world, TEST_ITEMS, { [late.id]: walk });
    expect(late.burn ?? null).toBeNull();
  });

  it('credits a death by burning to whoever lit it', () => {
    const { world, state, c } = setup();
    const t = spawnCharacter(state, world, 0, -5);
    t.health.hp[1] = 5;
    let by = -1;
    for (let i = 0; i < 6 * TICK_RATE && !t.health.dead; i++) {
      step(state, world, TEST_ITEMS, { [c.id]: input({ fire: i === 0 }) });
      for (const e of state.events) if (e.type === 'death' && e.target === t.id) by = e.by;
    }
    expect(t.health.dead).toBe(true);
    expect(by).toBe(c.id);
    expect(t.burn).toBeNull();
  });

  it('survives a JSON save and restore with flames flying and fire burning', () => {
    const { world, state, c } = setup([WALL]);
    spawnCharacter(state, world, 1, -3);
    run(state, world, 4, { [c.id]: input({ fire: true }) });
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    run(state, world, 40);
    run(copy, world, 40);
    expect(copy.flames).toEqual(state.flames);
    expect(copy.fires).toEqual(state.fires);
    expect(copy.entities).toEqual(state.entities);
  });
});

describe('putting yourself out', () => {
  /** Someone at the origin, alight, with a rifle and a grenade. */
  function alight() {
    const world = makeWorld();
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    const w = giveWeapon(c, TEST_ITEMS, 'rifle');
    stow(c, TEST_ITEMS, { item: 'grenade', count: 1 });
    c.burn = { left: FUEL.burnTime, by: 0, item: 'fuel' };
    return { world, state, c, w };
  }

  it('puts the fire out after FIRE.extinguishTime, sooner than it burns out', () => {
    const { world, state, c } = alight();
    step(state, world, TEST_ITEMS, { [c.id]: input({ extinguish: true }) });
    expect(c.extinguish).toBeCloseTo(FIRE.extinguishTime, 5);
    run(state, world, ticks(FIRE.extinguishTime) - 2);
    expect(c.burn).not.toBeNull();
    run(state, world, 2);
    expect(c.burn).toBeNull();
    expect(c.extinguish).toBe(0);
    const lost = TOTAL_HP - totalHp(c.health);
    expect(lost).toBeCloseTo(FUEL.burnDamage * 6 * FIRE.extinguishTime, -1);
    expect(lost).toBeLessThan(FUEL.burnDamage * 6 * FUEL.burnTime * 0.5);
  });

  it("does nothing when you're not on fire", () => {
    const { world, state, c } = alight();
    c.burn = null;
    step(state, world, TEST_ITEMS, { [c.id]: input({ extinguish: true }) });
    expect(c.extinguish ?? 0).toBe(0);
  });

  it("can't fire, aim, reload, throw, heal or switch hands meanwhile", () => {
    const { world, state, c, w } = alight();
    w.mag = 10;
    step(state, world, TEST_ITEMS, { [c.id]: input({ extinguish: true }) });
    const busy = input({ fire: true, aim: true, throw: true, draw: 'knife' });
    run(state, world, 10, { [c.id]: busy });
    expect(w.mag).toBe(10);
    expect(c.aim).toBe(0);
    expect(state.grenades).toHaveLength(0);
    expect(c.gear.hand).toBe('primary1');
    w.mag = 0;
    step(state, world, TEST_ITEMS, { [c.id]: input({ reload: true }) });
    expect(w.reloading).toBe(0);
    // Out again: firing works.
    w.mag = 10;
    run(state, world, ticks(FIRE.extinguishTime));
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true }) });
    expect(w.mag).toBe(9);
  });

  it('stops a reload already going', () => {
    const { world, state, c, w } = alight();
    stow(c, TEST_ITEMS, { item: 'round', count: 30 });
    w.mag = 0;
    step(state, world, TEST_ITEMS, { [c.id]: input({ reload: true }) });
    expect(w.reloading).toBeGreaterThan(0);
    step(state, world, TEST_ITEMS, { [c.id]: input({ extinguish: true }) });
    expect(w.reloading).toBe(0);
  });

  it('walks slowly and never sprints', () => {
    const { world, state, c } = alight();
    step(state, world, TEST_ITEMS, { [c.id]: input({ extinguish: true }) });
    run(state, world, 10, { [c.id]: input({ moveY: 1, sprint: true }) });
    expect(Math.hypot(c.vx, c.vz)).toBeCloseTo(MOVEMENT.extinguishSpeed, 1);
  });
});

describe('enemies and fire', () => {
  function arena(boxes: BoxDef[] = []) {
    const world = makeWorld(boxes);
    const nav = new NavGrid(world);
    const state = createState(7);
    const enemy = spawnEnemy(state, world, 0, 0, 0, 0, { skill: DEFAULT_SKILL });
    return { world, nav, state, enemy };
  }

  it('puts itself out when alight, and is alarmed by whoever lit it', () => {
    const { world, nav, state, enemy } = arena();
    const player = spawnCharacter(state, world, 0, 8, Math.PI);
    giveWeapon(player, TEST_ITEMS, 'flamer');
    // Facing away from the player: only the fire tells it someone's there.
    enemy.yaw = 0;
    for (let i = 0; i < 20 && !enemy.burn; i++) {
      step(
        state,
        world,
        TEST_ITEMS,
        { [player.id]: input({ fire: i === 0, yaw: 0, pitch: -0.05 }) },
        nav,
      );
      player.yaw = 0;
    }
    // The player stands behind it (+z), firing towards −z, so it's hit in the back.
    expect(enemy.burn).toBeTruthy();
    for (let i = 0; i < 3; i++) step(state, world, TEST_ITEMS, {}, nav);
    expect(enemy.extinguish).toBeGreaterThan(0);
    expect(enemy.ai!.awareness).toBe('alert');
    expect(enemy.ai!.target).toBe(player.id);
    for (let i = 0; i < ticks(FIRE.extinguishTime) + 2; i++)
      step(state, world, TEST_ITEMS, {}, nav);
    expect(enemy.burn).toBeNull();
  });

  it('steps out of fire it stands in', () => {
    const { world, nav, state, enemy } = arena();
    state.fires.push({ id: 999, item: 'fuel', by: 0, x: 0.2, y: 0.05, z: 0, age: 0, time: 7 });
    for (let i = 0; i < TICK_RATE; i++) step(state, world, TEST_ITEMS, {}, nav);
    expect(Math.hypot(enemy.x - 0.2, enemy.z)).toBeGreaterThan(FIRE.patchRadius + MOVEMENT.radius);
  });

  it('plans its path round fire in the way', () => {
    const { nav } = arena();
    const from = nav.nearest(0, 0, 10);
    const to = nav.nearest(0, 0, -10);
    const straight: number[] = [];
    findPath(nav, from, to, straight);
    // A straight line, through the middle.
    expect(straight).toHaveLength(6);
    const spots = [-1, -0.5, 0, 0.5, 1].map((x) => ({ x, y: 0.05, z: 0 }));
    const round: number[] = [];
    findPath(nav, from, to, round, { spots, radius: 1, cost: FIRE.avoidCost });
    // Every leg keeps clear of the fire.
    for (let i = 3; i < round.length; i += 3) {
      const ax = round[i - 3]!;
      const az = round[i - 1]!;
      const bx = round[i]!;
      const bz = round[i + 2]!;
      // Where the leg crosses z = 0, if it does.
      if (az > 0 === bz > 0) continue;
      const x = ax + ((bx - ax) * az) / (az - bz);
      expect(Math.abs(x)).toBeGreaterThan(1.9);
    }
  });
});

describe('molotov', () => {
  /** A thrower at the origin facing −z with one molotov. */
  function thrower(boxes: BoxDef[] = []) {
    const world = makeWorld(boxes);
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    stow(c, TEST_ITEMS, { item: 'molotov', count: 1 });
    return { world, state, c };
  }
  const MOLOTOV = grenadeDef(TEST_ITEMS, 'molotov');

  it('breaks where it first lands, long before its fuse, spilling fire around it on the floor', () => {
    const { world, state, c } = thrower();
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true, grenade: 'molotov' }) });
    expect(carriedGrenades(c, TEST_ITEMS)).toBe(0);
    let at = -1;
    for (let i = 0; i < ticks(MOLOTOV.fuse) && at < 0; i++) {
      run(state, world, 1);
      if (state.events.some((e) => e.type === 'explosion')) at = i;
    }
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(ticks(2));
    expect(state.grenades).toHaveLength(0);
    // The middle and two rings, all on the floor, within its radius of the middle.
    expect(state.fires.length).toBeGreaterThanOrEqual(10);
    const mx = state.fires[0]!.x;
    const mz = state.fires[0]!.z;
    expect(-mz).toBeGreaterThan(4);
    for (const p of state.fires) {
      expect(p.y).toBeLessThan(0.2);
      expect(p.item).toBe('molotov');
      expect(p.time).toBe(MOLOTOV.fire!.fireTime);
      expect(Math.hypot(p.x - mx, p.z - mz)).toBeLessThanOrEqual(MOLOTOV.radius + 0.01);
    }
  });

  it("doesn't spill through a wall", () => {
    // A wall across the way 4 m out: it breaks on it, and only this side burns.
    const wall: BoxDef = { x: 0, y: 2, z: -4.2, hx: 5, hy: 2, hz: 0.2, yaw: 0 };
    const { world, state, c } = thrower([wall]);
    step(state, world, TEST_ITEMS, { [c.id]: input({ throw: true, grenade: 'molotov' }) });
    run(state, world, ticks(1.5));
    expect(state.fires.length).toBeGreaterThan(3);
    for (const p of state.fires) expect(p.z).toBeGreaterThan(-4);
  });

  it('breaks on someone it hits, who is set alight by the fire at their feet', () => {
    const { world, state, c } = thrower();
    const t = spawnCharacter(state, world, 0, -3);
    step(state, world, TEST_ITEMS, {
      [c.id]: input({ throw: true, grenade: 'molotov', pitch: -0.1 }),
    });
    run(state, world, ticks(1));
    expect(t.burn).toMatchObject({ by: c.id, item: 'molotov' });
    expect(t.burn!.left).toBeGreaterThan(MOLOTOV.fire!.burnTime - 1);
  });

  it("can't be fired from a grenade launcher", () => {
    expect(roundOf(TEST_ITEMS, 'molotov')).toBeNull();
    expect(firesRound(TEST_ITEMS, weaponDef(TEST_ITEMS, 'launcher'), 'molotov')).toBe(false);
  });
});

describe('incendiary rounds', () => {
  it('hurt as a round does and may set whoever they hit alight', () => {
    const world = makeWorld();
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    giveWeapon(c, TEST_ITEMS, 'rifle', [], 'inc-round');
    const t = spawnCharacter(state, world, 0, -10);
    // Aimed at the chest.
    step(state, world, TEST_ITEMS, { [c.id]: input({ fire: true, pitch: -0.05 }) });
    expect(totalHp(t.health)).toBeLessThan(TOTAL_HP);
    expect(t.burn).toMatchObject({ by: c.id, item: 'inc-round' });
    // Its own burnTime, less the tick it has already burned.
    expect(t.burn!.left).toBeCloseTo(4, 1);
    expect(state.events.some((e) => e.type === 'ignite' && e.target === t.id)).toBe(true);
    // A shorter, weaker burn than the flamethrower's: 4 s, then out.
    run(state, world, ticks(4) + 1);
    expect(t.burn).toBeNull();
  });

  it('never set alight with no chance, and ordinary rounds never do', () => {
    const items = new Map(TEST_ITEMS);
    const def = ammoDef(TEST_ITEMS, 'inc-round');
    items.set('inc-round', { ...def, incendiary: { ...def.incendiary!, chance: 0 } });
    const world = makeWorld();
    const state = createState(1);
    const c = spawnCharacter(state, world, 0, 0);
    giveWeapon(c, items, 'rifle', [], 'inc-round');
    const t = spawnCharacter(state, world, 0, -10);
    for (let i = 0; i < 30; i++) {
      step(state, world, items, { [c.id]: input({ fire: true, pitch: -0.05 }) });
    }
    expect(t.burn ?? null).toBeNull();
    const plain = setup();
    const u = spawnCharacter(plain.state, plain.world, 0, -10);
    giveWeapon(plain.c, TEST_ITEMS, 'rifle');
    step(plain.state, plain.world, TEST_ITEMS, {
      [plain.c.id]: input({ fire: true, pitch: -0.05 }),
    });
    expect(totalHp(u.health)).toBeLessThan(TOTAL_HP);
    expect(u.burn ?? null).toBeNull();
  });
});

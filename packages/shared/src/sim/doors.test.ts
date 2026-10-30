import { describe, expect, it } from 'vitest';
import { addItem } from '../inventory/grid';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld, type BoxDef, type DoorDef } from '../world/collision-world';
import { spawnEnemy, type PatrolDef } from './ai';
import { createItem } from './create-item';
import { createDoors, syncDoors, useDoor } from './doors';
import { createState, spawnCharacter, type PlayerInput, type SimState } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';

/*
 * A wall across the map at z = 5 with a 1.2 m doorway in the middle, and a door in it hinged
 * on the left (−x), whose +z is the side it opens to when it starts open.
 */
function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  const c = (a: number, b: number) => (a + b) / 2;
  const h = (a: number, b: number) => (b - a) / 2;
  return {
    x: c(x0, x1),
    y: c(y0, y1),
    z: c(z0, z1),
    hx: h(x0, x1),
    hy: h(y0, y1),
    hz: h(z0, z1),
    yaw: 0,
  };
}

const HALF = 20;

function makeWorld(door: Partial<DoorDef> = {}): CollisionWorld {
  const n = (HALF / 4) * 2;
  return new CollisionWorld({
    terrain: {
      minX: -HALF,
      minZ: -HALF,
      cellSize: 4,
      cols: n,
      rows: n,
      heights: Array((n + 1) ** 2).fill(0),
    },
    boxes: [aabb(-HALF, 0, 4.9, -0.6, 3, 5.1), aabb(0.6, 0, 4.9, HALF, 3, 5.1)],
    ramps: [],
    ladders: [],
    doors: [
      {
        x: 0,
        y: 0,
        z: 5,
        yaw: 0,
        width: 1.2,
        height: 2.1,
        thickness: 0.05,
        hinge: 'left',
        key: undefined,
        open: false,
        ...door,
      },
    ],
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

function setup(door: Partial<DoorDef> = {}, z = 3) {
  const world = makeWorld(door);
  const state = createState(1);
  syncDoors(state, world);
  const c = spawnCharacter(state, world, 0, z);
  return { world, state, c };
}

const results = (state: SimState) =>
  state.events.flatMap((e) => (e.type === 'door' ? [e.result] : []));

/** Distance along +z from (x, 1, 3) to the first solid. */
const rayAt = (world: CollisionWorld, x: number) => world.raycast(x, 1, 3, 0, 0, 1, 10);

describe('doors', () => {
  it('fills the doorway closed and stands at 90° from its hinge open', () => {
    const world = makeWorld();
    expect(rayAt(world, 0)).toBeCloseTo(2 - 0.025);
    world.setDoorOpen(0, true);
    // Through the doorway, then on through the open door's side.
    expect(rayAt(world, 0)).toBe(Infinity);
    expect(world.raycast(-3, 1, 5.6, 1, 0, 0, 10)).toBeCloseTo(3 - 0.6 - 0.025);
    // The closed door blocks shots and sight at the hinge side too, but not open.
    expect(rayAt(world, -0.5)).toBe(Infinity);
    world.setDoorOpen(0, false);
    expect(rayAt(world, -0.5)).toBeCloseTo(2 - 0.025);
  });

  it('opens and closes in reach, and only in reach', () => {
    // The open door's free edge would be 2.8 m away.
    const { world, state, c } = setup({}, 9);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.open).toBe(false);
    expect(state.events).toEqual([]);
    c.z = 6.5;
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.open).toBe(true);
    expect(world.isDoorOpen(0)).toBe(true);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.open).toBe(false);
    expect(results(state)).toEqual(['opened', 'closed']);
  });

  it('stops a body closed and lets it through open', () => {
    const { world, state, c } = setup({}, 8);
    // Facing −z (yaw 0) and walking forward, into the door.
    const walk = { [c.id]: input({ moveY: 1 }) };
    for (let i = 0; i < 3 * TICK_RATE; i++) step(state, world, items, walk);
    expect(c.z).toBeGreaterThan(5);
    step(state, world, items, { [c.id]: input({ door: 0 }) });
    for (let i = 0; i < 3 * TICK_RATE; i++) step(state, world, items, walk);
    expect(c.z).toBeLessThan(2);
  });

  it('won’t close on someone in the doorway', () => {
    const { world, state, c } = setup({ open: true }, 5);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.open).toBe(true);
    expect(results(state)).toEqual(['blocked']);
  });

  it('unlocks with a carried key, using it up, for the rest of the raid', () => {
    const { world, state, c } = setup({ key: 'worn-key' });
    expect(state.doors[0]).toEqual({ open: false, flipped: false, locked: true });
    useDoor(state, world, items, c, 0);
    expect(results(state)).toEqual(['locked']);
    const key = createItem(items, 'worn-key');
    expect(key.left).toBe(2);
    addItem(items, c.gear.pockets, key);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]).toEqual({ open: true, flipped: false, locked: false });
    expect(c.gear.pockets.items[0]!.item.left).toBe(1);
    // Closed again, it opens without the key.
    useDoor(state, world, items, c, 0);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]).toEqual({ open: true, flipped: false, locked: false });
    expect(c.gear.pockets.items[0]!.item.left).toBe(1);
    expect(results(state)).toEqual(['locked', 'unlocked', 'closed', 'opened']);
  });

  it('uses the key with the fewest uses left, and a key at its last use is gone', () => {
    const { world, state, c } = setup({ key: 'worn-key' });
    addItem(items, c.gear.pockets, createItem(items, 'worn-key'));
    addItem(items, c.gear.vault!, { ...createItem(items, 'worn-key'), left: 1 });
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.locked).toBe(false);
    expect(c.gear.vault!.items).toEqual([]);
    expect(c.gear.pockets.items[0]!.item.left).toBe(2);
  });

  it('keeps a key with no uses set', () => {
    const { world, state, c } = setup({ key: 'key' });
    addItem(items, c.gear.pockets, createItem(items, 'key'));
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.locked).toBe(false);
    expect(c.gear.pockets.items[0]!.item).toEqual({ item: 'key', count: 1 });
  });

  it('keeps door state in plain JSON, and a new world follows it', () => {
    const { world, state, c } = setup();
    useDoor(state, world, items, c, 0);
    const copy = JSON.parse(JSON.stringify(state)) as SimState;
    expect(copy.doors).toEqual([{ open: true, flipped: false, locked: false }]);
    const fresh = makeWorld();
    expect(rayAt(fresh, 0)).toBeLessThan(Infinity);
    step(copy, fresh, items, {});
    expect(rayAt(fresh, 0)).toBe(Infinity);
    expect(createDoors(fresh)).toEqual([{ open: false, flipped: false, locked: false }]);
  });

  it('opens away from whoever opens it, and closes from the side it opened to', () => {
    // From −z it opens into +z: its slab is in the way along the wall at z = 5.6.
    const { world, state, c } = setup({}, 4);
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.flipped).toBe(false);
    expect(world.raycast(-3, 1, 5.6, 1, 0, 0, 10)).toBeCloseTo(3 - 0.6 - 0.025);
    expect(world.raycast(-3, 1, 4.4, 1, 0, 0, 10)).toBe(Infinity);
    useDoor(state, world, items, c, 0);
    // From +z it opens into −z.
    c.z = 6;
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]!.flipped).toBe(true);
    expect(world.raycast(-3, 1, 4.4, 1, 0, 0, 10)).toBeCloseTo(3 - 0.6 - 0.025);
    expect(world.raycast(-3, 1, 5.6, 1, 0, 0, 10)).toBe(Infinity);
    // Closing keeps the side, so it's drawn swinging back from there.
    useDoor(state, world, items, c, 0);
    expect(state.doors[0]).toEqual({ open: false, flipped: true, locked: false });
    expect(results(state)).toEqual(['opened', 'closed', 'opened', 'closed']);
  });

  it('follows a saved state from before doors swung both ways', () => {
    const { world, state } = setup();
    state.doors = [{ open: true, locked: false }];
    syncDoors(state, world);
    expect(world.isDoorOpen(0)).toBe(true);
    expect(world.isDoorFlipped(0)).toBe(false);
  });
});

describe('doors and navigation', () => {
  it('walks through a closed doorway, but not a locked one until it’s unlocked', () => {
    const world = makeWorld({ key: 'key' });
    const nav = new NavGrid(world);
    // Built with the door open, but it's still closed.
    expect(world.isDoorOpen(0)).toBe(false);
    const north = nav.nearest(0, 0, 2);
    const south = nav.nearest(0, 0, 8);
    expect(nav.component[north]).toBe(nav.component[south]);

    const state = createState(1);
    syncDoors(state, world, nav);
    expect(nav.component[north]).not.toBe(nav.component[south]);
    state.doors[0]!.locked = false;
    syncDoors(state, world, nav);
    expect(nav.component[north]).toBe(nav.component[south]);
  });

  const beyond: PatrolDef = {
    points: [{ x: 0, y: 0, z: 12, wait: 0, radius: 0 }],
    repeatFrom: 0,
    loop: false,
  };

  function patrolThrough(door: Partial<DoorDef>) {
    const world = makeWorld(door);
    const nav = new NavGrid(world);
    const state = createState(3);
    const enemy = spawnEnemy(state, world, 0, 0, -2, 0, { patrol: beyond });
    for (let i = 0; i < 10 * TICK_RATE; i++) step(state, world, items, {}, nav);
    return { state, enemy };
  }

  it('has enemies open a closed door on their way, and leave it open', () => {
    const { state, enemy } = patrolThrough({});
    expect(state.doors[0]).toEqual({ open: true, flipped: false, locked: false });
    expect(enemy.z).toBeGreaterThan(10);
  });

  it('never has enemies open a locked door, even carrying its key', () => {
    const world = makeWorld({ key: 'key' });
    const nav = new NavGrid(world);
    const state = createState(3);
    const enemy = spawnEnemy(state, world, 0, 0, -2, 0, { patrol: beyond });
    addItem(items, enemy.gear.pockets, createItem(items, 'key'));
    for (let i = 0; i < 10 * TICK_RATE; i++) step(state, world, items, {}, nav);
    expect(state.doors[0]).toEqual({ open: false, flipped: false, locked: true });
    expect(enemy.z).toBeLessThan(5);
    // Unlocked by a player, it's an ordinary door.
    state.doors[0]!.locked = false;
    for (let i = 0; i < 10 * TICK_RATE; i++) step(state, world, items, {}, nav);
    expect(state.doors[0]!.open).toBe(true);
    expect(enemy.z).toBeGreaterThan(10);
  });
});

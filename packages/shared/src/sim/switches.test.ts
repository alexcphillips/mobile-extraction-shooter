import { describe, expect, it } from 'vitest';
import { compileMap, compileNodes, type PrefabLookup } from '../content/compile';
import type { MapFile, MapNode, PrefabFile } from '../content/schema';
import { NavGrid } from '../nav/nav-grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { useDoor } from './doors';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { openingProgress, useSwitch } from './switches';

const NO_ITEMS = new Map() as never;
const WHITE = '#ffffff';
const INPUT: PlayerInput = {
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

/** A prefab with a shutter in a wall, its cab drawn up above: a small freight lift. */
const LIFT: PrefabFile = {
  formatVersion: 3,
  id: 'lift',
  nodes: [
    { type: 'box', pos: [-2, 0, 0], size: [2, 3, 0.2], colour: WHITE },
    { type: 'box', pos: [2, 0, 0], size: [2, 3, 0.2], colour: WHITE },
    {
      type: 'door',
      id: 'gate',
      pos: [0, 0, 0],
      size: [2, 3],
      colour: WHITE,
      look: 'cab',
      rollUp: true,
    },
    { type: 'mover', prefab: 'cab', pos: [0, 4, 0], travel: [0, -4, 0], door: 'gate' },
  ],
};
const CAB: PrefabFile = {
  formatVersion: 3,
  id: 'cab',
  nodes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: WHITE }],
};

function compile(nodes: MapNode[]) {
  const row = Array<number>(11).fill(0);
  const map: MapFile = {
    formatVersion: 3,
    id: 'test',
    name: 'Test',
    environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
    terrain: {
      origin: [-20, -20],
      cellSize: 4,
      heights: Array.from({ length: 11 }, () => row),
      colour: '#6b8f4e',
    },
    nodes,
    zones: [],
  };
  const prefabs: PrefabLookup = new Map([
    ['lift', LIFT],
    ['cab', CAB],
  ]);
  return compileMap(map, prefabs);
}

const lever = (rows: { opens: string; timer?: number; noise?: string; lasts?: number }[]) =>
  ({
    type: 'box',
    pos: [0, 0, 5],
    size: [0.4, 1, 0.2],
    colour: WHITE,
    switch: { name: 'Power', rows },
  }) as MapNode;

const LIFT_AT: MapNode = { type: 'prefab', id: 'lift-1', prefab: 'lift', pos: [0, 0, 0] };

function raid(nodes: MapNode[]) {
  const map = compile(nodes);
  const world = new CollisionWorld(map.world);
  const state = createState(1);
  const player = spawnCharacter(state, world, 0, 6);
  const run = (seconds: number, press = false) => {
    for (let t = 0; t < Math.round(seconds * TICK_RATE); t++) {
      const input = { ...INPUT, ...(press && t === 0 && { switch: 0 }) };
      step(state, world, NO_ITEMS, { [player.id]: input });
    }
  };
  run(1 / TICK_RATE);
  return { map, world, state, player, run };
}

describe('switches', () => {
  it('names a door in a placed prefab, and locks it until the switch is used', () => {
    const { map, state, world, player } = raid([
      LIFT_AT,
      lever([{ opens: 'lift-1/gate', timer: 45 }]),
    ]);
    expect(map.world.switches?.[0]).toMatchObject({ name: 'Power' });
    expect(map.world.switches?.[0]?.rows[0]).toMatchObject({ door: 0, timer: 45, lasts: 45 });
    expect(state.doors[0]!.locked).toBe(true);
    expect(world.doors[0]!.key).toBeUndefined();
    const stood = spawnCharacter(state, world, 0, 1);
    useDoor(state, world, NO_ITEMS, stood, 0);
    expect(state.doors[0]!.open).toBe(false);
    expect(state.events.at(-1)).toMatchObject({ type: 'door', result: 'locked' });
    expect(player.health.dead).toBe(false);
  });

  it('refuses a row naming no door', () => {
    expect(() => compile([lever([{ opens: 'nowhere' }])])).toThrow(/no door "nowhere"/);
  });

  it('needs something solid to aim at', () => {
    const ghost = { ...lever([]), collide: false } as MapNode;
    expect(() => compile([ghost])).toThrow(/needs something that collides/);
  });

  it('opens the door when the timer ends, with its noise lasting until then', () => {
    const { state, world, run } = raid([
      LIFT_AT,
      lever([{ opens: 'lift-1/gate', timer: 45, noise: 'alarm-klaxon', lasts: 45 }]),
    ]);
    run(44, true);
    const d = state.doors[0]!;
    expect(d.open).toBe(false);
    expect(d.locked).toBe(true);
    expect(d.opening).toBeCloseTo(1, 1);
    expect(openingProgress(d)).toBeCloseTo(44 / 45, 2);
    expect(state.noises).toHaveLength(1);
    run(1.2);
    expect(d.open).toBe(true);
    expect(d.locked).toBe(false);
    expect(d.gone).toBe(true);
    expect(world.isDoorGone(0)).toBe(true);
    expect(d.opening).toBeUndefined();
    expect(openingProgress(d)).toBe(1);
    expect(state.noises).toHaveLength(0);
  });

  it('says what to play as the door opens', () => {
    const map: MapNode[] = [
      LIFT_AT,
      {
        ...lever([{ opens: 'lift-1/gate', timer: 1 }]),
        switch: { rows: [{ opens: 'lift-1/gate', timer: 1, openNoise: 'door-buzzer' }] },
      } as MapNode,
    ];
    const { state, run } = raid(map);
    run(0.9, true);
    run(0.1 + 2 / TICK_RATE);
    // The last tick's events are gone, so look for it on the tick it happens.
    const again = raid(map);
    again.run(1 / TICK_RATE, true);
    let heard: unknown;
    for (let i = 0; i < TICK_RATE * 2 && !heard; i++) {
      again.run(1 / TICK_RATE);
      heard = again.state.events.find((e) => e.type === 'doorSwitched');
    }
    expect(heard).toMatchObject({ door: 0, sound: 'door-buzzer' });
    expect(state.doors[0]!.open).toBe(true);
  });

  it('opens at once with no timer', () => {
    const { state, run } = raid([LIFT_AT, lever([{ opens: 'lift-1/gate' }])]);
    run(2 / TICK_RATE, true);
    expect(state.doors[0]!.open).toBe(true);
  });

  it('works once, only in reach, and not for enemies', () => {
    const { state, world, player, run } = raid([
      LIFT_AT,
      lever([{ opens: 'lift-1/gate', timer: 10 }]),
    ]);
    const far = spawnCharacter(state, world, 15, 15);
    useSwitch(state, world, far, 0);
    expect(state.switches[0]).toBe(false);
    useSwitch(state, world, { ...player, ai: {} } as never, 0);
    expect(state.switches[0]).toBe(false);
    useSwitch(state, world, player, 0);
    expect(state.switches[0]).toBe(true);
    run(5);
    const left = state.doors[0]!.opening!;
    useSwitch(state, world, player, 0);
    expect(state.doors[0]!.opening).toBe(left);
  });

  it('runs a row for each door, on timers of their own', () => {
    const { state, run } = raid([
      LIFT_AT,
      { type: 'box', pos: [8, 0, 0], size: [2, 3, 0.2], colour: WHITE },
      { type: 'door', id: 'other', pos: [12, 0, 0], size: [1, 2], colour: WHITE },
      lever([
        { opens: 'lift-1/gate', timer: 2 },
        { opens: 'other', timer: 4 },
      ]),
    ]);
    run(3, true);
    expect(state.doors[0]!.open).toBe(true);
    expect(state.doors[1]!.open).toBe(false);
    run(1.2);
    expect(state.doors[1]!.open).toBe(true);
  });

  it('cuts the way through for AI until it opens', () => {
    const map = compile([LIFT_AT, lever([{ opens: 'lift-1/gate', timer: 1 }])]);
    const world = new CollisionWorld(map.world);
    const nav = new NavGrid(world);
    const state = createState(1);
    const player = spawnCharacter(state, world, 0, 6);
    step(state, world, NO_ITEMS, { [player.id]: INPUT }, nav);
    const locked = (nav as unknown as { doorLocked: Uint8Array }).doorLocked;
    expect(locked[0]).toBe(1);
    step(state, world, NO_ITEMS, { [player.id]: { ...INPUT, switch: 0 } }, nav);
    for (let i = 0; i < TICK_RATE * 2; i++) step(state, world, NO_ITEMS, {}, nav);
    expect(state.doors[0]!.locked).toBe(false);
    expect(locked[0]).toBe(0);
  });
});

describe('use time', () => {
  const nodes = (useTime: number): MapNode[] => [
    LIFT_AT,
    {
      ...lever([]),
      switch: { useTime, rows: [{ opens: 'lift-1/gate' }] },
    } as MapNode,
  ];
  const hold = (r: ReturnType<typeof raid>, seconds: number, i: number | null = 0) => {
    for (let t = 0; t < Math.round(seconds * TICK_RATE); t++)
      step(r.state, r.world, NO_ITEMS, { [r.player.id]: { ...INPUT, switch: i } });
  };

  it('needs holding for its whole use time', () => {
    const r = raid(nodes(3));
    hold(r, 2.9);
    expect(r.state.switches[0]).toBe(false);
    expect(r.player.switching?.held).toBeCloseTo(2.9, 1);
    hold(r, 0.2);
    expect(r.state.switches[0]).toBe(true);
    expect(r.state.doors[0]!.open).toBe(true);
    expect(r.player.switching).toBeUndefined();
  });

  it('starts over if you let go', () => {
    const r = raid(nodes(3));
    hold(r, 2);
    hold(r, 1 / TICK_RATE, null);
    expect(r.player.switching).toBeUndefined();
    hold(r, 2);
    expect(r.state.switches[0]).toBe(false);
  });

  it('starts over if you walk out of reach', () => {
    const r = raid(nodes(3));
    hold(r, 2);
    r.player.x = 15;
    hold(r, 1 / TICK_RATE);
    expect(r.player.switching).toBeUndefined();
    expect(r.state.switches[0]).toBe(false);
  });

  it('takes one press with no use time', () => {
    const r = raid(nodes(0));
    hold(r, 1 / TICK_RATE);
    expect(r.state.switches[0]).toBe(true);
  });
});

describe('movers', () => {
  it('compiles apart from the map, drawn only, tied to the door beside it', () => {
    const map = compile([LIFT_AT, lever([{ opens: 'lift-1/gate', timer: 1 }])]);
    expect(map.movers).toHaveLength(1);
    expect(map.movers[0]).toMatchObject({ door: 0, x: 0, y: 4, z: 0, travel: [0, -4, 0] });
    expect(map.movers[0]!.shapes).toHaveLength(1);
    // Only the wall's two boxes and the lever collide: nothing of the cab.
    expect(map.world.boxes).toHaveLength(3);
  });

  it('is drawn where it starts in the editor, which compiles nodes alone', () => {
    const prefabs: PrefabLookup = new Map([['cab', CAB]]);
    const mover: MapNode = {
      type: 'mover',
      prefab: 'cab',
      pos: [1, 4, 2],
      travel: [0, -4, 0],
      door: 'gate',
    };
    const out = compileNodes([mover], prefabs);
    expect(out.shapes).toHaveLength(1);
    expect(out.shapes[0]).toMatchObject({ x: 1, z: 2 });
    expect(out.boxes).toHaveLength(0);
    const tilted: MapNode = { type: 'group', pos: [0, 0, 0], roll: 10, nodes: [mover] };
    expect(() => compileNodes([tilted], prefabs)).toThrow(/movers can't be/);
  });

  it('turns its travel with its yaw', () => {
    const map = compile([
      { type: 'door', id: 'd', pos: [0, 0, 0], size: [1, 2], colour: WHITE },
      { type: 'mover', prefab: 'cab', pos: [0, 0, 0], yaw: 90, travel: [0, 0, 2], door: 'd' },
    ]);
    expect(map.movers[0]!.travel[0]).toBeCloseTo(2);
    expect(map.movers[0]!.travel[2]).toBeCloseTo(0);
  });
});

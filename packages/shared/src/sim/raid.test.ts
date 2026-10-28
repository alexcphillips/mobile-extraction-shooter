import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { addItem } from '../inventory/grid';
import { TICK_RATE } from '../tick';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip } from './gear';
import { CHEST, createHealth, dealDamage, HEAD } from './health';
import {
  RAID,
  extractionAt,
  gearItems,
  investigateInReach,
  investigatedBy,
  keptItems,
  startQuests,
  startRaid,
  takeQuestItems,
  timeLeft,
} from './raid';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';

const world = new CollisionWorld({
  terrain: { minX: -32, minZ: -32, cellSize: 8, cols: 8, rows: 8, heights: Array(81).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

const map = {
  markers: [
    { type: 'extraction', id: 'gate', x: 20, y: 0, z: 0, name: 'Gate', radius: 3 },
    { type: 'playerSpawn', id: 'spawn', x: 0, y: 0, z: 0, yaw: 0 },
    { type: 'questMarker', id: 'radio', x: -10, y: 0, z: 0 },
    { type: 'questMarker', id: 'desk', x: 5, y: 0, z: 5 },
    { type: 'questMarker', id: 'shelf', x: 5, y: 0, z: -5 },
  ],
} as unknown as CompiledMap;

/** A raid of `seconds` with a player at (x, 0). */
function setup(x = 0, seconds = 60) {
  const state = createState(1);
  startRaid(state, map, seconds);
  const c = spawnCharacter(state, world, x, 0);
  return { state, c };
}

const still: PlayerInput = {
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

const run = (state: ReturnType<typeof setup>['state'], seconds: number): void => {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) step(state, world, items, {});
};

describe('raid', () => {
  it('opens the map’s extraction points and counts the timer down', () => {
    const { state, c } = setup(0, 60);
    expect(state.raid!.extractions).toEqual([
      { id: 'gate', name: 'Gate', x: 20, y: 0, z: 0, radius: 3 },
    ]);
    expect(timeLeft(state)).toBeCloseTo(60);
    run(state, 10);
    expect(timeLeft(state)).toBeCloseTo(50);
    expect(extractionAt(state, c)).toBeNull();
    c.x = 22;
    expect(extractionAt(state, c)?.id).toBe('gate');
    c.y = RAID.extractHeight + 0.1;
    expect(extractionAt(state, c)).toBeNull();
    expect(timeLeft(createState(1))).toBe(Infinity);
  });

  it('extracts a player who stands in a point for its time, even while being shot', () => {
    const { state, c } = setup(20);
    run(state, RAID.extractTime / 2);
    dealDamage(state, c, CHEST, 20, 0);
    run(state, RAID.extractTime / 2 - 0.2);
    expect(state.entities).toContain(c);
    expect(c.extracting).toBeGreaterThan(RAID.extractTime - 0.3);

    let leave = null;
    for (let i = 0; i < TICK_RATE && !leave; i++) {
      step(state, world, items, {});
      leave = state.events.find((e) => e.type === 'leave') ?? null;
    }
    expect(leave).toEqual({ type: 'leave', by: c.id, how: 'extracted', at: 'gate' });
    expect(state.entities).not.toContain(c);
    expect(state.left).toEqual([
      { character: c, how: 'extracted', at: 'gate', tick: expect.any(Number) },
    ]);
    // Gone for good: nothing more happens to them.
    run(state, 1);
    expect(state.left).toHaveLength(1);
  });

  it('starts over when the player steps out, and never extracts the dead or enemies', () => {
    const { state, c } = setup(20);
    const enemy = spawnEnemy(state, world, 21, 0, 0, 0, {});
    run(state, RAID.extractTime - 1);
    c.x = 0;
    step(state, world, items, {});
    expect(c.extracting).toBe(0);
    c.x = 20;
    run(state, RAID.extractTime - 1);
    expect(state.left).toEqual([]);
    dealDamage(state, c, HEAD, 1000, 0);
    run(state, 2);
    expect(state.left).toEqual([]);
    expect(state.entities).toEqual([c, enemy]);
  });

  it('makes players still in the raid missing in action when time runs out', () => {
    const { state, c } = setup(0, 5);
    const other = spawnCharacter(state, world, 5, 5);
    const enemy = spawnEnemy(state, world, -5, 0, 0, 0, {});
    dealDamage(state, other, HEAD, 1000, 0);
    run(state, 5 - 0.1);
    expect(state.left).toEqual([]);
    run(state, 0.2);
    expect(timeLeft(state)).toBe(0);
    expect(state.left.map((l) => [l.character, l.how, l.at])).toEqual([[c, 'mia', null]]);
    expect(state.entities).toEqual([other, enemy]);
  });

  it('survives a JSON round trip mid-extraction', () => {
    const { state } = setup(20);
    run(state, RAID.extractTime - 1);
    const copy = JSON.parse(JSON.stringify(state)) as typeof state;
    run(state, 1.1);
    run(copy, 1.1);
    expect(copy.left.map((l) => l.how)).toEqual(['extracted']);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(state));
  });

  it('keeps everything on extraction, and only the knife and the vault otherwise', () => {
    const { c } = setup();
    const knife = createItem(items, 'knife');
    const rifle = createItem(items, 'rifle');
    const backpack = createItem(items, 'backpack');
    const watch = createItem(items, 'watch');
    const cash = createItem(items, 'cash', 500);
    equip(c, items, 'knife', knife);
    equip(c, items, 'primary1', rifle);
    equip(c, items, 'backpack', backpack);
    addItem(items, c.gear.backpack!.grid, watch);
    addItem(items, c.gear.vault!, cash);
    expect(gearItems(c.gear)).toEqual([rifle, knife, backpack, watch, cash]);
    expect(keptItems(c.gear, true)).toEqual([rifle, knife, backpack, watch, cash]);
    expect(keptItems(c.gear, false)).toEqual([knife, cash]);
  });

  it('sets up quest markers to investigate and quest items at one of their spots', () => {
    const { state, c } = setup();
    startQuests(state, map, items, c.id, {
      investigate: ['radio'],
      extract: [{ item: 'notes', spots: ['desk', 'shelf'] }],
    });
    expect(state.raid!.investigate).toEqual([
      { holder: c.id, marker: 'radio', x: -10, y: 0, z: 0, done: false },
    ]);
    expect(state.ground.map((g) => [g.item.item, g.x, Math.abs(g.z)])).toEqual([['notes', 5, 5]]);
    expect(() =>
      startQuests(state, map, items, c.id, { investigate: ['nowhere'], extract: [] }),
    ).toThrow(/no quest marker/);
  });

  it('investigates a marker in reach once, for its holder only, and not when dead', () => {
    const { state, c } = setup();
    const other = spawnCharacter(state, world, -10, 1);
    startQuests(state, map, items, c.id, { investigate: ['radio'], extract: [] });
    const press = (id: number) =>
      step(state, world, items, { [id]: { ...still, investigate: true } });
    press(c.id);
    expect(investigatedBy(state, c.id)).toEqual([]);
    press(other.id);
    expect(state.raid!.investigate[0]!.done).toBe(false);
    c.x = -10 + RAID.investigateReach - 0.1;
    expect(investigateInReach(state, c)?.marker).toBe('radio');
    dealDamage(state, c, HEAD, 1000, 0);
    press(c.id);
    expect(investigatedBy(state, c.id)).toEqual([]);
    c.health = createHealth();
    press(c.id);
    expect(state.events).toContainEqual({ type: 'investigate', by: c.id, marker: 'radio' });
    expect(investigatedBy(state, c.id)).toEqual(['radio']);
    expect(investigateInReach(state, c)).toBeNull();
  });

  it('takes quest items out of every grid, nested ones too', () => {
    const { c } = setup();
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    addItem(items, c.gear.backpack!.grid, createItem(items, 'notes'));
    addItem(items, c.gear.backpack!.grid, createItem(items, 'watch'));
    addItem(items, c.gear.vault!, createItem(items, 'notes'));
    addItem(items, c.gear.pockets, createItem(items, 'notes'));
    expect(takeQuestItems(items, c.gear)).toEqual(['notes', 'notes', 'notes']);
    expect(gearItems(c.gear).map((i) => i.item)).toEqual(['backpack', 'watch']);
  });
});

import { describe, expect, it } from 'vitest';
import { compileMap, type PrefabLookup } from '../content/compile';
import type { MapFile, MapNode } from '../content/schema';
import { TICK_RATE } from '../tick';
import { CollisionWorld, createRayHit } from '../world/collision-world';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';

const DEG = Math.PI / 180;
const NO_ITEMS = new Map() as never;
const WHITE = '#ffffff';

/** A hollow 3 × 2.8 × 8 m container, open at −z and closed at +z, floor at y = 0. */
const CONTAINER: MapNode[] = [
  { type: 'box', pos: [0, 0, 0], size: [3, 0.2, 8], colour: WHITE },
  { type: 'box', pos: [0, 2.6, 0], size: [3, 0.2, 8], colour: WHITE },
  { type: 'box', pos: [-1.4, 0.2, 0], size: [0.2, 2.4, 8], colour: WHITE },
  { type: 'box', pos: [1.4, 0.2, 0], size: [0.2, 2.4, 8], colour: WHITE },
  { type: 'box', pos: [0, 0.2, 3.9], size: [2.6, 2.4, 0.2], colour: WHITE },
];

function worldWith(nodes: MapNode[]): CollisionWorld {
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
  const prefabs: PrefabLookup = new Map();
  return new CollisionWorld(compileMap(map, prefabs).world);
}

function walker(world: CollisionWorld, x: number, z: number, y = Infinity) {
  const state = createState(1);
  const c = spawnCharacter(state, world, x, z, 0, y);
  const input: PlayerInput = {
    moveX: 0,
    moveY: -1,
    yaw: 0,
    pitch: 0,
    sprint: false,
    crouch: false,
    jump: false,
    fire: false,
    aim: false,
    reload: false,
  };
  /** Walks towards +z; returns the furthest single tick's jump along z. */
  const walk = (seconds: number): number => {
    let jump = 0;
    for (let i = 0; i < TICK_RATE * seconds; i++) {
      const from = c.z;
      step(state, world, NO_ITEMS, { [c.id]: input });
      jump = Math.max(jump, Math.abs(c.z - from));
    }
    return jump;
  };
  return { c, walk };
}

describe('a tilted container', () => {
  const pitch = -20;
  const sin = Math.sin(20 * DEG);
  const cos = Math.cos(20 * DEG);

  it('walks up its roof as a ramp, with the low end sunk to the ground', () => {
    // Pivot on the floor's middle; the roof's low edge comes to ground level.
    const y = 4 * sin - 2.8 * cos;
    const world = worldWith([{ type: 'group', pos: [0, y, 0], pitch, nodes: CONTAINER }]);
    const { c, walk } = walker(world, 0, -6);
    walk(2);
    // Near the top, the height is the roof's plane there.
    expect(c.z).toBeGreaterThan(0.5);
    expect(c.y).toBeCloseTo(y + 2.8 / cos + c.z * Math.tan(20 * DEG), 1);
    expect(c.y).toBeGreaterThan(1.8);
  });

  it('walks in at the open low end and up the inside to the closed end', () => {
    const y = 4 * sin + 0.2;
    const world = worldWith([{ type: 'group', pos: [0, y, 0], pitch, nodes: CONTAINER }]);
    const { c, walk } = walker(world, 0, -6);
    walk(5);
    // Stopped by the closed end's wall, on the floor, still under the roof.
    expect(c.mode).toBe('ground');
    expect(c.y).toBeGreaterThan(2);
    expect(c.z).toBeGreaterThan(2.5);
    expect(c.z).toBeLessThan(3.9);
    expect(world.ceilingAt(c.x, c.z, 0.3, c.y + 1)).toBeLessThan(c.y + 3.5);
  });

  it('stops you smoothly under the raised end instead of throwing you out', () => {
    // A solid plank high at −z, coming down towards +z.
    const plank: MapNode = {
      type: 'box',
      pos: [0, 2, 0],
      size: [3, 0.2, 8],
      pitch: 20,
      colour: WHITE,
    };
    const world = worldWith([plank]);
    const { c, walk } = walker(world, 0, -3.5, 1);
    const jump = walk(4);
    expect(jump).toBeLessThan(0.5);
    expect(Math.abs(c.x)).toBeLessThan(0.01);
    expect(c.z).toBeGreaterThan(-3);
    expect(c.z).toBeLessThan(3);
    expect(c.y).toBeCloseTo(0);
  });

  it('shoots through the hollow middle and stops on its walls', () => {
    const world = worldWith([
      { type: 'group', pos: [0, 4 * sin + 0.2, 0], pitch, nodes: CONTAINER },
    ]);
    const hit = createRayHit();
    // Up the inside along the floor's slope, to the closed end about 3.9 m past the middle.
    const [dy, dz] = [sin, cos];
    const d = world.raycast(0, 4 * sin + 1.5, 0, 0, dy, dz, 20, hit);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(4.5);
  });
});

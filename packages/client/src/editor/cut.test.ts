import type { BoxDef, WorldDef } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { floorLevels, startCut, stepCut } from './cut';

const box = (y: number, hy: number, hx: number, hz: number): BoxDef => ({
  x: 0,
  y,
  z: 0,
  hx,
  hy,
  hz,
  yaw: 0,
});

const world = (boxes: BoxDef[]): WorldDef => ({
  terrain: { minX: 0, minZ: 0, cols: 1, rows: 1, cellSize: 1, heights: [0, 0, 0, 0] },
  boxes,
  ramps: [],
  ladders: [],
});

describe('the cutaway', () => {
  it('finds floors from broad solids, not walls or crates', () => {
    const levels = floorLevels(
      world([
        box(0.05, 0.05, 10, 10), // ground floor slab, top 0.1
        box(0.2, 0.1, 2, 2), // a stage on it, top 0.3: the same level
        box(4.85, 0.15, 10, 10), // first floor, top 5
        box(2.5, 2.5, 10, 0.2), // a wall: too thin
        box(0.5, 0.5, 0.5, 0.5), // a crate: too small
        box(0.5, 0.5, 2, 2), // a counter: too thick
      ]),
    );
    expect(levels).toEqual([0.1, 5]);
  });

  it('starts over the floor below the target and steps a floor at a time', () => {
    const levels = [0.1, 5];
    expect(startCut(levels, 0.1)).toBe(1.6);
    expect(startCut(levels, 6)).toBe(6.5);
    expect(stepCut(levels, 1.6, 1)).toBe(6.5);
    expect(stepCut(levels, 6.5, -1)).toBe(1.6);
    // Nothing further: a storey on.
    expect(stepCut(levels, 6.5, 1)).toBe(9.5);
    expect(stepCut(levels, 1.6, -1)).toBe(-1.4);
  });
});

import { describe, expect, it } from 'vitest';
import { cellCentre, cursorSpeed, nearestBox, stepRange, stepTarget, type Box } from './pad-nav';

const box = (left: number, top: number, width = 40, height = 30): Box => ({
  left,
  top,
  width,
  height,
});

describe('cursorSpeed', () => {
  it('creeps on a small push and speeds up when held at full', () => {
    expect(cursorSpeed(0.2, 0)).toBeLessThan(80);
    expect(cursorSpeed(1, 0)).toBeLessThan(cursorSpeed(1, 1));
    expect(cursorSpeed(1, 1)).toBe(cursorSpeed(1, 5));
  });
});

describe('nearestBox', () => {
  it('takes the nearest within the radius, none past it', () => {
    const boxes = [box(0, 0), box(100, 0)];
    expect(nearestBox(90, 10, boxes, 56)).toBe(1);
    expect(nearestBox(70, 200, boxes, 56)).toBe(-1);
  });

  it('takes the smallest of the boxes the point is inside (a tile over its grid)', () => {
    const grid = box(0, 0, 300, 300);
    const tile = box(40, 40, 40, 80);
    expect(nearestBox(50, 50, [grid, tile], 56)).toBe(1);
    expect(nearestBox(200, 200, [grid, tile], 56)).toBe(0);
  });
});

describe('stepTarget', () => {
  // A row of buttons, with one a little lower to the right and one far off to the side.
  const row = [box(0, 0), box(60, 0), box(120, 4), box(60, 300)];

  it('steps to the next box that way, not one behind or the one it is on', () => {
    expect(stepTarget(20, 15, 'right', row)?.index).toBe(1);
    expect(stepTarget(80, 15, 'right', row)?.index).toBe(2);
    expect(stepTarget(80, 15, 'left', row)?.index).toBe(0);
    expect(stepTarget(140, 15, 'right', row)).toBeNull();
  });

  it('prefers straight ahead over a nearer box off to the side', () => {
    const boxes = [box(100, 0), box(40, 80)];
    expect(stepTarget(20, 15, 'right', boxes)?.index).toBe(0);
    expect(stepTarget(20, 15, 'down', boxes)?.index).toBe(1);
  });

  it('lands at a small box’s middle, and just inside a large one level with the cursor', () => {
    expect(stepTarget(20, 15, 'right', row)).toEqual({ index: 1, x: 80, y: 15 });
    const grid = box(200, 0, 400, 400);
    expect(stepTarget(20, 150, 'right', [grid])).toEqual({ index: 0, x: 220, y: 150 });
  });
});

describe('cellCentre', () => {
  it('finds the middle of the cell under a point, kept inside the grid', () => {
    const grid = box(100, 100, 200, 120); // 5 × 3 cells of 40
    expect(cellCentre(150, 150, grid, 40)).toEqual([160, 160]);
    expect(cellCentre(999, 999, grid, 40)).toEqual([280, 200]);
  });
});

describe('stepRange', () => {
  it('steps on the input’s step grid, within its range, without float drift', () => {
    expect(stepRange(1, 0.2, 3, 0.1, 2)).toBe(1.2);
    expect(stepRange(0.3, 0.2, 3, 0.1, -5)).toBe(0.2);
    expect(stepRange(5, 1, 9, 1, 10)).toBe(9);
  });
});

import {
  createRng,
  nextFloat,
  type BoxDef,
  type HeightGrid,
  type HeightGridDef,
  type Shape,
} from '@mes/shared';

export const WORLD_SIZE = 256;
export const WORLD_MIN = -WORLD_SIZE / 2;
const CELL = 2;
/** Flat ground around the spawn, blending into the hills. */
const FLAT_RADIUS = 24;
const FLAT_BLEND = 12;
/** Random boxes stay out of this radius. */
const CLEARING = 30;

const PALETTE = [0xc8a165, 0x8c8c8c, 0xa0522d, 0x6e7f80, 0xd9d0c1, 0x4f6d7a, 0x9b6a4f, 0x7a8b5c];
export const GRASS = 0x6b8f4e;

/** Rolling hills, flattened around the spawn. The real map stores a height grid. */
function hills(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (d - FLAT_RADIUS) / FLAT_BLEND));
  const blend = t * t * (3 - 2 * t);
  return (
    blend * (3 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 1.5 * Math.sin(x * 0.13 + z * 0.09))
  );
}

export function makeTerrain(): HeightGridDef {
  const n = WORLD_SIZE / CELL;
  const heights: number[] = [];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) heights.push(hills(WORLD_MIN + i * CELL, WORLD_MIN + j * CELL));
  return { minX: WORLD_MIN, minZ: WORLD_MIN, cellSize: CELL, cols: n, rows: n, heights };
}

export function makeBoxes(count: number, seed: number, terrain: HeightGrid): BoxDef[] {
  const rng = createRng(seed);
  const r = (): number => nextFloat(rng);
  const boxes: BoxDef[] = [];
  while (boxes.length < count) {
    const x = WORLD_MIN + 4 + r() * (WORLD_SIZE - 8);
    const z = WORLD_MIN + 4 + r() * (WORLD_SIZE - 8);
    if (Math.hypot(x, z) < CLEARING) continue;
    const hx = 0.5 + r() * 2.5;
    const hz = 0.5 + r() * 2.5;
    const height = 1 + r() * r() * 8;
    // Sink the base 1 m so boxes don't float on slopes.
    const base = terrain.heightAt(x, z) - 1;
    boxes.push({
      x,
      y: base + (height + 1) / 2,
      z,
      hx,
      hy: (height + 1) / 2,
      hz,
      yaw: r() * Math.PI * 2,
    });
  }
  return boxes;
}

/** The random boxes as shapes, each with a colour from the palette. */
export function boxShapes(boxes: readonly BoxDef[], seed: number): Shape[] {
  const rng = createRng(seed + 1);
  return boxes.map((b) => ({
    kind: 'box',
    ...b,
    pitch: 0,
    roll: 0,
    colour: PALETTE[Math.floor(nextFloat(rng) * PALETTE.length)]!,
  }));
}

import type { CompiledWater } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { buildWater } from './map';

const body = (x: number, level: number, yaw = 0): CompiledWater => ({
  x,
  z: 0,
  hx: 2,
  hz: 1,
  yaw,
  level,
  colour: 0x3d7ea6,
  opacity: 0.5,
});

describe('water (MT-1)', () => {
  it('draws every body as one mesh, each at its own level and fade', () => {
    const mesh = buildWater([body(0, 1), body(10, -0.5, Math.PI / 2)])!;
    const pos = mesh.geometry.getAttribute('position');
    const col = mesh.geometry.getAttribute('color');
    expect(pos.count).toBe(12);
    expect(col.itemSize).toBe(4);
    expect(col.getW(0)).toBeCloseTo(0.5);
    expect(pos.getY(0)).toBe(1);
    expect(pos.getY(6)).toBe(-0.5);
    // Turned 90°: its 4 m length runs along z.
    const zs = Array.from({ length: 6 }, (_, i) => pos.getZ(6 + i));
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4);
    expect(buildWater([])).toBeNull();
  });
});

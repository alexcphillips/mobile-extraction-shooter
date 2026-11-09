import { describe, expect, it } from 'vitest';
import { arcStrength, hitBearing } from './hit-direction';

describe('hit direction', () => {
  it('points at the source on the screen, clockwise from straight ahead', () => {
    // Facing −z (yaw 0): ahead is −z, right is +x, behind is +z, left is −x.
    expect(hitBearing(0, 0, 0, 0, -10)).toBeCloseTo(0);
    expect(hitBearing(0, 0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(hitBearing(0, 0, 0, 0, 10))).toBeCloseTo(Math.PI);
    expect(hitBearing(0, 0, 0, -10, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it('follows the viewer turning and moving', () => {
    // Turned left a quarter (facing −x), a shot from −x is ahead and one from −z is right.
    expect(hitBearing(Math.PI / 2, 0, 0, -10, 0)).toBeCloseTo(0);
    expect(hitBearing(Math.PI / 2, 0, 0, 0, -10)).toBeCloseTo(Math.PI / 2);
    expect(hitBearing(0, 5, 5, 5, -5)).toBeCloseTo(0);
    expect(hitBearing(4 * Math.PI, 0, 0, 10, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('holds, then fades', () => {
    expect(arcStrength(-1)).toBe(0);
    expect(arcStrength(0)).toBe(1);
    expect(arcStrength(0.5)).toBe(1);
    expect(arcStrength(1)).toBeCloseTo(0.5);
    expect(arcStrength(1.5)).toBe(0);
  });
});

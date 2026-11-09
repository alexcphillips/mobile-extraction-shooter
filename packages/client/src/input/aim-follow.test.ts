import { describe, expect, it } from 'vitest';
import { FOLLOW_MAX, bearing, followRate, wrapAngle } from './aim-follow';

describe('aim follow', () => {
  const b = { yaw: 0, pitch: 0 };

  it('measures bearings as the game looks (yaw 0 down −z, left positive)', () => {
    bearing(0, 0, 0, 0, 0, -10, b);
    expect(b.yaw).toBeCloseTo(0);
    bearing(0, 0, 0, -10, 0, 0, b);
    expect(b.yaw).toBeCloseTo(Math.PI / 2);
    bearing(0, 0, 0, 0, 10, -10, b);
    expect(b.pitch).toBeCloseTo(Math.PI / 4);
  });

  it('follows a share of a target crossing the view', () => {
    const out = { yaw: 0, pitch: 0 };
    followRate({ yaw: 0, pitch: 0 }, { yaw: 0.02, pitch: -0.01 }, 1 / 30, 0.5, out);
    expect(out.yaw).toBeCloseTo(0.3);
    expect(out.pitch).toBeCloseTo(-0.15);
  });

  it('turns the short way across ±π', () => {
    const out = { yaw: 0, pitch: 0 };
    followRate({ yaw: Math.PI - 0.01, pitch: 0 }, { yaw: -Math.PI + 0.01, pitch: 0 }, 1, 1, out);
    expect(out.yaw).toBeCloseTo(0.02);
    expect(wrapAngle(2 * Math.PI + 0.5)).toBeCloseTo(0.5);
  });

  it('never turns faster than its cap', () => {
    const out = { yaw: 0, pitch: 0 };
    followRate({ yaw: 0, pitch: 0 }, { yaw: 1, pitch: -1 }, 1 / 30, 1, out);
    expect(out.yaw).toBe(FOLLOW_MAX);
    expect(out.pitch).toBe(-FOLLOW_MAX);
  });
});

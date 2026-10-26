import { describe, expect, it } from 'vitest';
import { FixedTimestep, TICK_RATE, TICK_SECONDS } from './tick';

describe('tick', () => {
  it('runs at 30 Hz', () => {
    expect(TICK_RATE).toBe(30);
    expect(TICK_SECONDS * TICK_RATE).toBeCloseTo(1);
  });
});

describe('FixedTimestep', () => {
  it('runs whole ticks and returns the remainder as alpha', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    const alpha = loop.advance(TICK_SECONDS * 2.5, () => ticks++);
    expect(ticks).toBe(2);
    expect(alpha).toBeCloseTo(0.5);
    loop.advance(TICK_SECONDS * 0.6, () => ticks++);
    expect(ticks).toBe(3);
  });

  it('runs one second of 60 Hz frames as 30 ticks', () => {
    const loop = new FixedTimestep();
    let ticks = 0;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => ticks++);
    expect(ticks).toBeGreaterThanOrEqual(29);
    expect(ticks).toBeLessThanOrEqual(30);
  });

  it('caps a long frame', () => {
    const loop = new FixedTimestep(0.25);
    let ticks = 0;
    loop.advance(10, () => ticks++);
    expect(ticks).toBe(Math.floor(0.25 / TICK_SECONDS + 1e-9));
  });
});

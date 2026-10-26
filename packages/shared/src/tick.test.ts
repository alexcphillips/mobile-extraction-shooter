import { describe, expect, it } from 'vitest';
import { TICK_RATE, TICK_SECONDS } from './tick';

describe('tick', () => {
  it('runs at 30 Hz', () => {
    expect(TICK_RATE).toBe(30);
    expect(TICK_SECONDS * TICK_RATE).toBeCloseTo(1);
  });
});

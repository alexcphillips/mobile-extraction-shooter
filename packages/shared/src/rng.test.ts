import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, pick } from './rng';

describe('rng', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => nextFloat(a));
    expect(Array.from({ length: 5 }, () => nextFloat(b))).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => nextFloat(c))).not.toEqual(seqA);
  });

  it('continues the same sequence after a JSON round trip', () => {
    const a = createRng(7);
    nextFloat(a);
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(nextFloat(b)).toBe(nextFloat(a));
  });

  it('stays in range and covers every integer', () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      seen.add(nextInt(rng, 6));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('refuses to pick from an empty list', () => {
    expect(() => pick(createRng(1), [])).toThrow();
  });
});

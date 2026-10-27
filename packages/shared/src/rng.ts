/**
 * Seeded RNG (mulberry32). The state is a plain object so it serialises with the rest of
 * the simulation state, and a restored state continues the same sequence.
 */
export interface Rng {
  s: number;
}

export function createRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** A float in [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A float in [min, max). */
export function nextRange(rng: Rng, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/** An integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(nextFloat(rng) * n);
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return nextFloat(rng) < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from an empty list');
  return items[nextInt(rng, items.length)]!;
}

/** Picks one option by weight. A weight of 0 is never picked unless all are 0. */
export function byWeight<T extends { weight: number }>(rng: Rng, options: readonly T[]): T {
  if (options.length === 0) throw new Error('pick from an empty list');
  let total = 0;
  for (const o of options) total += o.weight;
  let roll = nextFloat(rng) * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return options[options.length - 1]!;
}

/** An integer in [min, max], inclusive. */
export function nextIntIn(rng: Rng, min: number, max: number): number {
  return min + nextInt(rng, max - min + 1);
}

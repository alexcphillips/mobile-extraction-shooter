/** Seeded RNG (mulberry32). The real one lives in shared from session 3. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Brightness for a face with unit normal (nx, ny): tops 1.0, ±x sides 0.8, ±z sides 0.7,
 * bottoms 0.5, blended in between. This is the "no real lighting" look from design.md.
 */
export function shade(nx: number, ny: number): number {
  return (ny >= 0 ? 0.7 + 0.3 * ny : 0.7 + 0.2 * ny) + 0.1 * Math.abs(nx);
}

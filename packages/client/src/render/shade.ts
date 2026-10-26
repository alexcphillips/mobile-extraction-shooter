/**
 * Brightness for a face with unit normal (nx, ny): tops 1.0, ±x sides 0.8, ±z sides 0.7,
 * bottoms 0.5, blended in between. This is the "no real lighting" look from design.md.
 */
export function shade(nx: number, ny: number): number {
  return (ny >= 0 ? 0.7 + 0.3 * ny : 0.7 + 0.2 * ny) + 0.1 * Math.abs(nx);
}

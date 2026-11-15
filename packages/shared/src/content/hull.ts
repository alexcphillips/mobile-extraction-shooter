/*
 * Shapes for the model part types `hull` and `loft` (CH-3a, 2026-11-13): a convex hull of
 * a few points, and the ring points of a loft. Pure math, used by drawing (client), the
 * fit check and the schema's checks. Small inputs (up to 32 points), so the plain
 * incremental hull is plenty.
 */

export type P3 = readonly [number, number, number];

const EPS = 1e-7;

function sub(a: P3, b: P3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: P3, b: P3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The convex hull of points as triangles (indices into points), each wound so its normal
 * (b − a) × (c − a) points out. Null if the points are all on one plane (no solid). Points
 * inside the hull are left out of it.
 */
export function convexHull(points: readonly P3[]): [number, number, number][] | null {
  const n = points.length;
  if (n < 4) return null;
  // A first tetrahedron: two points far apart, the point furthest off their line, the
  // point furthest off their plane.
  let i0 = 0;
  let i1 = 0;
  let far = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = sub(points[j]!, points[i]!);
      const l = dot(d, d);
      if (l > far) [far, i0, i1] = [l, i, j];
    }
  if (far < EPS) return null;
  const axis = sub(points[i1]!, points[i0]!);
  let i2 = -1;
  far = EPS;
  for (let i = 0; i < n; i++) {
    const c = cross(axis, sub(points[i]!, points[i0]!));
    const l = dot(c, c);
    if (l > far) [far, i2] = [l, i];
  }
  if (i2 < 0) return null;
  const normal = cross(axis, sub(points[i2]!, points[i0]!));
  const scale = Math.sqrt(dot(normal, normal));
  let i3 = -1;
  far = 1e-6;
  for (let i = 0; i < n; i++) {
    const h = Math.abs(dot(normal, sub(points[i]!, points[i0]!))) / scale;
    if (h > far) [far, i3] = [h, i];
  }
  if (i3 < 0) return null;

  let faces: [number, number, number][] = [];
  const add = (a: number, b: number, c: number, inside: P3): void => {
    const nrm = cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!));
    faces.push(dot(nrm, sub(inside, points[a]!)) > 0 ? [a, c, b] : [a, b, c]);
  };
  const mid: P3 = [0, 1, 2].map(
    (k) => (points[i0]![k]! + points[i1]![k]! + points[i2]![k]! + points[i3]![k]!) / 4,
  ) as unknown as P3;
  add(i0, i1, i2, mid);
  add(i0, i1, i3, mid);
  add(i0, i2, i3, mid);
  add(i1, i2, i3, mid);

  const above = (f: readonly number[], p: P3): number => {
    const a = points[f[0]!]!;
    const nrm = cross(sub(points[f[1]!]!, a), sub(points[f[2]!]!, a));
    const l = Math.sqrt(dot(nrm, nrm)) || 1;
    return dot(nrm, sub(p, a)) / l;
  };
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const p = points[i]!;
    const seen = faces.map((f) => above(f, p) > 1e-6);
    if (!seen.some(Boolean)) continue;
    // The horizon: edges of the faces it sees whose other face it doesn't see.
    const edges = new Set<string>();
    faces.forEach((f, k) => {
      if (!seen[k]) return;
      for (let e = 0; e < 3; e++) edges.add(`${f[e]},${f[(e + 1) % 3]}`);
    });
    const kept = faces.filter((_, k) => !seen[k]);
    for (const e of edges) {
      const [a, b] = e.split(',').map(Number) as [number, number];
      if (!edges.has(`${b},${a}`)) kept.push([a, b, i]);
    }
    faces = kept;
  }
  return faces;
}

/**
 * One ring of a loft in its own frame: `sides` points round an ellipse whose flat faces
 * are `w` wide (x) and `d` deep (z), at height y, moved over by dx, dz. Half a step round,
 * so with an even number of sides a flat face looks forward.
 */
export function loftRing(
  ring: readonly number[],
  sides: number,
  out: [number, number, number][] = [],
): [number, number, number][] {
  const [y, w, d, dx = 0, dz = 0] = ring as [number, number, number, number?, number?];
  const k = 1 / Math.cos(Math.PI / sides);
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    out.push([dx + (Math.cos(a) * w * k) / 2, y!, dz + (Math.sin(a) * d * k) / 2]);
  }
  return out;
}

/** The points of each convex piece of a loft (two rings each), in its own frame. */
export function loftPieces(rings: readonly (readonly number[])[], sides: number): P3[][] {
  const out: P3[][] = [];
  for (let i = 0; i + 1 < rings.length; i++)
    out.push([...loftRing(rings[i]!, sides), ...loftRing(rings[i + 1]!, sides)]);
  return out;
}

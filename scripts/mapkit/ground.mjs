// Ground from a layout file (MK-6, 2026-11-12): the terrain grid from the layout's slope and
// pads, retaining walls on pads edged `wall`, roads graded level across, and a check of
// what's too steep to walk up. District's generator (DS-2) builds its ground with this.
//
// Why the retaining walls are thick: the terrain is a grid of corner heights, so a sheer
// step can't be in it; every cell the step crosses slopes over its whole width. A wall pad
// is built as a solid band inside its edge, `depth` deep, with the step in the grid hidden
// halfway in, so the sloped cells are under the band. That needs the band to be two cells'
// widths across the step's direction (5.7 m on a 2 m grid at District's −140°). Its top is
// flush with the pad under a drawn cap the terrain's color, so from above it reads as the
// pad; the face is concrete. On a side where the ground outside is higher than the pad (cut into the
// hill), the band's top is the ground outside and its face looks into the pad.
import { drawn, box, group, r2 } from './nodes.mjs';
import { terrainGrid } from './terrain.mjs';

const RAD = Math.PI / 180;

/** Local point in a layout rect (layouts.ts's toLocal). */
function toLocal(r, x, z) {
  const a = r.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - r.x;
  const dz = z - r.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
function toWorld(r, lx, lz) {
  const a = r.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
}
/** How far a point is inside a rect: negative outside, by the nearer side. */
function inside(r, x, z) {
  const [lx, lz] = toLocal(r, x, z);
  return Math.min(r.w / 2 - Math.abs(lx), r.d / 2 - Math.abs(lz));
}
/** How far a point is outside a rect (0 inside). */
function outside(r, x, z) {
  const [lx, lz] = toLocal(r, x, z);
  return Math.hypot(Math.max(0, Math.abs(lx) - r.w / 2), Math.max(0, Math.abs(lz) - r.d / 2));
}
const smooth = (t) => t * t * (3 - 2 * t);

function slopeHeight(layout, x, z) {
  const s = layout.slope;
  if (!s) return 0;
  const dx = s.high[0] - s.low[0];
  const dz = s.high[1] - s.low[1];
  const t = ((x - s.low[0]) * dx + (z - s.low[1]) * dz) / (dx * dx + dz * dz);
  return s.lowY + (s.highY - s.lowY) * Math.min(1, Math.max(0, t));
}

/** Nearest point on a polyline: [x, z, distance, index of its segment, t along it]. */
function nearestOn(points, x, z) {
  let best = [points[0][0], points[0][1], Infinity, 0, 0];
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k];
    const [bx, bz] = points[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const L = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best[2]) best = [px, pz, d, k, t];
  }
  return best;
}

/**
 * @param {object} layout a layout file (content/layouts/<map>.json), as loaded
 * @param {object} [o]
 * @param {number} [o.cellSize] the grid's cell (2 m, as Silver Creek)
 * @param {number} [o.margin] ground past the bounds on every side
 * @param {string} [o.color] the terrain's color, also the retaining walls' caps
 * @param {string} [o.wallColor] retaining walls' faces
 * @param {number} [o.shoulder] how far past a road's edge the ground eases back
 * @param {string[]} [o.grade] road ids graded level across (default all)
 * @param {number} [o.maxGrade] DS-2: roads (not `path`s) keep to this grade along their
 *   length instead of following the pads' banks, and cut through wall pads' bands; left
 *   out, roads follow the ground as it is and stop at walls (MK-6's ground)
 * @param {(x: number, z: number, y: number) => number} [o.carve] DS-2: a last say on each
 *   point's height after the roads (a sunken cut, a berm)
 */
export function layoutGround(layout, o = {}) {
  const {
    cellSize = 2,
    margin = 0,
    color = '#7a7a4c',
    wallColor = '#9a9890',
    shoulder = 4,
    grade,
    maxGrade,
    carve,
  } = o;
  const pads = layout.pads.map((p) => ({ edge: 'bank', blend: 6, yaw: 0, ...p }));
  // A wall pad's band, deep enough to cover the cells the step crosses (see the top).
  const reach = (p) =>
    cellSize * (Math.abs(Math.cos(p.yaw * RAD)) + Math.abs(Math.sin(p.yaw * RAD)));
  const depthOf = (p) => r2(2 * reach(p) + 0.2);

  /** The ground from the slope and pads; a wall pad steps up halfway into its band. */
  function padHeight(x, z) {
    let y = slopeHeight(layout, x, z);
    for (const p of pads) {
      if (p.edge === 'wall') {
        if (inside(p, x, z) >= depthOf(p) / 2) y = p.y;
        continue;
      }
      const d = outside(p, x, z);
      if (d === 0) y = p.y;
      else if (d < p.blend) y += (p.y - y) * smooth(1 - d / p.blend);
    }
    return y;
  }
  const inWallPad = (x, z) => pads.some((p) => p.edge === 'wall' && inside(p, x, z) >= 0);

  const roads = (layout.roads ?? []).filter((r) => !grade || grade.includes(r.id));
  const STEP = 1;
  /** A road's profile: centerline heights each meter, and its height at a nearest point. */
  function profileOf(r, earlier) {
    const pts = r.points;
    const cum = [0];
    for (let k = 1; k < pts.length; k++)
      cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const cuts = maxGrade != null && r.kind !== 'path';
    const total = cum[cum.length - 1];
    const n = Math.max(1, Math.ceil(total / STEP));
    const point = (sd) => {
      let k = 0;
      while (k + 2 < cum.length && cum[k + 1] < sd) k++;
      const t = Math.min(1, Math.max(0, (sd - cum[k]) / (cum[k + 1] - cum[k] || 1)));
      const [ax, az] = pts[k];
      const [bx, bz] = pts[k + 1];
      return [ax + (bx - ax) * t, az + (bz - az) * t];
    };
    let h = null;
    if (cuts) {
      const raw = [];
      for (let i = 0; i <= n; i++) raw.push(padHeight(...point((total * i) / n)));
      // The nearest profile to the ground that keeps to maxGrade: the middle of the highest
      // such line under it and the lowest over it (each keeps to the grade, so does the mean).
      const ds = total / n;
      const lo = raw.map((_, i) =>
        Math.min(...raw.map((p, j) => p + maxGrade * ds * Math.abs(i - j))),
      );
      const hi = raw.map((_, i) =>
        Math.max(...raw.map((p, j) => p - maxGrade * ds * Math.abs(i - j))),
      );
      h = raw.map((_, i) => (lo[i] + hi[i]) / 2);
      // Meet a road it starts or ends on at that road's height, eased in at half the grade.
      for (const [end, i0] of [
        [pts[0], 0],
        [pts[pts.length - 1], n],
      ]) {
        const on = earlier.find((q) => q.cuts && nearestOn(q.r.points, ...end)[2] < 1.5);
        if (!on) continue;
        const [px, pz, , k, t] = nearestOn(on.r.points, ...end);
        const delta = on.at(px, pz, k, t) - h[i0];
        const R = Math.max(8, Math.abs(delta) / (maxGrade / 2));
        for (let i = 0; i <= n; i++) {
          const dist = (Math.abs(i - i0) * total) / n;
          if (dist < R) h[i] += delta * (1 - dist / R);
        }
      }
    }
    /** The road's height at a point on its centerline (segment k, t along it). */
    const at = (px, pz, k, t) => {
      if (!h) return padHeight(px, pz);
      const sd = cum[k] + t * (cum[k + 1] - cum[k]);
      const f = Math.min(n, Math.max(0, (sd / total) * n));
      const i = Math.min(n - 1, Math.floor(f));
      return h[i] + (h[i + 1] - h[i]) * (f - i);
    };
    return { r, cum, cuts, at };
  }
  const profiles = [];
  for (const r of roads) profiles.push(profileOf(r, profiles));
  /**
   * The ground with roads graded: level across each road, eased back over its shoulder. In
   * a wall pad only a road that cuts (maxGrade) changes the ground; under its band the
   * shoulder is hidden in the retaining wall's pieces either side of the road's gap.
   */
  function height(x, z) {
    const y = padHeight(x, z);
    const wall = inWallPad(x, z);
    let best = null;
    for (const pr of profiles) {
      if (wall && !pr.cuts) continue;
      const [px, pz, d, k, t] = nearestOn(pr.r.points, x, z);
      const half = pr.r.width / 2 + 0.5;
      if (d >= half + shoulder) continue;
      if (!best || d < best.d) best = { d, half, cy: pr.at(px, pz, k, t) };
    }
    let h = y;
    if (best && best.d <= best.half) h = best.cy;
    else if (best) h = best.cy + (y - best.cy) * smooth((best.d - best.half) / shoulder);
    return carve ? carve(x, z, h) : h;
  }
  /** Whether a cutting road runs through a point (within its width and half a meter). */
  const onCuttingRoad = (x, z) =>
    profiles.some((pr) => pr.cuts && nearestOn(pr.r.points, x, z)[2] <= pr.r.width / 2 + 0.5);

  const { bounds } = layout;
  const origin = [bounds.x0 - margin, bounds.z0 - margin];
  const cols = Math.ceil((bounds.x1 - bounds.x0 + 2 * margin) / cellSize);
  const rows = Math.ceil((bounds.z1 - bounds.z0 + 2 * margin) / cellSize);
  const grid = terrainGrid({ origin, cellSize, cols, rows, height: (x, z) => r2(height(x, z)) });

  /**
   * Retaining walls round every wall pad: each side in pieces of about `piece` meters, each
   * a solid band from below the lower ground to the higher, with a drawn cap.
   */
  function retainingWalls(piece = 4) {
    const out = [];
    for (const p of pads.filter((q) => q.edge === 'wall')) {
      const depth = depthOf(p);
      const nodes = [];
      const sides = [
        // name, along (local x or z), half-length, which local axis is across, sign
        ['front', 'x', p.w / 2, -1],
        ['back', 'x', p.w / 2, 1],
        ['left', 'z', p.d / 2, -1],
        ['right', 'z', p.d / 2, 1],
      ];
      for (const [name, ax, half, sign] of sides) {
        // Corners: the x sides (front, back) run full width; the z sides fit between them.
        const from = ax === 'x' ? -half : -half + depth;
        const to = ax === 'x' ? half : half - depth;
        const edge0 = ax === 'x' ? (sign * p.d) / 2 : (sign * p.w) / 2;
        // Gaps where a cutting road runs through the band (sampled at its edge and middle).
        const open = (t) =>
          [0, depth / 2, depth].some((q) => {
            const across = edge0 - sign * q;
            return onCuttingRoad(...(ax === 'x' ? toWorld(p, t, across) : toWorld(p, across, t)));
          });
        const spans = [];
        let s0 = null;
        for (let t = from; t <= to + 1e-6; t += 0.25) {
          const shut = !open(t);
          if (shut && s0 === null) s0 = t;
          if (!shut && s0 !== null) {
            spans.push([s0, t - 0.25]);
            s0 = null;
          }
        }
        if (s0 !== null) spans.push([s0, to]);
        const pieces = [];
        for (const [sa, sb] of spans) {
          if (sb - sa < 0.2) continue;
          const m = Math.max(1, Math.round((sb - sa) / piece));
          for (let k = 0; k < m; k++)
            pieces.push([sa + ((sb - sa) * k) / m, sa + ((sb - sa) * (k + 1)) / m]);
        }
        for (let k = 0; k < pieces.length; k++) {
          const [a, b] = pieces[k];
          // Outer face in local coordinates; sample the ground 0.6 m out along it.
          const edge = ax === 'x' ? (sign * p.d) / 2 : (sign * p.w) / 2;
          let lo = Infinity;
          let hi = -Infinity;
          for (let t = a; t <= b + 1e-6; t += Math.max(0.5, (b - a) / 4)) {
            const out = edge + sign * 0.6;
            const [wx, wz] = ax === 'x' ? toWorld(p, t, out) : toWorld(p, out, t);
            const g = grid.groundAt(wx, wz);
            lo = Math.min(lo, g);
            hi = Math.max(hi, g);
          }
          const bottom = Math.min(lo, p.y) - 0.6;
          const top = Math.max(hi, p.y);
          const inner = edge - sign * depth;
          const [l0, l1] = [Math.min(edge, inner), Math.max(edge, inner)];
          const rect = ax === 'x' ? [a, l0, b, l1] : [l0, a, l1, b];
          const id = `${p.id}-wall-${name}-${k + 1}`;
          // Its top flush with the higher ground, never under it: the steep cells hidden in it
          // must stay below its top, or they poke through and the sim won't walk up them.
          nodes.push(box(...rect, bottom - p.y, top - p.y, wallColor, { id }));
          nodes.push(drawn(...rect, top - p.y, top - p.y + 0.05, color, { id: `${id}-cap` }));
        }
      }
      out.push(
        group(`${p.name ?? p.id} retaining walls`, nodes, {
          pos: [r2(p.x), r2(p.y), r2(p.z)],
          ...(p.yaw ? { yaw: r2(p.yaw) } : {}),
        }),
      );
    }
    return out;
  }

  /** Grades along each road's centerline: the steepest over `over` meters, and where. */
  function roadGrades(over = 4) {
    return profiles.map(({ r, cum }) => {
      const total = cum[cum.length - 1];
      let worst = { grade: 0, at: r.points[0] };
      const at = (s) => {
        let k = 0;
        while (k + 2 < cum.length && cum[k + 1] < s) k++;
        const t = (s - cum[k]) / (cum[k + 1] - cum[k] || 1);
        const [ax, az] = r.points[k];
        const [bx, bz] = r.points[k + 1];
        return [ax + (bx - ax) * t, az + (bz - az) * t];
      };
      for (let s = 0; s + over <= total; s += 1) {
        const g = Math.abs(grid.groundAt(...at(s + over)) - grid.groundAt(...at(s))) / over;
        if (g > worst.grade) worst = { grade: g, at: at(s + over / 2) };
      }
      return { id: r.id, length: r2(total), grade: r2(worst.grade), at: worst.at.map(r2) };
    });
  }

  /**
   * Ground too steep to walk up (over 45°), by the pad whose bank it's in (or 'slope'),
   * leaving out wall bands: [{ by, cells, steepest, at }].
   */
  function steep(limit = 1) {
    const cells = grid.steepCells(limit, (x, z) =>
      pads.some((p) => p.edge === 'wall' && Math.abs(inside(p, x, z)) <= depthOf(p) + cellSize),
    );
    const by = new Map();
    for (const [x, z, s] of cells) {
      const p = pads.find((q) => q.edge !== 'wall' && outside(q, x, z) <= q.blend);
      const k = p?.id ?? 'slope';
      const e = by.get(k) ?? { by: k, cells: 0, steepest: 0, at: [0, 0] };
      e.cells++;
      if (s > e.steepest) Object.assign(e, { steepest: r2(s), at: [r2(x), r2(z)] });
      by.set(k, e);
    }
    return [...by.values()];
  }

  return {
    ...grid,
    height,
    /** The ground from the slope and pads alone (no roads), as the grid samples it. */
    padHeight,
    /** Whether a point is in a wall pad's band, where the step is hidden. */
    inWallBand: (x, z) =>
      pads.some((p) => p.edge === 'wall' && Math.abs(inside(p, x, z)) <= depthOf(p)),
    retainingWalls,
    roadGrades,
    steep,
    wallDepth: depthOf,
  };
}

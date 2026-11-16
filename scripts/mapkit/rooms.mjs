// Rooms to walls and slabs (MK, 2026-11-15, for d2's nightclub): a building as a list of
// rectangular rooms, each with the height its walls run (bottom to top), and its doorways;
// out come wall nodes, one per straight run of edge, fitted so no two cut into each other.
//
//   roomWalls({ rooms, openings, inside, outside })  → wall, door and extra nodes
//   union(rects, holes, bottom, top, color)          → boxes covering rects less holes
//
// Rooms: { r: [x0, z0, x1, z1], yb, yt } (yb the floor its walls stand on, yt the ceiling
// they reach). Two rooms sharing an edge share one wall. Where a taller room's wall covers
// a shorter one's on the same line (a two-storey hall beside a wing), the taller one stands
// and the shorter is left out. A wall along x runs on over a corner (covering it) and stops
// at the face of a wall it meets side-on or crosses; a wall along z stops short of a wall
// along x passing its end, unless it carries on past it. Walls with a room on only one side
// (or open air) take the outside color.
//
// Openings: { axis: 'x' | 'z', c, at, w, y, h, glass?, door?, extra? }: a doorway w wide
// centered `at` along the wall on line c (axis 'x': a wall along x at z = c; 'z': along z
// at x = c), from the floor at y (absolute) up h. It goes in whichever wall on that line
// spans y. `door` adds a door node ({ key?, color?, name? }). Openings may not overlap along one
// wall even at different heights (the compiler refuses them), so stagger a storey's.
// docs/tech/editors.md → Map kit.

import { box, r2 } from './nodes.mjs';

const EPS = 1e-6;
const T = 0.1;

/** Intervals [a, b] merged where they touch or overlap. */
function merge(spans) {
  const out = [];
  for (const s of [...spans].sort((p, q) => p[0] - q[0]))
    if (out.length && s[0] <= out.at(-1)[1] + EPS) out.at(-1)[1] = Math.max(out.at(-1)[1], s[1]);
    else out.push([...s]);
  return out;
}

/** Intervals less [a, b]. */
const minus = (spans, [a, b]) =>
  spans.flatMap(([s, e]) =>
    [
      [s, Math.min(e, a)],
      [Math.max(s, b), e],
    ].filter(([p, q]) => q - p > EPS),
  );

const overlapsY = (p, q) => Math.min(p.yt, q.yt) - Math.max(p.yb, q.yb) > EPS;

/** Wall segments {axis, c, a, b, yb, yt}: room edges merged per line and height. */
function segments(rooms) {
  const lines = new Map();
  const put = (axis, c, a, b, yb, yt) => {
    const k = `${axis}|${c}|${yb}|${yt}`;
    const v = lines.get(k) ?? { axis, c, yb, yt, spans: [] };
    v.spans.push([a, b]);
    lines.set(k, v);
  };
  for (const {
    r: [x0, z0, x1, z1],
    yb,
    yt,
  } of rooms) {
    put('x', z0, x0, x1, yb, yt);
    put('x', z1, x0, x1, yb, yt);
    put('z', x0, z0, z1, yb, yt);
    put('z', x1, z0, z1, yb, yt);
  }
  const all = [...lines.values()].map((l) => ({ ...l, spans: merge(l.spans) }));
  const segs = [];
  for (const l of all) {
    let spans = l.spans;
    // A taller wall on the same line covering this one's height wins.
    for (const o of all)
      if (
        o !== l &&
        o.axis === l.axis &&
        Math.abs(o.c - l.c) < EPS &&
        o.yb <= l.yb + EPS &&
        o.yt >= l.yt - EPS
      )
        for (const s of o.spans) spans = minus(spans, s);
    for (const [a, b] of spans) segs.push({ axis: l.axis, c: l.c, a, b, yb: l.yb, yt: l.yt });
  }
  return segs;
}

/** Whether a point at height y is inside a room whose walls span y. */
const inRoom = (rooms, x, z, y) =>
  rooms.some(
    ({ r: [x0, z0, x1, z1], yb, yt }) =>
      x > x0 + EPS && x < x1 - EPS && z > z0 + EPS && z < z1 - EPS && y > yb && y < yt,
  );

/** Whether a segment has open air (no room) on either side anywhere along it. */
function outer(rooms, s) {
  const y = (s.yb + s.yt) / 2;
  const n = Math.max(2, Math.ceil((s.b - s.a) / 1.5));
  for (let k = 0; k <= n; k++) {
    const t = s.a + 0.25 + ((s.b - s.a - 0.5) * k) / n;
    const sides =
      s.axis === 'x'
        ? [
            [t, s.c - 0.3],
            [t, s.c + 0.3],
          ]
        : [
            [s.c - 0.3, t],
            [s.c + 0.3, t],
          ];
    if (sides.some(([x, z]) => !inRoom(rooms, x, z, y))) return true;
  }
  return false;
}

export function roomWalls({ rooms, openings = [], inside, outside, thick = 0.2 }) {
  const segs = segments(rooms);
  const xs = segs.filter((s) => s.axis === 'x');
  const zs = segs.filter((s) => s.axis === 'z');
  const nodes = [];
  const used = new Set();

  for (const s of xs) {
    const end = (x, out) => {
      const at = zs.filter(
        (w) => Math.abs(w.c - x) < EPS && overlapsY(w, s) && s.c >= w.a - EPS && s.c <= w.b + EPS,
      );
      if (!at.length) return x;
      // Through the middle of one, or where two meet end to end: stop at its face.
      const through =
        at.some((w) => s.c > w.a + EPS && s.c < w.b - EPS) ||
        (at.some((w) => Math.abs(w.b - s.c) < EPS) && at.some((w) => Math.abs(w.a - s.c) < EPS));
      return through ? x - out * T : x + out * T;
    };
    nodes.push(wall(s, end(s.a, -1), end(s.b, 1)));
  }
  for (const s of zs) {
    const end = (z, out) => {
      const goesOn = zs.some(
        (w) =>
          w !== s &&
          Math.abs(w.c - s.c) < EPS &&
          overlapsY(w, s) &&
          (out < 0 ? Math.abs(w.b - z) < EPS : Math.abs(w.a - z) < EPS),
      );
      if (goesOn) return z;
      const passes = xs.some(
        (w) => Math.abs(w.c - z) < EPS && overlapsY(w, s) && s.c >= w.a - EPS && s.c <= w.b + EPS,
      );
      return passes ? z - out * T : z;
    };
    nodes.push(wall(s, end(s.a, -1), end(s.b, 1)));
  }

  function wall(s, a, b) {
    const mid = (a + b) / 2;
    const ops = openings.filter(
      (o) =>
        o.axis === s.axis &&
        Math.abs(o.c - s.c) < EPS &&
        o.y >= s.yb - EPS &&
        o.y < s.yt - EPS &&
        o.at > s.a &&
        o.at < s.b,
    );
    for (const o of ops) used.add(o);
    return {
      type: 'wall',
      pos: s.axis === 'x' ? [r2(mid), r2(s.yb), r2(s.c)] : [r2(s.c), r2(s.yb), r2(mid)],
      ...(s.axis === 'z' ? { yaw: 90 } : {}),
      size: [r2(b - a), r2(s.yt - s.yb), thick],
      color: outer(rooms, s) ? outside : inside,
      openings: ops.map((o) => ({
        along: r2(s.axis === 'x' ? o.at - mid : mid - o.at),
        width: o.w,
        bottom: r2(o.y - s.yb),
        top: r2(o.y - s.yb + o.h),
        ...(o.glass ? { glass: o.glass } : {}),
      })),
    };
  }

  const missed = openings.filter((o) => !used.has(o));
  if (missed.length)
    throw new Error(
      `openings on no wall: ${missed.map((o) => `${o.axis} ${o.c} @${o.at} y${o.y}`).join(', ')}`,
    );

  for (const o of openings)
    if (o.door) {
      const [x, z] = o.axis === 'x' ? [o.at, o.c] : [o.c, o.at];
      nodes.push({
        type: 'door',
        pos: [r2(x), r2(o.y), r2(z)],
        ...(o.axis === 'z' ? { yaw: 90 } : {}),
        size: [r2(o.w - 0.04), r2(o.h - 0.02)],
        ...(o.door.key ? { key: o.door.key, thickness: 0.12 } : {}),
        ...(o.door.name ? { name: o.door.name } : {}),
        color: o.door.color ?? '#6a6e72',
      });
    }
  return nodes;
}

/** Boxes covering a union of rects [x0, z0, x1, z1] less holes, merged band by band. */
export function union(rects, holes, bottom, top, color, extra = {}) {
  const all = [...rects, ...holes];
  const xs = [...new Set(all.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const zs = [...new Set(all.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const inside = (rs, x, z) => rs.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
  const bands = [];
  for (let j = 0; j < zs.length - 1; j++) {
    const z = (zs[j] + zs[j + 1]) / 2;
    const runs = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const x = (xs[i] + xs[i + 1]) / 2;
      if (!inside(rects, x, z) || inside(holes, x, z)) continue;
      if (runs.length && runs.at(-1)[1] === xs[i]) runs.at(-1)[1] = xs[i + 1];
      else runs.push([xs[i], xs[i + 1]]);
    }
    const prev = bands.at(-1);
    if (prev && prev.z1 === zs[j] && JSON.stringify(prev.runs) === JSON.stringify(runs))
      prev.z1 = zs[j + 1];
    else bands.push({ z0: zs[j], z1: zs[j + 1], runs });
  }
  return bands.flatMap(({ z0, z1, runs }) =>
    runs.map(([x0, x1]) => box(x0, z0, x1, z1, bottom, top, color, extra)),
  );
}

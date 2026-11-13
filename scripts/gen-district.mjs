// Generates District's bones graybox (roadmap DS-2): content/maps/district.json and its
// dev-only raid, from the layout file content/layouts/district.json (edit it on the board at
// /layout?map=district, then re-run). Terrain from the layout's slope and pads with roads
// held to a grade, the sunken rail cut and culvert, the storm drain under the forecourt,
// every area as boxes (district-build.mjs), landmarks as tall blocks, the in-between's zones
// as labels, invisible walls on the play edge. Detail: docs/design/maps/district.md.
// Re-runs keep what the user made or changed by hand (MK-2, scripts/mapkit/generated.mjs).
//
//   node scripts/gen-district.mjs [--dry-run] [--reclaim <key>,… | all] [--dump <file>]
import { buildAreas, C } from './district-build.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGenerated, writeOnce } from './mapkit/generated.mjs';
import { layoutGround } from './mapkit/ground.mjs';
import { importTs, readContent } from './mapkit/import-ts.mjs';
import { box, drawn, group, label, r2, yawAlongX } from './mapkit/nodes.mjs';
import { roadStrip } from './mapkit/road.mjs';
import { runDownFrom, runLength, stairRun } from './mapkit/runs.mjs';
import { frame } from './mapkit/frame.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = resolve(ROOT, 'content/maps/district.json');
const RAID_FILE = resolve(ROOT, 'content/raids/district.json');

const lib = await importTs();
const layout = lib.loadLayout(
  readContent('layouts/district.json'),
  'content/layouts/district.json',
);
const byId = (list, id) => {
  const v = list.find((q) => q.id === id);
  if (!v) throw new Error(`layout: no "${id}"`);
  return v;
};
const road = (id) => byId(layout.roads, id);
const zone = (id) => byId(layout.zones, id);

const CELL = 2;
const MARGIN = 20;
/** Vehicle roads keep under this grade along their length (real streets: under 10%). */
const MAX_GRADE = 0.08;
/** How far past a road the ground eases back: 5 m keeps road cuts in banks under 45°. */
const SHOULDER = 5;
const TERRAIN = '#7d7b5a';
const COLORS = { road: '#4a4a4c', service: '#5c5c5e', path: '#8a857a', ballast: '#6b6258' };
/** Roads graded level across; the sunken ones are carved instead, the drain is underground. */
const SUNKEN = ['rail-cut', 'culvert', 'storm-drain'];
const GRADED = layout.roads.map((r) => r.id).filter((id) => !SUNKEN.includes(id));

// ---------------------------------------------------------------- lines and polygons

function nearestOn(points, x, z) {
  let best = { d: Infinity, s: 0 };
  let acc = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k];
    const [bx, bz] = points[k + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.hypot(dx, dz) || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (L * L)));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best.d) best = { d, s: acc + t * L };
    acc += L;
  }
  return best;
}
function lengthOf(points) {
  let L = 0;
  for (let k = 1; k < points.length; k++)
    L += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return L;
}
/** The point and direction at distance s along a polyline. */
function pointAt(points, s) {
  let acc = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, az] = points[k];
    const [bx, bz] = points[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (s <= acc + L || k + 2 === points.length) {
      const t = Math.min(1, Math.max(0, (s - acc) / L));
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L };
    }
    acc += L;
  }
}
function insidePoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------- the sunken routes

const pre = layoutGround(layout, {
  cellSize: CELL,
  margin: MARGIN,
  maxGrade: MAX_GRADE,
  grade: GRADED,
  shoulder: SHOULDER,
});

/**
 * The rail cut (design/maps/district.md → the station): a straight cut along the south-west
 * edge, measured from its first point along the tracks (s) and across them (off, + toward
 * the station). Track 2 (the train) at off 0, track 1 at 16; its floor runs off −8 to 20,
 * level at 8 m through the station (s 100 on) and rising 2% to the north-west, where it's
 * about 5 m under the hill. Its banks rise 0.8 a meter.
 */
const RAIL = (() => {
  const [a, b] = road('rail-cut').points;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const frameOf = (x, z) => {
    const rx = x - a[0];
    const rz = z - a[1];
    return { s: rx * dir[0] + rz * dir[1], off: rx * dir[1] - rz * dir[0] };
  };
  const at = (s, off) => [a[0] + dir[0] * s + dir[1] * off, a[1] + dir[1] * s - dir[0] * off];
  const bed = (s) => (s >= 100 ? 8 : 8 + (100 - s) * 0.02);
  return { a, dir, L, frameOf, at, bed, floor: [-8, 20], bank: 0.8, tracks: [0, 16] };
})();

/**
 * The culvert (the covered way across the flats): a concrete channel 5 m across and 2.8 m
 * deep, its walls too steep to climb, rising to the ground over its last 14 m at the east
 * end, with a ramp out at the bend. Its west end is the storm drain's mouth.
 */
const CULVERT = (() => {
  const pts = road('culvert').points;
  const L = lengthOf(pts);
  const depthAt = (s) => (s > L - 14 ? (2.8 * (L - s)) / 14 : 2.8);
  const floorAt = (s) => {
    const p = pointAt(pts, Math.max(0, Math.min(L, s)));
    return pre.groundAt(p.x, p.z) - depthAt(Math.max(0, s));
  };
  // The ramp out at the bend, north, 12 m.
  const bend = pts[1];
  const p = pointAt(pts, Math.hypot(bend[0] - pts[0][0], bend[1] - pts[0][1]) + 0.01);
  const ramp = [bend, [bend[0] + p.dz * 12, bend[1] - p.dx * 12]];
  return { pts, L, floorAt, half: 2.5, wall: 2.5, ramp, sBend: nearestOn(pts, ...bend).s };
})();

/** The finished ground's last say: the rail cut and the culvert dug in. */
function carve(x, z, y) {
  const { s, off } = RAIL.frameOf(x, z);
  const out =
    off < RAIL.floor[0] ? RAIL.floor[0] - off : off > RAIL.floor[1] ? off - RAIL.floor[1] : 0;
  y = Math.min(y, RAIL.bed(s) + out * RAIL.bank);
  const c = nearestOn(CULVERT.pts, x, z);
  if (c.d < 12)
    y = Math.min(y, CULVERT.floorAt(c.s) + Math.max(0, c.d - CULVERT.half) * CULVERT.wall);
  const r = nearestOn(CULVERT.ramp, x, z);
  if (r.d < 8) {
    const t = r.s / 12;
    const g = pre.groundAt(...CULVERT.ramp[1]);
    const fy = CULVERT.floorAt(CULVERT.sBend) * (1 - t) + g * t;
    y = Math.min(y, fy + Math.max(0, r.d - 2) * CULVERT.wall);
  }
  return y;
}

const ground = layoutGround(layout, {
  cellSize: CELL,
  margin: MARGIN,
  color: TERRAIN,
  maxGrade: MAX_GRADE,
  shoulder: SHOULDER,
  grade: GRADED,
  carve,
});
const { groundAt } = ground;

/**
 * The storm drain: a box tunnel from the culvert's west end under the lot and the forecourt
 * to the mall's service door, 2.6 m wide and 2.5 high inside, its floor rising 3% from the
 * culvert's but kept 3.2 m under the ground; it comes up by stairs in a pit by the door.
 */
const DRAIN = (() => {
  const pts = road('storm-drain').points;
  const L = lengthOf(pts);
  const f0 = CULVERT.floorAt(0);
  // Sampled each meter: rising 3% from the culvert's floor, at least 3.2 m under the ground,
  // then the highest line under that which keeps to 8% (no steps over a bank above it).
  const n = Math.ceil(L);
  const want = Array.from({ length: n + 1 }, (_, i) => {
    const p = pointAt(pts, (L * i) / n);
    return Math.min(f0 + 0.03 * ((L * i) / n), pre.groundAt(p.x, p.z) - 3.2);
  });
  const held = want.map((_, i) =>
    Math.min(...want.map((w, j) => w + (0.08 * L * Math.abs(i - j)) / n)),
  );
  const floorAt = (s) => {
    const f = Math.min(n, Math.max(0, (s / L) * n));
    const i = Math.min(n - 1, Math.floor(f));
    return held[i] + (held[i + 1] - held[i]) * (f - i);
  };
  return { pts, L, floorAt, inner: 2.6, height: 2.5 };
})();

function buildDrain() {
  const nodes = [];
  const { pts, L, inner, height } = DRAIN;
  const PIECE = 3;
  const T = 0.3;
  const W = 3;
  // The drain's line ends at the mall's service door but its last stretch runs under the
  // mall's front corner, so it stops (with the pit and its landing) 1 m short of the mall;
  // DS-5 takes it on into the service corridors. The pit's stairs are measured first so the
  // tunnel stops at their foot.
  const mall = byId(layout.areas, 'mall-main');
  let stop = 0;
  while (
    stop < L &&
    lib.rectDistance(mall, pointAt(pts, stop).x, pointAt(pts, stop).z) > inner / 2 + W + 1
  )
    stop += 0.5;
  const rise0 = (() => {
    const p = pointAt(pts, stop);
    return pre.groundAt(p.x, p.z);
  })();
  const pitRun = (rise) =>
    runLength('stairs', {
      id: 'x',
      rise,
      width: inner,
      flight: 2,
      turn: 'straight',
      color: C.stairs,
    }).length;
  const end = stop - 3 - pitRun(rise0 - DRAIN.floorAt(stop - 10)) - 0.3;
  // Footprints that open the ground over them: a cell is opened when all its corners are
  // inside them (together), so what's built fills every opened cell.
  const prints = [];
  let k = 0;
  // Pieces of about PIECE meters along each stretch, end to end; at a bend the two pieces
  // reach on far enough to close the wedge between them.
  const stretches = [];
  for (let i = 0, acc = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    stretches.push({ s0: acc, s1: acc + len, dir: pointAt(pts, acc + len / 2) });
    acc += len;
  }
  const reach = (i) => {
    const [p, q] = [stretches[i - 1].dir, stretches[i].dir];
    const turn = Math.acos(Math.min(1, p.dx * q.dx + p.dz * q.dz));
    return (inner / 2 + W) * Math.tan(turn / 2);
  };
  for (const [i, st] of stretches.entries()) {
    const hi = Math.min(st.s1, end);
    if (hi <= st.s0) continue;
    const n = Math.ceil((hi - st.s0) / PIECE);
    for (let j = 0; j < n; j++) {
      const s = st.s0 + ((hi - st.s0) * j) / n;
      const s1 = st.s0 + ((hi - st.s0) * (j + 1)) / n;
      const p = pointAt(pts, (s + s1) / 2);
      const y = r2(DRAIN.floorAt((s + s1) / 2));
      // Local +z along the drain.
      const f = frame({ x: p.x, z: p.z, yaw: r2((Math.atan2(p.dx, p.dz) * 180) / Math.PI) }, y);
      const z0 = -(s1 - s) / 2 - (j === 0 && i > 0 ? reach(i) : 0);
      const z1 =
        (s1 - s) / 2 + (j === n - 1 && hi === st.s1 && i + 1 < stretches.length ? reach(i + 1) : 0);
      // The nav sees nothing under the terrain, so the ground over the whole drain is opened
      // (as Silver Creek's mill race tunnel): its walls and roof fill the opened cells up to
      // the ground's height, under a cap in the terrain's color.
      const top = Math.max(height + T, groundAt(p.x, p.z) - y);
      const id = `drain-${++k}`;
      const hw = inner / 2;
      nodes.push(
        f.group(id, [
          box(-hw - W, z0, hw + W, z1, -0.4, 0, C['dark-concrete'], { id: `${id}-floor` }),
          box(-hw - W, z0, -hw, z1, 0, top, C['dark-concrete'], { id: `${id}-wall-l` }),
          box(hw, z0, hw + W, z1, 0, top, C['dark-concrete'], { id: `${id}-wall-r` }),
          box(-hw, z0, hw, z1, height, top, C['dark-concrete'], { id: `${id}-roof` }),
          drawn(-hw - W, z0, hw + W, z1, top, top + 0.03, TERRAIN, { id: `${id}-cap` }),
        ]),
      );
      prints.push({ f, hx: hw + W, z0, z1 });
    }
  }
  // The pit by the mall's service door: stairs up to the ground, walls round, a rail, and a
  // landing at the top where the ground is opened over the stairs.
  const y = r2(DRAIN.floorAt(end));
  const p = pointAt(pts, end);
  const f = frame({ x: p.x, z: p.z, yaw: r2((Math.atan2(p.dx, p.dz) * 180) / Math.PI) }, y);
  const len = pitRun(rise0 - y);
  const gTop = r2(
    Math.max(...[0, len / 2, len + 1].map((lz) => groundAt(...f.toWorld(0, lz)))) - y,
  );
  const { node } = stairRun({
    id: 'drain-pit-stairs',
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    rise: gTop,
    width: inner,
    flight: 2,
    turn: 'straight',
    color: C.stairs,
  });
  const run = runLength('stairs', {
    id: 'x',
    rise: gTop,
    width: inner,
    flight: 2,
    turn: 'straight',
    color: C.stairs,
  }).length;
  const hw = inner / 2;
  nodes.push(
    f.group('drain-pit', [
      node,
      box(-hw, 0, hw, 0.3, -0.4, 0, C['dark-concrete'], { id: 'drain-pit-sill' }),
      box(-hw - W, 0, -hw, run, -0.4, gTop, C['dark-concrete'], { id: 'drain-pit-wall-l' }),
      box(hw, 0, hw + W, run, -0.4, gTop, C['dark-concrete'], { id: 'drain-pit-wall-r' }),
      box(-hw - W, run, hw + W, run + 3, -0.4, gTop, C['dark-concrete'], {
        id: 'drain-pit-landing',
      }),
      box(-hw - 0.1, 0, -hw, run, gTop, gTop + 1.05, C.rail, { id: 'drain-pit-rail-l' }),
      box(hw, 0, hw + 0.1, run, gTop, gTop + 1.05, C.rail, { id: 'drain-pit-rail-r' }),
      box(-hw - 0.1, -0.4, hw + 0.1, 0, gTop, gTop + 1.05, C.rail, { id: 'drain-pit-rail-end' }),
    ]),
  );
  prints.push({ f, hx: hw + W, z0: 0, z1: run + 3 });

  const holes = new Set();
  const { origin, cellSize, cols, rows } = ground;
  const covering = ([x, z]) =>
    prints.filter(({ f: q, hx, z0, z1 }) => {
      const [lx, lz] = q.toLocal(x, z);
      return Math.abs(lx) <= hx + 1e-6 && lz >= z0 - 1e-6 && lz <= z1 + 1e-6;
    });
  for (const pr of prints) {
    const [cx, cz] = pr.f.toWorld(0, (pr.z0 + pr.z1) / 2);
    const R = Math.hypot(pr.hx, (pr.z1 - pr.z0) / 2) + cellSize;
    for (
      let i = Math.floor((cx - R - origin[0]) / cellSize);
      i <= (cx + R - origin[0]) / cellSize;
      i++
    )
      for (
        let j = Math.floor((cz - R - origin[1]) / cellSize);
        j <= (cz + R - origin[1]) / cellSize;
        j++
      ) {
        if (i < 0 || j < 0 || i >= cols || j >= rows || holes.has(`${i},${j}`)) continue;
        const corners = [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ].map(([a, b]) => [origin[0] + a * cellSize, origin[1] + b * cellSize]);
        const over = corners.map(covering);
        if (over.some((o) => !o.length)) continue;
        holes.add(`${i},${j}`);
      }
  }
  return { node: group('Storm drain', nodes), holes };
}
const drain = buildDrain();

// ---------------------------------------------------------------- areas and landmarks

const poiColor = (a) => layout.pois[a.poi]?.color ?? '#888888';
const floorOf = (a) => r2(a.y ?? ground.padHeight(a.x, a.z));
const areas = buildAreas(layout, { floorOf, groundAt, poiColor, rail: RAIL });

const landmarks = layout.landmarks.map((m) => {
  // The hotel's tower stands on its three full floors (lobby, kitchen, two floors); the rest
  // of its height is a facade.
  const hotel = byId(layout.areas, 'hotel-main');
  const base =
    m.id === 'hotel-tower'
      ? floorOf(hotel) + hotel.floors * hotel.floorHeight + 0.3
      : groundAt(m.x, m.z);
  const f = frame(m, r2(base));
  const color = m.id === 'hotel-tower' ? '#8a4f9e' : '#c9a227';
  const top = m.id === 'hotel-tower' ? m.height - (base - groundAt(m.x, m.z)) : m.height;
  const nodes = [
    box(-m.w / 2, -m.d / 2, m.w / 2, m.d / 2, m.id === 'hotel-tower' ? 0 : -0.5, top, color, {
      id: `${m.id}-mast`,
      landmark: true,
    }),
  ];
  if (m.id === 'crane')
    nodes.push(
      box(-10, -0.8, 40, 0.8, m.height - 2, m.height - 0.5, color, {
        id: 'crane-jib',
        collide: false,
        landmark: true,
      }),
    );
  return f.group(m.name ?? m.id, nodes);
});

// ---------------------------------------------------------------- roads, edges, labels

/** Where a road crosses the culvert it rides a deck at its own grade (the culvert runs under). */
const SPAN = CULVERT.half + 1.4;
function culvertBridges() {
  const out = [];
  for (const r of layout.roads.filter((q) => GRADED.includes(q.id) && q.kind !== 'path')) {
    const L = lengthOf(r.points);
    let s0 = null;
    for (let s = 0; s <= L + 0.5; s += 0.5) {
      const p = pointAt(r.points, Math.min(s, L));
      const over = s <= L && nearestOn(CULVERT.pts, p.x, p.z).d < SPAN + r.width / 2;
      if (over && s0 === null) s0 = s;
      if (!over && s0 !== null) {
        const p = pointAt(r.points, (s0 + s) / 2);
        const y = r2(pre.groundAt(p.x, p.z));
        const f = frame({ x: p.x, z: p.z, yaw: r2((Math.atan2(p.dx, p.dz) * 180) / Math.PI) }, y);
        const hl = (s - s0) / 2 + 1;
        const hw = r.width / 2 + 0.6;
        const id = `${r.id}-culvert-bridge-${out.length + 1}`;
        out.push(
          f.group(id, [
            box(-hw, -hl, hw, hl, -0.5, 0.02, C['dark-concrete'], { id: `${id}-deck` }),
            box(-hw, -hl, -hw + 0.25, hl, 0.02, 0.9, C.wall, { id: `${id}-side-l` }),
            box(hw - 0.25, -hl, hw, hl, 0.02, 0.9, C.wall, { id: `${id}-side-r` }),
          ]),
        );
        s0 = null;
      }
    }
  }
  return out;
}
const bridges = culvertBridges();
/** Road strips lie on the ground before the culvert was dug (decks carry them over it). */
const roads = group(
  'Roads',
  layout.roads
    .filter((r) => !SUNKEN.includes(r.id))
    .flatMap((r) =>
      roadStrip(r.id, r.points, r.width, {
        groundAt: (x, z) =>
          Math.max(
            groundAt(x, z),
            nearestOn(CULVERT.pts, x, z).d < SPAN + r.width ? pre.groundAt(x, z) : -Infinity,
          ),
        color: COLORS[r.kind ?? 'road'] ?? COLORS.road,
      }),
    ),
);

/**
 * Stairs where a path crosses a wall pad's edge (the hotel steps off the plaza level): down
 * off the band's top when the pad is the higher side, up out of the pad when it's cut in.
 */
function wallStairs() {
  const RAD = Math.PI / 180;
  const out = [];
  for (const pad of layout.pads.filter((q) => q.edge === 'wall')) {
    const pf = frame(pad);
    const depth = ground.wallDepth(pad);
    const inPad = (x, z) => {
      const [lx, lz] = pf.toLocal(x, z);
      return Math.abs(lx) <= pad.w / 2 && Math.abs(lz) <= pad.d / 2;
    };
    for (const r of layout.roads.filter((q) => q.kind === 'path' && !SUNKEN.includes(q.id))) {
      const L = lengthOf(r.points);
      let was = null;
      for (let s = 0; s <= L; s += 0.25) {
        const p = pointAt(r.points, s);
        const now = inPad(p.x, p.z);
        if (was !== null && now !== was) {
          // The side it crosses, and that side's outward normal, in the pad's frame.
          const [lx, lz] = pf.toLocal(p.x, p.z);
          const ex = pad.w / 2 - Math.abs(lx);
          const ez = pad.d / 2 - Math.abs(lz);
          const local = Math.abs(ex) < Math.abs(ez) ? [Math.sign(lx), 0] : [0, Math.sign(lz)];
          const edge = local[0] ? [local[0] * (pad.w / 2), lz] : [lx, local[1] * (pad.d / 2)];
          const n = [
            local[0] * Math.cos(pad.yaw * RAD) + local[1] * Math.sin(pad.yaw * RAD),
            -local[0] * Math.sin(pad.yaw * RAD) + local[1] * Math.cos(pad.yaw * RAD),
          ];
          const [ex0, ez0] = pf.toWorld(...edge);
          const outside = groundAt(ex0 + n[0] * 3, ez0 + n[1] * 3);
          const id = `${r.id}-wall-stairs-${out.length + 1}`;
          const climbIn = r2((Math.atan2(-n[0], -n[1]) * 180) / Math.PI);
          if (pad.y > outside + 0.3) {
            const { node } = runDownFrom('stairs', {
              id,
              top: [ex0 + n[0] * 0.05, ez0 + n[1] * 0.05],
              topY: pad.y,
              yaw: climbIn,
              width: r.width,
              turn: 'straight',
              groundAt,
              color: C.stairs,
            });
            out.push(node);
          } else if (outside > pad.y + 0.3) {
            const top = [ex0 - n[0] * (depth - 0.05), ez0 - n[1] * (depth - 0.05)];
            const { node } = runDownFrom('stairs', {
              id,
              top,
              topY: outside,
              yaw: r2(climbIn + 180),
              width: r.width,
              turn: 'straight',
              groundAt: () => pad.y,
              color: C.stairs,
            });
            out.push(node);
          }
        }
        was = now;
      }
    }
  }
  return out;
}
const pathStairs = wallStairs();
const tracks = group(
  'Rail tracks',
  RAIL.tracks
    .map((off, k) => {
      const pts = [RAIL.at(-30, off), RAIL.at(100, off), RAIL.at(230, off)];
      return roadStrip(`track-${k + 1}`, pts, 2.6, { groundAt, color: COLORS.ballast });
    })
    .flat(),
);
const culvertFloor = group(
  'Culvert floor',
  roadStrip('culvert-floor', CULVERT.pts, 4.4, { groundAt, color: '#8d8a82' }),
);

/** Invisible walls just outside each side of the play edge. */
const play = zone('play-area').points;
const edges = group(
  'Edges',
  play.map(([ax, az], i) => {
    const [bx, bz] = play[(i + 1) % play.length];
    const L = Math.hypot(bx - ax, bz - az);
    let [nx, nz] = [(bz - az) / L, -(bx - ax) / L];
    if (insidePoly(play, (ax + bx) / 2 + nx, (az + bz) / 2 + nz)) [nx, nz] = [-nx, -nz];
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t <= 1; t += 1 / Math.ceil(L / 2)) {
      const g = groundAt(ax + (bx - ax) * t + nx, az + (bz - az) * t + nz);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    const f = frame(
      {
        x: (ax + bx) / 2 + nx * 0.5,
        z: (az + bz) / 2 + nz * 0.5,
        yaw: yawAlongX([ax, az], [bx, bz]),
      },
      r2(lo - 2),
    );
    return f.group(`edge-${i + 1}`, [
      box(-L / 2 - 0.5, -0.5, L / 2 + 0.5, 0.5, 0, hi - lo + 14, '#5a8ab8', {
        id: `edge-${i + 1}`,
        invisible: true,
      }),
    ]);
  }),
);
// A bad table fails loudly.
if (!insidePoly(play, byId(layout.areas, 'mall-main').x, byId(layout.areas, 'mall-main').z))
  throw new Error('play-area: the mall is outside the play edge');

/** A map label's text: a name up to its first bracket or colon, at most 40 characters. */
const short = (name) => name.split(/ \(|: /)[0].slice(0, 40);
const centroid = (pts) => [
  pts.reduce((a, p) => a + p[0], 0) / pts.length,
  pts.reduce((a, p) => a + p[1], 0) / pts.length,
];
const labels = group('Labels', [
  ...Object.entries(layout.pois).map(([id, p]) => {
    const as = layout.areas.filter((a) => a.poi === id);
    const [x, z] = centroid(as.map((a) => [a.x, a.z]));
    return label(short(p.name), r2(x), r2(z), 'area', r2(groundAt(x, z)));
  }),
  ...layout.zones
    .filter(
      (zn) =>
        !['play-area', 'escarpment', 'embankment'].includes(zn.id) && !zn.id.startsWith('exit-'),
    )
    .map((zn) => {
      const [x, z] = centroid(zn.points);
      return label(short(zn.name ?? zn.id), r2(x), r2(z), undefined, r2(groundAt(x, z)));
    }),
  (() => {
    const p = pointAt(DRAIN.pts, DRAIN.L / 2);
    return label('Storm drain', r2(p.x), r2(p.z), undefined, r2(DRAIN.floorAt(DRAIN.L / 2)));
  })(),
]);

/** The in-between's zones drawn on the ground as low posts round their outline (not built yet). */
const zoneMarks = group(
  'Zone marks',
  layout.zones
    .filter((zn) => !['play-area', 'escarpment', 'embankment'].includes(zn.id))
    .flatMap((zn) =>
      zn.points.map(([x, z], k) =>
        drawn(
          x - 0.2,
          z - 0.2,
          x + 0.2,
          z + 0.2,
          groundAt(x, z) - 0.3,
          groundAt(x, z) + 1.2,
          zn.id.startsWith('exit-') ? '#3fae5a' : '#d0a040',
          {
            id: `${zn.id}-mark-${k + 1}`,
          },
        ),
      ),
    ),
);

// ---------------------------------------------------------------- spawns and extractions

/** Test only (as Northpoint's were): one spawn by the hill road, the edge zones as exits. */
const testSpawn = (() => {
  const [x, z] = [150, 262];
  return { type: 'playerSpawn', id: 'test-1', pos: [x, r2(groundAt(x, z)), z], yaw: 40 };
})();
const extractions = layout.zones
  .filter((zn) => zn.id.startsWith('exit-'))
  .map((zn) => {
    const [x, z] = centroid(zn.points);
    const y = zn.id === 'exit-train' ? RAIL.bed(150) + 1 : groundAt(x, z);
    return {
      id: zn.id.replace(/^exit-/, ''),
      name: `${(zn.name ?? zn.id).replace(/^Extract( \(conditional\))?: /, '')} (test)`,
      points: zn.points.map(([px, pz]) => [r2(px), r2(pz)]),
      extraction: { y: r2(y - 1), height: 5 },
    };
  });

// ---------------------------------------------------------------- the map

const holes = [...drain.holes]
  .map((k) => k.split(',').map(Number))
  .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const map = {
  formatVersion: 4,
  id: 'district',
  name: 'District',
  environment: { sky: '#a9b2b6', fogNear: 45, fogFar: 120 },
  terrain: ground.node(TERRAIN, holes.length ? holes : undefined),
  nodes: [
    group('Spawns', [testSpawn]),
    ...ground.retainingWalls(),
    roads,
    group('Road bridges', bridges),
    group('Wall stairs', pathStairs),
    tracks,
    culvertFloor,
    drain.node,
    group('Areas', areas),
    group('Landmarks', landmarks),
    edges,
    zoneMarks,
    labels,
  ],
  zones: extractions,
};

const raid = {
  formatVersion: 1,
  id: 'district',
  name: 'District',
  map: 'district',
  duration: 1500,
  order: 3,
  tags: ['test'],
  dev: true,
};

// What the table gives, for the session's notes: steep ground, road grades.
const argv = process.argv.slice(2);
if (argv.includes('--report')) {
  console.table(ground.steep());
  // Roads over the culvert ride decks, so their grades are read off the ground before it.
  console.table(pre.roadGrades().filter((g) => g.grade > 0.1));
  console.table(pathStairs.map((n) => ({ id: n.name, at: n.pos, yaw: n.yaw })));
  console.table(bridges.map((n) => ({ id: n.name, at: n.pos })));
}
await writeGenerated({
  file: MAP_FILE,
  map,
  by: fileURLToPath(import.meta.url),
  root: ROOT,
  argv: argv.filter((a) => a !== '--report'),
});
await writeOnce({
  file: RAID_FILE,
  doc: raid,
  root: ROOT,
  argv: argv.filter((a) => a !== '--report'),
});

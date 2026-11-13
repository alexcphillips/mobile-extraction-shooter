// Generates District's bones (roadmap DS-2, split at RD-1): content/maps/district.json and
// its dev-only raid, from the layout file content/layouts/district.json (edit it on the board
// at /layout?map=district, then re-run). Every area as boxes (district-build.mjs) standing on
// the map's terrain, with a foundation down to the lowest ground under it; landmarks as tall
// blocks; the in-between's zones as labels; invisible walls on the play edge.
//
// The terrain and the roads are the user's (RD-1, 2026-11-12): shaped and drawn in the editor
// (/editor?map=district, G and O). The script only seeds them when the map has none: the
// layout's slope with nothing on it, and the layout's roads and the rail tracks as map roads.
// `--reseed terrain` (or roads) starts one over from the seed. Everything the script places
// stands on the terrain as the game grades it under the roads.
// Re-runs keep what the user made or changed by hand (MK-2, scripts/mapkit/generated.mjs).
// Detail: docs/design/maps/district.md.
//
//   node scripts/gen-district.mjs [--report] [--dry-run] [--reclaim <key>,… | all]
//                                 [--reseed terrain,roads] [--dump <file>]
import { buildAreas } from './district-build.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seededFields, writeGenerated, writeOnce } from './mapkit/generated.mjs';
import { layoutGround } from './mapkit/ground.mjs';
import { importTs, readContent } from './mapkit/import-ts.mjs';
import { box, drawn, group, label, r2, yawAlongX } from './mapkit/nodes.mjs';
import { frame } from './mapkit/frame.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = resolve(ROOT, 'content/maps/district.json');
const RAID_FILE = resolve(ROOT, 'content/raids/district.json');
const argv = process.argv.slice(2);

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
const TERRAIN = '#7d7b5a';
/** Road colors by the layout's kind (asphalt is ROAD.color, left out). */
const KIND_COLORS = { service: '#5c5c5e', path: '#8a857a' };
const BALLAST = '#6b6258';
/** Seeded vehicle roads keep under this grade along their length (real streets: under 10%). */
const MAX_GRADE = 0.08;
/** The layout's sunken routes: dug by hand in the editor now (the storm drain is gone). */
const SUNKEN = ['rail-cut', 'culvert', 'storm-drain'];

// ---------------------------------------------------------------- lines and polygons

function insidePoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------- the rail line

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

// ---------------------------------------------------------------- the ground (seeded)

/** The seed terrain: the layout's slope alone, no pads, no cuts. Shaped by hand from here. */
function seedTerrain() {
  const ground = layoutGround(
    { ...layout, pads: [] },
    {
      cellSize: CELL,
      margin: MARGIN,
      color: TERRAIN,
      grade: [],
    },
  );
  return ground.node(TERRAIN);
}

/** The seed roads: the layout's (main roads first, as listed), then the rail tracks. */
function seedRoads() {
  const pts = (list) => list.map(([x, z]) => [r2(x), r2(z)]);
  return [
    ...layout.roads
      .filter((r) => !SUNKEN.includes(r.id))
      .map((r) => ({
        id: r.id,
        ...(r.name ? { name: r.name } : {}),
        points: pts(r.points),
        width: r.width,
        ...(r.kind !== 'path' ? { maxGrade: MAX_GRADE } : {}),
        ...(KIND_COLORS[r.kind] ? { color: KIND_COLORS[r.kind] } : {}),
      })),
    ...RAIL.tracks.map((off, k) => ({
      id: `track-${k + 1}`,
      name: `Track ${k + 1}`,
      points: pts([RAIL.at(-30, off), RAIL.at(230, off)]),
      width: 2.6,
      shoulder: 2,
      radius: 0,
      color: BALLAST,
    })),
  ];
}

const SEED = { terrain: seedTerrain(), roads: seedRoads() };
const { terrain, roads } = seededFields(MAP_FILE, SEED, argv);
/** The ground everything stands on: the terrain as the game grades it under the roads. */
const grid = (() => {
  const h = terrain.heights;
  const def = {
    minX: terrain.origin[0],
    minZ: terrain.origin[1],
    cellSize: terrain.cellSize,
    cols: h[0].length - 1,
    rows: h.length - 1,
    heights: h.flat(),
  };
  lib.gradeRoads(def, def.heights, roads ?? []);
  return new lib.HeightGrid(def);
})();
const groundAt = (x, z) => grid.heightAt(x, z);

// ---------------------------------------------------------------- areas and landmarks

const poiColor = (a) => layout.pois[a.poi]?.color ?? '#888888';
/** The ground under an area's footprint, sampled every 2 m: its lowest and highest. */
function groundUnder(a) {
  const f = frame(a);
  let lo = Infinity;
  let hi = -Infinity;
  const nx = Math.max(1, Math.ceil(a.w / 2));
  const nz = Math.max(1, Math.ceil(a.d / 2));
  for (let i = 0; i <= nx; i++)
    for (let k = 0; k <= nz; k++) {
      const g = groundAt(...f.toWorld(-a.w / 2 + (a.w * i) / nx, -a.d / 2 + (a.d * k) / nz));
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
  return { lo, hi };
}
/** Its ground floor: the layout's y, or the highest ground under it (never sunk). */
const floorOf = (a) => r2(a.y ?? groundUnder(a).hi);
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

// ---------------------------------------------------------------- edges and labels

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

/** Test only (as Northpoint's were): one spawn on the evacuation road below the station. */
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

const map = {
  formatVersion: 4,
  id: 'district',
  name: 'District',
  environment: { sky: '#a9b2b6', fogNear: 45, fogFar: 120 },
  nodes: [
    group('Spawns', [testSpawn]),
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

// What the table gives, for the session's notes: each building's floor against the ground
// under it (a foundation fills below; ground over the floor shows inside, so dig it out).
if (argv.includes('--report')) {
  console.table(
    layout.areas
      .filter((a) => a.floors > 0)
      .map((a) => {
        const { lo, hi } = groundUnder(a);
        const y = floorOf(a);
        return {
          area: a.id,
          floor: y,
          'ground low': r2(lo),
          'ground high': r2(hi),
          'buried by': hi > y + 0.05 ? r2(hi - y) : '',
        };
      }),
  );
}
const passed = argv.filter((a) => a !== '--report');
await writeGenerated({
  file: MAP_FILE,
  map,
  by: fileURLToPath(import.meta.url),
  root: ROOT,
  argv: passed,
  seed: SEED,
});
await writeOnce({ file: RAID_FILE, doc: raid, root: ROOT, argv: passed });

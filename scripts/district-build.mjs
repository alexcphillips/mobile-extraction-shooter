// District's buildings as bones (DS-2, 2026-11-12): every layout area with floors as a shell
// at its real footprint and floor heights, its entrances cut on their floors, slabs with a
// stairwell, the garage's decks and ramps, and the few yards whose mass is the place (the
// train, the platforms, the helicopter, the convoy, the cans). Each is built square in its
// area's frame (mapkit/frame.mjs) and placed turned. No rooms, props or loot yet: those are
// DS-5 on, after the user approves the bones (DS-3).
import { buildingKit } from './mapkit/building.mjs';
import { frame } from './mapkit/frame.mjs';
import { box, drawn, yawAlongZ } from './mapkit/nodes.mjs';
import { runDownFrom, stairRun } from './mapkit/runs.mjs';

export const C = {
  glass: '#9cc4d0',
  'timber-dark': '#5e4632',
  'dark-concrete': '#6f6d68',
  floorboards: '#8f8b84',
  trim: '#e0dccf',
  plaster: '#cfc6b0',
  timber: '#8a6a48',
  roof: '#4a4440',
  wall: '#b9b3a6',
  slab: '#8f8b84',
  stairs: '#9a958c',
  rail: '#5d5f63',
  vehicle: '#5f6650',
  container: '#8a5a3c',
};
const kit = buildingKit({ C });

const WALL = 0.3;
const PARAPET = 1.1;

/** Wall openings for an area's entrances on one side, as the kit's walls take them. */
function openings(area, side, fh) {
  return area.entrances
    .filter((e) => e.side === side)
    .map((e) => {
      const tall = e.width >= 4 ? Math.min(fh - 0.4, 3.4) : Math.min(fh - 0.4, 2.4);
      return { at: e.along, width: e.width, bottom: e.floor * fh, top: e.floor * fh + tall };
    });
}

/** The four outer walls of a w × d box, `h` tall, with its entrances cut. */
function outerWalls(id, area, h, fh, color) {
  const hw = area.w / 2;
  const hd = area.d / 2;
  return [
    kit.wX(`${id}-front`, -hw, hw, -hd + WALL / 2, 0, h, color, openings(area, 'front', fh), WALL),
    kit.wX(`${id}-back`, -hw, hw, hd - WALL / 2, 0, h, color, openings(area, 'back', fh), WALL),
    kit.wZ(
      `${id}-left`,
      -hw + WALL / 2,
      -hd + WALL,
      hd - WALL,
      0,
      h,
      color,
      openings(area, 'left', fh),
      WALL,
    ),
    kit.wZ(
      `${id}-right`,
      hw - WALL / 2,
      -hd + WALL,
      hd - WALL,
      0,
      h,
      color,
      openings(area, 'right', fh),
      WALL,
    ),
  ];
}

/** A low parapet ring round a roof or deck edge at y, with gaps [side, from, to] left open. */
function parapets(id, hw, hd, y, color, gaps = []) {
  const out = [];
  const sides = [
    ['front', -hw, hw, (a, b) => [a, -hd, b, -hd + 0.25]],
    ['back', -hw, hw, (a, b) => [a, hd - 0.25, b, hd]],
    ['left', -hd + 0.25, hd - 0.25, (a, b) => [-hw, a, -hw + 0.25, b]],
    ['right', -hd + 0.25, hd - 0.25, (a, b) => [hw - 0.25, a, hw, b]],
  ];
  for (const [side, from, to, rect] of sides) {
    const cut = gaps.filter((g) => g[0] === side).sort((p, q) => p[1] - q[1]);
    let a = from;
    let k = 0;
    for (const [, g0, g1] of [...cut, [side, to, to]]) {
      if (g0 - a > 0.2)
        out.push(box(...rect(a, g0), y, y + PARAPET, color, { id: `${id}-${side}-${++k}` }));
      a = Math.max(a, g1);
    }
  }
  return out;
}

/** Rails round a hole in a floor (a court's void, a stairwell): collidable, waist high. */
function holeRails(id, [x0, z0, x1, z1], y, open = []) {
  const t = 0.08;
  const rails = [
    ['f', [x0, z0 - t, x1, z0]],
    ['b', [x0, z1, x1, z1 + t]],
    ['l', [x0 - t, z0, x0, z1]],
    ['r', [x1, z0, x1 + t, z1]],
  ].filter(([k]) => !open.includes(k));
  return rails.map(([k, r]) => box(...r, y, y + 1.05, C.rail, { id: `${id}-rail-${k}` }));
}

/**
 * Switchback stairs from the ground floor to `to` floors up, in two places side by side
 * that take turns floor by floor: stairs and ramps collide as solid wedges, so a flight
 * stacked straight over the last leaves too little headroom on low floors (1.5 m on the
 * garage's 3 m decks). Each run's foot is at (x, z) or 4.2 m along +x, climbing +z;
 * `holes[k]` is the hole floor k + 1 needs over run k.
 */
function stairWell(id, x, z, fh, to) {
  const nodes = [];
  const holes = [];
  const width = 1.4;
  const flights = Math.ceil(fh / 2.8 - 1e-9);
  const run = (fh / flights) * 1.6;
  for (let k = 0; k < to; k++) {
    const xk = x + (k % 2) * 4.2;
    const { node } = stairRun({
      id: `${id}-${k + 1}`,
      x: xk,
      z,
      y: k * fh,
      yaw: 0,
      rise: fh,
      width,
      turn: 'right',
      color: C.stairs,
    });
    nodes.push(node);
    // Both lanes, from the foot line to past the landing.
    holes.push([xk - width / 2 - 0.1, z, xk + width / 2 + width + 0.2 + 0.1, z + run + 1.5 + 0.1]);
  }
  return { nodes, holes };
}

/** A building shell: walls with its entrances, floor slabs with a stairwell, a flat roof. */
function shell(area, y, groundIn, extra = {}) {
  const { id } = area;
  const fh = area.floorHeight;
  const n = Math.max(1, area.floors);
  const H = n * fh;
  const hw = area.w / 2;
  const hd = area.d / 2;
  const f = frame(area, y);
  const color = extra.color ?? C.wall;
  const nodes = [
    box(-hw, -hd, hw, hd, -0.6, 0.05, C.slab, { id: `${id}-floor` }),
    ...outerWalls(`${id}-wall`, area, H, fh, color),
  ];
  if (n > 1) {
    const well = stairWell(`${id}-stairs`, -hw + 1.6, hd - 7.5, fh, n - 1);
    nodes.push(...well.nodes);
    for (let k = 1; k < n; k++) {
      const holes = [...(extra.voids ?? []), well.holes[k - 1]];
      nodes.push(
        ...kit.slabWithHoles(
          `${id}-floor-${k + 1}`,
          -hw + WALL,
          -hd + WALL,
          hw - WALL,
          hd - WALL,
          k * fh - 0.3,
          k * fh,
          C.slab,
          holes,
        ),
      );
      for (const [v, hole] of (extra.voids ?? []).entries())
        nodes.push(...holeRails(`${id}-void-${v + 1}-${k + 1}`, hole, k * fh));
      nodes.push(...holeRails(`${id}-well-${k + 1}`, well.holes[k - 1], k * fh, ['f']));
    }
  }
  nodes.push(box(-hw, -hd, hw, hd, H, H + 0.3, extra.roof ?? C.roof, { id: `${id}-roof` }));
  nodes.push(...parapets(`${id}-parapet`, hw, hd, H + 0.3, color, extra.roofGaps ?? []));
  if (extra.more) nodes.push(...extra.more({ f, H, fh, groundIn }));
  return f.group(area.name ?? id, nodes);
}

/**
 * Columns on a grid, one per level between the slabs (so none runs through a slab or a
 * parapet, which the editor would list as overlaps).
 */
function columns(id, xs, zs, levels, fh) {
  const out = [];
  for (let k = 0; k < levels; k++)
    for (const [i, cx] of xs.entries())
      for (const [j, cz] of zs.entries())
        out.push(
          box(
            cx - 0.3,
            cz - 0.3,
            cx + 0.3,
            cz + 0.3,
            k ? k * fh : 0.05,
            (k + 1) * fh - 0.3,
            C['dark-concrete'],
            {
              id: `${id}-col-${k + 1}-${i + 1}-${j + 1}`,
            },
          ),
        );
  return out;
}

/** The half-built office block: slabs on columns, no walls, a stair core, open on top. */
function openFrame(area, y) {
  const { id } = area;
  const fh = area.floorHeight;
  const n = area.floors;
  const hw = area.w / 2;
  const hd = area.d / 2;
  const f = frame(area, y);
  const nodes = [box(-hw, -hd, hw, hd, -0.6, 0.05, C.slab, { id: `${id}-floor` })];
  const well = stairWell(`${id}-stairs`, -hw + 2, hd - 7.5, fh, n - 1);
  nodes.push(...well.nodes);
  for (let k = 1; k < n; k++) {
    // The top floor's slab only half poured: a frame still going up.
    const x1 = k === n - 1 ? 0 : hw;
    nodes.push(
      ...kit.slabWithHoles(`${id}-floor-${k + 1}`, -hw, -hd, x1, hd, k * fh - 0.3, k * fh, C.slab, [
        well.holes[k - 1],
      ]),
    );
  }
  nodes.push(
    ...columns(id, [-hw + 0.6, -hw / 3, hw / 3, hw - 0.6], [-hd + 0.6, 0, hd - 0.6], n - 1, fh),
  );
  return f.group(area.name ?? id, nodes);
}

/** The parking garage: decks every floorHeight, ramps between them, a stair core. */
function garage(area, y) {
  const { id } = area;
  const fh = area.floorHeight;
  const n = area.floors; // levels, the top one an open deck
  const hw = area.w / 2;
  const hd = area.d / 2;
  const f = frame(area, y);
  const nodes = [box(-hw, -hd, hw, hd, -0.6, 0.05, C.slab, { id: `${id}-floor` })];
  const ramps = [];
  const RX = 9;
  const RW = 4;
  const going = 6;
  const L = fh * going;
  for (let k = 0; k + 1 < n; k++) {
    const x = k % 2 ? RX : -RX;
    ramps.push({ k, x, hole: [x - RW / 2 - 0.1, -L / 2 - 0.1, x + RW / 2 + 0.1, L / 2 + 0.1] });
    nodes.push({
      type: 'ramp',
      id: `${id}-ramp-${k + 1}`,
      pos: [x, k * fh, -L / 2 + L / 2],
      size: [RW, fh, L],
      color: C.stairs,
    });
  }
  const well = stairWell(`${id}-stairs`, hw - 9, -3, fh, n - 1);
  nodes.push(...well.nodes);
  const gapsOn = (floor) =>
    area.entrances
      .filter((e) => e.floor === floor)
      .map((e) => [e.side, e.along - e.width / 2, e.along + e.width / 2]);
  nodes.push(...parapets(`${id}-edge-1`, hw, hd, 0.05, C.wall, gapsOn(0)));
  for (let k = 1; k < n; k++) {
    const holes = [well.holes[k - 1], ...ramps.filter((r) => r.k === k - 1).map((r) => r.hole)];
    nodes.push(
      ...kit.slabWithHoles(
        `${id}-deck-${k + 1}`,
        -hw,
        -hd,
        hw,
        hd,
        k * fh - 0.3,
        k * fh,
        C.slab,
        holes,
      ),
    );
    nodes.push(...parapets(`${id}-edge-${k + 1}`, hw, hd, k * fh, C.wall, gapsOn(k)));
    nodes.push(...holeRails(`${id}-well-${k + 1}`, well.holes[k - 1], k * fh, ['f']));
  }
  nodes.push(
    ...columns(
      id,
      [-hw + 0.7, -hw / 2, 0, hw / 2, hw - 0.7],
      [-hd + 0.7, -hd / 2, hd / 2, hd - 0.7],
      n - 1,
      fh,
    ),
  );
  return f.group(area.name ?? id, nodes);
}

/** A solid block: a facade, or a tall landmark. */
function block(id, name, r, y, h, color, extra = {}) {
  const f = frame(r, y);
  return f.group(name, [
    box(-r.w / 2, -r.d / 2, r.w / 2, r.d / 2, -0.6, h, color, { id, ...extra }),
  ]);
}

/** Corner posts and a label: an open area (a yard, a lot) marked, nothing built yet. */
function marked(area, y, color) {
  const f = frame(area, y);
  const hw = area.w / 2;
  const hd = area.d / 2;
  const nodes = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz], k) =>
    drawn(sx * hw - 0.15, sz * hd - 0.15, sx * hw + 0.15, sz * hd + 0.15, -0.5, 2.4, color, {
      id: `${area.id}-post-${k + 1}`,
    }),
  );
  return f.group(area.name ?? area.id, nodes);
}

/** The world point of an entrance's middle (an area's frame, its side, along). */
function entranceAt(area, e) {
  const hw = area.w / 2;
  const hd = area.d / 2;
  const local = {
    front: [e.along, -hd],
    back: [e.along, hd],
    left: [-hw, e.along],
    right: [hw, e.along],
  }[e.side];
  return frame(area).toWorld(...local);
}

/**
 * Every area of the layout as bones. `floorOf(area)` is its ground floor's height, `groundAt`
 * the finished ground; `poiColor(area)` its place's color, for roofs and markers.
 */
export function buildAreas(layout, { floorOf, groundAt, poiColor, rail }) {
  const byId = new Map(layout.areas.map((a) => [a.id, a]));
  const out = [];
  const skip = new Set([
    'glass-bridge',
    'rail-footbridge',
    'rail-platform',
    'rail-island',
    'rail-train',
  ]);
  for (const a of layout.areas) {
    if (skip.has(a.id)) continue;
    const y = floorOf(a);
    const color = poiColor(a);
    const f = frame(a, y);
    const groundIn = f.groundIn(groundAt);
    if (a.id === 'garage') out.push(garage(a, y));
    else if (a.id === 'cons-block') out.push(openFrame(a, y));
    else if (a.tier === 'facade')
      out.push(block(`${a.id}-block`, a.name ?? a.id, a, y, a.floors * a.floorHeight, color));
    else if (a.floors === 0) out.push(yard(a, y, color, groundIn));
    else if (a.id === 'mall-main') out.push(shell(a, y, groundIn, mallMain(a, color)));
    else if (a.id === 'mall-dept')
      out.push(shell(a, y, groundIn, { roof: color, voids: [[-7, -6, 7, 8]] }));
    else out.push(shell(a, y, groundIn, { roof: color }));
  }
  out.push(glassBridge(byId.get('garage'), byId.get('mall-dept'), floorOf));
  out.push(...station(layout, byId, rail));
  return out;
}

/** The mall's court: a void through the upper floor; stairs from the plaza level to the roof. */
function mallMain(a, color) {
  const hd = a.d / 2;
  return {
    roof: color,
    voids: [[-24, -12, 24, 12]],
    // The roof terrace is reached from the plaza level by stairs up the back wall.
    roofGaps: [['back', -8, -4]],
    more: ({ H, fh, groundIn }) => {
      const { node } = runDownFrom('stairs', {
        id: 'mall-roof-stairs',
        top: [-6, hd + 0.1],
        topY: H + 0.3,
        yaw: 180,
        width: 1.8,
        turn: 'straight',
        groundAt: (x, z) => Math.max(groundIn(x, z), fh),
        color: C.stairs,
      });
      return [node];
    },
  };
}

/** Open ground: posts and a label, and the mass of the few yards that are their place. */
function yard(a, y, color, groundIn) {
  const f = frame(a, y);
  const hw = a.w / 2;
  const hd = a.d / 2;
  const base = (x, z) => groundIn(x, z);
  const nodes = [];
  const solid = (id, x0, z0, x1, z1, h, col = C.vehicle) => {
    const g = Math.min(base(x0, z0), base(x1, z1), base(x0, z1), base(x1, z0));
    nodes.push(box(x0, z0, x1, z1, g - 0.3, g + h, col, { id }));
  };
  if (a.id === 'plaza-heli') {
    solid('heli-fuselage', -6, -1.6, 6, 1.6, 2.6);
    solid('heli-rotor-hub', -1, -1, 1, 1, 3.1);
  } else if (a.id === 'lot-convoy') {
    solid('convoy-armored', -20, -1.4, -13, 1.4, 2.5);
    solid('convoy-truck-1', -8, -1.3, 1, 1.3, 3.2);
    solid('convoy-truck-2', 6, -1.3, 15, 1.3, 3.2);
    solid('convoy-jeep', 19, -1, 23.5, 1, 1.9);
  } else if (a.id === 'svc-containers') {
    for (const [k, [x, z, h]] of [
      [-7, -14, 2.6],
      [-7, -6, 5.2],
      [-7, 6, 2.6],
      [1, -10, 5.2],
      [1, 4, 2.6],
      [1, 14, 5.2],
      [8, -2, 2.6],
    ].entries())
      solid(`cans-${k + 1}`, x - 1.2, z - 3, x + 1.2, z + 3, h, C.container);
  } else if (a.id === 'gas-canopy') {
    for (const [k, [x, z]] of [
      [-hw + 1, -hd + 1],
      [hw - 1, -hd + 1],
      [hw - 1, hd - 1],
      [-hw + 1, hd - 1],
    ].entries())
      nodes.push(
        box(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0, 5, C.wall, { id: `gas-canopy-pillar-${k + 1}` }),
      );
    nodes.push(drawn(-hw, -hd, hw, hd, 5, 5.6, C.trim, { id: 'gas-canopy-roof' }));
    for (const x of [-7, 0, 7]) solid(`gas-pumps-${x}`, x - 0.6, -4, x + 0.6, 4, 1.5, C.wall);
  }
  return f.group(a.name ?? a.id, [...marked(a, y, color).nodes, ...nodes]);
}

/** The glass bridge from the garage's deck to the department store's upper floor. */
function glassBridge(garageA, dept, floorOf) {
  const ge = garageA.entrances.find((e) => e.kind === 'glass bridge');
  const de = dept.entrances.find((e) => e.kind === 'glass bridge');
  const a = entranceAt(garageA, ge);
  const b = entranceAt(dept, de);
  const y = floorOf(garageA) + ge.floor * garageA.floorHeight;
  const yb = floorOf(dept) + de.floor * dept.floorHeight;
  if (Math.abs(y - yb) > 0.05)
    throw new Error(`glass bridge: garage deck ${y} ≠ store floor ${yb}`);
  const mid = { x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, yaw: yawAlongZ(a, b) };
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.8;
  const f = frame(mid, y);
  const hw = ge.width / 2 + 0.4;
  return f.group('Glass connector bridge', [
    box(-hw, -L / 2, hw, L / 2, -0.5, 0, C.slab, { id: 'bridge-deck' }),
    box(-hw, -L / 2, -hw + 0.15, L / 2, 0, 1.1, C.rail, { id: 'bridge-side-l' }),
    box(hw - 0.15, -L / 2, hw, L / 2, 0, 1.1, C.rail, { id: 'bridge-side-r' }),
    drawn(-hw, -L / 2, -hw + 0.05, L / 2, 1.1, 2.8, C.glass, { id: 'bridge-glass-l' }),
    drawn(hw - 0.05, -L / 2, hw, L / 2, 1.1, 2.8, C.glass, { id: 'bridge-glass-r' }),
    drawn(-hw, -L / 2, hw, L / 2, 2.8, 3, C.trim, { id: 'bridge-roof' }),
  ]);
}

/**
 * The station in the rail cut: platform 1 and the island as boxes on the cut's floor, the
 * stalled train on track 2, the footbridge over track 1 with stairs down to both.
 * `rail` is the cut's frame: { at(s, off) → [x, z], bed(s), yaw }.
 */
function station(layout, byId, rail) {
  const out = [];
  const bed = rail.bed(150);
  const plat = (a, id) => {
    const f = frame(a, bed);
    return f.group(a.name ?? id, [
      box(-a.w / 2, -a.d / 2, a.w / 2, a.d / 2, -0.4, 1, C.slab, { id: `${id}-deck` }),
    ]);
  };
  out.push(plat(byId.get('rail-platform'), 'platform-1'));
  out.push(plat(byId.get('rail-island'), 'platform-2'));
  const train = byId.get('rail-train');
  const tf = frame(train, bed);
  const cars = [];
  let x = -train.w / 2;
  for (const [k, len] of [16, 14, 14, 14, 14].entries()) {
    cars.push(
      box(x, -1.5, x + len, 1.5, 0.2, 4.2, k ? C.container : C.vehicle, {
        id: `train-car-${k + 1}`,
      }),
    );
    x += len + 1.5;
  }
  out.push(tf.group(train.name ?? 'train', cars));
  // The footbridge: a deck from over the island to over platform 1, stairs down onto each.
  const fb = byId.get('rail-footbridge');
  const top = fb.y;
  const ff = frame(fb, top);
  const D = 22;
  const nodes = [box(-2, -D / 2, 2, D / 2, -0.4, 0, C.slab, { id: 'footbridge-deck' })];
  // Rails, open where each stair arrives (the island's on −x, platform 1's on +x).
  nodes.push(box(-2, -D / 2 + 2.2, -1.9, D / 2, 0, 1.1, C.rail, { id: 'footbridge-rail-l' }));
  nodes.push(box(1.9, -D / 2, 2, D / 2 - 2.2, 0, 1.1, C.rail, { id: 'footbridge-rail-r' }));
  const rise = top - (bed + 1);
  // Island side (−z end), the stair along local −x; platform 1 (+z end), along +x.
  for (const [id, zc, dir] of [
    ['footbridge-stairs-island', -D / 2 + 1, -1],
    ['footbridge-stairs-platform', D / 2 - 1, 1],
  ]) {
    const { node } = runDownFrom('stairs', {
      id,
      top: [dir * 2.05, zc],
      topY: 0,
      yaw: dir > 0 ? 270 : 90,
      width: 1.6,
      turn: 'straight',
      groundAt: () => -rise,
      color: C.stairs,
    });
    nodes.push(node);
  }
  out.push(ff.group(fb.name ?? 'footbridge', nodes));
  return out;
}

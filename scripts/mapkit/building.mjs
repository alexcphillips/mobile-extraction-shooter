// Building pieces (moved out of silver-creek-west.mjs for MT-7, 2026-11-10; into the map
// kit for MK-6, 2026-11-12): walls with openings, doors, windows, gabled roofs, house shells,
// slabs with holes and porches. Built in a local frame (frame.mjs places it); see
// silver-creek-west.mjs for the house-building rules (wall thicknesses, door and window sizes).
import * as base from './nodes.mjs';

export const WIN = { bottom: 0.9, top: 2.0 };
export const DOOR_H = 2.1;

/**
 * The pieces, given the map's colors `C` (glass, timber-dark, dark-concrete, floorboards,
 * trim, plaster, timber, roof as each piece uses them). box, drawn, along and r2 default to
 * the kit's own.
 */
export function buildingKit(h) {
  const { C, box = base.box, drawn = base.drawn, along = base.along, r2 = base.r2 } = h;
  /** A wall along x at z; openings by their x (`at`). Outer walls 0.2, partitions 0.15. */
  const wX = (id, x0, x1, z, bottom, top, color, ops = [], thick = 0.2) => ({
    type: 'wall',
    id,
    pos: [r2((x0 + x1) / 2), r2(bottom), r2(z)],
    size: [r2(x1 - x0), r2(top - bottom), thick],
    color,
    openings: ops.map(({ at, ...o }) => ({ ...o, along: r2(at - (x0 + x1) / 2) })),
  });
  /** A wall along z at x; openings by their z (`at`). A yaw-90 wall measures along −z. */
  const wZ = (id, x, z0, z1, bottom, top, color, ops = [], thick = 0.2) => ({
    type: 'wall',
    id,
    pos: [r2(x), r2(bottom), r2((z0 + z1) / 2)],
    yaw: 90,
    size: [r2(z1 - z0), r2(top - bottom), thick],
    color,
    openings: ops.map(({ at, ...o }) => ({ ...o, along: r2((z0 + z1) / 2 - at) })),
  });
  const door = (at, width = 1.2) => ({ at, width, bottom: 0, top: DOOR_H });
  const win = (at, width = 1.4, extra = {}) => ({ at, width, ...WIN, glass: C.glass, ...extra });
  /** A door node in a wall along x (dx) or z (dz), at its doorway's middle. */
  const doorX = (id, x, z, y, width = 1.2, extra = {}) => ({
    type: 'door',
    id,
    pos: [r2(x), r2(y), r2(z)],
    yaw: 0,
    size: [width, DOOR_H],
    color: C['timber-dark'],
    ...extra,
  });
  const doorZ = (id, x, z, y, width = 1.2, extra = {}) => ({
    ...doorX(id, x, z, y, width, extra),
    yaw: 90,
  });

  /**
   * A gabled roof over x0..x1, z0..z1 with its ridge along x: two tilted slabs that collide
   * (0.4 m eaves), over a drawn prism that closes the gable ends. `gaps` leaves holes along
   * x in the north (−z) slope, for a caved-in roof.
   */
  function roof(id, x0, x1, z0, z1, eave, pitch, colors, gaps = []) {
    const t = Math.tan((pitch * Math.PI) / 180);
    const zc = (z0 + z1) / 2;
    const rise = ((z1 - z0) / 2) * t;
    const ridge = eave + rise;
    const lowY = eave - 0.4 * t;
    const runs = (from, to, holes) => {
      const out = [];
      let a = from;
      for (const [g0, g1] of holes) {
        if (g0 > a) out.push([a, g0]);
        a = g1;
      }
      if (to > a) out.push([a, to]);
      return out;
    };
    const slab = (k, xa, xb, a, b) =>
      along(
        [r2((xa + xb) / 2), a[0], a[1]],
        [r2((xa + xb) / 2), b[0], b[1]],
        r2(xb - xa),
        0.15,
        colors.roof,
        {
          id: `${id}-${k}`,
          collide: true,
        },
      );
    const nodes = [];
    runs(x0 - 0.3, x1 + 0.3, gaps).forEach(([xa, xb], k) =>
      nodes.push(slab(`n${k + 1}`, xa, xb, [lowY, z0 - 0.4], [ridge, zc])),
    );
    nodes.push(slab('s', x0 - 0.3, x1 + 0.3, [ridge, zc], [lowY, z1 + 0.4]));
    runs(x0 + 0.01, x1 - 0.01, gaps).forEach(([xa, xb], k) =>
      nodes.push(
        drawn(xa, z0, xb, z1, eave - 0.08, ridge - 0.08, colors.gable, {
          id: `${id}-gable-${k + 1}`,
          top: [r2(xb - xa), 0],
        }),
      ),
    );
    return { nodes, ridge };
  }

  /**
   * A one-storey house shell in its own frame: x ±hw, z ±hd, front on +z. Floor slab from
   * under the ground to `fl`, outer walls to the ceiling, a ceiling slab inside the walls.
   * `ops` are the openings of the four outer walls; `ceilingHoles` are [x0, z0, x1, z1].
   */
  function shell(
    id,
    { hw = 5.5, hd = 4.5, fl = 0.35, wallH = 3.0, color, ops, ceilingHoles = [] },
  ) {
    const top = fl + wallH;
    const nodes = [
      box(-hw, -hd, hw, hd, -0.3, fl, C['dark-concrete'], { id: `${id}-floor` }),
      drawn(-hw + 0.2, -hd + 0.2, hw - 0.2, hd - 0.2, fl, fl + 0.01, C.floorboards, {
        id: `${id}-boards`,
      }),
      wX(`${id}-wall-front`, -hw, hw, hd - 0.1, fl, top + 0.2, color, ops.front ?? []),
      wX(`${id}-wall-back`, -hw, hw, -hd + 0.1, fl, top + 0.2, color, ops.back ?? []),
      wZ(`${id}-wall-west`, -hw + 0.1, -hd + 0.2, hd - 0.2, fl, top + 0.2, color, ops.west ?? []),
      wZ(`${id}-wall-east`, hw - 0.1, -hd + 0.2, hd - 0.2, fl, top + 0.2, color, ops.east ?? []),
      // corner trim, drawn
      ...[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], k) =>
        drawn(
          sx * hw - 0.06,
          sz * hd - 0.06,
          sx * hw + 0.06,
          sz * hd + 0.06,
          fl - 0.05,
          top + 0.2,
          C.trim,
          {
            id: `${id}-trim-${k + 1}`,
          },
        ),
      ),
    ];
    nodes.push(
      ...slabWithHoles(
        `${id}-ceiling`,
        -hw + 0.2,
        -hd + 0.2,
        hw - 0.2,
        hd - 0.2,
        top,
        top + 0.2,
        C.plaster,
        ceilingHoles,
      ),
    );
    return { nodes, top: top + 0.2 };
  }

  /** A slab over a rectangle with rectangular holes cut out (split into strips along x). */
  function slabWithHoles(id, x0, z0, x1, z1, bottom, top, color, holes) {
    const xs = [...new Set([x0, x1, ...holes.flatMap((o) => [o[0], o[2]])])].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const [a, b] = [xs[i], xs[i + 1]];
      const cuts = holes.filter((o) => o[0] <= a && o[2] >= b).sort((p, q) => p[1] - q[1]);
      let z = z0;
      for (const o of cuts) {
        if (o[1] > z) out.push([a, z, b, o[1]]);
        z = Math.max(z, o[3]);
      }
      if (z1 > z) out.push([a, z, b, z1]);
    }
    return out.map(([a, b, c, d], k) =>
      box(a, b, c, d, bottom, top, color, { id: `${id}-${k + 1}` }),
    );
  }

  /** A front porch: a deck one step up, and a roof on two posts out of reach (2.7 m). */
  const porch = (id, x, hd, fl, w = 3, deep = 1.6, roofY = 2.75) => [
    box(x - w / 2, hd, x + w / 2, hd + deep, -0.2, fl - 0.02, C.timber, { id: `${id}-deck` }),
    box(x - w / 2 - 0.2, hd, x + w / 2 + 0.2, hd + deep + 0.2, roofY, roofY + 0.12, C.roof, {
      id: `${id}-porch-roof`,
    }),
    box(x - w / 2 + 0.05, hd + deep - 0.05, x - w / 2 + 0.17, hd + deep + 0.07, fl, roofY, C.trim, {
      id: `${id}-post-1`,
    }),
    box(x + w / 2 - 0.17, hd + deep - 0.05, x + w / 2 - 0.05, hd + deep + 0.07, fl, roofY, C.trim, {
      id: `${id}-post-2`,
    }),
  ];
  return { wX, wZ, door, win, doorX, doorZ, roof, shell, slabWithHoles, porch };
}

// Stair and ramp runs between two levels (MK-6, 2026-11-12): a climb split into flights with
// landings between, straight on or turning back (a switchback), as one group placed at the
// foot. Stairs collide as ramps, so the AI walks both if they're 45° or less; runs keep to
// that and throw past it. The test walks one of each in the sim and checks the nav joins
// the foot to the top (level-design.md: the AI walks stairs and slopes, never ladders).
import { box, group, r2 } from './nodes.mjs';

const RAD = Math.PI / 180;

/**
 * @typedef {object} RunOptions
 * @property {string} id
 * @property {string} [name] the group's name (default the id)
 * @property {number} x the foot's middle, at the bottom of the first flight
 * @property {number} z
 * @property {number} y
 * @property {number} yaw which way it climbs: local +z, as a stairs node (0 climbs south)
 * @property {number} rise meters from the foot to the top
 * @property {number} [width] each flight's width
 * @property {number} [flight] most rise in one flight before a landing
 * @property {number} [going] run per meter of rise (stairs 1.6 is about 32°; 1 is 45°)
 * @property {number} [landing] a landing's depth along the climb
 * @property {'straight' | 'left' | 'right'} [turn] a switchback turns back to that side
 * @property {number} [gap] between a switchback's flights
 * @property {number} [base] landings' bottom, from the foot (default −0.3); lower them to
 *   meet the ground under a run down a bank
 * @property {string} color
 * @property {string} [landingColor]
 * @property {number} [sides] stairs only: drawn side walls this high over the steps
 */

/**
 * The nodes of a run in its own frame (foot at the origin, climbing +z), and its top.
 * @param {'stairs' | 'ramp'} kind
 * @param {RunOptions} o
 */
function plan(kind, o) {
  const {
    id,
    rise,
    width = kind === 'stairs' ? 1.6 : 3,
    flight = kind === 'stairs' ? 2.8 : Infinity,
    going = kind === 'stairs' ? 1.6 : 8,
    landing = kind === 'stairs' ? 1.5 : 3,
    turn = 'straight',
    gap = 0.2,
    color,
    landingColor = color,
  } = o;
  const base = o.base ?? -0.3;
  if (going < 1) throw new Error(`${id}: steeper than 45° (going ${going}); the AI can't climb it`);
  const n = Math.max(1, Math.ceil(rise / flight - 1e-9));
  const fr = rise / n;
  const run = fr * going;
  const side = turn === 'left' ? -1 : 1;
  const step = width + gap;
  const nodes = [];
  // Each flight's start (local), its direction (+1 climbs +z, −1 climbs −z) and its lane.
  let z = 0;
  let lane = 0;
  let dir = 1;
  let y = 0;
  for (let k = 0; k < n; k++) {
    const z1 = z + dir * run;
    const x = lane * step * side;
    nodes.push({
      type: kind,
      id: `${id}-flight-${k + 1}`,
      pos: [r2(x), r2(y), r2((z + z1) / 2)],
      ...(dir < 0 ? { yaw: 180 } : {}),
      size: [r2(width), r2(fr), r2(run)],
      color,
      ...(kind === 'stairs' && o.sides ? { sides: o.sides } : {}),
    });
    y += fr;
    if (k === n - 1) {
      z = z1;
      break;
    }
    // A landing past the flight's end: across both lanes when it turns back.
    const zl = z1 + dir * landing;
    const [xa, xb] =
      turn === 'straight'
        ? [x - width / 2, x + width / 2]
        : [Math.min(0, side * step) - width / 2, Math.max(0, side * step) + width / 2];
    nodes.push(
      box(xa, Math.min(z1, zl), xb, Math.max(z1, zl), base, y, landingColor, {
        id: `${id}-landing-${k + 1}`,
      }),
    );
    if (turn === 'straight') z = zl;
    else {
      lane = lane ? 0 : 1;
      dir = -dir;
      z = z1;
    }
  }
  return { nodes, top: { lx: lane * step * side, lz: z, y: rise, dir } };
}

/**
 * A run as a group at its foot.
 * @returns {{ node: object, top: { x: number, z: number, y: number, yaw: number } }} the top
 *   of the last flight in the map, and which way you face stepping off it.
 */
function placed(kind, o) {
  const { nodes, top } = plan(kind, o);
  const a = o.yaw * RAD;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    node: group(o.name ?? o.id, nodes, {
      pos: [r2(o.x), r2(o.y), r2(o.z)],
      ...(o.yaw ? { yaw: r2(o.yaw) } : {}),
    }),
    top: {
      x: o.x + top.lx * c + top.lz * s,
      z: o.z - top.lx * s + top.lz * c,
      y: o.y + top.y,
      yaw: top.dir > 0 ? o.yaw : o.yaw + 180,
    },
  };
}

/** Stairs from a foot to `rise` above it (see RunOptions; `name` names the group). */
export const stairRun = (o) => placed('stairs', o);

/** A ramp from a foot to `rise` above it; `going` 8 (1:8) by default, a car ramp. */
export const rampRun = (o) => placed('ramp', o);

/** How long a run is along its climb, without building it (for laying one out first). */
export function runLength(kind, o) {
  const { nodes, top } = plan(kind, o);
  let lo = 0;
  let hi = 0;
  for (const n of nodes) {
    const half = (n.size[2] ?? 0) / 2;
    lo = Math.min(lo, n.pos[2] - half);
    hi = Math.max(hi, n.pos[2] + half);
  }
  return { length: r2(hi - lo), end: top };
}

/**
 * A run laid out from its top down to the ground: `top` is where it arrives ([x, z] and
 * y), `yaw` the way it climbs, and the foot is found where the run meets `groundAt`
 * (a few rounds, since the rise sets the length and the length the foot). For stairs off
 * a terrace's edge or a deck.
 * @param {'stairs' | 'ramp'} kind
 * @param {Omit<RunOptions, 'x' | 'z' | 'y' | 'rise'> & { top: [number, number], topY: number,
 *   groundAt: (x: number, z: number) => number }} o
 */
export function runDownFrom(kind, o) {
  const { top, topY, groundAt, ...rest } = o;
  const a = o.yaw * RAD;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  let rise = topY - groundAt(...top);
  let foot = top;
  for (let k = 0; k < 6; k++) {
    // The top's place in the run's own frame, turned into the map, back from the top.
    const { lx, lz } = plan(kind, { ...rest, rise }).top;
    foot = [top[0] - (lx * c + lz * s), top[1] - (-lx * s + lz * c)];
    const next = topY - groundAt(...foot);
    if (Math.abs(next - rise) < 0.01) break;
    rise = next;
  }
  return placed(kind, { ...rest, x: foot[0], z: foot[1], y: topY - rise, rise });
}

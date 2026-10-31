import { CellWalk } from '../world/grid';
import { DIR_Q, DIR_R, type NavGrid } from './nav-grid';

/**
 * found: the path reaches the goal. partial: the goal can't be reached (or the search
 * gave up), so the path goes as close as it got. none: no path at all.
 */
export type PathResult = 'found' | 'partial' | 'none';

/** A search stops after expanding this many nodes; about 60 m of open ground each way. */
export const MAX_EXPAND = 20000;
/** Smoothing tries to skip at most this many nodes in one straight line. */
const MAX_SKIP = 64;

/** Per-grid scratch, so a search allocates nothing. Stamps mark what this search touched. */
interface Scratch {
  g: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  search: number;
  heap: Int32Array;
  heapF: Float32Array;
  size: number;
  chain: Int32Array;
  walk: CellWalk;
}

const scratches = new WeakMap<NavGrid, Scratch>();

function scratchFor(nav: NavGrid): Scratch {
  let s = scratches.get(nav);
  if (!s) {
    const n = nav.nodeCount;
    // Each expansion pushes at most 8 entries.
    const heap = MAX_EXPAND * 8 + 8;
    s = {
      g: new Float32Array(n),
      parent: new Int32Array(n),
      seen: new Uint32Array(n),
      closed: new Uint32Array(n),
      search: 0,
      heap: new Int32Array(heap),
      heapF: new Float32Array(heap),
      size: 0,
      chain: new Int32Array(MAX_EXPAND + 1),
      walk: new CellWalk(),
    };
    scratches.set(nav, s);
  }
  return s;
}

/**
 * Spots a path keeps away from (fire, 2026-10-31): a node within radius of one, with it at
 * the height of a body standing there, costs this much more to step onto, and smoothing
 * won't cut a corner through one. A way through still beats no way at all.
 */
export interface Avoid {
  spots: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  radius: number;
  /** Extra cost per node in one, in metres. */
  cost: number;
}

/** A spot this far below a node's floor, or this far above it, is out of a body's reach. */
const AVOID_BELOW = 0.5;
const AVOID_ABOVE = 2.2;

// The goal of the search in progress, for the estimate.
let goalX = 0;
let goalY = 0;
let goalZ = 0;

/** Octile distance across, plus the climb. Never more than the real cost. */
function estimate(nav: NavGrid, n: number): number {
  const dx = Math.abs(nav.nodeX(n) - goalX);
  const dz = Math.abs(nav.nodeZ(n) - goalZ);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(nav.nodeY(n) - goalY);
}

/**
 * A* from one node to another. The path goes into out as flat x, y, z waypoints from the
 * start, smoothed so it only turns where it has to. Allocates nothing but out's growth.
 *
 * Nodes in different components can't reach each other, so then it heads greedily for
 * the closest spot it can find within a smaller budget. With avoid, it goes round those
 * spots where it can.
 */
export function findPath(
  nav: NavGrid,
  from: number,
  to: number,
  out: number[],
  avoid?: Avoid,
): PathResult {
  out.length = 0;
  if (from < 0 || to < 0) return 'none';
  const s = scratchFor(nav);
  s.search++;
  s.size = 0;
  const cs = nav.cellSize;
  const diagonal = cs * Math.SQRT2;
  goalX = nav.nodeX(to);
  goalY = nav.nodeY(to);
  goalZ = nav.nodeZ(to);
  const reachable = nav.component[from] === nav.component[to];
  const limit = reachable ? MAX_EXPAND : MAX_EXPAND / 5;
  const weight = reachable ? 1 : 2;
  const shun = avoid && avoid.spots.length > 0 ? avoid : undefined;

  s.g[from] = 0;
  s.parent[from] = -1;
  s.seen[from] = s.search;
  push(s, from, estimate(nav, from));
  let best = from;
  let bestH = Infinity;
  let expanded = 0;
  let reached = false;
  search: while (s.size > 0) {
    const n = pop(s);
    if (s.closed[n] === s.search) continue;
    s.closed[n] = s.search;
    if (n === to) {
      reached = true;
      break;
    }
    const h = estimate(nav, n);
    if (h < bestH) {
      bestH = h;
      best = n;
    }
    if (++expanded >= limit) break;
    const hn = nav.nodeY(n);
    for (let d = 0; d < 8; d++) {
      const m = nav.neighbour(n, d);
      if (m < 0 || s.closed[m] === s.search) continue;
      let g = s.g[n]! + (d < 4 ? cs : diagonal) + Math.abs(nav.nodeY(m) - hn);
      if (shun && near(shun, nav.nodeX(m), nav.nodeY(m), nav.nodeZ(m))) g += shun.cost;
      if (s.seen[m] === s.search && g >= s.g[m]!) continue;
      if (s.size >= s.heap.length) break search;
      s.seen[m] = s.search;
      s.g[m] = g;
      s.parent[m] = n;
      push(s, m, g + weight * estimate(nav, m));
    }
  }

  const end = reached ? to : best;
  let len = 0;
  for (let n = end; n >= 0 && len < s.chain.length; n = s.parent[n]!) s.chain[len++] = n;
  s.chain.subarray(0, len).reverse();
  smooth(nav, s, len, out, shun);
  if (reached) return 'found';
  return end === from ? 'none' : 'partial';
}

function push(s: Scratch, n: number, f: number): void {
  let i = s.size++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (s.heapF[p]! <= f) break;
    s.heap[i] = s.heap[p]!;
    s.heapF[i] = s.heapF[p]!;
    i = p;
  }
  s.heap[i] = n;
  s.heapF[i] = f;
}

function pop(s: Scratch): number {
  const top = s.heap[0]!;
  const n = s.heap[--s.size]!;
  const f = s.heapF[s.size]!;
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= s.size) break;
    if (c + 1 < s.size && s.heapF[c + 1]! < s.heapF[c]!) c++;
    if (s.heapF[c]! >= f) break;
    s.heap[i] = s.heap[c]!;
    s.heapF[i] = s.heapF[c]!;
    i = c;
  }
  s.heap[i] = n;
  s.heapF[i] = f;
  return top;
}

/** Whether a spot to avoid is within reach of a body standing at (x, y, z). */
function near(avoid: Avoid, x: number, y: number, z: number): boolean {
  const r2 = avoid.radius * avoid.radius;
  for (const p of avoid.spots) {
    const up = p.y - y;
    if (up < -AVOID_BELOW || up > AVOID_ABOVE) continue;
    const dx = p.x - x;
    const dz = p.z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/** Whether walking straight from node a to b passes within reach of a spot to avoid. */
function crosses(nav: NavGrid, avoid: Avoid, a: number, b: number): boolean {
  const ax = nav.nodeX(a);
  const az = nav.nodeZ(a);
  const dx = nav.nodeX(b) - ax;
  const dz = nav.nodeZ(b) - az;
  const len2 = dx * dx + dz * dz;
  const y = Math.min(nav.nodeY(a), nav.nodeY(b));
  const top = Math.max(nav.nodeY(a), nav.nodeY(b));
  const r2 = avoid.radius * avoid.radius;
  for (const p of avoid.spots) {
    if (p.y < y - AVOID_BELOW || p.y > top + AVOID_ABOVE) continue;
    const t =
      len2 > 1e-12 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.z - az) * dz) / len2)) : 0;
    const ex = ax + dx * t - p.x;
    const ez = az + dz * t - p.z;
    if (ex * ex + ez * ez < r2) return true;
  }
  return false;
}

function smooth(nav: NavGrid, s: Scratch, len: number, out: number[], avoid?: Avoid): void {
  let n = s.chain[0]!;
  out.push(nav.nodeX(n), nav.nodeY(n), nav.nodeZ(n));
  let i = 0;
  while (i < len - 1) {
    let j = i + 1;
    while (
      j + 1 < len &&
      j + 1 - i <= MAX_SKIP &&
      straight(nav, s.walk, s.chain[i]!, s.chain[j + 1]!) &&
      !(avoid && crosses(nav, avoid, s.chain[i]!, s.chain[j + 1]!))
    )
      j++;
    n = s.chain[j]!;
    out.push(nav.nodeX(n), nav.nodeY(n), nav.nodeZ(n));
    i = j;
  }
}

/**
 * Can a body walk straight from node a to node b? Follows the line through every cell it
 * crosses, each step a link between side-by-side columns, so it can't slip through a
 * corner, over a drop or into a wall.
 */
export function straight(nav: NavGrid, walk: CellWalk, a: number, b: number): boolean {
  const ax = nav.nodeX(a);
  const az = nav.nodeZ(a);
  const dx = nav.nodeX(b) - ax;
  const dz = nav.nodeZ(b) - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return a === b;
  if (
    !walk.begin(
      nav.minX,
      nav.minZ,
      nav.cellSize,
      nav.cols,
      nav.rows,
      ax,
      az,
      dx / len,
      dz / len,
      len,
    )
  )
    return false;
  let node = a;
  let q = walk.q;
  let r = walk.r;
  while (walk.next()) {
    const dq = walk.q - q;
    const dr = walk.r - r;
    q = walk.q;
    r = walk.r;
    let d = 0;
    while (d < 4 && (DIR_Q[d] !== dq || DIR_R[d] !== dr)) d++;
    node = nav.neighbour(node, d);
    if (node < 0) return false;
  }
  return node === b;
}

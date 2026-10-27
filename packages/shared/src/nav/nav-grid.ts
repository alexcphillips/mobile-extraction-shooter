import { MOVEMENT } from '../sim/movement';
import type { CollisionWorld } from '../world/collision-world';

/** Navigation tuning, in metres. */
export const NAV = {
  /** Columns are this far apart. */
  cellSize: 0.5,
  /**
   * Room kept from walls when deciding a spot is walkable. Less than the body's radius,
   * so 1 m doorways stay open whatever the grid's alignment; bodies slide along walls.
   */
  radius: 0.2,
  /** Neighbours this much higher or lower are linked: steps, stairs and slopes. */
  climb: MOVEMENT.stepUp,
  /** Headroom needed: AI doesn't crouch to get somewhere. */
  height: MOVEMENT.standHeight,
  /** Terrain steeper than this (rise over run) isn't walkable either way. */
  maxSlope: MOVEMENT.maxSlope,
} as const;

/** Neighbour directions: the four sides (+x, +z, −x, −z), then the four diagonals. */
export const DIR_Q = [1, 0, -1, 0, 1, -1, -1, 1] as const;
export const DIR_R = [0, 1, 0, -1, 1, 1, -1, -1] as const;
/** The two sides each diagonal passes between: a diagonal never cuts a corner. */
const DIAGONAL_SIDES = [
  [0, 1],
  [2, 1],
  [2, 3],
  [0, 3],
] as const;

const EPS = 1e-3;
/** Most surfaces stacked in one column, terrain included. */
const MAX_STACK = 32;
const NONE = 0xffffffff;

/**
 * Where AI can walk: a grid of columns over the map, each holding a node for every
 * surface in it where a standing body fits (the ground, floors, roofs, stairs), so it has
 * several layers where floors stack. Nodes link to neighbours within a step's height, so
 * stairs and slopes connect floors; ladders don't (AI never climbs them).
 *
 * Built once from the collision world, like it, and never part of the sim state. It's
 * built with every door open: an open door's slab is kept clear of, and a closed doorway
 * is walked through (enemies open the door on the way). A locked door cuts the links
 * through its doorway; setDoorLocked follows the sim's door state (see syncDoors).
 */
export class NavGrid {
  readonly minX: number;
  readonly minZ: number;
  readonly cellSize = NAV.cellSize;
  readonly cols: number;
  readonly rows: number;
  /** Nodes of column c are columnStart[c] .. columnStart[c + 1], lowest first. */
  readonly columnStart: Uint32Array;
  readonly nodeColumn: Uint32Array;
  /** Height of each node's surface. */
  readonly heights: Float32Array;
  /** Bit d set: linked to the neighbour in direction d. */
  readonly links: Uint8Array;
  /** Nodes that can reach each other share a component. Numbered from 0. */
  readonly component: Uint32Array;
  componentSizes: readonly number[];
  /** The links through each door's doorway, as node × 8 + direction. */
  private readonly doorLinks: Int32Array[];
  private readonly doorLocked: Uint8Array;
  private componentsStale = false;

  constructor(world: CollisionWorld) {
    const closed: number[] = [];
    for (let i = 0; i < world.doors.length; i++) {
      if (world.isDoorOpen(i)) continue;
      closed.push(i);
      world.setDoorOpen(i, true);
    }
    const t = world.terrain;
    const cs = this.cellSize;
    this.minX = t.minX;
    this.minZ = t.minZ;
    this.cols = Math.max(1, Math.floor((t.maxX - t.minX) / cs));
    this.rows = Math.max(1, Math.floor((t.maxZ - t.minZ) / cs));
    const columns = this.cols * this.rows;
    this.columnStart = new Uint32Array(columns + 1);

    const heights: number[] = [];
    const bottoms = new Float64Array(MAX_STACK);
    const tops = new Float64Array(MAX_STACK);
    const found = new Float64Array(MAX_STACK + 1);
    const grad = { x: 0, z: 0 };
    // Bodies can't stand closer to the map's edge than their radius.
    const edge = MOVEMENT.radius;
    for (let r = 0; r < this.rows; r++) {
      for (let q = 0; q < this.cols; q++) {
        this.columnStart[r * this.cols + q] = heights.length;
        const x = this.x(q);
        const z = this.z(r);
        if (x < t.minX + edge || x > t.maxX - edge || z < t.minZ + edge || z > t.maxZ - edge)
          continue;
        const solids = world.solidsAt(x, z, bottoms, tops);
        // Something's top is a surface unless it's inside another solid or underground.
        const inside = (h: number): boolean => {
          for (let k = 0; k < solids; k++)
            if (bottoms[k]! < h - EPS && tops[k]! > h + EPS) return true;
          return false;
        };
        let n = 0;
        const ground = t.heightAt(x, z);
        t.gradientAt(x, z, grad);
        const steep = grad.x * grad.x + grad.z * grad.z > NAV.maxSlope * NAV.maxSlope;
        if (!steep && !inside(ground)) found[n++] = ground;
        for (let k = 0; k < solids; k++) {
          const h = tops[k]!;
          if (h > ground - EPS && !inside(h)) found[n++] = h;
        }
        sortAscending(found, n);
        for (let k = 0; k < n; k++) {
          const h = found[k]!;
          // A surface just under another one is stood on through it: keep the upper.
          if (k + 1 < n && found[k + 1]! - h <= NAV.climb) continue;
          if (!world.overlaps(x, z, NAV.radius, h + NAV.climb, h + NAV.height)) heights.push(h);
        }
      }
    }
    this.columnStart[columns] = heights.length;
    const count = heights.length;
    this.heights = Float32Array.from(heights);
    this.nodeColumn = new Uint32Array(count);
    for (let c = 0; c < columns; c++)
      for (let k = this.columnStart[c]!; k < this.columnStart[c + 1]!; k++) this.nodeColumn[k] = c;

    this.links = new Uint8Array(count);
    for (let k = 0; k < count; k++) this.links[k] = this.findLinks(k);
    for (const i of closed) world.setDoorOpen(i, false);
    this.doorLinks = world.doors.map((_, i) => this.linksThrough(world, i));
    this.doorLocked = new Uint8Array(world.doors.length);

    this.component = new Uint32Array(count);
    this.componentSizes = this.labelComponents();
  }

  /**
   * Cuts or restores the links through a door's doorway. The components are out of date
   * until updateComponents.
   */
  setDoorLocked(door: number, locked: boolean): void {
    if ((this.doorLocked[door] === 1) === locked) return;
    this.doorLocked[door] = locked ? 1 : 0;
    for (const l of this.doorLinks[door]!) {
      const bit = 1 << (l & 7);
      if (locked) this.links[l >> 3]! &= ~bit;
      else this.links[l >> 3]! |= bit;
    }
    this.componentsStale = true;
  }

  /**
   * Numbers the components again after doors were locked or unlocked: about 11 ms for the
   * test map on the Mac. Does nothing if nothing changed.
   */
  updateComponents(): void {
    if (!this.componentsStale) return;
    this.componentsStale = false;
    this.componentSizes = this.labelComponents();
  }

  get nodeCount(): number {
    return this.heights.length;
  }

  /** Middle of column q in x, and of row r in z. */
  x(q: number): number {
    return this.minX + (q + 0.5) * this.cellSize;
  }

  z(r: number): number {
    return this.minZ + (r + 0.5) * this.cellSize;
  }

  nodeX(node: number): number {
    return this.x(this.nodeColumn[node]! % this.cols);
  }

  nodeZ(node: number): number {
    return this.z(Math.floor(this.nodeColumn[node]! / this.cols));
  }

  nodeY(node: number): number {
    return this.heights[node]!;
  }

  /** The node linked to in direction d, or -1. */
  neighbour(node: number, d: number): number {
    if (!(this.links[node]! & (1 << d))) return -1;
    const c = this.nodeColumn[node]!;
    return this.nodeNear(
      (c % this.cols) + DIR_Q[d]!,
      Math.floor(c / this.cols) + DIR_R[d]!,
      this.heights[node]!,
    );
  }

  /**
   * The node a body with its feet at (x, y, z) stands on: in its column or a nearby one,
   * at most maxRise above its feet and not far below. -1 if there's none. A looser
   * maxRise finds a hand-placed spot whose height is only roughly right.
   */
  nearest(x: number, y: number, z: number, maxRise: number = NAV.climb): number {
    const q0 = Math.floor((x - this.minX) / this.cellSize);
    const r0 = Math.floor((z - this.minZ) / this.cellSize);
    let best = -1;
    let bestScore = Infinity;
    for (let r = r0 - 2; r <= r0 + 2; r++) {
      if (r < 0 || r >= this.rows) continue;
      for (let q = q0 - 2; q <= q0 + 2; q++) {
        if (q < 0 || q >= this.cols) continue;
        const c = r * this.cols + q;
        const dx = this.x(q) - x;
        const dz = this.z(r) - z;
        for (let k = this.columnStart[c]!; k < this.columnStart[c + 1]!; k++) {
          const dy = this.heights[k]! - y;
          if (dy > maxRise || dy < -2) continue;
          const score = dx * dx + dz * dz + dy * dy;
          if (score < bestScore) {
            bestScore = score;
            best = k;
          }
        }
      }
    }
    return best;
  }

  /** The node in column (q, r) within a step of height h, or -1. */
  private nodeNear(q: number, r: number, h: number): number {
    if (q < 0 || r < 0 || q >= this.cols || r >= this.rows) return -1;
    const c = r * this.cols + q;
    let best = -1;
    let bestDy: number = NAV.climb;
    for (let k = this.columnStart[c]!; k < this.columnStart[c + 1]!; k++) {
      const dy = Math.abs(this.heights[k]! - h);
      if (dy <= bestDy) {
        bestDy = dy;
        best = k;
      }
    }
    return best;
  }

  private findLinks(node: number): number {
    const c = this.nodeColumn[node]!;
    const q = c % this.cols;
    const r = Math.floor(c / this.cols);
    const h = this.heights[node]!;
    let bits = 0;
    const side: number[] = [];
    for (let d = 0; d < 4; d++) {
      side[d] = this.nodeNear(q + DIR_Q[d]!, r + DIR_R[d]!, h);
      if (side[d]! >= 0) bits |= 1 << d;
    }
    for (let d = 4; d < 8; d++) {
      const [a, b] = DIAGONAL_SIDES[d - 4]!;
      const sa = side[a]!;
      const sb = side[b]!;
      if (sa < 0 || sb < 0) continue;
      const m = this.nodeNear(q + DIR_Q[d]!, r + DIR_R[d]!, h);
      if (m < 0) continue;
      const hm = this.heights[m]!;
      if (
        Math.abs(this.heights[sa]! - hm) <= NAV.climb &&
        Math.abs(this.heights[sb]! - hm) <= NAV.climb
      )
        bits |= 1 << d;
    }
    return bits;
  }

  /** The links that cross a door's closed footprint, from nodes near its sill. */
  private linksThrough(world: CollisionWorld, door: number): Int32Array {
    const d = world.doors[door]!;
    const found: number[] = [];
    const reach = d.width / 2 + this.cellSize * 2;
    const q0 = Math.max(0, Math.floor((d.x - reach - this.minX) / this.cellSize));
    const q1 = Math.min(this.cols - 1, Math.floor((d.x + reach - this.minX) / this.cellSize));
    const r0 = Math.max(0, Math.floor((d.z - reach - this.minZ) / this.cellSize));
    const r1 = Math.min(this.rows - 1, Math.floor((d.z + reach - this.minZ) / this.cellSize));
    const c = Math.cos(d.yaw);
    const s = Math.sin(d.yaw);
    // Into the door's frame (the inverse of the rotation in collision-world.ts).
    const localX = (x: number, z: number): number => c * (x - d.x) - s * (z - d.z);
    const localZ = (x: number, z: number): number => s * (x - d.x) + c * (z - d.z);
    for (let r = r0; r <= r1; r++) {
      for (let q = q0; q <= q1; q++) {
        const col = r * this.cols + q;
        for (let n = this.columnStart[col]!; n < this.columnStart[col + 1]!; n++) {
          if (Math.abs(this.heights[n]! - d.y) > NAV.climb) continue;
          const ax = localX(this.x(q), this.z(r));
          const az = localZ(this.x(q), this.z(r));
          for (let dir = 0; dir < 8; dir++) {
            if (!(this.links[n]! & (1 << dir))) continue;
            const bx = this.x(q + DIR_Q[dir]!);
            const bz = this.z(r + DIR_R[dir]!);
            const lbx = localX(bx, bz);
            const lbz = localZ(bx, bz);
            // Crosses the door's plane within its width.
            if (az > 0 === lbz > 0) continue;
            const t = az / (az - lbz);
            if (Math.abs(ax + (lbx - ax) * t) <= d.width / 2) found.push(n * 8 + dir);
          }
        }
      }
    }
    return Int32Array.from(found);
  }

  /** Flood-fills the links, so reachability is a lookup. */
  private labelComponents(): number[] {
    this.component.fill(NONE);
    const sizes: number[] = [];
    const queue = new Uint32Array(this.nodeCount);
    for (let start = 0; start < this.nodeCount; start++) {
      if (this.component[start] !== NONE) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      this.component[start] = id;
      while (head < tail) {
        const n = queue[head++]!;
        for (let d = 0; d < 8; d++) {
          const m = this.neighbour(n, d);
          if (m >= 0 && this.component[m] === NONE) {
            this.component[m] = id;
            queue[tail++] = m;
          }
        }
      }
      sizes.push(tail);
    }
    return sizes;
  }
}

function sortAscending(a: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) {
    const v = a[i]!;
    let j = i - 1;
    while (j >= 0 && a[j]! > v) {
      a[j + 1] = a[j]!;
      j--;
    }
    a[j + 1] = v;
  }
}

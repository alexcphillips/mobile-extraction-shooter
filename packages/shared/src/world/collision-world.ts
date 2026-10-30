import { CellWalk, StaticGrid } from './grid';
import { HeightGrid, setHit, type HeightGridDef, type SurfaceHit } from './terrain';

/*
 * Rotation convention (matches three.js rotation.y): a local point (lx, lz) on something
 * with yaw θ is at world (x + lx cos θ + lz sin θ, z − lx sin θ + lz cos θ).
 * Solids only rotate about Y, so a standing capsule against a solid is a circle against
 * a rectangle in XZ plus a height overlap.
 */

/** A solid box: centre, half-extents and yaw. */
export interface BoxDef {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
}

/**
 * A solid wedge, used for stairs: a rectangle footprint (centre, half-extents, yaw), solid
 * from `bottom` up to a sloped top that rises from `low` at local −z to `high` at local +z.
 */
export interface RampDef {
  x: number;
  z: number;
  hx: number;
  hz: number;
  yaw: number;
  bottom: number;
  low: number;
  high: number;
}

/**
 * A ladder on a wall. (x, z) is the middle of its foot, on the face you climb; yaw turns
 * local +z to point out of the wall, towards the climber.
 */
export interface LadderDef {
  x: number;
  z: number;
  yaw: number;
  halfWidth: number;
  bottom: number;
  top: number;
}

/**
 * A door in a doorway. (x, y, z) is the bottom middle of the doorway, in the middle of the
 * wall; yaw turns local +z to the side it opens towards by default (a door starting open).
 * Seen from +z, a left hinge is at local −x. Closed, it fills the doorway; open, it stands
 * at 90° from its hinge, into +z or, flipped, into −z.
 */
export interface DoorDef {
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  thickness: number;
  hinge: 'left' | 'right';
  /** The key item that unlocks it; none means it's never locked. */
  key: string | undefined;
  /** How it starts. A door with a key starts locked unless it starts open. */
  open: boolean;
}

/** Everything the simulation collides with, as plain data. The map loader produces it. */
export interface WorldDef {
  terrain: HeightGridDef;
  boxes: readonly BoxDef[];
  ramps: readonly RampDef[];
  ladders: readonly LadderDef[];
  doors?: readonly DoorDef[];
}

export interface Ladder extends LadderDef {
  /** Outward normal, towards the climber. */
  nx: number;
  nz: number;
}

export type RayHitKind = 'none' | 'terrain' | 'solid';

export interface RayHit extends SurfaceHit {
  kind: RayHitKind;
  /** Solid index for solid hits (boxes first, then ramps, then doors), otherwise -1. */
  index: number;
}

export function createRayHit(): RayHit {
  return { kind: 'none', index: -1, distance: Infinity, nx: 0, ny: 0, nz: 0 };
}

/** Which surface groundAt found: a solid index, or -1 for terrain. */
export interface GroundHit {
  solid: number;
}

// Solid layout: centre x, z; half-extents x, z; cos and sin of yaw; bottom; top at local
// −z and at +z (equal for boxes).
const STRIDE = 9;
const GRID_CELL = 4;

/**
 * The collision world, built once from map data. All queries reuse internal scratch space
 * and allocate nothing. Only doors change: each is a solid with three poses (closed, open
 * into +z, open into −z), and setDoorOpen swaps between them (the sim's door state is the truth; syncDoors copies it
 * here).
 */
export class CollisionWorld {
  readonly terrain: HeightGrid;
  readonly ladders: readonly Ladder[];
  readonly doors: readonly DoorDef[];
  readonly solidCount: number;
  /** Solid index of the first door: doors come after boxes and ramps. */
  readonly firstDoor: number;
  private readonly s: Float64Array;
  /** Each door's solid closed, open into +z, then open into −z, STRIDE values each. */
  private readonly doorPoses: Float64Array;
  private readonly doorOpen: Uint8Array;
  /** Opens (or last opened) into −z. */
  private readonly doorFlipped: Uint8Array;
  private readonly grid: StaticGrid;
  private readonly found: Uint32Array;
  private readonly walk = new CellWalk();
  private readonly terrainHit: SurfaceHit = { distance: 0, nx: 0, ny: 0, nz: 0 };

  constructor(def: WorldDef) {
    this.terrain = new HeightGrid(def.terrain);
    this.doors = def.doors ?? [];
    this.firstDoor = def.boxes.length + def.ramps.length;
    this.solidCount = this.firstDoor + this.doors.length;
    this.s = new Float64Array(this.solidCount * STRIDE);
    let i = 0;
    for (const b of def.boxes) {
      this.setSolid(i++, b.x, b.z, b.hx, b.hz, b.yaw, b.y - b.hy, b.y + b.hy, b.y + b.hy);
    }
    for (const r of def.ramps)
      this.setSolid(i++, r.x, r.z, r.hx, r.hz, r.yaw, r.bottom, r.low, r.high);
    this.doorPoses = new Float64Array(this.doors.length * 3 * STRIDE);
    this.doorOpen = new Uint8Array(this.doors.length);
    this.doorFlipped = new Uint8Array(this.doors.length);
    this.doors.forEach((d, k) => {
      for (let pose = 0; pose < 3; pose++) {
        this.setSolid(i, ...doorPose(d, pose));
        this.doorPoses.set(this.s.subarray(i * STRIDE, (i + 1) * STRIDE), (k * 3 + pose) * STRIDE);
      }
      this.setDoorOpen(k, d.open);
      i++;
    });

    // A door's cell rectangle covers all its poses.
    const rects = new Float64Array(this.solidCount * 4);
    for (let k = 0; k < this.solidCount; k++) {
      const door = k - this.firstDoor;
      if (door < 0) rects.set(footprint(this.s, k * STRIDE), k * 4);
      else {
        const r = footprint(this.doorPoses, door * 3 * STRIDE);
        for (let pose = 1; pose < 3; pose++) {
          const b = footprint(this.doorPoses, (door * 3 + pose) * STRIDE);
          r[0] = Math.min(r[0], b[0]);
          r[1] = Math.min(r[1], b[1]);
          r[2] = Math.max(r[2], b[2]);
          r[3] = Math.max(r[3], b[3]);
        }
        rects.set(r, k * 4);
      }
    }
    const t = this.terrain;
    this.grid = new StaticGrid(t.minX, t.minZ, t.maxX - t.minX, t.maxZ - t.minZ, GRID_CELL, rects);
    this.found = new Uint32Array(this.solidCount);
    this.ladders = def.ladders.map((l) => ({ ...l, nx: Math.sin(l.yaw), nz: Math.cos(l.yaw) }));
  }

  isDoorOpen(door: number): boolean {
    return this.doorOpen[door] === 1;
  }

  /** Does the door open (or did it last open) into −z? */
  isDoorFlipped(door: number): boolean {
    return this.doorFlipped[door] === 1;
  }

  /** Moves a door's solid to its closed pose, or open into +z (or −z, flipped). */
  setDoorOpen(door: number, open: boolean, flipped = false): void {
    this.doorOpen[door] = open ? 1 : 0;
    this.doorFlipped[door] = flipped ? 1 : 0;
    const from = (door * 3 + (open ? (flipped ? 2 : 1) : 0)) * STRIDE;
    this.s.set(this.doorPoses.subarray(from, from + STRIDE), (this.firstDoor + door) * STRIDE);
  }

  /** The door a solid index is, or -1 for any other solid. */
  doorOf(solid: number): number {
    return solid >= this.firstDoor ? solid - this.firstDoor : -1;
  }

  /**
   * How far (x, z) is from a door's footprint closed, or open on the side it's open to
   * (or last was), across the ground: 0 inside it.
   */
  doorDistance(door: number, open: boolean, x: number, z: number): number {
    const pose = open ? 1 + this.doorFlipped[door]! : 0;
    distanceTo(this.doorPoses, (door * 3 + pose) * STRIDE, x, z);
    return closestDist;
  }

  private setSolid(
    i: number,
    x: number,
    z: number,
    hx: number,
    hz: number,
    yaw: number,
    bottom: number,
    top0: number,
    top1: number,
  ): void {
    this.s.set([x, z, hx, hz, Math.cos(yaw), Math.sin(yaw), bottom, top0, top1], i * STRIDE);
  }

  /**
   * Height of the highest surface under a standing circle whose top is at most maxTop:
   * the terrain under its centre, or any solid it overlaps. Writes what was found to out.
   */
  groundAt(x: number, z: number, radius: number, maxTop: number, out?: GroundHit): number {
    let best = this.terrain.heightAt(x, z);
    let solid = -1;
    const n = this.grid.query(x - radius, z - radius, x + radius, z + radius, this.found);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (!this.circleOverlaps(i, x, z, radius)) continue;
      const top = this.topAtClosest(i);
      if (top <= maxTop && top > best) {
        best = top;
        solid = i;
      }
    }
    if (out) out.solid = solid;
    return best;
  }

  /** The lowest solid underside above minBottom over a circle, or Infinity. */
  ceilingAt(x: number, z: number, radius: number, minBottom: number): number {
    let best = Infinity;
    const n = this.grid.query(x - radius, z - radius, x + radius, z + radius, this.found);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      const bottom = this.s[i * STRIDE + 6]!;
      if (bottom >= minBottom && bottom < best && this.circleOverlaps(i, x, z, radius))
        best = bottom;
    }
    return best;
  }

  /**
   * The solids whose footprint contains the point (x, z): each one's bottom and its top
   * there, written to bottoms and tops. Returns how many, at most bottoms.length.
   */
  solidsAt(x: number, z: number, bottoms: Float64Array, tops: Float64Array): number {
    const n = this.grid.query(x, z, x, z, this.found);
    let count = 0;
    for (let k = 0; k < n && count < bottoms.length; k++) {
      const i = this.found[k]!;
      if (!this.circleOverlaps(i, x, z, 1e-6)) continue;
      bottoms[count] = this.s[i * STRIDE + 6]!;
      tops[count] = this.topAtClosest(i);
      count++;
    }
    return count;
  }

  /**
   * Would pushOut move a standing circle with this height range? The same rules: solids
   * with their top at or below low, or their bottom at or above high, don't count.
   */
  overlaps(x: number, z: number, radius: number, low: number, high: number): boolean {
    const n = this.grid.query(x - radius, z - radius, x + radius, z + radius, this.found);
    for (let k = 0; k < n; k++) {
      const i = this.found[k]!;
      if (this.s[i * STRIDE + 6]! >= high) continue;
      if (this.circleOverlaps(i, x, z, radius) && this.topAtClosest(i) > low) return true;
    }
    return false;
  }

  /**
   * Pushes a standing circle out of every solid that overlaps the height range (low, high),
   * moving pos. A solid whose top is at or below low (something to step onto) doesn't
   * block. Returns true if anything pushed.
   */
  pushOut(pos: { x: number; z: number }, radius: number, low: number, high: number): boolean {
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      let pushed = false;
      const n = this.grid.query(
        pos.x - radius,
        pos.z - radius,
        pos.x + radius,
        pos.z + radius,
        this.found,
      );
      for (let k = 0; k < n; k++) {
        const i = this.found[k]!;
        const o = i * STRIDE;
        if (this.s[o + 6]! >= high) continue;
        if (!this.circleOverlaps(i, pos.x, pos.z, radius)) continue;
        if (this.topAtClosest(i) <= low) continue;
        // Push direction in the solid's local frame, then rotated back to world.
        let px: number;
        let pz: number;
        if (closestDist > 1e-9) {
          const f = (radius - closestDist) / closestDist;
          px = (localX - closestX) * f;
          pz = (localZ - closestZ) * f;
        } else {
          // Centre inside the rectangle: out through the nearest side.
          const penX = this.s[o + 2]! - Math.abs(localX);
          const penZ = this.s[o + 3]! - Math.abs(localZ);
          px = penX < penZ ? (localX < 0 ? -1 : 1) * (penX + radius) : 0;
          pz = penX < penZ ? 0 : (localZ < 0 ? -1 : 1) * (penZ + radius);
        }
        const c = this.s[o + 4]!;
        const sn = this.s[o + 5]!;
        pos.x += px * c + pz * sn;
        pos.z += -px * sn + pz * c;
        pushed = true;
      }
      if (!pushed) break;
      moved = true;
    }
    return moved;
  }

  /**
   * Distance to the first solid or terrain along a unit direction, or Infinity within
   * maxDist. 0 if the origin is inside something. Writes details to hit if given.
   */
  raycast(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    hit?: RayHit,
  ): number {
    let best = maxDist;
    let bestSolid = -1;
    let bestFace = -1;
    const t = this.terrain;
    const walk = this.walk;
    if (
      walk.begin(t.minX, t.minZ, GRID_CELL, this.grid.cols, this.grid.rows, ox, oz, dx, dz, maxDist)
    ) {
      this.grid.newPass();
      do {
        const cell = walk.r * this.grid.cols + walk.q;
        const start = this.grid.cellStart[cell]!;
        const end = this.grid.cellStart[cell + 1]!;
        for (let k = start; k < end; k++) {
          const i = this.grid.cellItems[k]!;
          if (!this.grid.firstVisit(i)) continue;
          const d = this.raySolid(i, ox, oy, oz, dx, dy, dz, best);
          if (d < best) {
            best = d;
            bestSolid = i;
            bestFace = rayFace;
          }
        }
        // Any solid hit before this cell's exit is the nearest: later cells are further on.
        if (bestSolid >= 0 && best <= walk.tExit) break;
      } while (walk.next());
    }

    const td = t.raycast(ox, oy, oz, dx, dy, dz, best, this.terrainHit);
    if (td <= best && td !== Infinity) {
      if (hit) {
        const h = this.terrainHit;
        hit.kind = 'terrain';
        hit.index = -1;
        setHit(hit, td, h.nx, h.ny, h.nz);
      }
      return td;
    }
    if (bestSolid < 0) {
      if (hit) {
        hit.kind = 'none';
        hit.index = -1;
        setHit(hit, Infinity, 0, 0, 0);
      }
      return Infinity;
    }
    if (hit) {
      hit.kind = 'solid';
      hit.index = bestSolid;
      this.faceNormal(bestSolid, bestFace, dx, dy, dz, best, hit);
    }
    return best;
  }

  /** Is a circle overlapping solid i's footprint? Leaves the closest point in the scratch. */
  private circleOverlaps(i: number, x: number, z: number, radius: number): boolean {
    distanceTo(this.s, i * STRIDE, x, z);
    return closestDist < radius;
  }

  /** Top height of solid i at the closest point; call right after circleOverlaps(i). */
  private topAtClosest(i: number): number {
    const o = i * STRIDE;
    const top0 = this.s[o + 7]!;
    const top1 = this.s[o + 8]!;
    if (top0 === top1) return top0;
    const hz = this.s[o + 3]!;
    return top0 + ((top1 - top0) * (closestZ + hz)) / (2 * hz);
  }

  /**
   * Ray against solid i: the intersection of the x and z slabs (local frame), y ≥ bottom,
   * and y below the (maybe sloped) top. Leaves the entering face in rayFace.
   */
  private raySolid(
    i: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
  ): number {
    const o = i * STRIDE;
    const c = this.s[o + 4]!;
    const sn = this.s[o + 5]!;
    const px = ox - this.s[o]!;
    const pz = oz - this.s[o + 1]!;
    const lox = c * px - sn * pz;
    const loz = sn * px + c * pz;
    const ldx = c * dx - sn * dz;
    const ldz = sn * dx + c * dz;
    const hx = this.s[o + 2]!;
    const hz = this.s[o + 3]!;
    const bottom = this.s[o + 6]!;
    const top0 = this.s[o + 7]!;
    const k = (this.s[o + 8]! - top0) / (2 * hz);
    rayT0 = 0;
    rayT1 = maxT;
    rayFace = -1;
    if (!slab(lox, ldx, hx, FACE_X)) return Infinity;
    if (!slab(loz, ldz, hz, FACE_Z)) return Infinity;
    // y ≥ bottom, as bottom − y ≤ 0.
    if (!halfSpace(bottom - oy, -dy, FACE_BOTTOM)) return Infinity;
    // y ≤ top0 + k (lz + hz), as y − k lz − (top0 + k hz) ≤ 0.
    if (!halfSpace(oy - k * loz - (top0 + k * hz), dy - k * ldz, FACE_TOP)) return Infinity;
    return rayT0;
  }

  private faceNormal(
    i: number,
    face: number,
    dx: number,
    dy: number,
    dz: number,
    distance: number,
    hit: SurfaceHit,
  ): void {
    const o = i * STRIDE;
    const c = this.s[o + 4]!;
    const sn = this.s[o + 5]!;
    const ldx = c * dx - sn * dz;
    const ldz = sn * dx + c * dz;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (face === FACE_X) nx = ldx > 0 ? -1 : 1;
    else if (face === FACE_Z) nz = ldz > 0 ? -1 : 1;
    else if (face === FACE_BOTTOM) ny = -1;
    else if (face === FACE_TOP) {
      const k = (this.s[o + 8]! - this.s[o + 7]!) / (2 * this.s[o + 3]!);
      const len = Math.hypot(1, k);
      ny = 1 / len;
      nz = -k / len;
    } else {
      // The ray started inside.
      setHit(hit, distance, -dx, -dy, -dz);
      return;
    }
    setHit(hit, distance, nx * c + nz * sn, ny, -nx * sn + nz * c);
  }
}

/**
 * A door's solid in one pose (0 closed, 1 open into +z, 2 open into −z), as setSolid's
 * arguments after the index.
 */
function doorPose(
  d: DoorDef,
  pose: number,
): [number, number, number, number, number, number, number, number] {
  const side = d.hinge === 'left' ? -1 : 1;
  const hw = d.width / 2;
  const top = d.y + d.height;
  if (pose === 0) return [d.x, d.z, hw, d.thickness / 2, d.yaw, d.y, top, top];
  // Turned 90° about the hinge, so the free edge swings towards +z (pose 1) or −z (pose 2).
  const c = Math.cos(d.yaw);
  const s = Math.sin(d.yaw);
  const hx = d.x + side * hw * c;
  const hz = d.z - side * hw * s;
  const yaw = d.yaw + ((pose === 1 ? side : -side) * Math.PI) / 2;
  const lx = -side * hw;
  return [
    hx + lx * Math.cos(yaw),
    hz - lx * Math.sin(yaw),
    hw,
    d.thickness / 2,
    yaw,
    d.y,
    top,
    top,
  ];
}

/** A solid's bounding rectangle in x, z: min x, min z, max x, max z. */
function footprint(s: Float64Array, o: number): [number, number, number, number] {
  const c = Math.abs(s[o + 4]!);
  const sn = Math.abs(s[o + 5]!);
  const hx = s[o + 2]!;
  const hz = s[o + 3]!;
  const ex = c * hx + sn * hz;
  const ez = sn * hx + c * hz;
  return [s[o]! - ex, s[o + 1]! - ez, s[o]! + ex, s[o + 1]! + ez];
}

/** The closest point of the solid at s[o] to (x, z), into the scratch below. */
function distanceTo(s: Float64Array, o: number, x: number, z: number): void {
  const px = x - s[o]!;
  const pz = z - s[o + 1]!;
  const c = s[o + 4]!;
  const sn = s[o + 5]!;
  const hx = s[o + 2]!;
  const hz = s[o + 3]!;
  localX = c * px - sn * pz;
  localZ = sn * px + c * pz;
  closestX = localX < -hx ? -hx : localX > hx ? hx : localX;
  closestZ = localZ < -hz ? -hz : localZ > hz ? hz : localZ;
  closestDist = Math.hypot(localX - closestX, localZ - closestZ);
}

// Scratch outputs, kept outside the class so the hot paths allocate nothing.
let localX = 0;
let localZ = 0;
let closestX = 0;
let closestZ = 0;
let closestDist = 0;
let rayT0 = 0;
let rayT1 = 0;
let rayFace = -1;

const FACE_X = 0;
const FACE_Z = 1;
const FACE_BOTTOM = 2;
const FACE_TOP = 3;

function slab(lo: number, ld: number, h: number, face: number): boolean {
  if (Math.abs(ld) < 1e-12) return lo >= -h && lo <= h;
  const ta = (-h - lo) / ld;
  const tb = (h - lo) / ld;
  const near = Math.min(ta, tb);
  if (near > rayT0) {
    rayT0 = near;
    rayFace = face;
  }
  rayT1 = Math.min(rayT1, Math.max(ta, tb));
  return rayT0 <= rayT1;
}

/** Clips the ray to a0 + a1 t ≤ 0. */
function halfSpace(a0: number, a1: number, face: number): boolean {
  if (Math.abs(a1) < 1e-12) return a0 <= 0;
  const t = -a0 / a1;
  if (a1 > 0) rayT1 = Math.min(rayT1, t);
  else if (t > rayT0) {
    rayT0 = t;
    rayFace = face;
  }
  return rayT0 <= rayT1;
}

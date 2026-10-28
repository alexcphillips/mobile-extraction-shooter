import { AI } from '../sim/ai';
import { MOVEMENT } from '../sim/movement';
import type { CollisionWorld } from '../world/collision-world';
import type { NavGrid } from './nav-grid';

/** Tuning for the map editor's search for hiding spots, in metres. */
export const EXPOSURE = {
  /** How far enemies see. */
  range: AI.sightRange,
  /** Spots enemies can walk to are looked from this far apart (every 4th column). */
  spacing: 2,
  /** Looked-from spots are bucketed in squares this big, searched nearest first. */
  bucket: 8,
} as const;

/** What a navigation node is to enemies, in `Exposure.kind`. */
export const SPOT = {
  /** Enemies can walk there. */
  reachable: 0,
  /** Enemies can't walk there, but can see a player standing there from somewhere they can. */
  seen: 1,
  /** Enemies can neither walk there nor see a player standing there: a hiding spot. */
  hidden: 2,
  /** Not looked at yet. */
  unknown: 3,
} as const;

const EYE = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
/** The two points enemies look for, as in their sight: the head and the middle of the body. */
const HEAD = MOVEMENT.standHeight - 0.12;
const BODY = MOVEMENT.standHeight * 0.6;

/**
 * Finds the spots a player could stand on where enemies can neither walk to them nor shoot
 * them (design.md → Editors → navigation overlay). Enemies reach the areas their spawns
 * are in (the biggest area if there are none). Every other node is checked for a clear
 * line from an enemy's eyes, standing on a reachable spot within sight range, to a standing
 * player's head or body there. Doors count as they are in the world (open or shut, never
 * locked: the grid is built with every door unlocked).
 *
 * It's slow on a big map (a ray per pair in the worst case), so it runs a slice at a time:
 * call `step` until it returns true. For the editor only; nothing in the game uses it.
 */
export class Exposure {
  /** SPOT.* for each nav node. */
  readonly kind: Uint8Array;
  /** Nodes left to check, and how many there were. */
  private readonly todo: number[] = [];
  readonly total: number;
  /** Looked-from eye positions (x, y, z) by bucket. */
  private readonly eyes: Float32Array[];
  private readonly bucketCols: number;
  private readonly bucketRows: number;
  /** The eye that last saw a spot, tried first for the next (neighbours mostly share one). */
  private lastBucket = -1;
  private lastEye = -1;

  constructor(
    private readonly nav: NavGrid,
    private readonly world: CollisionWorld,
    /** Where enemies start, as x, y, z. */
    starts: readonly (readonly [number, number, number])[],
  ) {
    const n = nav.nodeCount;
    this.kind = new Uint8Array(n).fill(SPOT.unknown);
    const areas = new Set<number>();
    for (const [x, y, z] of starts) {
      // A spawn's height is roughly right: look a little higher for its floor.
      const node = nav.nearest(x, y, z, 1);
      if (node >= 0) areas.add(nav.component[node]!);
    }
    if (!areas.size && nav.componentSizes.length) {
      let biggest = 0;
      nav.componentSizes.forEach((size, i) => {
        if (size > nav.componentSizes[biggest]!) biggest = i;
      });
      areas.add(biggest);
    }

    const every = Math.max(1, Math.round(EXPOSURE.spacing / nav.cellSize));
    const per = Math.max(1, Math.round(EXPOSURE.bucket / nav.cellSize));
    this.bucketCols = Math.ceil(nav.cols / per);
    this.bucketRows = Math.ceil(nav.rows / per);
    const lists: number[][] = Array.from({ length: this.bucketCols * this.bucketRows }, () => []);
    for (let node = 0; node < n; node++) {
      if (!areas.has(nav.component[node]!)) {
        this.todo.push(node);
        continue;
      }
      this.kind[node] = SPOT.reachable;
      const c = nav.nodeColumn[node]!;
      const q = c % nav.cols;
      const r = Math.floor(c / nav.cols);
      if (q % every || r % every) continue;
      const b = Math.floor(r / per) * this.bucketCols + Math.floor(q / per);
      lists[b]!.push(nav.nodeX(node), nav.nodeY(node) + EYE, nav.nodeZ(node));
    }
    this.eyes = lists.map((l) => Float32Array.from(l));
    this.total = this.todo.length;
  }

  /** How many nodes are still to check. */
  get left(): number {
    return this.todo.length;
  }

  /** Checks up to `count` more nodes. True once every node is done. */
  step(count: number): boolean {
    for (let k = 0; k < count && this.todo.length; k++) {
      const node = this.todo.pop()!;
      this.kind[node] = this.seen(node) ? SPOT.seen : SPOT.hidden;
    }
    return this.todo.length === 0;
  }

  /** Whether an enemy on a reachable spot within range sees a player standing on this node. */
  private seen(node: number): boolean {
    const nav = this.nav;
    const x = nav.nodeX(node);
    const y = nav.nodeY(node);
    const z = nav.nodeZ(node);
    if (this.lastEye >= 0 && this.sees(this.lastBucket, this.lastEye, x, y, z)) return true;
    const size = EXPOSURE.bucket;
    const bq = Math.floor((x - nav.minX) / size);
    const br = Math.floor((z - nav.minZ) / size);
    const rings = Math.ceil(EXPOSURE.range / size) + 1;
    // Nearest buckets first: the ring of buckets at each distance.
    for (let ring = 0; ring <= rings; ring++) {
      for (let r = br - ring; r <= br + ring; r++) {
        if (r < 0 || r >= this.bucketRows) continue;
        const edge = r === br - ring || r === br + ring;
        for (let q = bq - ring; q <= bq + ring; q += edge ? 1 : 2 * ring || 1) {
          if (q < 0 || q >= this.bucketCols) continue;
          const b = r * this.bucketCols + q;
          const eyes = this.eyes[b]!;
          for (let e = 0; e < eyes.length; e += 3) {
            if (this.sees(b, e, x, y, z)) {
              this.lastBucket = b;
              this.lastEye = e;
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  private sees(b: number, e: number, x: number, y: number, z: number): boolean {
    const eyes = this.eyes[b]!;
    const ox = eyes[e]!;
    const oy = eyes[e + 1]!;
    const oz = eyes[e + 2]!;
    if (Math.hypot(x - ox, z - oz) > EXPOSURE.range) return false;
    return (
      clearLine(this.world, ox, oy, oz, x, y + HEAD, z) ||
      clearLine(this.world, ox, oy, oz, x, y + BODY, z)
    );
  }
}

function clearLine(
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  tx: number,
  ty: number,
  tz: number,
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  return world.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d) === Infinity;
}

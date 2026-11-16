import {
  itemDef,
  loftPieces,
  meleeDef,
  modelShapes,
  platingShapes,
  weaponDef,
  type BodyDef,
  type ItemDb,
  type Outfit,
  type ModelShape,
  type SkeletonBone,
  type Layer,
} from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { MOUNT_OF, PLATING_TO_SKELETON } from './body-model';
import { Pose, SHOULDER_CAP, armsDown, holdGun, holdKnife, type Skeleton } from './skeleton-pose';

/*
 * The fit check (CH-3): how well worn gear fits our body, measured in a set of poses.
 * Every model part is a box, wedge, slab or cylinder, all convex, so a part is a solid
 * bounded by its face planes and "inside" is exact. Two measures per worn item and pose:
 *   through: a covered surface (the head under head gear; neck, chest, spine and hips
 *     under torso gear; gear worn under it, UNDER) that sits outside the gear
 *     with gear just under it, so it shows through. Probed inward along the surface's
 *     normal up to PROBE; the depth is how far it pokes out.
 *   into: a limb, the gun, or gear beside it (helmet against the carrier) sunk
 *     inside the gear's solids; the depth is how far in.
 * Surfaces are sampled about every SPACING meters. Allocates freely: a tool, not per frame.
 */

/** Worn slots. */
export const FIT_SLOTS = ['armor', 'rig', 'backpack', 'headset', 'helmet', 'visor'] as const;
export type FitSlot = (typeof FIT_SLOTS)[number];
export type FitKit = Partial<Record<FitSlot, string>>;
type Stack = 'head' | 'torso';
const STACK: Record<FitSlot, Stack> = {
  armor: 'torso',
  rig: 'torso',
  backpack: 'torso',
  headset: 'head',
  helmet: 'head',
  visor: 'head',
};
/**
 * What each is worn over. The visor isn't over the helmet: its brow tucks under the
 * helmet's rim, so the two sit side by side and are checked for sinking into each other.
 */
const UNDER: Record<FitSlot, readonly FitSlot[]> = {
  armor: [],
  rig: ['armor'],
  backpack: ['armor', 'rig'],
  headset: [],
  helmet: ['headset'],
  visor: ['headset'],
};
const COVERS: Record<Stack, readonly SkeletonBone[]> = {
  head: ['head'],
  torso: ['neck', 'chest', 'spine', 'hips'],
};

/** The test kit built in CH-3 to the look target. */
export const FIT_KIT: FitKit = {
  helmet: 'combat-helmet',
  visor: 'heavy-visor',
  headset: 'tactical-headset',
  armor: 'plate-carrier',
  rig: 'm12-patrol-rig',
};

const SPACING = 0.02;
/** How far under a surface gear still counts as covering it (m): the body, gear under it. */
export const PROBE = 0.05;
const PROBE_GEAR = 0.02;

/** A pose to check: its name, what it holds and how it's set, for what's worn. */
export interface FitPose {
  name: string;
  /** Held in the right hand (weapon matrix): a gun or knife item id. */
  holds?: string;
  set: (pose: Pose, items: ItemDb, layer: Layer) => void;
}

/** What a kit wears on its torso, which the arms keep clear of (CH-3c). */
export const kitLayer = (kit: FitKit): Layer => (kit.rig ? 'rig' : kit.armor ? 'armor' : 'bare');

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const ANKLE = new THREE.Vector3();
const rifle =
  (aim: number, pitch = 0) =>
  (pose: Pose, items: ItemDb, layer: Layer): void =>
    holdGun(
      pose,
      { kind: 'rifle', aim, pitch, tilt: 0, kick: 0 },
      weaponDef(items, 'akm').model,
      layer,
    );
const knife =
  (slash = -1) =>
  (pose: Pose, items: ItemDb, layer: Layer): void =>
    holdKnife(pose, meleeDef(items, 'knife').model.grip, slash, layer);

/**
 * The test poses until CH-5 brings clips: the code poses (the holds, empty hands), a
 * crouch and the head turned over the shoulder. Angles in radians.
 */
export const FIT_POSES: readonly FitPose[] = [
  { name: 'T', set: () => {} },
  { name: 'down', set: (p, _, layer) => armsDown(p, layer) },
  { name: 'rLow', holds: 'akm', set: rifle(0) },
  { name: 'rAim', holds: 'akm', set: rifle(1) },
  { name: 'rUp', holds: 'akm', set: rifle(1, 0.6) },
  { name: 'rDown', holds: 'akm', set: rifle(1, -0.6) },
  {
    name: 'pAim',
    holds: 'm9a3',
    set: (p, items, layer) =>
      holdGun(
        p,
        { kind: 'pistol', aim: 1, pitch: 0, tilt: 0, kick: 0 },
        weaponDef(items, 'm9a3').model,
        layer,
      ),
  },
  { name: 'knife', holds: 'knife', set: knife() },
  { name: 'slash', holds: 'knife', set: knife(0.5) },
  {
    // A deep crouch (2026-11-13, the user's call: lower): knees well forward, shins back,
    // the body leaning in, the hips dropped until the boots are on the ground; aiming.
    name: 'crouch',
    holds: 'akm',
    set: (p, items, layer) => {
      const { index } = p.skeleton;
      for (const [thigh, shin, foot] of [
        [index.thighL, index.shinL, index.footL],
        [index.thighR, index.shinR, index.footR],
      ] as const) {
        p.turnLocal(thigh, X, 1.6);
        p.turnLocal(shin, X, -2.25);
        p.turnLocal(foot, X, 0.65);
      }
      p.turnLocal(index.hips, X, -0.3);
      p.turnLocal(index.spine, X, 0.12);
      p.update();
      const rest = p.skeleton.rest[index.footR * 3 + 1]!;
      p.move[1] = rest - p.position(index.footR, ANKLE).y;
      p.update();
      rifle(1)(p, items, layer);
    },
  },
  {
    // Looking over the left shoulder and up, arms down.
    name: 'turn',
    set: (p, _, layer) => {
      const { index } = p.skeleton;
      p.turnLocal(index.neck, Y, 0.6);
      p.turnLocal(index.head, Y, 0.5);
      p.turnLocal(index.head, X, 0.35);
      p.update();
      armsDown(p, layer);
    },
  },
];

/** Points sampled over surfaces, in the rest frame, with their outward normals. */
interface Samples {
  p: number[];
  n: number[];
  /** The surface each one stands for (m²). */
  area: number[];
  /**
   * How far in it may be probed: to where it leaves its own part or meets another moving
   * with it (gear past those isn't under this surface, the body's own stuff is between).
   */
  reach: number[];
  /** The matrix each one moves by: a bone index, or WEAPON. */
  mat: number[];
  /** What each one is, an index into `labels`. */
  what: number[];
  labels: string[];
}
const WEAPON = -1;

function triangles(shapes: readonly ModelShape[]): {
  pos: ArrayLike<number>;
  nor: ArrayLike<number>;
} {
  const b = new TriangleBuilder(false);
  for (const s of shapes) b.shape(s);
  const g = b.build();
  const out = { pos: g.getAttribute('position').array, nor: g.getAttribute('normal').array };
  g.dispose();
  return out;
}

/**
 * Samples the surfaces of shapes that move together, leaving out what's buried inside
 * another of them (an ear's inner face in the skull), which faces inward and is never seen.
 */
function sample(out: Samples, shapes: readonly ModelShape[], mat: number, label: string): void {
  let what = out.labels.indexOf(label);
  if (what < 0) what = out.labels.push(label) - 1;
  const all = pieces(shapes);
  shapes.forEach((shape, si) => {
    const { pos, nor } = triangles([shape]);
    for (let t = 0; t < pos.length; t += 9) {
      const a = [pos[t]!, pos[t + 1]!, pos[t + 2]!];
      const b = [pos[t + 3]!, pos[t + 4]!, pos[t + 5]!];
      const c = [pos[t + 6]!, pos[t + 7]!, pos[t + 8]!];
      const edge = Math.max(dist(a, b), dist(b, c), dist(c, a));
      const steps = Math.max(1, Math.ceil(edge / SPACING));
      const area =
        new THREE.Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!)
          .cross(new THREE.Vector3(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!))
          .length() / 2;
      // The middles of the triangle cut into steps² small ones: never on an edge, where a
      // surface meets the next and a probe would graze it.
      const each = area / (steps * steps);
      for (let i = 0; i < steps; i++)
        for (let j = 0; i + j < steps; j++)
          for (const f of i + j < steps - 1 ? [1 / 3, 2 / 3] : [1 / 3]) {
            const u = (i + f) / steps;
            const v = (j + f) / steps;
            const w = 1 - u - v;
            const x = a[0]! * w + b[0]! * u + c[0]! * v;
            const y = a[1]! * w + b[1]! * u + c[1]! * v;
            const z = a[2]! * w + b[2]! * u + c[2]! * v;
            const inOther = (o: Solid[], oi: number): boolean =>
              oi !== si && o.some((q) => depthIn(q, x, y, z) > -0.001);
            if (all.some(inOther)) continue;
            const [dx, dy, dz] = [-nor[t]!, -nor[t + 1]!, -nor[t + 2]!];
            // Out of its own part: the furthest exit of the pieces it's on (a loft's run on).
            let reach = 0;
            for (const q of all[si]!)
              if (depthIn(q, x, y, z) > -0.001)
                reach = Math.max(reach, exit(q, x, y, z, dx, dy, dz));
            all.forEach((o, oi) => {
              if (oi === si) return;
              for (const q of o) reach = Math.min(reach, entry(q, x, y, z, dx, dy, dz, PROBE));
            });
            out.reach.push(Math.min(reach, PROBE));
            out.p.push(x, y, z);
            out.n.push(nor[t]!, nor[t + 1]!, nor[t + 2]!);
            out.area.push(each);
            out.mat.push(mat);
            out.what.push(what);
          }
    }
  });
}
const dist = (a: number[], b: number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/** A convex part: its face planes (n·x ≤ d inside) and a bounding sphere. */
interface Solid {
  planes: number[];
  c: [number, number, number];
  r: number;
}

/** Each shape's convex pieces as solids: a loft's segments each a hull, the rest whole. */
function pieces(shapes: readonly ModelShape[]): Solid[][] {
  return shapes.map((s) =>
    s.kind === 'loft'
      ? loftPieces(s.rings, s.sides).map((points) => solid({ ...s, kind: 'hull', points }))
      : [solid(s)],
  );
}
const solids = (shapes: readonly ModelShape[]): Solid[] => pieces(shapes).flat();

function solid(s: ModelShape): Solid {
  {
    const { pos, nor } = triangles([s]);
    const c: [number, number, number] = [0, 0, 0];
    const count = pos.length / 3;
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) c[k]! += pos[i + k]! / count;
    let r = 0;
    for (let i = 0; i < pos.length; i += 3)
      r = Math.max(r, Math.hypot(pos[i]! - c[0], pos[i + 1]! - c[1], pos[i + 2]! - c[2]));
    const planes: number[] = [];
    const seen = new Set<string>();
    for (let t = 0; t < pos.length; t += 9) {
      let nx = nor[t]!;
      let ny = nor[t + 1]!;
      let nz = nor[t + 2]!;
      let d = nx * pos[t]! + ny * pos[t + 1]! + nz * pos[t + 2]!;
      // Face the plane away from the middle, whatever the winding.
      if (nx * c[0] + ny * c[1] + nz * c[2] > d) [nx, ny, nz, d] = [-nx, -ny, -nz, -d];
      const key = [nx, ny, nz, d].map((v) => Math.round(v * 1e4)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      planes.push(nx, ny, nz, d);
    }
    return { planes, c, r };
  }
}

/** How deep p is inside the solid (> 0), or a negative number outside. */
function depthIn(s: Solid, x: number, y: number, z: number): number {
  let depth = Infinity;
  const pl = s.planes;
  for (let i = 0; i < pl.length; i += 4) {
    const gap = pl[i + 3]! - (pl[i]! * x + pl[i + 1]! * y + pl[i + 2]! * z);
    if (gap < depth) depth = gap;
    if (depth < 0) return depth;
  }
  return depth;
}

/** Where a ray from p (inside or on the solid) along d (unit) leaves it. */
function exit(
  s: Solid,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  let t1 = Infinity;
  const pl = s.planes;
  for (let i = 0; i < pl.length; i += 4) {
    const df = pl[i]! * dx + pl[i + 1]! * dy + pl[i + 2]! * dz;
    if (df <= 1e-9) continue;
    const t = (pl[i + 3]! - (pl[i]! * x + pl[i + 1]! * y + pl[i + 2]! * z)) / df;
    if (t > 1e-5) t1 = Math.min(t1, t);
  }
  return t1;
}

/** Where a ray from p along d (unit) first enters the solid within len, or Infinity. */
function entry(
  s: Solid,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  len: number,
): number {
  let t0 = 0;
  let t1 = len;
  entered = -1;
  const pl = s.planes;
  for (let i = 0; i < pl.length; i += 4) {
    const f = pl[i]! * x + pl[i + 1]! * y + pl[i + 2]! * z - pl[i + 3]!;
    const df = pl[i]! * dx + pl[i + 1]! * dy + pl[i + 2]! * dz;
    if (Math.abs(df) < 1e-6) {
      // Along the face: running over it isn't entering.
      if (f > -1e-4) return Infinity;
      continue;
    }
    const t = -f / df;
    if (df < 0 && t > t0) [t0, entered] = [t, i];
    else if (df > 0) t1 = Math.min(t1, t);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
/** The plane (its offset in planes) the last entry() went in by. */
let entered = -1;

/** One item's worst fit in one pose (meters), and what did it. */
export interface FitCell {
  through: number;
  throughBy: string;
  /** Where the worst of each is, in the rest pose's frame (the gear's). */
  throughAt: [number, number, number];
  intoAt: [number, number, number];
  into: number;
  intoBy: string;
  /** How much surface is sunk into it (m²), of everything that sinks in. */
  intoArea: number;
}
export interface FitRow {
  /** A worn slot, or 'body' for the bare chest (arms and gun into the torso). */
  slot: FitSlot | 'body';
  item: string;
  cells: FitCell[];
}

/**
 * The fit of every worn item of a kit in every pose: body (with the outfit's plating, if
 * given) and kit as bodyGeometry draws them.
 */
export function fitCheck(
  body: BodyDef,
  skeleton: Skeleton,
  kit: FitKit,
  items: ItemDb,
  poses: readonly FitPose[] = FIT_POSES,
  outfit?: Outfit,
): FitRow[] {
  const helmet = kit.helmet ? itemDef(items, kit.helmet) : null;
  const hidesHead = helmet?.type === 'armor' && !!helmet.hidesHead;
  const { index } = skeleton;

  // Body surfaces (and plating), by bone.
  const bodyS: Samples = { p: [], n: [], area: [], reach: [], mat: [], what: [], labels: [] };
  for (const bone of Object.keys(index) as SkeletonBone[]) {
    if (hidesHead && bone === 'head') continue;
    const parts = body.model.parts.filter((p) => p.group === bone);
    if (parts.length) sample(bodyS, modelShapes({ parts }), index[bone], bone);
  }
  if (outfit)
    for (const g of platingShapes(outfit.plating)) {
      const bone = PLATING_TO_SKELETON[g.bone];
      sample(bodyS, g.shapes, index[bone], bone);
    }
  const boneOf = (label: string): SkeletonBone | null =>
    label in index ? (label as SkeletonBone) : null;

  const worn = FIT_SLOTS.filter((s) => kit[s]).map((slot) => {
    const shapes = modelShapes(itemDef(items, kit[slot]!).model);
    const mount = skeleton.mounts[MOUNT_OF[slot]];
    const s: Samples = { p: [], n: [], area: [], reach: [], mat: [], what: [], labels: [] };
    sample(s, shapes, mount, `${slot}`);
    return { slot, id: kit[slot]!, mount, solids: solids(shapes), samples: s };
  });
  // What gear covers, in the rest frame: head gear the head volume's middle, torso gear the
  // upright line through the chest. A face turned away from it is an outside face; one
  // turned toward it is the inside or the opening (the head comes out of a helmet's bottom).
  const hv = skeleton.def.headVolume;
  const headAt = skeleton.index.head * 3;
  const headMiddle = [0, 1, 2].map(
    (k) => skeleton.rest[headAt + k]! + (hv.a[k]! + hv.b[k]!) / 2,
  ) as [number, number, number];
  const outside = (stack: Stack, plane: readonly number[], at: THREE.Vector3): boolean =>
    stack === 'head'
      ? plane[0]! * (at.x - headMiddle[0]) +
          plane[1]! * (at.y - headMiddle[1]) +
          plane[2]! * (at.z - headMiddle[2]) >
        0
      : plane[0]! * at.x + plane[2]! * at.z > 0;
  const held = new Map<string, Samples>();
  for (const p of poses)
    if (p.holds && !held.has(p.holds)) {
      const def = itemDef(items, p.holds);
      const s: Samples = { p: [], n: [], area: [], reach: [], mat: [], what: [], labels: [] };
      sample(s, modelShapes(def.model as { parts: [] }), WEAPON, 'gun');
      held.set(p.holds, s);
    }

  // The bare chest too: how far arms and the gun sink into the torso itself, so the gear's
  // numbers can be told from the hold's.
  const chestParts = body.model.parts.filter((p) => p.group === 'chest');
  const chest = { mount: index.chest, solids: solids(modelShapes({ parts: chestParts })) };
  const ARMS = new Set<string>([
    'upperArmL',
    'forearmL',
    'handL',
    'upperArmR',
    'forearmR',
    'handR',
  ]);
  // The top of the upper arm, where it meets the shoulder: rigid pieces overlap there as a
  // shoulder does, and clearArms leaves it (SHOULDER_CAP), so the check does too.
  const shoulderX = Math.abs(skeleton.rest[index.upperArmR * 3]!);
  const elbowX = Math.abs(skeleton.rest[index.forearmR * 3]!);
  const capX = shoulderX + (elbowX - shoulderX) * SHOULDER_CAP;
  const capped = (i: number): boolean =>
    bodyS.labels[bodyS.what[i]!]!.startsWith('upperArm') && Math.abs(bodyS.p[i * 3]!) < capX;

  const rows: FitRow[] = [
    { slot: 'body', item: '(chest)', cells: [] },
    ...worn.map((w) => ({ slot: w.slot, item: w.id, cells: [] })),
  ];
  const pose = new Pose(skeleton);
  const skin = (m: number, out: THREE.Matrix4): THREE.Matrix4 =>
    m === WEAPON ? out.fromArray(pose.weapon) : out.fromArray(pose.skin, m * 16);
  const inv = new THREE.Matrix4();
  const rel: THREE.Matrix4[] = Array.from(
    { length: skeleton.count + 1 },
    () => new THREE.Matrix4(),
  );
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const hit = new THREE.Vector3();

  for (const fp of poses) {
    pose.reset();
    pose.update();
    fp.set(pose, items, kitLayer(kit));
    pose.update();
    const gun = fp.holds ? held.get(fp.holds)! : null;

    const targets = [{ slot: 'body' as const, id: '(chest)', ...chest }, ...worn];
    targets.forEach((w, wi) => {
      const stack = w.slot === 'body' ? null : STACK[w.slot];
      // Everything into the gear's own rest frame (its mount's skin matrix undone).
      skin(w.mount, inv).invert();
      for (let m = 0; m < skeleton.count; m++) rel[m]!.multiplyMatrices(inv, skin(m, rel[m]!));
      rel[skeleton.count]!.multiplyMatrices(inv, skin(WEAPON, rel[skeleton.count]!));
      const cell: FitCell = {
        through: 0,
        throughBy: '',
        throughAt: [0, 0, 0],
        into: 0,
        intoBy: '',
        intoArea: 0,
        intoAt: [0, 0, 0],
      };

      const check = (
        s: Samples,
        label: (i: number) => string,
        mode: (i: number) => 'through' | 'into' | null,
        probe = PROBE,
      ): void => {
        for (let i = 0; i < s.mat.length; i++) {
          const how = mode(i);
          if (!how) continue;
          const m = rel[s.mat[i]! === WEAPON ? skeleton.count : s.mat[i]!]!;
          v.set(s.p[i * 3]!, s.p[i * 3 + 1]!, s.p[i * 3 + 2]!).applyMatrix4(m);
          if (how === 'into') {
            let deepest = 0;
            for (const solid of w.solids) {
              if (Math.hypot(v.x - solid.c[0], v.y - solid.c[1], v.z - solid.c[2]) > solid.r)
                continue;
              deepest = Math.max(deepest, depthIn(solid, v.x, v.y, v.z));
            }
            if (deepest > 0.002) cell.intoArea += s.area[i]!;
            if (deepest > cell.into) {
              cell.into = deepest;
              cell.intoBy = label(i);
              cell.intoAt = [v.x, v.y, v.z];
            }
            continue;
          }
          nv.set(s.n[i * 3]!, s.n[i * 3 + 1]!, s.n[i * 3 + 2]!).applyMatrix3(nm.setFromMatrix4(m));
          // Inside anything worn on the same mount (the brow up in the helmet's rim, seen
          // from the visor), it's hidden whatever this piece does.
          let hidden = worn.some(
            (o) =>
              o.mount === w.mount &&
              o.solids.some(
                (solid) =>
                  Math.hypot(v.x - solid.c[0], v.y - solid.c[1], v.z - solid.c[2]) <= solid.r &&
                  depthIn(solid, v.x, v.y, v.z) >= 0,
              ),
          );
          let first = Infinity;
          for (const solid of hidden ? [] : w.solids) {
            if (Math.hypot(v.x - solid.c[0], v.y - solid.c[1], v.z - solid.c[2]) > solid.r + probe)
              continue;
            if (depthIn(solid, v.x, v.y, v.z) >= 0) {
              hidden = true;
              break;
            }
            const t = entry(
              solid,
              v.x,
              v.y,
              v.z,
              -nv.x,
              -nv.y,
              -nv.z,
              Math.min(probe, s.reach[i]!),
            );
            if (t >= first || entered < 0) continue;
            hit.copy(v).addScaledVector(nv, -t);
            if (outside(stack!, solid.planes.slice(entered, entered + 3), hit)) first = t;
          }
          if (!hidden && first < Infinity && first > cell.through) {
            cell.through = first;
            cell.throughBy = label(i);
            cell.throughAt = [v.x, v.y, v.z];
          }
        }
      };

      const labelOf = (i: number): string => bodyS.labels[bodyS.what[i]!]!;
      if (w.slot === 'body') {
        check(bodyS, labelOf, (i) => (ARMS.has(labelOf(i)) && !capped(i) ? 'into' : null));
      } else {
        // The body: covered bones show through it, the rest sink into it.
        check(bodyS, labelOf, (i) =>
          capped(i) ? null : COVERS[stack!].includes(boneOf(labelOf(i))!) ? 'through' : 'into',
        );
        // Gear worn under it shows through; gear beside it (or on the other stack) sinks in.
        // Gear worn over it is checked from that side.
        for (const o of worn) {
          if (o === w || UNDER[o.slot].includes(w.slot)) continue;
          const under = UNDER[w.slot].includes(o.slot);
          check(
            o.samples,
            () => o.id,
            () => (under ? 'through' : 'into'),
            PROBE_GEAR,
          );
        }
      }
      if (gun)
        check(
          gun,
          () => fp.holds!,
          () => 'into',
        );
      rows[wi]!.cells.push(cell);
    });
  }
  return rows;
}

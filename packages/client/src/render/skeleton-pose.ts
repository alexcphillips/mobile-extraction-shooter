import {
  SKELETON_BONES,
  type Layer,
  type ClipDef,
  type MountSlot,
  type SkeletonBone,
  type SkeletonDef,
} from '@mes/shared';
import * as THREE from 'three';

/*
 * Our own character player (CH-1): poses the skeleton of content/characters/skeleton.json
 * from the clips of content/animations, with no GLB, GLTFLoader or AnimationMixer. Every
 * array is made once per body; posing allocates nothing.
 *
 * Bones are rigid (each body vertex has one bone, weight 1), so the renderer needs only
 * `skin`: per bone, the matrix taking a point modeled on the rest pose to where the pose
 * puts it, in the character's frame (feet at the origin, facing −z). Gear on a mount uses
 * its bone's skin matrix the same way, and the gun the `weapon` matrix.
 */

const DEG = Math.PI / 180;

/** The bones by index, and what every body of this skeleton shares. */
export interface Skeleton {
  readonly def: SkeletonDef;
  readonly count: number;
  /** Index of each bone (the order of SKELETON_BONES, parents first). */
  readonly index: Readonly<Record<SkeletonBone, number>>;
  /** Each bone's parent's index, −1 for the hips. */
  readonly parent: Int8Array;
  /** Rest offsets from the parent (x, y, z per bone). */
  readonly offset: Float32Array;
  /** Rest positions in the character's frame (x, y, z per bone). */
  readonly rest: Float32Array;
  readonly mounts: Readonly<Record<MountSlot, number>>;
}

export function compileSkeleton(def: SkeletonDef): Skeleton {
  const count = SKELETON_BONES.length;
  const index = Object.fromEntries(SKELETON_BONES.map((b, i) => [b, i])) as Record<
    SkeletonBone,
    number
  >;
  const parent = new Int8Array(count);
  const offset = new Float32Array(count * 3);
  const rest = new Float32Array(count * 3);
  const byName = new Map(def.bones.map((b) => [b.name, b]));
  SKELETON_BONES.forEach((name, i) => {
    const b = byName.get(name)!;
    const p = b.parent === null ? -1 : index[b.parent];
    // The schema lets a file list bones in any parent-first order; ours must be too.
    if (p >= i) throw new Error(`${name}'s parent must come before it in SKELETON_BONES`);
    parent[i] = p;
    for (let k = 0; k < 3; k++) {
      offset[i * 3 + k] = b.offset[k]!;
      rest[i * 3 + k] = b.offset[k]! + (p < 0 ? 0 : rest[p * 3 + k]!);
    }
  });
  const mounts = {
    helmet: index[def.mounts.helmet],
    armor: index[def.mounts.armor],
    rig: index[def.mounts.rig],
    backpack: index[def.mounts.backpack],
  };
  return { def, count, index, parent, offset, rest, mounts };
}

/** A clip ready to sample: its keys as quaternions, made once at load. */
export interface Clip {
  readonly id: string;
  readonly layer: 'lower' | 'upper';
  readonly length: number;
  readonly loop: boolean;
  readonly tracks: readonly { bone: number; times: Float32Array; quats: Float32Array }[];
  readonly move: { times: Float32Array; values: Float32Array } | null;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const qd = new THREE.Quaternion();

export function compileClip(def: ClipDef, skeleton: Skeleton): Clip {
  const tracks = Object.entries(def.keys).map(([bone, keys]) => {
    const times = new Float32Array(keys!.length);
    const quats = new Float32Array(keys!.length * 4);
    keys!.forEach(([t, x, y, z], i) => {
      times[i] = t;
      qa.setFromEuler(euler.set(x * DEG, y * DEG, z * DEG, 'YXZ'));
      // Keep neighbors in the same hemisphere so blending goes the short way.
      if (i > 0) {
        qb.fromArray(quats, (i - 1) * 4);
        if (qa.dot(qb) < 0) qa.set(-qa.x, -qa.y, -qa.z, -qa.w);
      }
      qa.toArray(quats, i * 4);
    });
    return { bone: skeleton.index[bone as SkeletonBone], times, quats };
  });
  const move = def.move
    ? {
        times: Float32Array.from(def.move, (k) => k[0]),
        values: Float32Array.from(def.move.flatMap((k) => [k[1], k[2], k[3]])),
      }
    : null;
  return { id: def.id, layer: def.layer, length: def.length, loop: def.loop, tracks, move };
}

/**
 * Where time t falls between keys: writes the two key indices and the blend between them
 * into SPAN. A loop wraps from its last key to its first across the seam.
 */
const SPAN = { i: 0, j: 0, f: 0 };
function span(times: Float32Array, t: number, length: number, loop: boolean): void {
  const n = times.length;
  const first = times[0]!;
  const last = times[n - 1]!;
  if (n === 1) {
    SPAN.i = SPAN.j = 0;
    SPAN.f = 0;
    return;
  }
  if (t >= first && t <= last) {
    let i = 0;
    while (i < n - 2 && times[i + 1]! <= t) i++;
    SPAN.i = i;
    SPAN.j = i + 1;
    SPAN.f = (t - times[i]!) / (times[i + 1]! - times[i]!);
    return;
  }
  if (!loop) {
    SPAN.i = SPAN.j = t < first ? 0 : n - 1;
    SPAN.f = 0;
    return;
  }
  // Across the seam: from the last key to the first one a loop later.
  const gap = first + length - last;
  const into = t > last ? t - last : t + length - last;
  SPAN.i = n - 1;
  SPAN.j = 0;
  SPAN.f = gap > 0 ? into / gap : 0;
}

/** A clip's time, wrapped for a loop and clamped for a one-shot. */
export function clipTime(clip: Clip, t: number): number {
  if (clip.loop) return ((t % clip.length) + clip.length) % clip.length;
  return Math.min(Math.max(t, 0), clip.length);
}

const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const vd = new THREE.Vector3();
const handPos = new THREE.Vector3();
const elbow = new THREE.Vector3();
const wrist = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * One body's pose: each bone's local rotation and the hips' move, and from them (update)
 * each bone's world matrix and skin matrix in the character's frame.
 */
export class Pose {
  /** Local rotation per bone, x y z w, relative to its rest (identity). */
  readonly local: Float32Array;
  /** The hips moved off their rest place, in the character's frame. */
  readonly move = new Float32Array(3);
  /** Each bone's world matrix (column-major, 16 per bone): rotation, and its posed origin. */
  readonly world: Float32Array;
  /** Each bone's skin matrix: rest-pose points to posed points (world · inverse bind). */
  readonly skin: Float32Array;
  /** The gun's matrix in the character's frame (the old weapon bone). */
  readonly weapon = new Float32Array(16);

  constructor(readonly skeleton: Skeleton) {
    this.local = new Float32Array(skeleton.count * 4);
    this.world = new Float32Array(skeleton.count * 16);
    this.skin = new Float32Array(skeleton.count * 16);
    this.reset();
    m1.identity().toArray(this.weapon);
    this.update();
  }

  /** Back to the rest pose (call before applying the frame's clips). */
  reset(): void {
    const q = this.local;
    for (let i = 0; i < q.length; i += 4) {
      q[i] = q[i + 1] = q[i + 2] = 0;
      q[i + 3] = 1;
    }
    this.move.fill(0);
  }

  /**
   * Blends a clip at time t over what's there by weight (0–1): 1 replaces the bones it
   * keys, a fade-in takes a part. Bones it doesn't key are left alone.
   */
  applyClip(clip: Clip, t: number, weight: number): void {
    if (weight <= 0) return;
    const time = clipTime(clip, t);
    for (const track of clip.tracks) {
      span(track.times, time, clip.length, clip.loop);
      qa.fromArray(track.quats, SPAN.i * 4);
      qb.fromArray(track.quats, SPAN.j * 4);
      qa.slerp(qb, SPAN.f);
      qc.fromArray(this.local, track.bone * 4);
      if (weight < 1) qa.copy(qc.slerp(qa, weight));
      qa.toArray(this.local, track.bone * 4);
    }
    if (clip.move) {
      const { times, values } = clip.move;
      span(times, time, clip.length, clip.loop);
      for (let k = 0; k < 3; k++) {
        const a = values[SPAN.i * 3 + k]!;
        const v = a + (values[SPAN.j * 3 + k]! - a) * SPAN.f;
        this.move[k] = this.move[k]! + (v - this.move[k]!) * Math.min(weight, 1);
      }
    }
  }

  /** Turns a bone about an axis in its parent's frame, on top of its pose (radians). */
  turnLocal(bone: number, axis: THREE.Vector3, angle: number): void {
    qa.setFromAxisAngle(axis, angle);
    qb.fromArray(this.local, bone * 4);
    qa.multiply(qb).toArray(this.local, bone * 4);
  }

  /** Works out every bone's world and skin matrix from the local pose. */
  update(): void {
    const { count, parent, offset, rest } = this.skeleton;
    for (let i = 0; i < count; i++) {
      const p = parent[i]!;
      v1.fromArray(offset, i * 3);
      if (p < 0) v1.add(vd.fromArray(this.move));
      qa.fromArray(this.local, i * 4);
      m1.compose(v1, qa, ONE);
      if (p >= 0) m1.premultiply(m2.fromArray(this.world, p * 16));
      m1.toArray(this.world, i * 16);
      // Skin = world · translate(−rest), as the rest rotation is the identity.
      v1.fromArray(rest, i * 3).negate();
      m1.multiply(m2.makeTranslation(v1.x, v1.y, v1.z)).toArray(this.skin, i * 16);
    }
  }

  /** A bone's posed origin (its joint) in the character's frame. */
  position(bone: number, out: THREE.Vector3): THREE.Vector3 {
    const w = this.world;
    const o = bone * 16;
    return out.set(w[o + 12]!, w[o + 13]!, w[o + 14]!);
  }

  /** A bone's world rotation in the character's frame. */
  rotation(bone: number, out: THREE.Quaternion): THREE.Quaternion {
    return out.setFromRotationMatrix(m1.fromArray(this.world, bone * 16));
  }

  /** Sets a bone's local rotation so its world rotation is q (update() after). */
  setWorldRotation(bone: number, q: THREE.Quaternion): void {
    const p = this.skeleton.parent[bone]!;
    if (p < 0) qd.copy(q);
    else qd.copy(this.rotation(p, qc).invert()).multiply(q);
    qd.toArray(this.local, bone * 4);
  }

  /** Turns a bone so the direction from it to `from` (a posed point) points at `to`. */
  aim(bone: number, from: THREE.Vector3, to: THREE.Vector3): void {
    this.position(bone, vc);
    va.subVectors(from, vc).normalize();
    vb.subVectors(to, vc).normalize();
    qa.setFromUnitVectors(va, vb);
    this.setWorldRotation(bone, this.rotation(bone, qb).premultiply(qa));
    this.update();
  }

  /**
   * Two-bone IK (ported from the pack's body): bends upper and lower so the hand's joint
   * reaches `to`, with the elbow towards `pole`, then turns the hand to world rotation
   * `rotation`. All in the character's frame. A target out of reach is reached towards.
   */
  reach(
    upper: number,
    lower: number,
    hand: number,
    to: THREE.Vector3,
    pole: THREE.Vector3,
    rotation: THREE.Quaternion,
  ): void {
    this.position(upper, va);
    this.position(lower, vb);
    this.position(hand, vc);
    const l1 = va.distanceTo(vb);
    const l2 = vb.distanceTo(vc);
    v1.subVectors(to, va);
    const d = Math.min(Math.max(v1.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    v1.normalize();
    // The elbow: along the reach by the law of cosines, then out towards the pole.
    const along = (l1 * l1 + d * d - l2 * l2) / (2 * d);
    const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    v2.copy(pole).addScaledVector(v1, -pole.dot(v1)).normalize();
    elbow.copy(va).addScaledVector(v1, along).addScaledVector(v2, out);
    wrist.copy(va).addScaledVector(v1, d);
    this.aim(upper, vb, elbow);
    this.aim(lower, this.position(hand, handPos), wrist);
    this.setWorldRotation(hand, rotation);
    this.update();
  }

  /** Where the skin matrices of `mount` start (gear on it is drawn with that matrix). */
  mountOffset(slot: MountSlot): number {
    return this.skeleton.mounts[slot] * 16;
  }
}

/** A clip playing on a layer, crossfading from the one before. */
export class ClipLayer {
  clip: Clip | null = null;
  time = 0;
  private prev: Clip | null = null;
  private prevTime = 0;
  private fade = 0;
  private fadeFor = 0;

  /** Switches to a clip (no-op if it's already playing), fading over `fade` seconds. */
  play(clip: Clip, fade: number, from = 0): void {
    if (clip === this.clip) return;
    this.prev = this.clip;
    this.prevTime = this.time;
    this.clip = clip;
    this.time = from;
    this.fadeFor = this.prev ? fade : 0;
    this.fade = 0;
  }

  /** Moves time on; a negative rate plays backwards. */
  advance(dt: number, rate = 1): void {
    this.time += dt * rate;
    this.prevTime += dt * rate;
    if (this.fade < this.fadeFor) this.fade += dt;
  }

  /** Poses the layer's bones: the old clip, then the new one faded in over it. */
  apply(pose: Pose): void {
    if (!this.clip) return;
    const w = this.fadeFor > 0 ? Math.min(1, this.fade / this.fadeFor) : 1;
    if (this.prev && w < 1) pose.applyClip(this.prev, this.prevTime, 1);
    pose.applyClip(this.clip, this.time, w);
  }
}

/**
 * How a gun is held (CH-1's hold, 2026-11-13). Aimed, its sight sits just under the eye
 * (as the first-person view puts it on the eye line); a rifle's butt is in the right
 * shoulder's pocket and the chest turns so the support hand reaches; a pistol is pushed
 * out in both hands. At the low ready a rifle tips down about its butt, and a pistol comes
 * in to the chest. Meters and radians, in the character's frame (x right, y up, −z forward).
 */
export const HOLD = {
  rifle: {
    /** The sight from the eye, aimed: right (cheek on the stock), down, forward. */
    sight: [0.07, -0.02, 0],
    /** Trigger to butt, so the butt is this far behind the grip. */
    pull: 0.33,
    /** The shoulder pocket from the right shoulder joint, where the butt goes. */
    pocket: [-0.07, -0.02, -0.06],
    /** The low ready: tipped down about the butt, and lowered. */
    lowPitch: -0.6,
    lowDrop: 0.03,
    /** The chest turns right (spine and chest share it; the neck turns the head back). */
    twist: 0.5,
  },
  pistol: {
    sight: [0.02, -0.02, -0.42],
    pull: 0,
    pocket: [0, 0, 0],
    /** The low ready: the gun's origin from the right shoulder joint, tipped down. */
    low: [-0.15, -0.22, -0.28],
    lowPitch: -0.8,
    lowDrop: 0,
    twist: 0,
  },
} as const;
/** The eye from the neck joint: up and forward. */
const EYE_FROM_NECK = [0, 0.12, -0.09] as const;
/** How much of looking up or down the upper body leans (spine and chest share it, the
 * neck turns the head back). */
const LOOK_LEAN = 0.4;
/** At the low ready the gun follows this much of looking up and down; aimed, all of it. */
export const LOW_FOLLOW = 0.3;

/**
 * The hands on the gun, in the gun's frame: each wrist's place from its grip or support
 * point, and the hand's rotation. At rest the right hand points along +x and the left along
 * −x, palms down; on the gun both point along the barrel (−z), the right palm in (−x) round
 * the grip, the left palm up under the handguard. First guesses until CH-6.
 */
const HANDS = {
  rightWrist: new THREE.Vector3(0.02, 0.03, 0.07),
  rightQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 2, 0, 'YXZ')),
  leftWrist: new THREE.Vector3(0, -0.03, 0.07),
  leftQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, -Math.PI / 2, 0, 'YXZ')),
};

const gunPos = new THREE.Vector3();
const gunQ = new THREE.Quaternion();
const target = new THREE.Vector3();
const pole = new THREE.Vector3();
const handGoal = new THREE.Quaternion();
const pitchAxis = new THREE.Vector3(1, 0, 0);
const leanAxis = new THREE.Vector3(0, 0, -1);
const upAxis = new THREE.Vector3(0, 1, 0);
const shoulder = new THREE.Vector3();
const eye = new THREE.Vector3();
const aimed = new THREE.Vector3();
const low = new THREE.Vector3();
const butt = new THREE.Vector3();
const pivot = new THREE.Vector3();
const gunMatrix = new THREE.Matrix4();

/** How far a gun is held out from the chest for what's worn on it (CH-3c), meters. */
export const STAND_OFF: Readonly<Record<Layer, number>> = { bare: 0, armor: 0.04, rig: 0.09 };
const standDir = new THREE.Vector3();

/** How a gun is being held this frame. */
export interface GunHold {
  kind: keyof typeof HOLD;
  /** 0 at the low ready, 1 aimed. */
  aim: number;
  /** Where it looks up (+) or down, radians. */
  pitch: number;
  /** The gun canted with the lean, radians. */
  tilt: number;
  /** Recoil kick, 0–1. */
  kick: number;
}

/** A gun's points the hold uses, in its own frame (its model's). */
export interface GunPoints {
  grip: readonly [number, number, number];
  support: readonly [number, number, number];
  sight: readonly [number, number, number];
}

/**
 * Turns the chest for the hold, places the gun (the weapon matrix) and puts both hands on
 * it by IK: the right on the grip, the left on the support point. Call after the clips and
 * update().
 */
export function holdGun(pose: Pose, h: GunHold, gun: GunPoints, layer: Layer = 'bare'): void {
  const { index } = pose.skeleton;
  const spec = HOLD[h.kind];
  // The chest turns for a rifle, and the upper body leans with the look, as the shoulders
  // follow the gun up and down.
  const lean = h.pitch * LOOK_LEAN;
  pose.turnLocal(index.spine, pitchAxis, lean / 2);
  pose.turnLocal(index.chest, pitchAxis, lean / 2);
  pose.turnLocal(index.neck, pitchAxis, -lean);
  if (spec.twist) {
    pose.turnLocal(index.spine, upAxis, -spec.twist / 2);
    pose.turnLocal(index.chest, upAxis, -spec.twist / 2);
    pose.turnLocal(index.neck, upAxis, spec.twist);
  }
  pose.update();
  pose.position(index.upperArmR, shoulder);
  pose.position(index.neck, eye).add(v1.fromArray(EYE_FROM_NECK));

  // Aimed: the sight under the eye, the butt (if any) back in the shoulder pocket.
  aimed.fromArray(spec.sight).add(eye).sub(v1.fromArray(gun.sight));
  if (spec.pull > 0) aimed.z = shoulder.z + spec.pocket[2] - (gun.grip[2] + spec.pull);
  // The low ready: a rifle tips down about its butt; a pistol comes in to the chest.
  if ('low' in spec) {
    low.fromArray(spec.low).add(shoulder);
  } else {
    butt.set(aimed.x, aimed.y + gun.grip[1], aimed.z + gun.grip[2] + spec.pull);
    low.subVectors(aimed, butt).applyAxisAngle(pitchAxis, spec.lowPitch).add(butt);
    low.y -= spec.lowDrop;
  }

  // Then turned up or down with the look and canted with the lean, about the shoulder at
  // the low ready and the eye aimed, so aimed sights stay on the eye line.
  const follow = h.pitch * (LOW_FOLLOW + (1 - LOW_FOLLOW) * h.aim);
  gunQ.setFromAxisAngle(pitchAxis, follow).premultiply(qd.setFromAxisAngle(leanAxis, h.tilt));
  pivot.lerpVectors(shoulder, eye, h.aim);
  gunPos.lerpVectors(low, aimed, h.aim);
  gunPos.z += h.kick * 0.03;
  gunPos.sub(pivot).applyQuaternion(gunQ).add(pivot);
  // Held off what's worn on the chest (CH-3c): out by its depth at the low ready, a third
  // of that aimed (the butt stays in the shoulder), along where the chest faces.
  const off = STAND_OFF[layer] * (1 - (2 / 3) * h.aim);
  if (off) {
    const w = pose.world;
    const c = index.chest * 16;
    gunPos.addScaledVector(standDir.set(-w[c + 8]!, -w[c + 9]!, -w[c + 10]!).normalize(), off);
  }
  const tip = h.pitch - follow + spec.lowPitch * (1 - h.aim) + h.kick * 0.06;
  gunQ.multiply(qd.setFromAxisAngle(pitchAxis, tip));
  gunMatrix.compose(gunPos, gunQ, ONE).toArray(pose.weapon);

  target.fromArray(gun.grip).add(HANDS.rightWrist).applyMatrix4(gunMatrix);
  handGoal.copy(gunQ).multiply(HANDS.rightQ);
  pose.reach(
    index.upperArmR,
    index.forearmR,
    index.handR,
    target,
    pole.set(0.25, -1, 0.15),
    handGoal,
  );
  target.fromArray(gun.support).add(HANDS.leftWrist).applyMatrix4(gunMatrix);
  slideInReach(pose, index.upperArmL, index.forearmL, index.handL, target);
  handGoal.copy(gunQ).multiply(HANDS.leftQ);
  pose.reach(
    index.upperArmL,
    index.forearmL,
    index.handL,
    target,
    pole.set(-0.25, -1, 0.15),
    handGoal,
  );
  clearArms(pose, layer, false);
}

const along = new THREE.Vector3();
const fromShoulder = new THREE.Vector3();

/**
 * If the wrist target is out of the arm's reach, slides it back along the gun (its +z,
 * towards the shooter) to the first place the arm reaches, as a support hand takes the
 * handguard where it can. Uses the weapon matrix; leaves the target alone if in reach.
 */
function slideInReach(
  pose: Pose,
  upper: number,
  lower: number,
  hand: number,
  to: THREE.Vector3,
): void {
  const reach =
    pose.position(upper, va).distanceTo(pose.position(lower, vb)) +
    vb.distanceTo(pose.position(hand, vc)) -
    2e-3;
  fromShoulder.subVectors(to, va);
  const c = fromShoulder.lengthSq() - reach * reach;
  if (c <= 0) return;
  along.set(0, 0, 1).transformDirection(gunMatrix);
  const b = fromShoulder.dot(along);
  const disc = b * b - c;
  if (disc < 0) return;
  // The nearer of the two places along the gun where the reach is just met.
  const t = -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : -b + Math.sqrt(disc);
  if (t > 0) to.addScaledVector(along, t);
}

/** The gun follows the right hand (carried while reloading or sprinting, or far away). */
export function carryGun(pose: Pose, gunInHand: THREE.Matrix4): void {
  m1.fromArray(pose.world, pose.skeleton.index.handR * 16)
    .multiply(gunInHand)
    .toArray(pose.weapon);
}

/**
 * The gun or knife relative to the right hand when the hand carries it: the inverse of the
 * hand on its grip (HANDS), so a carried gun sits in the hand as a held one does.
 */
export function gunInHand(
  grip: readonly [number, number, number],
  out: THREE.Matrix4,
): THREE.Matrix4 {
  v1.fromArray(grip).add(HANDS.rightWrist);
  return out.compose(v1, HANDS.rightQ, ONE).invert();
}

/**
 * The knife and empty hands (2026-11-13), by IK from the shoulders, in the character's
 * frame. Ready: the knife low and forward of the right hip, point forward and up; the left
 * hand up in front of the chest as a guard. A slash sweeps the right hand from drawn back
 * by the right shoulder, across the front at full stretch, to low on the left. Empty: arms
 * hanging, a little bent, elbows back. The sim's arm zones for each are fitted to these.
 */
export const KNIFE = {
  /** The right wrist, ready, and the knife tipped up from level (radians). */
  ready: [0.2, 1.1, -0.3],
  readyTip: 0.35,
  /** The left wrist, guarding. */
  guard: [-0.05, 1.3, -0.3],
  /** The slash's right-wrist path: start, middle (at p = 0.5) and end. */
  slash: [
    [0.3, 1.45, -0.15],
    [0.0, 1.35, -0.48],
    [-0.15, 1.2, -0.32],
  ],
  /** The blade turns from this far right of forward at the start to left at the end. */
  slashYaw: [0.7, -0.9],
} as const;
/** Empty hands: each wrist (the right's; the left mirrors it). */
export const ARMS_DOWN = [0.21, 0.9, -0.06] as const;

const knifeQ = new THREE.Quaternion();
const wristQ = new THREE.Quaternion();
const knifeHand = new THREE.Matrix4();

/** Bends the right arm to `to` with the knife hand turned `yaw` and tipped `tip`. */
function knifeArm(pose: Pose, to: THREE.Vector3, yaw: number, tip: number): void {
  const { index } = pose.skeleton;
  knifeQ.setFromAxisAngle(upAxis, yaw).multiply(qd.setFromAxisAngle(pitchAxis, tip));
  handGoal.copy(knifeQ).multiply(HANDS.rightQ);
  pose.reach(index.upperArmR, index.forearmR, index.handR, to, pole.set(0.3, -1, 0.3), handGoal);
}

/** Lines a hand up with its forearm (a straight wrist). */
function straightWrist(pose: Pose, forearm: number, hand: number): void {
  pose.setWorldRotation(hand, pose.rotation(forearm, wristQ));
  pose.update();
}

/**
 * Holds the knife (grip in its own frame): ready, or slashing with `slash` from 0 (start)
 * to 1 (end); below 0 is ready. Places it in the right hand (the weapon matrix). Call after
 * the clips and update().
 */
export function holdKnife(
  pose: Pose,
  grip: readonly [number, number, number],
  slash = -1,
  layer: Layer = 'bare',
): void {
  const { index } = pose.skeleton;
  target.fromArray(KNIFE.guard);
  pose.reach(
    index.upperArmL,
    index.forearmL,
    index.handL,
    target,
    pole.set(-0.5, -1, 0.3),
    qa.identity(),
  );
  straightWrist(pose, index.forearmL, index.handL);
  if (slash < 0) {
    knifeArm(pose, target.fromArray(KNIFE.ready), 0, KNIFE.readyTip);
  } else {
    // A curve through start, middle and end (a quadratic Bézier through the middle at 0.5).
    const [s0, s1, s2] = KNIFE.slash;
    const p = Math.min(1, slash);
    const u = 1 - p;
    for (let k = 0; k < 3; k++) {
      const c = 2 * s1[k]! - (s0[k]! + s2[k]!) / 2;
      v1.setComponent(k, u * u * s0[k]! + 2 * u * p * c + p * p * s2[k]!);
    }
    const yaw = KNIFE.slashYaw[0] + (KNIFE.slashYaw[1] - KNIFE.slashYaw[0]) * p;
    knifeArm(pose, target.copy(v1), yaw, 0);
  }
  knifeHand.fromArray(pose.world, index.handR * 16).multiply(gunInHand(grip, gunMatrix));
  knifeHand.toArray(pose.weapon);
  clearArms(pose, layer, false);
}

/** Empty hands: both arms hanging by the sides. Call after the clips and update(). */
export function armsDown(pose: Pose, layer: Layer = 'bare'): void {
  const { index } = pose.skeleton;
  for (const s of [1, -1]) {
    target.set(ARMS_DOWN[0] * s, ARMS_DOWN[1], ARMS_DOWN[2]);
    const [upper, lower, hand] =
      s > 0
        ? [index.upperArmR, index.forearmR, index.handR]
        : [index.upperArmL, index.forearmL, index.handL];
    pose.reach(upper, lower, hand, target, pole.set(0.2 * s, 0, 1), qa.identity());
    straightWrist(pose, lower, hand);
  }
  clearArms(pose, layer, true);
}

/*
 * Arms that clear the body and its gear (CH-3c, 2026-11-13). The torso, and what's worn on
 * it, is a few rounded boxes in the chest bone's frame (from the chest joint, x right, y up,
 * −z forward): the bare body's (matched to content/characters/body.json, which
 * body-model.test.ts checks), widened for body armor or a rig by LAYER_BOXES. Every armor
 * and rig model must stay inside its layer's boxes (fit-check.test.ts checks), so arms
 * kept out of the boxes never go through gear. The sim picks its arm zones by the same
 * layer (shared sim/hit-zones.ts → layerOf).
 */

/** A rounded box in the chest's frame: middle y and z, half height, width and depth. */
export interface TorsoBox {
  y: number;
  z: number;
  hy: number;
  hw: number;
  hd: number;
}
/** A box from rest-pose heights and depths (y0 to y1, half width, front −z to back +z). */
const restBox = (y0: number, y1: number, hw: number, front: number, back: number): TorsoBox => ({
  y: (y0 + y1) / 2 - CHEST_Y,
  hy: (y1 - y0) / 2,
  hw,
  z: (front + back) / 2,
  hd: (back - front) / 2,
});
/** The chest joint's rest height, which the boxes are measured from. */
const CHEST_Y = 1.28;
/**
 * The bare torso (rest pose): the pelvis, the waist and belly (narrower), the ribs. Matched
 * to content/characters/body.json; body-model.test.ts checks the body stays inside.
 */
export const TORSO: readonly TorsoBox[] = [
  restBox(0.9, 1.08, 0.168, -0.112, 0.112),
  restBox(1.08, 1.3, 0.158, -0.115, 0.108),
  restBox(1.3, 1.5, 0.168, -0.122, 0.105),
];
/**
 * The room each layer's gear may take, on top of the bare torso (rest pose, meters).
 * Armor: wide only low down, where a thin cummerbund goes (1.17–1.32, 18 cm out); up by
 * the armpits only the plate bags (15 cm out), 5 cm deep front and back (to z −0.17 and
 * 0.15). A rig: its pouches in front of that (to z −0.225), straps round the sides (19 cm).
 */
export const LAYER_BOXES: Readonly<Record<Exclude<Layer, 'bare'>, readonly TorsoBox[]>> = {
  armor: [restBox(1.17, 1.32, 0.18, -0.17, 0.15), restBox(1.17, 1.5, 0.15, -0.17, 0.15)],
  rig: [restBox(1.22, 1.37, 0.165, -0.225, 0.15), restBox(1.27, 1.33, 0.19, -0.17, 0.15)],
};
/** Corner rounding of the boxes. */
const TORSO_ROUND = 0.05;

/** The boxes for a layer: the body's, armor's, and a rig's over them (worn or not). */
const BOXES: Readonly<Record<Layer, readonly TorsoBox[]>> = {
  bare: TORSO,
  armor: [...TORSO, ...LAYER_BOXES.armor],
  rig: [...TORSO, ...LAYER_BOXES.armor, ...LAYER_BOXES.rig],
};
export function torsoBoxes(layer: Layer): readonly TorsoBox[] {
  return BOXES[layer];
}

/** How far a point (chest frame) is outside the boxes; negative inside. */
export function torsoDistance(boxes: readonly TorsoBox[], x: number, y: number, z: number): number {
  let best = Infinity;
  for (const b of boxes) {
    const r = Math.min(TORSO_ROUND, b.hw, b.hd);
    const qx = Math.abs(x) - b.hw + r;
    const qy = Math.abs(y - b.y) - b.hy;
    const qz = Math.abs(z - b.z) - b.hd + r;
    // Rounded only round the upright edges, flat top and bottom.
    const flat = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    const d = Math.hypot(Math.max(flat, 0), Math.max(qy, 0)) + Math.min(Math.max(flat, qy), 0);
    best = Math.min(best, d);
  }
  return best;
}

/** Arm thickness the boxes are kept clear of: upper arm (past the shoulder) and forearm. */
const UPPER_R = 0.047;
/**
 * How much of the upper arm, from the shoulder, is left out: there it rests on the ribs
 * under the shoulder, as arms do (the fit check leaves it out too).
 */
export const SHOULDER_CAP = 0.45;
const FORE_R = 0.045;
/** Overlap let pass (m): a sleeve brushing the ribs. */
const SLACK = 0.004;
const chestInv = new THREE.Matrix4();
const cs = new THREE.Vector3();
const ce = new THREE.Vector3();
const cw = new THREE.Vector3();
const cp = new THREE.Vector3();
const swivel = new THREE.Vector3();
const axisU = new THREE.Vector3();
const out = new THREE.Vector3();
const handQ = new THREE.Quaternion();

/** How deep an arm (shoulder, elbow, wrist; character frame) goes into the boxes. */
function armDepth(
  boxes: readonly TorsoBox[],
  s: THREE.Vector3,
  e: THREE.Vector3,
  w: THREE.Vector3,
): number {
  let worst = 0;
  for (let i = 0; i < 2; i++) {
    // The upper arm from under the armpit: at the shoulder it rests on the ribs, as arms do.
    const [a, b, r, from] = i === 0 ? [s, e, UPPER_R, SHOULDER_CAP] : [e, w, FORE_R, 0];
    for (let k = 0; k <= 6; k++) {
      const t = from + ((1 - from) * k) / 6;
      cp.lerpVectors(a, b, t).applyMatrix4(chestInv);
      worst = Math.max(worst, r - torsoDistance(boxes, cp.x, cp.y, cp.z));
    }
  }
  return worst;
}

/**
 * Keeps both arms out of the torso and what's worn on it. A free arm (hanging) first
 * swings its hand out until the arm clears; any arm then turns its elbow round the line
 * from shoulder to wrist (the hand staying where it is) to where it's clearest, preferring
 * the least turn. Call after the arms are placed. Allocates nothing.
 */
export function clearArms(pose: Pose, layer: Layer, free: boolean): void {
  const { index } = pose.skeleton;
  const boxes = BOXES[layer];
  for (const side of [1, -1]) {
    const [upper, lower, hand] =
      side > 0
        ? [index.upperArmR, index.forearmR, index.handR]
        : [index.upperArmL, index.forearmL, index.handL];
    chestInv.fromArray(pose.world, index.chest * 16).invert();
    pose.position(upper, cs);
    pose.position(lower, ce);
    pose.position(hand, cw);
    let depth = armDepth(boxes, cs, ce, cw);
    if (depth <= SLACK) continue;
    pose.rotation(hand, handQ);
    if (free) {
      // Raised out sideways about the shoulder (the chest's forward axis), 2° at a time,
      // until it clears: the least spread that does.
      const w = pose.world;
      const c = index.chest * 16;
      out.set(w[c + 8]!, w[c + 9]!, w[c + 10]!).normalize();
      for (let k = 0; k < 20 && depth > SLACK; k++) {
        cw.sub(cs)
          .applyAxisAngle(out, (side * 2 * Math.PI) / 180)
          .add(cs);
        swivel.subVectors(ce, cs).applyAxisAngle(out, (side * 2 * Math.PI) / 180);
        pose.reach(upper, lower, hand, cw, swivel, handQ);
        pose.position(lower, ce);
        pose.position(hand, cw);
        depth = armDepth(boxes, cs, ce, cw);
      }
      if (depth <= SLACK) continue;
    }
    // Turn the elbow round the shoulder–wrist line.
    axisU.subVectors(cw, cs).normalize();
    swivel.subVectors(ce, cs);
    let bestAngle = 0;
    let best = depth;
    for (let k = -12; k <= 12; k++) {
      if (!k) continue;
      const a = (k * 10 * Math.PI) / 180;
      ce.copy(swivel).applyAxisAngle(axisU, a).add(cs);
      const d = armDepth(boxes, cs, ce, cw) + Math.abs(a) * 0.002;
      if (d < best - 1e-4) [best, bestAngle] = [d, a];
    }
    if (!bestAngle) continue;
    swivel.applyAxisAngle(axisU, bestAngle);
    pose.reach(upper, lower, hand, cw, swivel, handQ);
  }
}

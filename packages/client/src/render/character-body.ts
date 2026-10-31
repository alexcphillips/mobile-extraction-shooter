import { MOVEMENT, heldWeapon, type Character, type ItemDb, type Outfit } from '@mes/shared';
import * as THREE from 'three';
import {
  WEAPON_BONE,
  characterGeometry,
  cloneCharacter,
  type CharacterTemplate,
  type Gear,
} from './character';
import { gunKey, gunModel, knifeModel, type GunModel } from './gun-model';

/** The clips the body plays, by their names in the Universal Animation Library. */
const CLIP = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  crouchIdle: 'Crouch_Idle_Loop',
  crouchWalk: 'Crouch_Fwd_Loop',
  air: 'Jump_Loop',
  death: 'Death01',
  gunIdle: 'Pistol_Idle_Loop',
  aimPose: 'Pistol_Aim_Neutral',
  reload: 'Pistol_Reload',
} as const;
type ClipName = (typeof CLIP)[keyof typeof CLIP];

/** How fast each moving clip walks at its own speed, in m/s, to match the feet to the ground. */
const CLIP_SPEED: Partial<Record<ClipName, number>> = {
  [CLIP.walk]: 1.3,
  [CLIP.jog]: 3.2,
  [CLIP.sprint]: 5.2,
  [CLIP.crouchWalk]: 0.9,
};

/** Bones the legs layer moves; the upper body layer moves the rest. */
const LOWER = /^(root|DEF-hips|DEF-thigh|DEF-shin|DEF-foot|DEF-toe)/;

const TUNE = {
  /** Below this speed (m/s) it stands still; above sprint it runs with the gun down. */
  still: 0.4,
  walkUpTo: 2.2,
  jogUpTo: 4.8,
  /** Crossfade times in seconds. */
  fadeLegs: 0.2,
  fadeUpper: 0.15,
  /** A knife slash lasts this long (s). */
  slash: 0.3,
  /** The legs turn towards where it's going by up to this much (radians) when strafing... */
  maxTwist: 1.2,
  /** ...and play backwards when it's going this far from where it faces. */
  backwards: 1.9,
  /** How quickly the legs' turn follows (per second). */
  twistRate: 10,
  /** How much of looking up or down bends the spine, and the head on top of that. */
  spineLean: 0.35,
  headLean: 0.35,
  /** The arms hold the gun by IK within this distance (m) of the camera... */
  ikRange: 30,
  /** ...and the animation updates every frame within the first distance, every 2nd within
   * the second, then every 4th; off screen, every 8th. */
  lodNear: 20,
  lodMid: 45,
  /** After dying, the body stops animating once the fall is over (seconds). */
  deadFreeze: 3,
};

/**
 * Where the gun sits, by how it's held, from the low ready to aimed: its origin relative
 * to the right shoulder in the character's frame (x right, y up, −z forward), turned up or
 * down with where it looks, and how far the gun is tipped down at the low ready (radians).
 */
const HOLD = {
  rifle: {
    low: new THREE.Vector3(-0.04, -0.16, -0.22),
    aimed: new THREE.Vector3(-0.07, 0.03, -0.24),
    lowPitch: -0.6,
  },
  pistol: {
    low: new THREE.Vector3(-0.1, -0.25, -0.3),
    aimed: new THREE.Vector3(-0.13, 0.0, -0.47),
    lowPitch: -0.8,
  },
} as const;
/** At the low ready the gun follows this much of looking up and down; aimed, all of it. */
const LOW_FOLLOW = 0.3;

/**
 * Hand poses measured once from the template's aim pose: each wrist and hand turn relative
 * to the gun's grip (right) and support point (left), and the gun relative to the right
 * hand, for when the hand carries it.
 */
interface HandPoses {
  rightWrist: THREE.Vector3;
  rightQ: THREE.Quaternion;
  leftWrist: THREE.Vector3;
  leftQ: THREE.Quaternion;
  gunInHand: THREE.Matrix4;
}

/** What every body made from one template shares: clips split in two, and hand poses. */
export class CharacterRig {
  readonly upper = new Map<string, THREE.AnimationClip>();
  readonly lower = new Map<string, THREE.AnimationClip>();
  readonly hands: HandPoses;

  constructor(readonly template: CharacterTemplate) {
    for (const name of Object.values(CLIP)) {
      const clip = template.clips.get(name);
      if (!clip) throw new Error(`character has no ${name} clip`);
      const legs = clip.tracks.filter((t) => LOWER.test(t.name));
      const rest = clip.tracks.filter((t) => !LOWER.test(t.name));
      this.lower.set(name, new THREE.AnimationClip(`${name}.lower`, clip.duration, legs));
      this.upper.set(name, new THREE.AnimationClip(`${name}.upper`, clip.duration, rest));
    }
    this.hands = measureHands(template);
  }
}

/** Poses a clone in the aim pose, with a pistol held level, and measures the hands. */
function measureHands(t: CharacterTemplate): HandPoses {
  const { root } = cloneCharacter(t);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(t.clips.get(CLIP.aimPose)!).play();
  mixer.update(0);
  root.updateMatrixWorld(true);
  const bone = (name: string) => root.getObjectByName(name)!;
  const handR = bone('DEF-handR');
  const handL = bone('DEF-handL');
  // The palm is a little along the hand from the wrist; the gun's grip goes there.
  const wristR = handR.getWorldPosition(new THREE.Vector3());
  const palm = new THREE.Vector3(0, 0.07, 0).applyMatrix4(handR.matrixWorld);
  const pistolGrip = new THREE.Vector3(0, -0.055, 0.005);
  const gun = new THREE.Matrix4().makeTranslation(palm.sub(pistolGrip));
  const gunInv = gun.clone().invert();
  const rightQ = handR.getWorldQuaternion(new THREE.Quaternion());
  const leftQ = handL.getWorldQuaternion(new THREE.Quaternion());
  const wristL = handL.getWorldPosition(new THREE.Vector3());
  mixer.stopAllAction();
  return {
    rightWrist: wristR.applyMatrix4(gunInv).sub(pistolGrip),
    rightQ,
    leftWrist: wristL.applyMatrix4(gunInv).sub(pistolGrip),
    leftQ,
    gunInHand: handR.matrixWorld.clone().invert().multiply(gun),
  };
}

type Upper = 'ik' | 'hand' | 'free' | 'dead';

/** An animation layer: one action playing, crossfading to the next. */
class Layer {
  action: THREE.AnimationAction | null = null;

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    private readonly clips: Map<string, THREE.AnimationClip>,
  ) {}

  /**
   * Plays a clip (from the start, or at the same point in its cycle as the last one if
   * sync), at a speed. Already playing: only the speed changes, unless restart.
   */
  play(
    name: string,
    fade: number,
    timeScale: number,
    sync = false,
    once = false,
    restart = false,
  ): void {
    const next = this.mixer.clipAction(this.clips.get(name)!);
    next.timeScale = timeScale;
    if (next === this.action) {
      if (restart) next.reset().play();
      return;
    }
    const prev = this.action;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    if (prev && sync) next.time = (prev.time / prev.getClip().duration) * next.getClip().duration;
    if (prev) prev.fadeOut(fade);
    next.fadeIn(prev ? fade : 0).play();
    this.action = next;
  }
}

// Scratch, so animating allocates nothing.
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const target = new THREE.Vector3();
const pole = new THREE.Vector3();
const elbow = new THREE.Vector3();
const wrist = new THREE.Vector3();
const gunPos = new THREE.Vector3();
const gunQ = new THREE.Quaternion();
const rootQ = new THREE.Quaternion();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const handGoal = new THREE.Quaternion();
// aimBone's own scratch, since reach calls it between uses of its own.
const s1 = new THREE.Vector3();
const s2 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const sq1 = new THREE.Quaternion();
const sq2 = new THREE.Quaternion();
const sq3 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();
const unitScale = new THREE.Vector3();
const pitchAxis = new THREE.Vector3(1, 0, 0);
const sphere = new THREE.Sphere();

/** Turns a bone by an angle about an axis in world space, keeping its parent as it is. */
function turnWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  bone.parent!.getWorldQuaternion(q1);
  q2.setFromAxisAngle(axis, angle);
  // world' = turn · parent · local, so local' = parent⁻¹ · turn · parent · local.
  bone.quaternion.premultiply(q1).premultiply(q2).premultiply(q1.invert());
  bone.updateMatrixWorld(true);
}

/** Turns a bone so the direction from it to a point (world) now points at a target. */
function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  bone.getWorldPosition(s3);
  s1.subVectors(from, s3).normalize();
  s2.subVectors(to, s3).normalize();
  bone.parent!.getWorldQuaternion(sq1);
  sq2.setFromUnitVectors(s1, s2);
  bone.getWorldQuaternion(sq3);
  bone.quaternion.copy(sq3.premultiply(sq2)).premultiply(sq1.invert());
  bone.updateMatrixWorld(true);
}

/**
 * A two-bone IK: bends an arm so the hand's wrist reaches a target (world), with the elbow
 * towards a pole direction, then turns the hand to a world rotation.
 */
function reach(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  hand: THREE.Object3D,
  to: THREE.Vector3,
  poleDir: THREE.Vector3,
  rotation: THREE.Quaternion,
): void {
  upper.getWorldPosition(a);
  lower.getWorldPosition(b);
  hand.getWorldPosition(c);
  const l1 = a.distanceTo(b);
  const l2 = b.distanceTo(c);
  v1.subVectors(to, a);
  const d = Math.min(Math.max(v1.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  v1.normalize();
  // The elbow: along the reach by the law of cosines, then out towards the pole.
  const along = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  v2.copy(poleDir).addScaledVector(v1, -poleDir.dot(v1)).normalize();
  elbow.copy(a).addScaledVector(v1, along).addScaledVector(v2, out);
  aimBone(upper, b, elbow);
  hand.getWorldPosition(c);
  // The wrist goes as far as the arm reaches towards the target.
  wrist.copy(a).addScaledVector(v1, d);
  aimBone(lower, c, wrist);
  lower.getWorldQuaternion(q1);
  hand.quaternion.copy(rotation).premultiply(q1.invert());
  hand.updateMatrixWorld(true);
}

/**
 * A character drawn with the animated body: legs from the moving clips, the upper body
 * holding the gun (by IK at the low ready or aimed, following where it looks), carrying it
 * in the right hand while reloading or sprinting, and falling down dead. The look (outfit,
 * helmet, armour and gun) is one skinned mesh. Positions are interpolated between ticks.
 */
export class CharacterBody {
  readonly root: THREE.Group;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly mixer: THREE.AnimationMixer;
  private readonly legs: Layer;
  private readonly top: Layer;
  private readonly bone: Record<
    'hips' | 'spine1' | 'spine3' | 'head' | 'upperL' | 'upperR' | 'lowerL' | 'lowerR',
    THREE.Object3D
  > & { handL: THREE.Object3D; handR: THREE.Object3D; weapon: THREE.Object3D };
  /**
   * The bones posed on top of the clips, and their rotations as the clips left them. The
   * mixer only writes a bone when its clip value changes, so they're put back before each
   * update; otherwise turns would pile up frame after frame.
   */
  private readonly posed: THREE.Object3D[];
  private readonly clipQ: THREE.Quaternion[];
  private look = '';
  private gun: GunModel | null = null;
  /** The knife is out (and no gun). */
  private knife = false;
  /** A knife swing: 1 as it starts, down to 0 as it ends. */
  private slash = 0;
  private hold: 'rifle' | 'pistol' = 'rifle';
  /** The reload time left when last animated, to tell when a new one starts, and its pace. */
  private reloadLeft = 0;
  private reloadPace = 1;
  private twist = 0;
  private kick = 0;
  private flinch = 0;
  private deadFor = 0;
  /** Seconds of animation still to play, for bodies that update every few frames. */
  private pending = 0;
  private frame: number;
  // The character's feet and yaw at the last two ticks.
  private readonly prev = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly cur = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    private readonly rig: CharacterRig,
    private readonly outfit: Outfit,
    c: Character,
  ) {
    const { root, mesh } = cloneCharacter(rig.template);
    this.root = root;
    this.mesh = mesh;
    this.mixer = new THREE.AnimationMixer(root);
    this.legs = new Layer(this.mixer, rig.lower);
    this.top = new Layer(this.mixer, rig.upper);
    const get = (name: string) => root.getObjectByName(name)!;
    this.bone = {
      hips: get('DEF-hips'),
      spine1: get('DEF-spine001'),
      spine3: get('DEF-spine003'),
      head: get('DEF-head'),
      upperL: get('DEF-upper_armL'),
      upperR: get('DEF-upper_armR'),
      lowerL: get('DEF-forearmL'),
      lowerR: get('DEF-forearmR'),
      handL: get('DEF-handL'),
      handR: get('DEF-handR'),
      weapon: get(WEAPON_BONE),
    };
    const { weapon: _weapon, ...posed } = this.bone;
    this.posed = Object.values(posed);
    this.clipQ = this.posed.map((b) => b.quaternion.clone());
    this.frame = c.id;
    this.tick(c);
    this.tick(c);
  }

  /** After each tick: where the character is now, to interpolate from the last. */
  tick(ch: Character): void {
    Object.assign(this.prev, this.cur);
    this.cur.x = ch.x;
    this.cur.y = ch.y;
    this.cur.z = ch.z;
    this.cur.yaw = ch.yaw;
  }

  /** It fired: the gun kicks. */
  fired(): void {
    this.kick = Math.min(1.5, this.kick + 1);
  }

  /** It was hit: the upper body flinches. */
  hit(): void {
    this.flinch = 1;
  }

  /** It swung its knife. */
  swung(): void {
    this.slash = 1;
  }

  /**
   * Places the body between the last two ticks (alpha 0–1) and animates it, every few
   * frames when far away or off screen.
   */
  update(
    ch: Character,
    items: ItemDb,
    alpha: number,
    dt: number,
    camera: THREE.Camera,
    frustum: THREE.Frustum,
  ): void {
    const { prev, cur } = this;
    this.root.position.set(
      prev.x + (cur.x - prev.x) * alpha,
      prev.y + (cur.y - prev.y) * alpha,
      prev.z + (cur.z - prev.z) * alpha,
    );
    let dy = cur.yaw - prev.yaw;
    dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
    this.root.rotation.y = prev.yaw + dy * alpha;
    this.setLook(ch, items);

    this.pending += dt;
    const distance = camera.position.distanceTo(this.root.position);
    sphere.set(this.root.position, 1.6);
    sphere.center.y += 0.9;
    const onScreen = frustum.intersectsSphere(sphere);
    const every = !onScreen ? 8 : distance < TUNE.lodNear ? 1 : distance < TUNE.lodMid ? 2 : 4;
    if (++this.frame % every !== 0) return;
    const step = this.pending;
    this.pending = 0;
    if (this.deadFor > TUNE.deadFreeze && ch.health.dead) return;
    this.animate(ch, step, onScreen && distance < TUNE.ikRange);
  }

  /** Rebuilds the mesh's geometry only when the gear changes. */
  private setLook(ch: Character, items: ItemDb): void {
    const w = heldWeapon(ch);
    const g = ch.gear;
    const knife = !w && g.hand === 'knife' && g.knife ? g.knife.item : null;
    const held = w ? gunKey(w) : (knife ?? '');
    const gear: Gear = {
      helmet: g.helmet?.item ?? null,
      armour: g.bodyArmour?.item ?? null,
      rig: g.rig?.item ?? null,
      backpack: g.backpack?.item ?? null,
      gun: null,
    };
    const key = `${gear.helmet} ${gear.armour} ${gear.rig} ${gear.backpack} ${held}`;
    if (key === this.look) return;
    this.look = key;
    this.gun = w ? gunModel(w, items) : null;
    this.knife = !!knife;
    this.hold = this.gun?.hold ?? 'rifle';
    gear.gun = this.gun?.shapes ?? (knife ? knifeModel(items, knife).shapes : null);
    this.mesh.geometry = characterGeometry(this.rig.template, this.outfit, gear, items);
  }

  private animate(ch: Character, dt: number, ik: boolean): void {
    // Velocity in the character's frame: forward and right.
    const sy = Math.sin(ch.yaw);
    const cy = Math.cos(ch.yaw);
    const fwd = -ch.vx * sy - ch.vz * cy;
    const right = ch.vx * cy - ch.vz * sy;
    const speed = Math.hypot(fwd, right);
    const crouched = ch.height < (MOVEMENT.standHeight + MOVEMENT.crouchHeight) / 2;
    const dead = ch.health.dead;

    // Legs, turned towards where it's going, or backwards.
    let heading = speed > TUNE.still ? Math.atan2(right, fwd) : 0;
    let dir = 1;
    if (Math.abs(heading) > TUNE.backwards) {
      heading -= Math.sign(heading) * Math.PI;
      dir = -1;
    }
    heading = Math.max(-TUNE.maxTwist, Math.min(TUNE.maxTwist, heading));
    let legs: ClipName;
    if (dead) legs = CLIP.death;
    // A vault is the jump clip too; prone has no clips yet, so it's drawn crouched.
    else if (ch.mode === 'air' || ch.mode === 'vault') legs = CLIP.air;
    else if (speed <= TUNE.still) legs = crouched ? CLIP.crouchIdle : CLIP.idle;
    else if (crouched) legs = CLIP.crouchWalk;
    else if (speed <= TUNE.walkUpTo) legs = CLIP.walk;
    else if (speed <= TUNE.jogUpTo) legs = CLIP.jog;
    else legs = CLIP.sprint;
    const natural = CLIP_SPEED[legs];
    const pace = natural ? dir * Math.max(0.5, Math.min(2, speed / natural)) : 1;
    this.legs.play(legs, TUNE.fadeLegs, pace, !!natural, dead);

    // The upper body.
    const w = heldWeapon(ch);
    let mode: Upper;
    if (dead) mode = 'dead';
    // Arms down while drawing or using a med, as when sprinting.
    else if ((!w && !this.knife) || ch.mode !== 'ground' || legs === CLIP.sprint) mode = 'free';
    else if (ch.draw > 0 || ch.using) mode = 'free';
    else if (!w || w.reloading > 0) mode = 'hand';
    else mode = ik ? 'ik' : 'hand';
    if (mode === 'dead') {
      this.top.play(CLIP.death, TUNE.fadeLegs, 1, false, true);
      this.deadFor += dt;
    } else {
      this.deadFor = 0;
      if (mode === 'free') this.top.play(legs, TUNE.fadeUpper, pace, true);
      else if (w && w.reloading > 0) {
        // The reload clip, timed to the reload, from the start of each one.
        const fresh = w.reloading > this.reloadLeft;
        if (fresh) this.reloadPace = this.rig.upper.get(CLIP.reload)!.duration / w.reloading;
        this.top.play(CLIP.reload, TUNE.fadeUpper, this.reloadPace, false, true, fresh);
      } else this.top.play(CLIP.gunIdle, TUNE.fadeUpper, 1);
    }
    this.reloadLeft = w?.reloading ?? 0;
    for (let i = 0; i < this.posed.length; i++) this.posed[i]!.quaternion.copy(this.clipQ[i]!);
    this.mixer.update(dt);
    for (let i = 0; i < this.posed.length; i++) this.clipQ[i]!.copy(this.posed[i]!.quaternion);
    this.root.updateMatrixWorld(true);

    // Turn the legs and keep the chest facing forward.
    const k = 1 - Math.exp(-dt * TUNE.twistRate);
    this.twist += ((dead ? 0 : -heading) - this.twist) * k;
    if (Math.abs(this.twist) > 1e-3) {
      turnWorld(this.bone.hips, UP, this.twist);
      turnWorld(this.bone.spine1, UP, -this.twist);
    }
    this.kick *= Math.exp(-dt / 0.08);
    this.flinch *= Math.exp(-dt / 0.15);
    this.slash = Math.max(0, this.slash - dt / TUNE.slash);
    if (dead || !w || !this.gun) {
      if (this.knife && mode === 'hand' && this.slash > 0) this.slashArm();
      this.carry();
      return;
    }

    // Lean with where it looks, and flinch back when hit.
    this.root.getWorldQuaternion(rootQ);
    pitchAxis.set(1, 0, 0).applyQuaternion(rootQ);
    const look = mode === 'free' ? 0 : ch.pitch;
    turnWorld(this.bone.spine3, pitchAxis, look * TUNE.spineLean + this.flinch * 0.25);
    turnWorld(this.bone.head, pitchAxis, look * TUNE.headLean);
    if (mode !== 'ik') {
      this.carry();
      return;
    }

    // The gun, from the right shoulder: from the low ready up to aimed, then where it looks.
    const hold = HOLD[this.hold];
    const follow = ch.pitch * (LOW_FOLLOW + (1 - LOW_FOLLOW) * ch.aim);
    m1.copy(this.root.matrixWorld).invert();
    this.bone.upperR.getWorldPosition(gunPos).applyMatrix4(m1);
    gunQ.setFromAxisAngle(pitchAxis.set(1, 0, 0), follow);
    v1.lerpVectors(hold.low, hold.aimed, ch.aim);
    v1.z += this.kick * 0.03;
    gunPos.add(v1.applyQuaternion(gunQ));
    const tip = ch.pitch - follow + hold.lowPitch * (1 - ch.aim) + this.kick * 0.06;
    gunQ.multiply(q1.setFromAxisAngle(pitchAxis, tip));
    this.bone.weapon.position.copy(gunPos);
    this.bone.weapon.quaternion.copy(gunQ);
    this.bone.weapon.updateMatrixWorld();

    // Both hands onto it: the right on the grip, the left on the support point.
    const { hands } = this.rig;
    const gunWorld = this.bone.weapon.matrixWorld;
    gunQ.premultiply(rootQ);
    target
      .set(...this.gun.grip)
      .add(hands.rightWrist)
      .applyMatrix4(gunWorld);
    pole.set(0.25, -1, 0.15).applyQuaternion(rootQ);
    handGoal.copy(gunQ).multiply(hands.rightQ);
    reach(this.bone.upperR, this.bone.lowerR, this.bone.handR, target, pole, handGoal);
    target
      .set(...this.gun.support)
      .add(hands.leftWrist)
      .applyMatrix4(gunWorld);
    pole.set(-0.25, -1, 0.15).applyQuaternion(rootQ);
    handGoal.copy(gunQ).multiply(hands.leftQ);
    reach(this.bone.upperL, this.bone.lowerL, this.bone.handL, target, pole, handGoal);
  }

  /**
   * The right hand slashes: out to the right of the chest, then across and forward to the
   * left, by IK from the shoulder.
   */
  private slashArm(): void {
    const p = 1 - this.slash;
    const out = Math.sin(Math.PI * p);
    const across = (1 - Math.cos(Math.PI * p)) / 2;
    this.root.getWorldQuaternion(rootQ);
    this.bone.upperR.getWorldPosition(target);
    // In the body's frame: it faces −z, so +x is its right.
    v1.set(0.25 - 0.5 * across, -0.2 + 0.08 * out, -(0.25 + 0.3 * out)).applyQuaternion(rootQ);
    target.add(v1);
    pole.set(0.25, -1, 0.15).applyQuaternion(rootQ);
    this.bone.handR.getWorldQuaternion(handGoal);
    reach(this.bone.upperR, this.bone.lowerR, this.bone.handR, target, pole, handGoal);
  }

  /** The gun follows the right hand, as the clip moves it. */
  private carry(): void {
    m1.copy(this.root.matrixWorld).invert();
    m2.multiplyMatrices(m1, this.bone.handR.matrixWorld).multiply(this.rig.hands.gunInHand);
    m2.decompose(this.bone.weapon.position, this.bone.weapon.quaternion, unitScale);
    this.bone.weapon.updateMatrixWorld();
  }
}

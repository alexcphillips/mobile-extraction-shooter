import {
  CHEST,
  HEAD,
  HIT_CAPSULES,
  ARM_CAPSULES,
  HOLDS,
  LAYERS,
  LEFT_ARM,
  LEFT_LEG,
  RIGHT_ARM,
  RIGHT_LEG,
  STOMACH,
  weaponDef,
  type ClipDef,
  type Hold,
  type Layer,
} from '@mes/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadItems, loadSkeleton } from '../content';
import {
  ClipLayer,
  Pose,
  carryGun,
  compileClip,
  compileSkeleton,
  gunInHand,
  holdGun,
  armsDown,
  holdKnife,
} from './skeleton-pose';

const skeleton = compileSkeleton(loadSkeleton());
const { index } = skeleton;
const at = (pose: Pose, bone: number) => pose.position(bone, new THREE.Vector3()).toArray();
const close = (a: number[], b: number[], digits = 4, what?: string) =>
  a.forEach((n, i) => expect(n, what).toBeCloseTo(b[i]!, digits));

const clip = (patch: Partial<ClipDef>): ReturnType<typeof compileClip> =>
  compileClip(
    { formatVersion: 1, id: 'test', layer: 'upper', length: 1, loop: false, keys: {}, ...patch },
    skeleton,
  );

describe('skeleton', () => {
  it('stands 1.8 m tall in the T-pose, arms out along x', () => {
    const pose = new Pose(skeleton);
    close(at(pose, index.hips), [0, 0.91, 0]);
    close(at(pose, index.handR), [0.75, 1.43, 0]);
    close(at(pose, index.handL), [-0.75, 1.43, 0]);
    close(at(pose, index.footR), [0.1, 0.075, 0]);
    // At rest every skin matrix is the identity.
    close(
      Array.from(pose.skin),
      Array.from({ length: skeleton.count }, () => new THREE.Matrix4().toArray()).flat(),
    );
  });

  it("puts the head volume where the sim's head zone is", () => {
    // The sim's capsules: side (+ right), height, forward; ours face −z.
    const sim = HIT_CAPSULES.find((c) => c.zone === HEAD)!;
    const { headVolume } = skeleton.def;
    const head = Array.from(skeleton.rest.subarray(index.head * 3, index.head * 3 + 3));
    for (const end of ['a', 'b'] as const) {
      const [x, y, z] = headVolume[end];
      close([x + head[0]!, y + head[1]!, -(z + head[2]!)], [...sim[end]]);
    }
    expect(headVolume.radius).toBe(sim.radius);
  });

  it("fits the sim's hit zones to the body", () => {
    // In the sim's frame: side (+ right), height, forward.
    const sim = (v: THREE.Vector3) => [v.x, v.y, -v.z];
    const rest = (bone: number) => sim(new Pose(skeleton).position(bone, new THREE.Vector3()));
    const zones = (zone: number) => HIT_CAPSULES.filter((c) => c.zone === zone);
    const top = (zone: number) => Math.max(...zones(zone).map((c) => c.b[1] + c.radius));
    const bottom = (zone: number) => Math.min(...zones(zone).map((c) => c.a[1] - c.radius));
    // The head is centered; the thorax reaches the neck and the stomach the hips' joint.
    expect(zones(HEAD)[0]!.a[0]).toBe(0);
    expect(top(CHEST)).toBeCloseTo(rest(index.neck)[1]!, 1);
    expect(bottom(STOMACH)).toBeLessThan(rest(index.thighR)[1]!);
    // Legs hang under the hip joints, down to the soles.
    for (const [zone, thigh] of [
      [LEFT_LEG, index.thighL],
      [RIGHT_LEG, index.thighR],
    ] as const) {
      const [leg] = zones(zone);
      expect(leg!.a[0]).toBeCloseTo(rest(thigh)[0]!, 3);
      expect(leg!.a[1] - leg!.radius).toBeCloseTo(0, 3);
      expect(leg!.b[1] + leg!.radius).toBeGreaterThan(rest(thigh)[1]!);
    }

    // Arms, for each hold and layer worn (CH-3c): shoulder, elbow and wrist of its pose,
    // averaged over its poses. FIT_ZONES=1 prints the table for sim/hit-zones.ts.
    const items = loadItems();
    const gun = (id: string, aim: number) => (layer: Layer) => {
      const def = weaponDef(items, id);
      const pose = new Pose(skeleton);
      const h = { kind: def.hold ?? 'rifle', aim, pitch: 0, tilt: 0, kick: 0 } as const;
      holdGun(pose, h, def.model, layer);
      return pose;
    };
    const knifeGrip = (items.get('knife')!.model as { grip: [number, number, number] }).grip;
    const posesFor: Record<Hold, ((layer: Layer) => Pose)[]> = {
      rifle: [gun('akm', 0), gun('akm', 1), gun('m416', 0), gun('m416', 1)],
      pistol: [gun('m9a3', 0), gun('m9a3', 1)],
      knife: [
        (layer) => {
          const pose = new Pose(skeleton);
          holdKnife(pose, knifeGrip, -1, layer);
          return pose;
        },
      ],
      none: [
        (layer) => {
          const pose = new Pose(skeleton);
          armsDown(pose, layer);
          return pose;
        },
      ],
    };
    const r3 = (n: number) => Math.round(n * 1000) / 1000 || 0;
    const table: string[] = [];
    for (const hold of HOLDS)
      for (const layer of LAYERS) {
        const poses = posesFor[hold].map((make) => make(layer));
        const arms: string[] = [];
        for (const [zone, bones] of [
          [LEFT_ARM, [index.upperArmL, index.forearmL, index.handL]],
          [RIGHT_ARM, [index.upperArmR, index.forearmR, index.handR]],
        ] as const) {
          const [shoulder, elbow, wrist] = bones.map((b) =>
            [0, 1, 2].map(
              (k) =>
                poses.reduce((sum, p) => sum + sim(p.position(b, new THREE.Vector3()))[k]!, 0) /
                poses.length,
            ),
          );
          arms.push(
            `...arm(${zone === LEFT_ARM ? 'LEFT_ARM' : 'RIGHT_ARM'}, ${[shoulder!, elbow!, wrist!]
              .map((v) => `[${v.map(r3).join(', ')}]`)
              .join(', ')}),`,
          );
          if (import.meta.env.FIT_ZONES) continue;
          const [upper, fore] = ARM_CAPSULES[hold][layer].filter((c) => c.zone === zone);
          const what = `${hold} ${layer}`;
          close([...upper!.a], shoulder!, 2, what);
          close([...upper!.b], elbow!, 2, what);
          close([...fore!.a], elbow!, 2, what);
          close([...fore!.b], wrist!, 2, what);
        }
        table.push(`${hold} ${layer}:\n  ${arms.join('\n  ')}`);
      }
    if (import.meta.env.FIT_ZONES) console.log(table.join('\n'));
  });

  it("puts a bent pose's joints where they should be", () => {
    const pose = new Pose(skeleton);
    // Elbow bent 90° forward: the right forearm then points along −z.
    pose.applyClip(clip({ keys: { forearmR: [[0, 0, 90, 0]] } }), 0, 1);
    pose.update();
    close(at(pose, index.handR), [0.49, 1.43, -0.26]);
    // A rest-pose point on the hand moves with it.
    const p = new THREE.Vector3(0.83, 1.43, 0).applyMatrix4(
      new THREE.Matrix4().fromArray(pose.skin, index.handR * 16),
    );
    close(p.toArray(), [0.49, 1.43, -0.34]);
  });
});

describe('clips', () => {
  const swing = clip({
    layer: 'lower',
    loop: true,
    keys: {
      thighR: [
        [0, 40, 0, 0],
        [0.5, -40, 0, 0],
      ],
    },
    move: [
      [0, 0, 0, 0],
      [0.5, 0, -0.1, 0],
    ],
  });
  const thigh = (pose: Pose) =>
    new THREE.Euler().setFromQuaternion(pose.rotation(index.thighR, new THREE.Quaternion())).x /
    (Math.PI / 180);

  it('interpolates between keys and across a loop seam', () => {
    const pose = new Pose(skeleton);
    pose.applyClip(swing, 0.25, 1);
    pose.update();
    expect(thigh(pose)).toBeCloseTo(0, 3);
    expect(at(pose, index.hips)[1]).toBeCloseTo(0.86, 4);
    // From −40 at 0.5 back to +40 at 1.0 (= 0): halfway at 0.75, and 1.25 is 0.25 again.
    pose.reset();
    pose.applyClip(swing, 0.625, 1);
    pose.update();
    expect(thigh(pose)).toBeCloseTo(-20, 1);
    pose.reset();
    pose.applyClip(swing, 1.25, 1);
    pose.update();
    expect(thigh(pose)).toBeCloseTo(0, 3);
  });

  it('blends a clip over another by weight, and a layer crossfades', () => {
    const still = clip({ layer: 'lower', keys: { thighR: [[0, 0, 0, 0]] } });
    const pose = new Pose(skeleton);
    pose.applyClip(still, 0, 1);
    pose.applyClip(swing, 0, 0.5);
    pose.update();
    expect(thigh(pose)).toBeCloseTo(20, 1);

    const layer = new ClipLayer();
    layer.play(still, 0);
    layer.play(swing, 0.2);
    layer.advance(0.1, 0); // halfway through the fade, at time 0 of the swing
    pose.reset();
    layer.apply(pose);
    pose.update();
    expect(thigh(pose)).toBeCloseTo(20, 1);
  });
});

describe('IK and the gun', () => {
  it('reaches a target with the hand turned as asked, elbow down', () => {
    const pose = new Pose(skeleton);
    const to = new THREE.Vector3(0.15, 1.25, -0.4);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.2, 0.1, 'YXZ'));
    pose.reach(
      index.upperArmR,
      index.forearmR,
      index.handR,
      to,
      new THREE.Vector3(0.25, -1, 0.15),
      turn,
    );
    close(at(pose, index.handR), to.toArray(), 3);
    expect(pose.rotation(index.handR, new THREE.Quaternion()).angleTo(turn)).toBeLessThan(1e-3);
    expect(at(pose, index.forearmR)[1]).toBeLessThan(1.43);
    // The bones keep their lengths.
    const u = pose.position(index.upperArmR, new THREE.Vector3());
    const l = pose.position(index.forearmR, new THREE.Vector3());
    expect(u.distanceTo(l)).toBeCloseTo(0.3, 4);
  });

  it('holds a rifle aimed with its sight under the eye, butt in the shoulder, hands on it', () => {
    const akm = weaponDef(loadItems(), 'akm').model;
    for (const pitch of [0, 0.4, -0.4]) {
      const pose = new Pose(skeleton);
      holdGun(pose, { kind: 'rifle', aim: 1, pitch, tilt: 0, kick: 0 }, akm);
      const gun = new THREE.Matrix4().fromArray(pose.weapon);
      const p = (v: readonly number[]) => new THREE.Vector3(...v).applyMatrix4(gun);
      // The eye: 0.12 over the neck joint and 0.09 forward; the sight just right and under it,
      // on the line where it looks.
      const eye = new THREE.Vector3(...at(pose, index.neck)).add(new THREE.Vector3(0, 0.12, -0.09));
      // Seen along the look (turned back by the pitch), the sight is ahead of the eye.
      const sight = p(akm.sight)
        .sub(eye)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
      close([sight.x, sight.y], [0.07, -0.02], 3);
      expect(sight.z).toBeLessThan(-0.1);
      const ahead = p([0, 0, -1]).sub(p([0, 0, 0]));
      expect(Math.asin(ahead.y)).toBeCloseTo(pitch, 3);
      if (pitch === 0) {
        // The butt (0.33 behind the grip) is 6 cm in front of the right shoulder joint.
        const butt = p([0, 0, akm.grip[2] + 0.33]);
        expect(butt.z - at(pose, index.upperArmR)[2]!).toBeCloseTo(-0.06, 3);
      }
      // The right hand on the grip; the left on the support point, or back along the
      // handguard from it where the arm doesn't reach (looking well up).
      const { grip, support } = akm;
      close(
        at(pose, index.handR),
        p([grip[0] + 0.02, grip[1] + 0.03, grip[2] + 0.07]).toArray(),
        3,
      );
      const left = new THREE.Vector3(...at(pose, index.handL)).applyMatrix4(gun.clone().invert());
      close([left.x, left.y], [support[0], support[1] - 0.03], 3);
      expect(left.z - (support[2] + 0.07)).toBeGreaterThan(-1e-3);
      expect(left.z - (support[2] + 0.07)).toBeLessThan(0.1);
    }
  });

  it('carries the gun in the hand where the hand held it, and slashes from the shoulder', () => {
    const pose = new Pose(skeleton);
    const grip = [0, -0.07, 0.05] as const;
    holdGun(
      pose,
      { kind: 'rifle', aim: 1, pitch: 0, tilt: 0, kick: 0 },
      {
        grip,
        support: [0, -0.04, -0.27],
        sight: [0, 0.06, -0.19],
      },
    );
    const held = Array.from(pose.weapon);
    carryGun(pose, gunInHand(grip, new THREE.Matrix4()));
    close(Array.from(pose.weapon), held, 3);
  });

  it('holds a knife ready, slashes across at full stretch, and keeps the knife in hand', () => {
    const grip = [0, -0.055, 0.005] as const;
    const pose = new Pose(skeleton);
    holdKnife(pose, grip);
    close(at(pose, index.handR), [0.2, 1.1, -0.3], 3);
    close(at(pose, index.handL), [-0.05, 1.3, -0.3], 3);
    // The knife's grip is in the right hand, where a hand holds a grip.
    const inHand = new THREE.Vector3(grip[0] + 0.02, grip[1] + 0.03, grip[2] + 0.07).applyMatrix4(
      new THREE.Matrix4().fromArray(pose.weapon),
    );
    close(inHand.toArray(), at(pose, index.handR), 3);
    // The slash: from by the right shoulder, through the middle at 0.5, to low on the left;
    // every point in reach, and the guard stays up.
    const path = [0, 0.5, 1].map((p) => {
      const slash = new Pose(skeleton);
      holdKnife(slash, grip, p);
      close(at(slash, index.handL), [-0.05, 1.3, -0.3], 3);
      return at(slash, index.handR);
    });
    close(path[0]!, [0.3, 1.45, -0.15], 3);
    close(path[1]!, [0, 1.35, -0.48], 3);
    close(path[2]!, [-0.15, 1.2, -0.32], 3);
  });
});

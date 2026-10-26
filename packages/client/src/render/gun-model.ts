import { attachmentDef, weaponDef, type ItemDb, type Shape, type WeaponState } from '@mes/shared';

/** A box in the gun's frame: centre and half-extents in metres; the barrel points along −z. */
function box(
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  colour: number,
): Shape {
  return { kind: 'box', x, y, z, hx, hy, hz, yaw: 0, pitch: 0, roll: 0, colour };
}

/** A cylinder lying along z. */
function tube(y: number, z: number, r: number, hz: number, colour: number): Shape {
  return {
    kind: 'cylinder',
    x: 0,
    y,
    z,
    radius: r,
    radiusTop: r,
    hy: hz,
    sides: 8,
    yaw: 0,
    pitch: Math.PI / 2,
    roll: 0,
    colour,
  };
}

/** The same shapes moved by (dy, dz), to put a part on a mount point. */
function at(shapes: readonly Shape[], dy: number, dz: number): Shape[] {
  return shapes.map((s) => ({ ...s, y: s.y + dy, z: s.z + dz }));
}

const DARK = 0x2a2d30;
const BLACK = 0x1d1f21;
const WOOD = 0x4a3a2c;

/*
 * Placeholder guns and attachments until the item editor builds real models with mount
 * points and sight lines (session 18). Attachments are drawn for a rifle's mounts and moved
 * onto the gun's. Each sight's sightY is the height the eye lines up with when aimed.
 */
interface GunBase {
  shapes: Shape[];
  mag: Shape[];
  longMag: Shape[];
  /** Height of the top rail and the bore, and where the muzzle ends. */
  railY: number;
  boreY: number;
  muzzleZ: number;
  /** How far the optic sits from a rifle's optic mount, along z. */
  opticZ: number;
  irons: { shapes: Shape[]; sightY: number };
  /** Where the right hand grips and the left hand holds, in the gun's frame. */
  grip: readonly [number, number, number];
  support: readonly [number, number, number];
}

const RIFLE: GunBase = {
  shapes: [
    box(0, 0, -0.1, 0.03, 0.045, 0.16, 0x3a3f44),
    box(0, 0.02, -0.36, 0.013, 0.013, 0.12, DARK),
    box(0, -0.075, 0.04, 0.022, 0.045, 0.02, WOOD),
    box(0, -0.015, 0.11, 0.026, 0.04, 0.05, WOOD),
  ],
  mag: [box(0, -0.09, -0.06, 0.022, 0.055, 0.03, DARK)],
  longMag: [box(0, -0.12, -0.06, 0.022, 0.085, 0.03, DARK)],
  railY: 0.045,
  boreY: 0.02,
  muzzleZ: -0.49,
  opticZ: 0,
  irons: { shapes: [box(0, 0.055, -0.06, 0.008, 0.01, 0.03, BLACK)], sightY: 0.065 },
  grip: [0, -0.07, 0.045],
  support: [0, -0.03, -0.29],
};

const PISTOL: GunBase = {
  shapes: [
    box(0, 0.008, -0.06, 0.014, 0.016, 0.095, 0x3a3f44),
    box(0, -0.016, -0.055, 0.012, 0.01, 0.08, DARK),
    box(0, -0.06, 0.0, 0.012, 0.04, 0.022, DARK),
  ],
  mag: [],
  longMag: [box(0, -0.115, 0.0, 0.011, 0.018, 0.02, DARK)],
  railY: 0.024,
  boreY: 0.008,
  muzzleZ: -0.155,
  opticZ: 0.03,
  irons: { shapes: [box(0, 0.029, -0.06, 0.005, 0.005, 0.08, BLACK)], sightY: 0.033 },
  grip: [0, -0.055, 0.005],
  support: [-0.012, -0.065, 0.0],
};

/** An open frame on a low base; the dot is drawn on the screen (hud/optic.ts). */
const RED_DOT = {
  shapes: [
    box(0, 0.052, -0.08, 0.016, 0.007, 0.03, BLACK),
    box(-0.018, 0.088, -0.09, 0.003, 0.03, 0.006, BLACK),
    box(0.018, 0.088, -0.09, 0.003, 0.03, 0.006, BLACK),
    box(0, 0.118, -0.09, 0.021, 0.003, 0.006, BLACK),
  ],
  sightY: 0.09,
};
const SCOPE = {
  shapes: [
    box(0, 0.06, -0.03, 0.008, 0.015, 0.008, BLACK),
    box(0, 0.06, -0.13, 0.008, 0.015, 0.008, BLACK),
    tube(0.09, -0.08, 0.016, 0.1, BLACK),
    tube(0.09, -0.2, 0.022, 0.025, BLACK),
    tube(0.09, 0.03, 0.02, 0.02, BLACK),
  ],
  sightY: 0.09,
};
/** For the rifle's muzzle at z −0.49 and bore 0.02; muzzleZ is where the shot leaves. */
const SUPPRESSOR = { shapes: [tube(0.02, -0.56, 0.02, 0.08, BLACK)], muzzleZ: -0.65 };
const BRAKE = { shapes: [box(0, 0.02, -0.505, 0.018, 0.018, 0.025, BLACK)], muzzleZ: -0.54 };

export interface GunModel {
  hold: 'rifle' | 'pistol';
  shapes: Shape[];
  /** The height the eye lines up with when aimed. */
  sightY: number;
  /** Where shots leave: bore height and the end of the barrel or muzzle device. */
  muzzleY: number;
  muzzleZ: number;
  suppressed: boolean;
  grip: readonly [number, number, number];
  support: readonly [number, number, number];
}

/** The placeholder model of a gun with its attachments, by kind. */
export function gunModel(w: WeaponState, items: ItemDb): GunModel {
  const gun = weaponDef(items, w.item);
  const hold = gun.hold ?? 'rifle';
  const base = hold === 'pistol' ? PISTOL : RIFLE;
  const a = w.attachments;
  const def = (id: string | null | undefined) => (id ? attachmentDef(items, id) : null);
  const optic = def(a.optic)?.optic;
  // An optic's shapes are drawn on a rifle's rail; move them onto this gun's.
  const railDy = base.railY - RIFLE.railY;
  const sight = !optic
    ? base.irons
    : {
        shapes: at((optic.zoom > 1 ? SCOPE : RED_DOT).shapes, railDy, base.opticZ),
        sightY: (optic.zoom > 1 ? SCOPE : RED_DOT).sightY + railDy,
      };
  // Placeholders by kind: anything that makes a gun quieter looks like a suppressor.
  const muzzleDef = def(a.muzzle);
  const suppressed = (muzzleDef?.mods?.loudness ?? 1) < 1;
  const front = !muzzleDef ? null : suppressed ? SUPPRESSOR : BRAKE;
  const frontDy = base.boreY - RIFLE.boreY;
  const frontDz = base.muzzleZ - RIFLE.muzzleZ;
  return {
    hold,
    shapes: [
      ...base.shapes,
      ...(a.magazine ? base.longMag : base.mag),
      ...sight.shapes,
      ...(front ? at(front.shapes, frontDy, frontDz) : []),
    ],
    sightY: sight.sightY,
    muzzleY: base.boreY,
    muzzleZ: front ? front.muzzleZ + frontDz : base.muzzleZ,
    suppressed,
    grip: base.grip,
    support: base.support,
  };
}

/**
 * The placeholder knife, in the same frame as a gun: the handle in the fist at a pistol's
 * grip, the blade along −z. Drawn in first person and in a body's right hand.
 */
export const KNIFE = {
  shapes: [
    box(0, -0.05, 0.0, 0.011, 0.014, 0.045, BLACK),
    box(0, -0.05, -0.05, 0.006, 0.026, 0.005, DARK),
    box(0, -0.048, -0.135, 0.003, 0.014, 0.08, 0xb9c0c6),
  ],
  grip: [0, -0.055, 0.005] as const,
};

/** A key that changes whenever the gun's model would. */
export function gunKey(w: WeaponState): string {
  const { optic, muzzle, magazine } = w.attachments;
  return `${w.item} ${optic} ${muzzle} ${magazine}`;
}

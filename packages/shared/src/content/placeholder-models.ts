import {
  ATTACHMENT_SLOTS,
  type AttachmentSlot,
  type ItemModel,
  type ModelPart,
  type WeaponModel,
} from './models';

/*
 * The placeholder models drawn before item models existed (sessions 6b–10b), for the format
 * 5 → 6 migration and for blank items: chosen by kind, as the client used to. Anything that
 * was never drawn gets a flat box the size of its inventory grid in its type's colour, as it
 * looked on the ground.
 */

type V = [number, number, number];
const box = (pos: V, size: V, colour: string, hiddenBy?: 'optic' | 'magazine'): ModelPart => ({
  type: 'box',
  pos,
  size,
  colour,
  ...(hiddenBy ? { hiddenBy } : {}),
});
/** A cylinder laid along z. */
const tube = (pos: V, radius: number, height: number, colour: string): ModelPart => ({
  type: 'cylinder',
  pos,
  pitch: 90,
  radius,
  height,
  colour,
});

const BODY = '#3a3f44';
const DARK = '#2a2d30';
const BLACK = '#1d1f21';
const WOOD = '#4a3a2c';

const RIFLE: ItemModel = {
  parts: [
    box([0, 0, -0.1], [0.06, 0.09, 0.32], BODY),
    box([0, 0.02, -0.36], [0.026, 0.026, 0.24], DARK),
    box([0, -0.075, 0.04], [0.044, 0.09, 0.04], WOOD),
    box([0, -0.015, 0.11], [0.052, 0.08, 0.1], WOOD),
    box([0, -0.09, -0.06], [0.044, 0.11, 0.06], DARK, 'magazine'),
    box([0, 0.055, -0.06], [0.016, 0.02, 0.06], BLACK, 'optic'),
  ],
  grip: [0, -0.07, 0.045],
  support: [0, -0.03, -0.29],
  muzzle: [0, 0.02, -0.49],
  sight: [0, 0.065, -0.06],
  mounts: { optic: [0, 0.045, 0], muzzle: [0, 0.02, -0.49], magazine: [0, -0.045, -0.06] },
};

const PISTOL: ItemModel = {
  parts: [
    box([0, 0.008, -0.06], [0.028, 0.032, 0.19], BODY),
    box([0, -0.016, -0.055], [0.024, 0.02, 0.16], DARK),
    box([0, -0.06, 0], [0.024, 0.08, 0.044], DARK),
    box([0, 0.029, -0.06], [0.01, 0.01, 0.16], BLACK, 'optic'),
  ],
  grip: [0, -0.055, 0.005],
  support: [-0.012, -0.065, 0],
  muzzle: [0, 0.008, -0.155],
  sight: [0, 0.033, -0.06],
  mounts: { optic: [0, 0.024, 0.03], muzzle: [0, 0.008, -0.155], magazine: [0, -0.1, 0] },
};

/** An open frame on a low base; the dot itself is drawn on the screen. */
const RED_DOT: ItemModel = {
  parts: [
    box([0, 0.007, -0.08], [0.032, 0.014, 0.06], BLACK),
    box([-0.018, 0.043, -0.09], [0.006, 0.06, 0.012], BLACK),
    box([0.018, 0.043, -0.09], [0.006, 0.06, 0.012], BLACK),
    box([0, 0.073, -0.09], [0.042, 0.006, 0.012], BLACK),
  ],
  sight: [0, 0.045, -0.09],
};

const SCOPE: ItemModel = {
  parts: [
    box([0, 0.015, -0.03], [0.016, 0.03, 0.016], BLACK),
    box([0, 0.015, -0.13], [0.016, 0.03, 0.016], BLACK),
    tube([0, 0.045, -0.08], 0.016, 0.2, BLACK),
    tube([0, 0.045, -0.2], 0.022, 0.05, BLACK),
    tube([0, 0.045, 0.03], 0.02, 0.04, BLACK),
  ],
  sight: [0, 0.045, 0],
};

const SUPPRESSOR: ItemModel = {
  parts: [tube([0, 0, -0.07], 0.02, 0.16, BLACK)],
  muzzle: [0, 0, -0.16],
};
const BRAKE: ItemModel = {
  parts: [box([0, 0, -0.015], [0.036, 0.036, 0.05], BLACK)],
  muzzle: [0, 0, -0.05],
};
/** A rifle's long magazine, from the magazine mount. */
const LONG_MAG: ItemModel = { parts: [box([0, -0.075, 0], [0.044, 0.17, 0.06], DARK)] };

/** The handle in the fist at a pistol's grip, the blade along −z. */
const KNIFE: ItemModel = {
  parts: [
    box([0, -0.05, 0], [0.022, 0.028, 0.09], BLACK),
    box([0, -0.05, -0.05], [0.012, 0.052, 0.01], DARK),
    box([0, -0.048, -0.135], [0.006, 0.028, 0.16], '#b9c0c6'),
  ],
  grip: [0, -0.055, 0.005],
};

const HELMET: ItemModel = {
  parts: [
    {
      type: 'cylinder',
      pos: [0, 1.719, 0],
      radius: 0.138,
      radiusTop: 0.113,
      height: 0.118,
      colour: '#56603f',
    },
    {
      type: 'cylinder',
      pos: [0, 1.793, 0],
      radius: 0.113,
      radiusTop: 0.059,
      height: 0.035,
      colour: '#56603f',
    },
  ],
};
const VEST: ItemModel = {
  parts: [
    box([0, 1.222, 0.005], [0.345, 0.315, 0.266], '#3d4733'),
    box([0, 1.113, -0.133], [0.276, 0.099, 0.059], '#343d2c'),
    box([0.108, 1.379, 0], [0.079, 0.039, 0.236], '#3d4733'),
    box([-0.108, 1.379, 0], [0.079, 0.039, 0.236], '#3d4733'),
  ],
};
/** On the back, behind the vest. */
const BACKPACK: ItemModel = {
  parts: [
    box([0, 1.182, 0.227], [0.296, 0.394, 0.177], '#4a4f3a'),
    box([0, 1.379, 0.217], [0.276, 0.059, 0.158], '#3f4432'),
    box([0, 1.064, 0.325], [0.217, 0.138, 0.059], '#3f4432'),
  ],
};
/** Pouches across the belly, over the vest's front. */
const RIG: ItemModel = {
  parts: [
    box([0, 1.08, -0.16], [0.3, 0.12, 0.05], '#4c5a36'),
    box([-0.09, 1.09, -0.2], [0.07, 0.1, 0.04], '#424e2f'),
    box([0, 1.09, -0.2], [0.07, 0.1, 0.04], '#424e2f'),
    box([0.09, 1.09, -0.2], [0.07, 0.1, 0.04], '#424e2f'),
  ],
};

/** The ground's colours by type, before models. */
const COLOURS: Record<string, string> = {
  weapon: '#56653f',
  ammo: '#9a8238',
  armour: '#3f5266',
  attachment: '#5a4870',
  med: '#b04848',
  container: '#4c5a36',
  melee: '#5e5e5e',
  key: '#c29a30',
  quest: '#8b4a8b',
  loot: '#a08a40',
  repair: '#2f7a7a',
};
/** One inventory cell on the ground, and how tall the boxes were. */
const CELL = 0.14;
const HEIGHT = 0.07;

/** The model an item was drawn with before format 6, from its (raw) file. */
export function placeholderModel(doc: Readonly<Record<string, unknown>>): ItemModel {
  const copy = (m: ItemModel): ItemModel => JSON.parse(JSON.stringify(m)) as ItemModel;
  switch (doc.type) {
    case 'weapon': {
      // Only the mounts and hidden parts of the slots it has.
      const m = copy(doc.hold === 'pistol' ? PISTOL : RIFLE) as WeaponModel;
      const slots = Array.isArray(doc.slots) ? (doc.slots as AttachmentSlot[]) : [];
      for (const slot of ATTACHMENT_SLOTS) if (!slots.includes(slot)) delete m.mounts?.[slot];
      m.parts = m.parts.filter((p) => !p.hiddenBy || slots.includes(p.hiddenBy));
      return m;
    }
    case 'melee':
      return copy(KNIFE);
    case 'attachment': {
      const optic = doc.optic as { zoom?: number } | undefined;
      const mods = doc.mods as { loudness?: number } | undefined;
      if (doc.slot === 'optic') return copy((optic?.zoom ?? 1) > 1 ? SCOPE : RED_DOT);
      if (doc.slot === 'muzzle') return copy((mods?.loudness ?? 1) < 1 ? SUPPRESSOR : BRAKE);
      return copy(LONG_MAG);
    }
    case 'armour':
      return copy(doc.slot === 'helmet' ? HELMET : VEST);
    case 'container':
      return copy(doc.slot === 'rig' ? RIG : BACKPACK);
  }
  const [w, h] = Array.isArray(doc.size) ? (doc.size as number[]) : [1, 1];
  const colour = COLOURS[doc.type as string] ?? '#808080';
  return { parts: [box([0, 0, 0], [(w ?? 1) * CELL, HEIGHT, (h ?? 1) * CELL], colour)] };
}

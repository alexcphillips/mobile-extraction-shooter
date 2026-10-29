import { z } from 'zod';
import type { Shape } from './compile';

/*
 * Item models (item format 6, session 18b): an item is drawn as simple shapes, plus the
 * points the game needs to hold, aim and fit it. Units are metres, angles degrees, colours
 * #rrggbb.
 *
 * Frames: a weapon, attachment, knife or any other item is modelled with the barrel or
 * blade along −z and y up; a gun's origin is where it sits on the body's weapon bone, an
 * attachment's is the point that goes on the gun's mount. Worn gear (armour, rigs and
 * backpacks) is modelled on the body in its rest pose: feet at y = 0, facing −z, 1.8 m tall.
 *
 * Unlike map shapes, a part's pos is its CENTRE (guns are built around the bore, not
 * standing on the ground). Rotation is yaw, then pitch, then roll about that centre (three.js
 * Euler order 'YXZ'), as for maps.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
export const vec3Schema = z.tuple([finite, finite, finite]);
const size3 = z.tuple([positive, positive, positive]);
const angle = finite.optional();
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are #rrggbb');

/** The fixed attachment slots a gun can have. */
export const ATTACHMENT_SLOTS = ['optic', 'muzzle', 'magazine'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];
export const slotSchema = z.enum(ATTACHMENT_SLOTS);

const placed = {
  pos: vec3Schema,
  yaw: angle,
  pitch: angle,
  roll: angle,
  colour,
  /**
   * Guns only: the part isn't drawn while something is fitted in this slot (iron sights
   * under an optic, the standard magazine when another is fitted).
   */
  hiddenBy: slotSchema.optional(),
};

export const partSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('box'),
    ...placed,
    /** Full width (x), height (y) and depth (z). */
    size: size3,
  }),
  z.strictObject({
    type: z.literal('cylinder'),
    ...placed,
    radius: positive,
    /** Defaults to radius; 0 makes a cone. */
    radiusTop: finite.refine((n) => n >= 0, 'must be 0 or more').optional(),
    /** Along its own y; pitch 90 lays it along z, like a barrel. */
    height: positive,
    /** Defaults to 8. */
    sides: z.int().min(3).max(32).optional(),
  }),
  z.strictObject({
    type: z.literal('wedge'),
    ...placed,
    /** Rises from the bottom at local −z to the full height at local +z. */
    size: size3,
  }),
]);
export type ModelPart = z.infer<typeof partSchema>;

const parts = z.array(partSchema).min(1);

/** Anything without points of its own: worn gear, meds, ammo, loot. */
export const plainModelSchema = z.strictObject({ parts });

export const weaponModelSchema = z.strictObject({
  parts,
  /** Where the right hand holds it; the left hand's grip is the support point. */
  grip: vec3Schema,
  support: vec3Schema,
  /** Where shots leave with nothing on the muzzle. */
  muzzle: vec3Schema,
  /** The iron sights: aiming lines the eye up with this point, looking along −z. */
  sight: vec3Schema,
  /** Where each slot's attachment goes: its origin is put here. One for every slot. */
  mounts: z.partialRecord(slotSchema, vec3Schema).optional(),
});

export const attachmentModelSchema = z.strictObject({
  parts,
  /** Optics: where the eye lines up when aiming through it, from its origin. */
  sight: vec3Schema.optional(),
  /** Muzzle devices: where shots leave, from its origin. */
  muzzle: vec3Schema.optional(),
});

export const meleeModelSchema = z.strictObject({
  parts,
  /** Where the right hand holds it. */
  grip: vec3Schema,
});

export type PlainModel = z.infer<typeof plainModelSchema>;
export type WeaponModel = z.infer<typeof weaponModelSchema>;
export type AttachmentModel = z.infer<typeof attachmentModelSchema>;
export type MeleeModel = z.infer<typeof meleeModelSchema>;
export type ItemModel = PlainModel | WeaponModel | AttachmentModel | MeleeModel;
export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/**
 * The shapes of a model's parts, moved by `at` (an attachment onto its mount), leaving out
 * parts hidden by a fitted slot. Appends to `out` and returns it.
 */
export function modelShapes(
  model: { readonly parts: readonly ModelPart[] },
  out: Shape[] = [],
  at: Vec3 = [0, 0, 0],
  fitted?: (slot: AttachmentSlot) => boolean,
): Shape[] {
  for (const p of model.parts) {
    if (p.hiddenBy && fitted?.(p.hiddenBy)) continue;
    const base = {
      x: p.pos[0] + at[0],
      y: p.pos[1] + at[1],
      z: p.pos[2] + at[2],
      yaw: (p.yaw ?? 0) * DEG,
      pitch: (p.pitch ?? 0) * DEG,
      roll: (p.roll ?? 0) * DEG,
      colour: parseInt(p.colour.slice(1), 16),
    };
    if (p.type === 'cylinder') {
      out.push({
        ...base,
        kind: 'cylinder',
        radius: p.radius,
        radiusTop: p.radiusTop ?? p.radius,
        hy: p.height / 2,
        sides: p.sides ?? 8,
      });
    } else {
      const [w, h, d] = p.size;
      out.push({ ...base, kind: p.type, hx: w / 2, hy: h / 2, hz: d / 2 });
    }
  }
  return out;
}

export const addVec = (a: Vec3, b: Vec3): [number, number, number] => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

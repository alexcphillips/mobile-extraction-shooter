import { z } from 'zod';
import type { ModelShape } from './compile';
import { convexHull } from './hull';

/*
 * Item models (item format 6, session 18b): an item is drawn as simple shapes, plus the
 * points the game needs to hold, aim and fit it. Units are meters, angles degrees, colors
 * #rrggbb.
 *
 * Frames: a weapon, attachment, knife or any other item is modeled with the barrel or
 * blade along −z and y up; a gun's origin is where it sits on the body's weapon bone, an
 * attachment's is the point that goes on the gun's mount. Worn gear (armor, rigs and
 * backpacks) is modeled on the body in its rest pose: feet at y = 0, facing −z, 1.8 m tall.
 *
 * Unlike map shapes, a part's pos is its CENTER (guns are built around the bore, not
 * standing on the ground). Rotation is yaw, then pitch, then roll about that center (three.js
 * Euler order 'YXZ'), as for maps.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
export const vec3Schema = z.tuple([finite, finite, finite]);
const size3 = z.tuple([positive, positive, positive]);
const angle = finite.optional();
const radius = finite.refine((n) => n >= 0, 'must be 0 or more');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');

/**
 * The fixed attachment slots a gun can have, in the order they're listed. The stock (WF-1,
 * 2026-11-12) is the biggest recoil and handling part, and sets how long the gun is in a
 * grid. 2026-11-19: the laser slot became the left and right rails (for lights later), and
 * the offset optic, barrel, foregrip and rear grip slots came.
 */
export const ATTACHMENT_SLOTS = [
  'optic',
  'offsetOptic',
  'muzzle',
  'barrel',
  'foregrip',
  'leftRail',
  'rightRail',
  'grip',
  'magazine',
  'stock',
] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];
export const slotSchema = z.enum(ATTACHMENT_SLOTS);

/**
 * What kind of attachment an item is (its `slot` field): which gun slots it goes in. Each
 * kind goes in the slot of its name, except a rail item (a laser, a light), which goes on
 * either rail.
 */
export const ATTACHMENT_KINDS = [
  'optic',
  'offsetOptic',
  'muzzle',
  'barrel',
  'foregrip',
  'rail',
  'grip',
  'magazine',
  'stock',
] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const kindSchema = z.enum(ATTACHMENT_KINDS);

const RAILS: readonly AttachmentSlot[] = ['leftRail', 'rightRail'];

/** The gun slots an attachment of this kind goes in. */
export function slotsOfKind(kind: AttachmentKind): readonly AttachmentSlot[] {
  return kind === 'rail' ? RAILS : [kind];
}

/** A gun's attachments with nothing fitted: every slot null. */
export function noAttachments(): Record<AttachmentSlot, string | null> {
  return Object.fromEntries(ATTACHMENT_SLOTS.map((s) => [s, null])) as Record<
    AttachmentSlot,
    string | null
  >;
}

/** The kind of attachment a gun slot takes. */
export function kindOfSlot(slot: AttachmentSlot): AttachmentKind {
  return slot === 'leftRail' || slot === 'rightRail' ? 'rail' : slot;
}

const placed = {
  pos: vec3Schema,
  yaw: angle,
  pitch: angle,
  roll: angle,
  color,
  /**
   * Guns only: the part isn't drawn while something is fitted in this slot (iron sights
   * under an optic, the standard magazine when another is fitted).
   */
  hiddenBy: slotSchema.optional(),
  /**
   * Scopes only (2026-11-18): the part isn't drawn while looking through the scope, as it
   * sits in the line of sight (the tube, the caps, a combat sight's body). The eyepiece's
   * rim and what's outside the line stay, framing the zoomed view.
   */
  scopedHidden: z.literal(true).optional(),
  /**
   * For the item editor only (2026-11-09, IE-1): a part's name ("bolt carrier") and the
   * group it belongs to ("stock"), so a model of many parts can be found and picked a group
   * at a time. The game ignores both, so adding them changed no format version.
   */
  name: z.string().min(1).max(40).optional(),
  group: z.string().min(1).max(40).optional(),
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
  /**
   * A box with its upright edges rounded (2026-11-02, for a steak, a phone, a wallet):
   * seen from above, each corner has its own radius, in order back left (−x −z), back
   * right, front right, front left. A radius is cut down to fit half the width and depth.
   */
  z.strictObject({
    type: z.literal('slab'),
    ...placed,
    /** Full width (x), height (y) and depth (z), as a box's. */
    size: size3,
    corners: z.tuple([radius, radius, radius, radius]),
    /** Steps in each rounded corner; defaults to 4. */
    segments: z.int().min(1).max(12).optional(),
  }),
  /**
   * Rings stacked up the part's own y (CH-3a, 2026-11-13), joined into one faceted tube
   * and capped: limbs, a torso, a boot. Each ring is [y, w, d] or [y, w, d, dx, dz]: its
   * height, its width (x) and depth (z) face to face, and its middle moved over. Rings go
   * up in y. Every piece between two rings is convex.
   */
  z.strictObject({
    type: z.literal('loft'),
    ...placed,
    /** Sides of every ring; defaults to 8. */
    sides: z.int().min(3).max(16).optional(),
    rings: z
      .array(
        z.union([
          z.tuple([finite, radius, radius]),
          z.tuple([finite, radius, radius, finite, finite]),
        ]),
      )
      .min(2)
      .max(16),
  }),
  /**
   * The convex hull of 4 to 32 points in the part's own frame (CH-3a, 2026-11-13): a
   * plate, a shell, a pad. Points inside the hull do nothing.
   */
  z.strictObject({
    type: z.literal('hull'),
    ...placed,
    points: z.array(vec3Schema).min(4).max(32),
  }),
  /**
   * A flat face with no thickness, facing up its own +y (2026-11-17, for painting scenes):
   * a rectangle of `size` (width x, depth z), or the convex polygon through `points`
   * ([x, z] in order round it). It costs only the triangles of its face, 2 for a
   * rectangle, where a box costs 12, so a scene laid in layers on a canvas can carry six
   * times the detail. Seen from below it isn't drawn.
   */
  z.strictObject({
    type: z.literal('panel'),
    ...placed,
    size: z.tuple([positive, positive]).optional(),
    points: z
      .array(z.tuple([finite, finite]))
      .min(3)
      .max(16)
      .optional(),
  }),
]);
export type ModelPart = z.infer<typeof partSchema>;

const parts = z
  .array(partSchema)
  .min(1)
  .superRefine((list, ctx) =>
    list.forEach((p, i) => {
      if (p.type === 'loft' && p.rings.some((r, k) => k > 0 && r[0] <= p.rings[k - 1]![0]))
        ctx.addIssue({ code: 'custom', path: [i, 'rings'], message: 'rings must go up in y' });
      if (p.type === 'hull' && !convexHull(p.points))
        ctx.addIssue({ code: 'custom', path: [i, 'points'], message: 'points are all on a plane' });
      if (p.type === 'panel') {
        if ((p.size === undefined) === (p.points === undefined))
          ctx.addIssue({ code: 'custom', path: [i], message: 'a panel takes size or points' });
        else if (p.points && !convexPolygon(p.points))
          ctx.addIssue({
            code: 'custom',
            path: [i, 'points'],
            message: 'points must go round a convex shape, in order',
          });
      }
    }),
  );

/** Anything without points of its own: worn gear, meds, ammo, loot. */
export const plainModelSchema = z.strictObject({ parts });

/**
 * How a stock folds (WF-1, 2026-11-12): its parts turn `yaw` degrees about an upright
 * axis through `pivot` (from the stock mount; + turns toward +x), then move by `shift`
 * (a collapsing stock slides forward along +z → −z). Either may be left out.
 */
export const foldSchema = z.strictObject({
  pivot: vec3Schema,
  yaw: angle,
  shift: vec3Schema.optional(),
});
export type Fold = z.infer<typeof foldSchema>;

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
  /**
   * A folding stock mount (the AK-74M's, WF-1): any stock fitted folds this way, whether
   * or not the stock folds by itself. Needs a stock mount.
   */
  stockFold: foldSchema.optional(),
  /**
   * How its factory stock folds by itself (AT-1b): its parts hidden by a stock turn this
   * way, from the stock mount. Fitted stocks fold their own way; `stockFold` overrides both.
   */
  factoryFold: foldSchema.optional(),
});

export const attachmentModelSchema = z.strictObject({
  parts,
  /** Optics: where the eye lines up when aiming through it, from its origin. */
  sight: vec3Schema.optional(),
  /**
   * Muzzle devices: where shots leave, from its origin. Barrels: where the muzzle slot is
   * (the barrel's end), from its origin.
   */
  muzzle: vec3Schema.optional(),
  /** Foregrips: where the support hand holds, from its origin. */
  support: vec3Schema.optional(),
  /** Rear grips: where the firing hand holds, from its origin. */
  grip: vec3Schema.optional(),
  /** Lasers: where the beam leaves (it runs along −z), from its origin. */
  laser: vec3Schema.optional(),
  /** Stocks that fold by themselves (WF-1): how, from its origin. */
  fold: foldSchema.optional(),
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

/** A panel's corners, [x, z] in order round it: its points, or its size's rectangle. */
export function panelPoints(p: {
  readonly size?: readonly [number, number] | undefined;
  readonly points?: readonly (readonly [number, number])[] | undefined;
}): (readonly [number, number])[] {
  if (p.points) return [...p.points];
  const [w, d] = p.size ?? [0, 0];
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
}

/** Whether [x, z] points go round a convex polygon in order (either way), with some area. */
export function convexPolygon(points: readonly (readonly [number, number])[]): boolean {
  let sign = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = points[i]!;
    const [bx, bz] = points[(i + 1) % n]!;
    const [cx, cz] = points[(i + 2) % n]!;
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (Math.abs(cross) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return sign !== 0;
}

/**
 * The shapes of a model's parts, moved by `at` (an attachment onto its mount), leaving out
 * parts hidden by a fitted slot. Appends to `out` and returns it.
 */
export function modelShapes(
  model: { readonly parts: readonly ModelPart[] },
  out: ModelShape[] = [],
  at: Vec3 = [0, 0, 0],
  fitted?: (slot: AttachmentSlot) => boolean,
  scoped = false,
): ModelShape[] {
  for (const p of model.parts) {
    if (p.hiddenBy && fitted?.(p.hiddenBy)) continue;
    if (scoped && p.scopedHidden) continue;
    const base = {
      x: p.pos[0] + at[0],
      y: p.pos[1] + at[1],
      z: p.pos[2] + at[2],
      yaw: (p.yaw ?? 0) * DEG,
      pitch: (p.pitch ?? 0) * DEG,
      roll: (p.roll ?? 0) * DEG,
      color: parseInt(p.color.slice(1), 16),
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
    } else if (p.type === 'slab') {
      const [w, h, d] = p.size;
      out.push({
        ...base,
        kind: 'slab',
        hx: w / 2,
        hy: h / 2,
        hz: d / 2,
        corners: p.corners,
        segments: p.segments ?? 4,
      });
    } else if (p.type === 'loft') {
      out.push({ ...base, kind: 'loft', rings: p.rings, sides: p.sides ?? 8 });
    } else if (p.type === 'hull') {
      out.push({ ...base, kind: 'hull', points: p.points });
    } else if (p.type === 'panel') {
      out.push({ ...base, kind: 'panel', points: panelPoints(p) });
    } else {
      const [w, h, d] = p.size;
      out.push({ ...base, kind: p.type, hx: w / 2, hy: h / 2, hz: d / 2 });
    }
  }
  return out;
}

/**
 * A model's parts folded (WF-1): each turned about the fold's upright axis and moved by its
 * shift. Exact for any part, since a part's yaw is its outermost turn (order YXZ).
 * Allocates: call it when a model is built, not per frame.
 */
export function foldParts(parts: readonly ModelPart[], fold: Fold): ModelPart[] {
  const yaw = fold.yaw ?? 0;
  const a = yaw * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [px, , pz] = fold.pivot;
  const [sx, sy, sz] = fold.shift ?? [0, 0, 0];
  return parts.map((p) => {
    const dx = p.pos[0] - px;
    const dz = p.pos[2] - pz;
    // A turn about +y by a: x' = x cos + z sin, z' = −x sin + z cos (three.js's rotation).
    const x = px + dx * cos + dz * sin + sx;
    const z = pz - dx * sin + dz * cos + sz;
    return { ...p, pos: [x, p.pos[1] + sy, z], yaw: (p.yaw ?? 0) + yaw || undefined };
  });
}

export const addVec = (a: Vec3, b: Vec3): [number, number, number] => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

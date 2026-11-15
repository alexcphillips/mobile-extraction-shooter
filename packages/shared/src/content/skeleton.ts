import { z } from 'zod';
import type { ContentFormat } from './format';
import { partSchema } from './models';
import { hexColorSchema, idSchema } from './schema';

/*
 * Our own character skeleton and animation clips (CH-1, 2026-11-13): content/characters/
 * skeleton.json and content/animations/*.json. Data only; the player that poses a body
 * from them is the client's (render/skeleton-pose.ts).
 *
 * Frame: meters, y up, the character faces −z, so +x is its right (L bones are on −x);
 * feet on y = 0. The rest pose is a T-pose (arms out along x, palms down) with every
 * bone's rest rotation the identity, so a bone's rest offset is a plain translation from
 * its parent and anything modeled on the rest pose (body pieces, gear, plating) is in the
 * same frame as the world, shifted by the bone's rest position.
 *
 * Rotations are degrees [x, y, z], applied as three.js Euler order 'YXZ' (yaw, then pitch,
 * then roll), as everywhere else in content.
 */

/** Every bone, parents before children. No fingers or toes. */
export const SKELETON_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'upperArmL',
  'forearmL',
  'handL',
  'upperArmR',
  'forearmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;
export type SkeletonBone = (typeof SKELETON_BONES)[number];

/** The bones the legs layer moves (with the hips' move); the upper-body layer moves the rest. */
export const LOWER_BONES: readonly SkeletonBone[] = [
  'hips',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
];

/** Worn gear's slots and the bone each rides. The gun has its own handle, posed in code. */
export const MOUNT_SLOTS = ['helmet', 'armor', 'rig', 'backpack'] as const;
export type MountSlot = (typeof MOUNT_SLOTS)[number];

export const SKELETON_FORMAT_VERSION = 1;
export const CLIP_FORMAT_VERSION = 1;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const vec3 = z.tuple([finite, finite, finite]);
const boneName = z.enum(SKELETON_BONES);

const limitsSchema = z
  .strictObject({ min: vec3, max: vec3 })
  .refine((l) => l.min.every((m, i) => m <= l.max[i]!), 'each min must be at most its max');

const boneSchema = z.strictObject({
  name: boneName,
  /** null only for the hips, the root. */
  parent: boneName.nullable(),
  /** From the parent's rest position (the character's feet for the hips), in meters. */
  offset: vec3,
  /** What its rotation may be, in degrees per axis, for the animation checks. */
  limits: limitsSchema.optional(),
});
export type SkeletonBoneDef = z.infer<typeof boneSchema>;

export const skeletonSchema = z
  .strictObject({
    formatVersion: z.number(),
    bones: z.array(boneSchema),
    mounts: z.strictObject({
      helmet: boneName,
      armor: boneName,
      rig: boneName,
      backpack: boneName,
    }),
    /**
     * The head's hit capsule in the head bone's frame, as the sim's (HIT_CAPSULES): body
     * pieces and helmets are built around it, and a test keeps the two the same.
     */
    headVolume: z.strictObject({ a: vec3, b: vec3, radius: finite }),
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    s.bones.forEach((b, i) => {
      if (seen.has(b.name))
        ctx.addIssue({ code: 'custom', path: ['bones', i], message: `${b.name} twice` });
      if (b.name === 'hips' ? b.parent !== null : b.parent === null || !seen.has(b.parent))
        ctx.addIssue({
          code: 'custom',
          path: ['bones', i, 'parent'],
          message:
            b.name === 'hips'
              ? 'the hips are the root (parent null)'
              : 'the parent must be a bone listed before it',
        });
      seen.add(b.name);
    });
    for (const name of SKELETON_BONES)
      if (!seen.has(name)) ctx.addIssue({ code: 'custom', path: ['bones'], message: `no ${name}` });
  });
export type SkeletonDef = z.infer<typeof skeletonSchema>;

export const SKELETON_FORMAT: ContentFormat<SkeletonDef> = {
  kind: 'skeleton',
  version: SKELETON_FORMAT_VERSION,
  schema: skeletonSchema,
  migrations: {},
};

/** A key: time in seconds, then [x, y, z] (degrees for a bone, meters for the move). */
const keySchema = z.tuple([finite, finite, finite, finite]);
const keysSchema = z.array(keySchema).min(1);

export const clipSchema = z
  .strictObject({
    formatVersion: z.number(),
    id: idSchema,
    /** Legs and stance, or an action over any stance. */
    layer: z.enum(['lower', 'upper']),
    /** Seconds. A loop's last key blends into its first across the seam. */
    length: finite.refine((n) => n > 0, 'must be greater than 0'),
    loop: z.boolean(),
    /** Each bone's rotation keys; bones without keys stay as they were. */
    keys: z.partialRecord(boneName, keysSchema),
    /** The hips moved off their rest place (bounce, crouching), legs layer only. */
    move: keysSchema.optional(),
  })
  .superRefine((c, ctx) => {
    const tracks: [string, readonly (readonly number[])[]][] = Object.entries(c.keys).map(
      ([bone, keys]) => [bone, keys!],
    );
    if (c.move) tracks.push(['move', c.move]);
    for (const [bone, keys] of tracks) {
      const path = bone === 'move' ? ['move'] : ['keys', bone];
      if (bone !== 'move') {
        const lower = LOWER_BONES.includes(bone as SkeletonBone);
        if (lower !== (c.layer === 'lower'))
          ctx.addIssue({
            code: 'custom',
            path,
            message: `${bone} belongs to the ${lower ? 'lower' : 'upper'} layer`,
          });
      } else if (c.layer !== 'lower') {
        ctx.addIssue({ code: 'custom', path, message: 'only the lower layer moves the hips' });
      }
      keys.forEach((k, i) => {
        const t = k[0]!;
        if (t < 0 || t > c.length)
          ctx.addIssue({ code: 'custom', path: [...path, i], message: 'time outside the clip' });
        if (i > 0 && t <= keys[i - 1]![0]!)
          ctx.addIssue({ code: 'custom', path: [...path, i], message: 'times must go up' });
      });
    }
  });
export type ClipDef = z.infer<typeof clipSchema>;

export const CLIP_FORMAT: ContentFormat<ClipDef> = {
  kind: 'animation clip',
  version: CLIP_FORMAT_VERSION,
  schema: clipSchema,
  migrations: {},
};

/*
 * The body (CH-2, 2026-11-13): content/characters/body.json, rigid faceted pieces, one or
 * more parts per bone, modeled in the rest pose (the skeleton's frame) like worn gear. Each
 * part's `group` names its bone, which it moves rigidly with. Edited in the item editor
 * (its "Body" entry, the model tab only).
 */

/** The outfit colors a body is drawn in (enemy outfits pick them; Outfit in enemies.ts). */
export const OUTFIT_SLOTS = ['skin', 'top', 'bottom', 'hands', 'feet'] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

/** Which outfit color a bone's pieces take. */
export function outfitSlotOf(bone: SkeletonBone): OutfitSlot {
  if (bone === 'head' || bone === 'neck') return 'skin';
  if (bone === 'handL' || bone === 'handR') return 'hands';
  if (bone === 'footL' || bone === 'footR') return 'feet';
  if (LOWER_BONES.includes(bone)) return 'bottom';
  return 'top';
}

export const BODY_FORMAT_VERSION = 1;

export const bodySchema = z
  .strictObject({
    formatVersion: z.number(),
    /**
     * The outfit the parts are colored in. Another outfit tints each part by its slot:
     * the part's color times the outfit's over this one's, per channel, so a piece's
     * shades keep their ratios.
     */
    colors: z.strictObject({
      skin: hexColorSchema,
      top: hexColorSchema,
      bottom: hexColorSchema,
      hands: hexColorSchema,
      feet: hexColorSchema,
    }),
    model: z.strictObject({ parts: z.array(partSchema).min(1) }),
  })
  .superRefine((b, ctx) => {
    b.model.parts.forEach((p, i) => {
      if (!SKELETON_BONES.includes(p.group as SkeletonBone))
        ctx.addIssue({
          code: 'custom',
          path: ['model', 'parts', i, 'group'],
          message: `a body part's group is its bone (${SKELETON_BONES.join(', ')})`,
        });
      if (p.hiddenBy)
        ctx.addIssue({
          code: 'custom',
          path: ['model', 'parts', i, 'hiddenBy'],
          message: 'body parts are never hidden by attachments',
        });
    });
  });
export type BodyDef = z.infer<typeof bodySchema>;

export const BODY_FORMAT: ContentFormat<BodyDef> = {
  kind: 'body',
  version: BODY_FORMAT_VERSION,
  schema: bodySchema,
  migrations: {},
};

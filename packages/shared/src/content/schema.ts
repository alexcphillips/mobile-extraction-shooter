import { z } from 'zod';
import type { ContentFormat } from './format';

/*
 * Map and prefab files (content/maps, content/prefabs). Units are metres; angles are
 * degrees, so files are easy to read and write by hand. y is up, and yaw 0 faces −z.
 * Every shape's pos is the centre of its base, so y is where it stands.
 *
 * Rotation is yaw, then pitch, then roll (three.js Euler order 'YXZ'). Only box and
 * cylinder may tilt (pitch and roll), which turns them about their centre (pos raised by
 * half the height). Solids collide as boxes rotated about y only, so a tilted one collides
 * as its upright bounding box, or not at all with collide: false.
 */

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = finite.refine((n) => n > 0, 'must be greater than 0');
const vec2 = z.tuple([finite, finite]);
const vec3 = z.tuple([finite, finite, finite]);
const size3 = z.tuple([positive, positive, positive]);
const angle = finite.optional();

export const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lower-case letters, digits and dashes');
export const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colours are #rrggbb');
/** A #rrggbb colour, or the name of a colour slot in the enclosing prefab or map. */
export const colourRefSchema = z
  .string()
  .regex(/^(#[0-9a-fA-F]{6}|[a-z][a-z0-9-]*)$/, 'a colour is #rrggbb or a colour slot name');
const slotsSchema = z.record(idSchema, hexColourSchema);

const solid = {
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  colour: colourRefSchema,
  /** Defaults to true. False makes it decoration only. */
  collide: z.boolean().optional(),
};

const boxSchema = z.strictObject({
  type: z.literal('box'),
  ...solid,
  /** Full width (x), height (y) and depth (z). */
  size: size3,
  pitch: angle,
  roll: angle,
});

const cylinderSchema = z.strictObject({
  type: z.literal('cylinder'),
  ...solid,
  radius: positive,
  /** Defaults to radius; 0 makes a cone. */
  radiusTop: finite.refine((n) => n >= 0, 'must be 0 or more').optional(),
  height: positive,
  /** Defaults to 8. */
  sides: z.int().min(3).max(32).optional(),
  pitch: angle,
  roll: angle,
});

/** A solid wedge rising from pos.y at local −z to pos.y + height at local +z. */
const rampSchema = z.strictObject({
  type: z.literal('ramp'),
  ...solid,
  size: size3,
});

/** Drawn as steps, collides as a ramp. Rises towards local +z. */
const stairsSchema = z.strictObject({
  type: z.literal('stairs'),
  ...solid,
  size: size3,
  /** Defaults to one step per 0.25 m of height. */
  steps: z.int().min(1).optional(),
});

/** pos is the middle of the ladder's foot on the wall face; yaw turns +z out of the wall. */
const ladderSchema = z.strictObject({
  type: z.literal('ladder'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  height: positive,
  /** Defaults to 0.6. */
  width: positive.optional(),
  colour: colourRefSchema,
});

const prefabRefSchema = z.strictObject({
  type: z.literal('prefab'),
  id: idSchema.optional(),
  prefab: idSchema,
  pos: vec3,
  yaw: angle,
  /** Overrides the prefab's colour slots. Values can name slots of the enclosing scope. */
  colours: z.record(idSchema, colourRefSchema).optional(),
});

/**
 * A door in a doorway. pos is the bottom middle of the doorway, in the middle of the wall;
 * yaw turns +z to the side it opens towards. Doors don't collide yet (session 11).
 */
const doorSchema = z.strictObject({
  type: z.literal('door'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  /** Width and height. */
  size: z.tuple([positive, positive]),
  /** Defaults to 0.05. */
  thickness: positive.optional(),
  /** Seen from +z. Defaults to left. */
  hinge: z.enum(['left', 'right']).optional(),
  /** The key item that unlocks it; no key means it's never locked. */
  key: idSchema.optional(),
  open: z.boolean().optional(),
  colour: colourRefSchema,
});

const marker = { id: idSchema.optional(), pos: vec3 };

const playerSpawnSchema = z.strictObject({
  type: z.literal('playerSpawn'),
  ...marker,
  yaw: angle,
});

const enemySpawnSchema = z.strictObject({
  type: z.literal('enemySpawn'),
  ...marker,
  yaw: angle,
  enemy: idSchema,
  loadout: idSchema.optional(),
  /** Multipliers on loot table weights for what this enemy drops. */
  lootWeights: z
    .record(
      idSchema,
      finite.refine((n) => n >= 0, 'must be 0 or more'),
    )
    .optional(),
});

const lootContainerSchema = z.strictObject({
  type: z.literal('lootContainer'),
  ...marker,
  yaw: angle,
  container: idSchema,
  lootTable: idSchema,
});

const lootSpawnSchema = z.strictObject({
  type: z.literal('lootSpawn'),
  ...marker,
  lootTable: idSchema,
});

const extractionSchema = z.strictObject({
  type: z.literal('extraction'),
  ...marker,
  name: z.string().min(1),
  radius: positive,
});

const questMarkerSchema = z.strictObject({
  type: z.literal('questMarker'),
  id: idSchema,
  pos: vec3,
});

export const nodeSchema = z.discriminatedUnion('type', [
  boxSchema,
  cylinderSchema,
  rampSchema,
  stairsSchema,
  ladderSchema,
  prefabRefSchema,
  doorSchema,
  playerSpawnSchema,
  enemySpawnSchema,
  lootContainerSchema,
  lootSpawnSchema,
  extractionSchema,
  questMarkerSchema,
]);

const nodesSchema = z.array(nodeSchema).superRefine((nodes, ctx) => {
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    if (n.id === undefined) return;
    if (seen.has(n.id))
      ctx.addIssue({ code: 'custom', message: `duplicate id "${n.id}"`, path: [i, 'id'] });
    seen.add(n.id);
  });
});

const zoneSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  /** The outline in x, z. */
  points: z.array(vec2).min(3),
});

const terrainSchema = z
  .strictObject({
    /** x, z of the first corner. */
    origin: vec2,
    cellSize: positive,
    /** Corner heights: rows along +z, each row along +x. */
    heights: z.array(z.array(finite).min(2)).min(2),
    colour: hexColourSchema,
  })
  .refine((t) => t.heights.every((row) => row.length === t.heights[0]!.length), {
    message: 'every row of heights must be the same length',
    path: ['heights'],
  });

export const MAP_FORMAT_VERSION = 1;

export const mapSchema = z
  .strictObject({
    formatVersion: z.literal(MAP_FORMAT_VERSION),
    id: idSchema,
    name: z.string().min(1),
    environment: z.strictObject({
      sky: hexColourSchema,
      fogNear: positive,
      fogFar: positive,
    }),
    terrain: terrainSchema,
    water: z
      .strictObject({
        level: finite,
        colour: hexColourSchema,
        opacity: finite.refine((n) => n > 0 && n <= 1, 'must be in (0, 1]'),
      })
      .optional(),
    /** Colour slots that the map's own nodes can use by name. */
    colours: slotsSchema.optional(),
    nodes: nodesSchema,
    zones: z.array(zoneSchema).superRefine((zones, ctx) => {
      const seen = new Set<string>();
      zones.forEach((zone, i) => {
        if (seen.has(zone.id))
          ctx.addIssue({ code: 'custom', message: `duplicate zone "${zone.id}"`, path: [i] });
        seen.add(zone.id);
      });
    }),
  })
  .refine((m) => m.environment.fogNear < m.environment.fogFar, {
    message: 'fogNear must be less than fogFar',
    path: ['environment'],
  });

export const PREFAB_FORMAT_VERSION = 1;

export const prefabSchema = z.strictObject({
  formatVersion: z.literal(PREFAB_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1).optional(),
  /**
   * Draw every copy with one instanced mesh instead of merging copies into the map's
   * chunks. For small props placed many times (trees, crates).
   */
  instanced: z.boolean().optional(),
  /** Default colours for the slots its nodes use; each placement can override them. */
  colours: slotsSchema.optional(),
  nodes: nodesSchema,
});

export type MapNode = z.infer<typeof nodeSchema>;
export type MapZone = z.infer<typeof zoneSchema>;
export type MapFile = z.infer<typeof mapSchema>;
export type PrefabFile = z.infer<typeof prefabSchema>;

export const MAP_FORMAT: ContentFormat<MapFile> = {
  kind: 'map',
  version: MAP_FORMAT_VERSION,
  schema: mapSchema,
  migrations: {},
};

export const PREFAB_FORMAT: ContentFormat<PrefabFile> = {
  kind: 'prefab',
  version: PREFAB_FORMAT_VERSION,
  schema: prefabSchema,
  migrations: {},
};

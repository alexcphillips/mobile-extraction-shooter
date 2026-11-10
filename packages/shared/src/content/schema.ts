import { z } from 'zod';
import type { ContentFormat } from './format';

/*
 * Map and prefab files (content/maps, content/prefabs). Units are metres; angles are
 * degrees, so files are easy to read and write by hand. y is up, and yaw 0 faces −z.
 * Every shape's pos is the centre of its base, so y is where it stands.
 *
 * Rotation is yaw, then pitch, then roll (three.js Euler order 'YXZ'). Box and cylinder
 * may tilt (pitch and roll), which turns them about their centre (pos raised by half the
 * height). Prefabs and groups may too (2026-11-05), about their pos, taking all they hold
 * with them. Doors in them become panels fixed shut; ladders, glass, barricades and
 * buildings can't be in them. A tilted solid collides as a slab, with a sloped top and
 * underside over an upright footprint, or not at all with collide: false.
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
/** A node's path id, its ids joined by "/": "lift/gate". */
const idPathSchema = z
  .string()
  .regex(/^[a-z0-9#][a-z0-9#.-]*(\/[a-z0-9#][a-z0-9#.-]*)*$/, 'a path of ids joined by /');
const nonNegativeNumber = finite.refine((n) => n >= 0, 'must be 0 or more');

/**
 * What a loot container is filled from (2026-11-02): loot tables by weight, and a weight
 * for nothing at all. Picked once for the whole container (so a fridge is all food or all
 * parts), or with `each`, once for every item (a mix in one fridge); the number of items is
 * the rolls of a table picked by weight. The weights needn't add up to anything.
 */
export const lootMixSchema = z
  .strictObject({
    tables: z.record(idSchema, positive),
    empty: positive.optional(),
    each: z.literal(true).optional(),
  })
  .refine(
    (m) => Object.keys(m.tables).length > 0 || m.empty !== undefined,
    'a loot mix needs a table or an empty weight',
  );
export type LootMix = z.infer<typeof lootMixSchema>;

/**
 * Where a container's loot comes from: its own mix, else its one table (as maps had before
 * mixes), else its kind's default mix (content/loot-containers).
 */
const containerLoot = {
  /** Its kind, in content/loot-containers. */
  container: idSchema,
  lootTable: idSchema.optional(),
  mix: lootMixSchema.optional(),
};

/**
 * Makes a box, cylinder, group or placed prefab a loot container (2026-11-01), instead of a
 * lootContainer marker beside it: what's solid in it is what you aim at to loot it, and you
 * reach it from anywhere within LOOT_REACH of its footprint. Containers don't nest.
 */
const lootSchema = z
  .strictObject({
    ...containerLoot,
    /**
     * The prefab drawn in place of this node's own shapes once it's searched (2026-11-03), in
     * the node's frame. Drawn only: collision and aiming stay the closed look's.
     */
    searched: idSchema.optional(),
  })
  .optional();

/**
 * Makes a box, cylinder, group or placed prefab a switch (2026-11-05): aim at what's solid
 * in it and use it, once a raid. Each row opens a door, and a door named here is locked until
 * then. `opens` is a door's id beside the switch, else its path id in the map ("lift/gate").
 */
const switchSchema = z
  .strictObject({
    /** What the prompt calls it. Defaults to "switch". */
    name: z.string().min(1).optional(),
    /** Seconds the use button must be held to use it. Left out, one press does. */
    useTime: nonNegativeNumber.optional(),
    rows: z.array(
      z.strictObject({
        opens: idPathSchema,
        /** Seconds until it opens. Left out, it opens at once. */
        timer: nonNegativeNumber.optional(),
        /** A sound file's id, heard all over the map while it plays. */
        noise: idSchema.optional(),
        /** Seconds the noise repeats for. Defaults to the timer. */
        lasts: nonNegativeNumber.optional(),
        /** A sound file's id, played at the door as it opens. */
        openNoise: idSchema.optional(),
      }),
    ),
  })
  .optional();

const solid = {
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  colour: colourRefSchema,
  /** Defaults to true. False makes it decoration only. */
  collide: z.boolean().optional(),
  /**
   * Leaves (MT-3, 2026-11-10): it doesn't collide and shots pass it, but the AI can't see
   * through it, as players can't. A cone or tapered cylinder hides by two stacked boxes,
   * narrower than its shape. It can't also have collide: true.
   */
  foliage: z.boolean().optional(),
};

const bulgeBy = finite.refine((n) => n >= 0, 'must be 0 or more');

/**
 * Drawn again past the fog as a flat silhouette, so it shows from anywhere on the map
 * (MT-1, 2026-11-09): a fire lookout, a water tower. On a box, cylinder, group or placed
 * prefab; a prefab can be one wherever it's placed (its own `landmark`).
 */
const landmarkSchema = z.literal(true).optional();

const boxSchema = z.strictObject({
  type: z.literal('box'),
  ...solid,
  /** Full width (x), height (y) and depth (z). */
  size: size3,
  pitch: angle,
  roll: angle,
  /**
   * How far out each face's middle is pushed, in metres (2026-11-03, for bags of concrete),
   * making that face a low pyramid: −x, +x, −y (bottom), +y (top), −z, +z, before turning.
   * Drawn only: it collides as the plain box. Left out, every face is flat.
   */
  bulge: z.tuple([bulgeBy, bulgeBy, bulgeBy, bulgeBy, bulgeBy, bulgeBy]).optional(),
  /**
   * The top face's width (x) and depth (z) when it isn't the bottom's (2026-11-03, for a
   * jacket pinched at its hook): 0 brings it to a point or an edge. Drawn only, like bulge.
   */
  top: z.tuple([bulgeBy, bulgeBy]).optional(),
  /** How far the top face's middle is moved along x and z from over the bottom's, so it leans. */
  lean: z.tuple([finite, finite]).optional(),
  /**
   * Not drawn, and solid only to movement (2026-11-07, for map edges): shots, sight and
   * throws pass through it, as through a barricade's blocker, so nobody sees shots stop in
   * mid-air over a low wall. The editor shows it see-through. It can't tilt, be a loot
   * container or a switch, or have collide: false.
   */
  invisible: z.literal(true).optional(),
  landmark: landmarkSchema,
  loot: lootSchema,
  switch: switchSchema,
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
  landmark: landmarkSchema,
  loot: lootSchema,
  switch: switchSchema,
});

/**
 * A straight wall with openings (2026-11-02): pos is the middle of its base, its length
 * runs along local x. Each opening is a gap from `bottom` to `top`, `width` wide, centred
 * `along` metres from the wall's middle, optionally glazed with glass of that tint.
 */
const wallSchema = z.strictObject({
  type: z.literal('wall'),
  ...solid,
  /** Length (x), height (y) and thickness (z). */
  size: size3,
  openings: z.array(
    z.strictObject({
      along: finite,
      width: positive,
      bottom: finite.refine((n) => n >= 0, 'must be 0 or more'),
      top: positive,
      glass: colourRefSchema.optional(),
    }),
  ),
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
  /**
   * Solid side walls (2026-11-03, for outside stairs): one each side, 0.1 m thick inside
   * the width, whose top runs straight from the bottom step to the top one this many
   * metres above the steps. Drawn only. Left out, there are none.
   */
  sides: positive.optional(),
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
  pitch: angle,
  roll: angle,
  /** Overrides the prefab's colour slots. Values can name slots of the enclosing scope. */
  colours: z.record(idSchema, colourRefSchema).optional(),
  landmark: landmarkSchema,
  loot: lootSchema,
  switch: switchSchema,
});

/**
 * A door in a doorway. pos is the bottom middle of the doorway, in the middle of the wall;
 * yaw turns +z to the side it stands on if it starts open; opened in play, it swings away
 * from whoever opens it.
 */
const doorSchema = z
  .strictObject({
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
    /**
     * Zombies mode (2026-11-04): points to buy it open, instead of a key. It starts locked,
     * and once bought stays open for the rest of the game. Outside zombies it stays locked.
     */
    cost: z.int().min(1).optional(),
    /**
     * Drawn as this prefab instead of a door (zombies mode, 2026-11-04): a couch that blocks
     * a stairway until it's bought. It never swings; bought, it's gone. Its size and
     * thickness still make what's solid, so make it tall enough not to be climbed over.
     */
    look: idSchema.optional(),
    /** What the use button calls it ("Couch"); left out, a door. */
    name: z.string().min(1).optional(),
    /**
     * With a look, opened by a switch: drawn rolling up, as a shutter does, rather than
     * just vanishing (2026-11-05).
     */
    rollUp: z.literal(true).optional(),
    /**
     * A light in the door's frame showing where a switch has got to (2026-11-05): dull red
     * until it's used, flashing yellow while the timer runs, green once open.
     */
    lamp: z.strictObject({ pos: vec3, size: size3 }).optional(),
    open: z.boolean().optional(),
    colour: colourRefSchema,
  })
  .refine((d) => d.key === undefined || d.cost === undefined, {
    message: 'a door has a key or a cost, not both',
    path: ['cost'],
  });

/**
 * A prefab drawn apart from the map, moved by `travel` (metres, in its own frame) over the
 * timer of the door beside it that `door` names, then hidden as the door opens (2026-11-05).
 * Drawn only: it doesn't collide, so whatever it arrives as is solid in the map already.
 */
const moverSchema = z.strictObject({
  type: z.literal('mover'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  prefab: idSchema,
  travel: vec3,
  door: idPathSchema,
});

const marker = { id: idSchema.optional(), pos: vec3 };

const nonNegative = finite.refine((n) => n >= 0, 'must be 0 or more');

/**
 * A stop on a patrol: where to stand and look around. With a radius, each visit goes to
 * a random walkable spot within it, so the route isn't the same every raid.
 */
const patrolStopSchema = z.strictObject({
  pos: vec3,
  /** Seconds to stand here. Defaults to 3; 0 walks on without stopping. */
  wait: nonNegative.optional(),
  /** Metres. Defaults to 0. */
  radius: nonNegative.optional(),
});

/**
 * A route for enemies to walk. Enemy spawns name it with `patrol`. Each point is a stop
 * (an object) or a plain position to walk through, which is how the route is shaped:
 * between points enemies take the shortest way, so put points along the way you want
 * them to go. Points are positions like a marker's.
 */
const patrolSchema = z
  .strictObject({
    type: z.literal('patrol'),
    id: idSchema,
    points: z.array(z.union([vec3, patrolStopSchema])).min(2),
    /**
     * The points before this index are the way in from the spawn, walked once; the rest
     * repeat. Defaults to 0. At least two points must repeat.
     */
    repeatFrom: z.int().min(0).optional(),
    /** Defaults to true: from the last point back to the first that repeats. False walks back and forth. */
    loop: z.boolean().optional(),
  })
  .refine((p) => (p.repeatFrom ?? 0) <= p.points.length - 2, {
    message: 'repeatFrom must leave at least two points to repeat',
    path: ['repeatFrom'],
  });

const playerSpawnSchema = z.strictObject({
  type: z.literal('playerSpawn'),
  ...marker,
  yaw: angle,
  /**
   * The extraction zones (by id) a player starting here can't use (2026-11-07, the user's
   * call): a spawn in the loading yard doesn't get the yard's car extract. Each player's
   * extractions are their own (sim/raid.ts openExtractions).
   */
  noExtracts: z.array(idSchema).optional(),
});

/**
 * Where a PMC squad may start (2026-11-08, the user's call): besides the player spawns, so
 * squads can start away from a boss's ground and each other. Players never start here.
 */
const pmcSpawnSchema = z.strictObject({
  type: z.literal('pmcSpawn'),
  ...marker,
  yaw: angle,
});

const enemySpawnSchema = z.strictObject({
  type: z.literal('enemySpawn'),
  ...marker,
  yaw: angle,
  enemy: idSchema,
  loadout: idSchema.optional(),
  /** The id of a patrol beside it (in the same map or prefab) to walk; otherwise it guards its spot. */
  patrol: idSchema.optional(),
  /** Spawns at a random spot within this many metres. Defaults to 0. */
  radius: nonNegative.optional(),
  /** The chance it spawns at all, 0 to 1 (1 if left out). */
  chance: finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1').optional(),
  /**
   * A name shared by enemy spawns of which only one is used each raid, picked at random
   * (then rolling its chance as usual), so where they stand changes but not how many.
   * Names are map-wide, not scoped by prefab, and apart from loot spawns' names.
   */
  oneOf: idSchema.optional(),
  /** Multipliers on loot table weights for what this enemy drops. */
  lootWeights: z
    .record(
      idSchema,
      finite.refine((n) => n >= 0, 'must be 0 or more'),
    )
    .optional(),
  /*
   * The tutorial's flags (TU-2, 2026-11-09; design.md → Tutorial): on the spawn, so any
   * enemy type can have them. Optional fields, so still map format 4.
   */
  /** Hears nothing: no footsteps, shots, blasts, doors or glass. Hits still alarm it. */
  deaf: z.literal(true).optional(),
  /** Never notices anyone on its own, by sight or sound, until it's hit (or set alight). */
  passive: z.literal(true).optional(),
  /** Its shots, swings and blasts do no damage. They're still hits, felt in full. */
  harmless: z.literal(true).optional(),
  /** Put in at raid start and never again: a scav here isn't a wave slot. */
  once: z.literal(true).optional(),
  /** Carries only its loadout, not its type's loot. */
  noLoot: z.literal(true).optional(),
});

const lootContainerSchema = z.strictObject({
  type: z.literal('lootContainer'),
  ...marker,
  yaw: angle,
  ...containerLoot,
});

/** A spot where one loose item may lie, rolled from its loot table at raid start. */
const lootSpawnSchema = z.strictObject({
  type: z.literal('lootSpawn'),
  ...marker,
  lootTable: idSchema,
  /** The chance anything is there, 0 to 1 (1 if left out). */
  chance: finite.refine((n) => n >= 0 && n <= 1, 'must be from 0 to 1').optional(),
  /**
   * A name shared by spots of which only one is used each raid, picked at random (then
   * rolling its chance as usual): for something that's in one of several places, like a
   * key. Names are map-wide, not scoped by prefab.
   */
  oneOf: idSchema.optional(),
});

/**
 * A point of interest for PMC squads' routes (AI rework session 4; design.md → AI → PMCs):
 * a loot spot they search, or a choke they pass through and watch. A squad walks a chain
 * of them, picked by weight, and leaves the raid at an extraction zone.
 */
const poiSchema = z.strictObject({
  type: z.literal('poi'),
  ...marker,
  kind: z.enum(['loot', 'choke']),
  /** How likely a route is to take it in, against the others. Defaults to 1. */
  weight: nonNegative.optional(),
  /**
   * The part of the map it's in (2026-11-08): each PMC squad is given its own area at raid
   * start and keeps to it for its first few minutes, so squads spread out. Left out, it's
   * in no area (any squad's, any time).
   */
  area: idSchema.optional(),
  /**
   * Metres: a loot spot's containers within this are searched; a choke is watched from a
   * spot within it. Defaults to 8 for loot, 2 for a choke.
   */
  radius: nonNegative.optional(),
});

const questMarkerSchema = z.strictObject({
  type: z.literal('questMarker'),
  id: idSchema,
  pos: vec3,
});

/**
 * A name on the raid's map tab (2026-11-09, the user's call), such as "Warehouse" or "Tech
 * store", placed in the map editor. pos's height picks the floor it shows on (the map's
 * `floors`); nothing else uses it. An optional node, so still map format 4.
 */
const mapLabelSchema = z.strictObject({
  type: z.literal('mapLabel'),
  ...marker,
  text: z.string().min(1).max(40),
  /** 'area' is bigger, for a wing or a large store; 'place' (the default) for a room or shop. */
  size: z.enum(['area', 'place']).optional(),
});

/*
 * Zombies mode's markers (2026-11-04, docs/design.md → Zombies). Ignored by extraction raids.
 */

/**
 * Where zombies appear, used while a player can walk to it (or to its window's inside),
 * so a bought door opens more. Usually outside, naming the barricaded window they head for.
 */
const zombieSpawnSchema = z.strictObject({
  type: z.literal('zombieSpawn'),
  ...marker,
  /** Spawns at a random spot within this many metres. Defaults to 0. */
  radius: nonNegative.optional(),
  /** The id of a barricade beside it (in the same map or prefab) to break in through. */
  window: idSchema.optional(),
});

/**
 * A barricaded window (2026-11-04): planks players nail up one at a time and zombies tear
 * off before they climb through. pos is the middle of the window's sill, in the middle of
 * the wall; yaw turns +z to the inside. Players can never climb through it; shots, claws and
 * sight pass it. Make the wall's opening to match.
 */
const barricadeSchema = z.strictObject({
  type: z.literal('barricade'),
  id: idSchema,
  pos: vec3,
  yaw: angle,
  /** The opening's width and height above the sill. */
  size: z.tuple([positive, positive]),
  /** The most planks it takes, and how many it starts with. Defaults to 6. */
  planks: z.int().min(1).max(12).optional(),
});

const points = z.int().min(0);

/** A gun on the wall: buy it, or buy it again for its ammo. yaw turns +z out of the wall. */
const wallBuySchema = z.strictObject({
  type: z.literal('wallBuy'),
  ...marker,
  yaw: angle,
  /** A weapon item id. */
  item: idSchema,
  cost: points,
  /** Buying it again while carrying it refills its ammo for this. Defaults to half its cost. */
  ammoCost: points.optional(),
});

/** Pay for a random gun from the mode's mystery box list. */
const mysteryBoxSchema = z.strictObject({
  type: z.literal('mysteryBox'),
  ...marker,
  yaw: angle,
  cost: points,
});

/**
 * Nodes kept together for editing: moved, turned and deleted as one. A group adds nothing
 * to the ids of what's in it (a marker's path id is the same in a group or out of one),
 * so grouping never breaks a reference; ids must then be unique across groups too.
 */
const groupSchema = z.strictObject({
  type: z.literal('group'),
  /** Shown in the editor. */
  name: z.string().min(1).optional(),
  pos: vec3,
  yaw: angle,
  pitch: angle,
  roll: angle,
  landmark: landmarkSchema,
  loot: lootSchema,
  switch: switchSchema,
  get nodes(): z.ZodArray<typeof nodeSchema> {
    return z.array(nodeSchema);
  },
});

/**
 * A pane of glass filling a window (design.md → Glass): pos is its bottom middle, in the
 * middle of the wall; width runs along local x. Solid and seen through until it breaks.
 */
const glassSchema = z.strictObject({
  type: z.literal('glass'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  /** Width and height. */
  size: z.tuple([positive, positive]),
  /** Defaults to 0.02: thinner than any wall. */
  thickness: positive.optional(),
  /** Its tint; drawn see-through. */
  colour: colourRefSchema,
});

/**
 * Barbed wire (TU-2, 2026-11-09; design.md → Tutorial): a box you can't see or bump into,
 * pos the middle of its base. Touching it, standing, crouched or prone, starts a light
 * bleed, once each time you go in. Draw the coils beside it with collide: false shapes.
 */
const wireSchema = z.strictObject({
  type: z.literal('wire'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  /** Full width (x), height (y) and depth (z). */
  size: size3,
});

/**
 * A body of water (MT-1, 2026-11-09, the user's call): a flat see-through rectangle, its
 * surface at pos's y, size wide (local x) and deep (local z), turned by yaw. Each has its
 * own level, so a pond can sit above the creek below its weir. Where it's deeper than
 * 1.2 m over the terrain it stops movement like a wall (see DEEP_WATER); shots and sight
 * pass. Overlapping, the highest surface counts. Can't tilt.
 */
const waterSchema = z.strictObject({
  type: z.literal('water'),
  id: idSchema.optional(),
  pos: vec3,
  yaw: angle,
  size: z.tuple([positive, positive]),
  colour: colourRefSchema,
  /** Defaults to 0.7. */
  opacity: finite.refine((n) => n > 0 && n <= 1, 'must be in (0, 1]').optional(),
});

export const nodeSchema: z.ZodDiscriminatedUnion<
  [
    typeof boxSchema,
    typeof cylinderSchema,
    typeof wallSchema,
    typeof rampSchema,
    typeof stairsSchema,
    typeof ladderSchema,
    typeof prefabRefSchema,
    typeof doorSchema,
    typeof moverSchema,
    typeof glassSchema,
    typeof wireSchema,
    typeof waterSchema,
    typeof playerSpawnSchema,
    typeof pmcSpawnSchema,
    typeof enemySpawnSchema,
    typeof patrolSchema,
    typeof lootContainerSchema,
    typeof lootSpawnSchema,
    typeof questMarkerSchema,
    typeof poiSchema,
    typeof mapLabelSchema,
    typeof zombieSpawnSchema,
    typeof wallBuySchema,
    typeof mysteryBoxSchema,
    typeof barricadeSchema,
    typeof groupSchema,
  ]
> = z.discriminatedUnion('type', [
  boxSchema,
  cylinderSchema,
  wallSchema,
  rampSchema,
  stairsSchema,
  ladderSchema,
  prefabRefSchema,
  doorSchema,
  moverSchema,
  glassSchema,
  wireSchema,
  waterSchema,
  playerSpawnSchema,
  pmcSpawnSchema,
  enemySpawnSchema,
  patrolSchema,
  lootContainerSchema,
  lootSpawnSchema,
  questMarkerSchema,
  poiSchema,
  mapLabelSchema,
  zombieSpawnSchema,
  wallBuySchema,
  mysteryBoxSchema,
  barricadeSchema,
  groupSchema,
]);

/** Ids are unique in a map or prefab, groups included. */
const nodesSchema = z.array(nodeSchema).superRefine((nodes, ctx) => {
  const seen = new Set<string>();
  const check = (list: readonly MapNode[], path: (string | number)[]): void => {
    list.forEach((n, i) => {
      if (n.type === 'group') return check(n.nodes, [...path, i, 'nodes']);
      if (n.id === undefined) return;
      if (seen.has(n.id))
        ctx.addIssue({
          code: 'custom',
          message: `duplicate id "${n.id}"`,
          path: [...path, i, 'id'],
        });
      seen.add(n.id);
    });
  };
  check(nodes, []);
});

const zoneSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  /** The outline in x, z. */
  points: z.array(vec2).min(3),
  /**
   * Makes it an extraction point (map format 4, 2026-11-07, the user's call): players leave
   * the raid by standing inside its outline long enough, from just under `y` (the floor
   * it's on, RAID.extractBelow) up to `height` above it (RAID.extractHeight if left out).
   * So a zone round a shipping container can take in its roof but not the floor above it
   * in the building it stands in. Before format 4 an extraction point was a circle marker.
   */
  extraction: z
    .strictObject({
      y: finite,
      height: positive.optional(),
      /**
       * Open in only some raids (2026-11-07, the user's call, as Tarkov's random extracts):
       * each raid opens the map's rotatingExtractions of these, picked at random. Left
       * out, it's always open.
       */
      rotating: z.literal(true).optional(),
    })
    .optional(),
});

const terrainSchema = z
  .strictObject({
    /** x, z of the first corner. */
    origin: vec2,
    cellSize: positive,
    /** Corner heights: rows along +z, each row along +x. */
    heights: z.array(z.array(finite).min(2)).min(2),
    /**
     * Cells with no ground, [i, j] each (i along +x, j along +z), so what's built under
     * them can be reached (roadmap 19zm). Sorted by j, then i.
     */
    holes: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
    colour: hexColourSchema,
  })
  .refine((t) => t.heights.every((row) => row.length === t.heights[0]!.length), {
    message: 'every row of heights must be the same length',
    path: ['heights'],
  })
  .refine(
    (t) =>
      (t.holes ?? []).every(
        ([i, j]) => i >= 0 && j >= 0 && i < t.heights[0]!.length - 1 && j < t.heights.length - 1,
      ),
    { message: 'every hole must be a cell of the terrain', path: ['holes'] },
  );

export const MAP_FORMAT_VERSION = 4;

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
    /** Water over the whole map, as one `water` node covering the terrain would be. */
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
    /**
     * How many of the rotating extraction zones are open each raid (2026-11-07), picked at
     * random at the raid's start; all of them if left out or more than there are.
     */
    rotatingExtractions: z.int().min(0).optional(),
    /**
     * Metres an enemy spawn must keep from every player spawn (2026-11-07, the user's call):
     * AI.spawnClearance (60) if left out. Being in sight of one within AI.sightRange is
     * flagged whatever this is. Northpoint uses 0: indoors, walls do the work, and 60 m
     * left almost nowhere for enemies between its edge spawns.
     */
    enemyClearance: nonNegative.optional(),
    /**
     * Multiplies every shot's, blast's and breaking pane's loudness for the AI's hearing
     * there (AI rework session 1, the user's call): guns are heard 110–190 m, about all of
     * a small map. 1 if left out; Northpoint uses 0.6. Footsteps aren't scaled. An optional
     * field, so still format 4.
     */
    hearingScale: positive.optional(),
    /**
     * The share of scav slots filled at raid start (AI rework session 2): the rest come in
     * waves of that size. A third if left out; Northpoint starts half, since it's a hard map
     * (the user's call). An optional field, so still format 4.
     */
    scavStartShare: finite.refine((n) => n > 0 && n <= 1, 'must be over 0, up to 1').optional(),
    /**
     * PMC squads in a raid (AI rework session 3): between `count[0]` and `count[1]` PMCs
     * of the `enemy` type ('pmc' if left out), all at raid start, in squads of 2–4 at
     * player spawns nobody is using (sim/squads.ts). None if left out; Northpoint has 3–6.
     * An optional field, so still format 4.
     */
    pmcs: z
      .strictObject({
        enemy: idSchema.optional(),
        count: z
          .tuple([z.int().min(0), z.int().min(0)])
          .refine(([min, max]) => min <= max, 'min must not be above max'),
        /**
         * Squads start only at the map's `pmcSpawn` markers, never at unused player spawns
         * (MT-9, 2026-11-10): on Silver Creek a squad at the far spawn of a starter's own
         * end would meet them in their first seconds. Left out, both are used.
         */
        pmcSpawnsOnly: z.boolean().optional(),
      })
      .optional(),
    /**
     * The storeys the map tab shows one at a time (2026-11-09, the user's call), lowest
     * first: each is drawn cut CUT_ABOVE over its floor's height `y`, as the editor's cutaway
     * does, so a covered building shows its rooms, not its roof. Left out, the map tab shows
     * everything from above. An optional field, so still format 4.
     */
    floors: z
      .array(z.strictObject({ name: z.string().min(1).max(20), y: finite }))
      .min(1)
      .refine((f) => f.every((fl, i) => i === 0 || fl.y > f[i - 1]!.y), 'must go up, lowest first')
      .optional(),
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

export const PREFAB_FORMAT_VERSION = 3;

export const prefabSchema = z.strictObject({
  formatVersion: z.literal(PREFAB_FORMAT_VERSION),
  id: idSchema,
  name: z.string().min(1).optional(),
  /**
   * Draw every copy with one instanced mesh instead of merging copies into the map's
   * chunks. For small props placed many times (trees, crates).
   */
  instanced: z.boolean().optional(),
  /** Every placement is a landmark (see landmarkSchema). */
  landmark: landmarkSchema,
  /** Default colours for the slots its nodes use; each placement can override them. */
  colours: slotsSchema.optional(),
  /**
   * Makes it a building (session 16): placed on a slope, a concrete base fills the gap
   * under its footprint down to the ground, and the editor won't let two buildings'
   * footprints overlap. The floor stands at the prefab's y = 0.
   */
  building: z
    .strictObject({
      /** Width (x) and depth (z) of the footprint. */
      size: z.tuple([positive, positive]),
      /** x, z of the footprint's middle. Defaults to [0, 0]. */
      centre: vec2.optional(),
      /** The base's colour, a hex colour or one of the prefab's slots. Defaults to concrete. */
      colour: colourRefSchema.optional(),
    })
    .optional(),
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
  // Format 2 (session 7) added patrols and 3 (session 15) groups; nothing to change. Loot
  // containers made of geometry (2026-11-01) and terrain holes (19zm) are optional fields,
  // so still format 3. Format 4 (2026-11-07) made extraction points zones.
  migrations: { 1: (doc) => doc, 2: (doc) => doc, 3: extractionsToZones },
};

/** Sides of the polygon an old circle extraction point becomes. */
const CIRCLE_SIDES = 8;

/**
 * Format 3 to 4: each extraction marker, anywhere in the nodes (groups turned by their yaw;
 * pitch and roll are ignored), becomes an extraction zone: an octagon of its radius around
 * where it stood, at its height, with its id (made unique among the zones) and name.
 */
function extractionsToZones(doc: Record<string, unknown>): Record<string, unknown> {
  const zones = [...((doc.zones as Record<string, unknown>[] | undefined) ?? [])];
  const ids = new Set(zones.map((z) => z.id as string));
  type Raw = Record<string, unknown>;
  const walk = (nodes: Raw[], fx: number, fy: number, fz: number, yaw: number): Raw[] =>
    nodes.flatMap((n) => {
      const [lx, ly, lz] = (n.pos as [number, number, number] | undefined) ?? [0, 0, 0];
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const x = fx + lx * c + lz * s;
      const y = fy + ly;
      const z = fz - lx * s + lz * c;
      if (n.type === 'extraction') {
        let id = (n.id as string | undefined) ?? 'extraction';
        while (ids.has(id)) id = `${id}-x`;
        ids.add(id);
        const r = n.radius as number;
        const round = (v: number) => Math.round(v * 100) / 100;
        const points = Array.from({ length: CIRCLE_SIDES }, (_, i) => {
          const a = (i / CIRCLE_SIDES) * Math.PI * 2;
          return [round(x + Math.cos(a) * r), round(z + Math.sin(a) * r)];
        });
        zones.push({ id, name: n.name, points, extraction: { y: round(y) } });
        return [];
      }
      if (Array.isArray(n.nodes)) {
        const turn = yaw + (((n.yaw as number | undefined) ?? 0) * Math.PI) / 180;
        return [{ ...n, nodes: walk(n.nodes as Raw[], x, y, z, turn) }];
      }
      return [n];
    });
  const nodes = walk((doc.nodes as Raw[] | undefined) ?? [], 0, 0, 0, 0);
  return { ...doc, nodes, zones };
}

export const PREFAB_FORMAT: ContentFormat<PrefabFile> = {
  kind: 'prefab',
  version: PREFAB_FORMAT_VERSION,
  schema: prefabSchema,
  // Format 2 (session 7) added patrols and 3 (session 15) groups; nothing to change. Loot
  // containers made of geometry (2026-11-01) are an optional field, so still format 3.
  migrations: { 1: (doc) => doc, 2: (doc) => doc },
};

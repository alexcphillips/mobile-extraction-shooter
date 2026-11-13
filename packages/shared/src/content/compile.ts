import type {
  BoxDef,
  DoorDef,
  GlassDef,
  LadderDef,
  RampDef,
  WaterDef,
  WorldDef,
  SwitchDef,
} from '../world/collision-world';
import { HeightGrid, holeFlags } from '../world/terrain';
import { gradeRoads, roadStrip, ROAD } from '../world/roads';
import { ContentError } from './format';
import { wallPieces } from './walls';
import type { LootMix, MapFile, MapNode, MapZone, PrefabFile } from './schema';

/*
 * Flattens a map and the prefabs it places into plain data: the collision WorldDef for
 * the simulation, plus shapes, doors and markers in world space for the renderer and the
 * raid. Angles come out in radians and colors as 0xrrggbb numbers.
 */

/** A shape to draw, centered on (x, y, z), rotated yaw then pitch then roll ('YXZ'). */
interface ShapeBase {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  color: number;
}

export type Shape =
  /**
   * Map boxes may have a bulge (how far each face's middle is pushed out, −x +x −y +y −z +z)
   * and a top face of another size (top) moved over (lean).
   */
  | (ShapeBase & {
      kind: 'box';
      hx: number;
      hy: number;
      hz: number;
      bulge?: readonly [number, number, number, number, number, number];
      /** Half the top face's width and depth, when not hx and hz. */
      top?: readonly [number, number];
      /** The top face's middle moved along x and z. */
      lean?: readonly [number, number];
    })
  | (ShapeBase & { kind: 'cylinder'; radius: number; radiusTop: number; hy: number; sides: number })
  /** Rises from y − hy at local −z to y + hy at local +z. */
  | (ShapeBase & { kind: 'wedge'; hx: number; hy: number; hz: number })
  /** Item models only: a box with rounded upright edges (see models.ts → slab). */
  | (ShapeBase & {
      kind: 'slab';
      hx: number;
      hy: number;
      hz: number;
      /** Back left, back right, front right, front left (−z is the back). */
      corners: readonly [number, number, number, number];
      segments: number;
    });

/** Copies of one instanced prefab with one set of colors, drawn as one instanced mesh. */
export interface InstancedGroup {
  prefab: string;
  /** In the prefab's own frame. */
  shapes: Shape[];
  /** Where each copy stands; yaw in radians. */
  placements: { x: number; y: number; z: number; yaw: number }[];
}

/** A door, in the same order as world.doors (the sim's door indices). */
export interface CompiledDoor extends DoorDef {
  id: string;
  color: number;
  /** What the use button calls it, if not a door. */
  name?: string;
  /** Drawn as these shapes, in the door's frame, instead of a door (a couch). */
  look?: Shape[];
  /** A look that's drawn rolling up as a switch opens it. */
  rollUp?: boolean;
  /** A light showing a switch's progress, in the door's frame: pos is the middle of its base. */
  lamp?: { pos: readonly [number, number, number]; size: readonly [number, number, number] };
}

/**
 * A prefab drawn on its own and moved over a door's timer (a lift's cab): at (x, y, z), turned
 * by yaw, it ends up `travel` away, in world axes. Drawn only.
 */
export interface CompiledMover {
  id: string;
  /** The door's index in world.doors. */
  door: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  travel: readonly [number, number, number];
  shapes: Shape[];
}

/**
 * A barricaded window (zombies mode), in world space: (x, y, z) is the middle of its sill,
 * yaw turns +z to the inside. Its blocker is in world.blockers, in the same order.
 */
export interface CompiledBarricade {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  planks: number;
}

/** A body of water in world space: what collides, and how it's drawn. */
export interface CompiledWater extends WaterDef {
  color: number;
  opacity: number;
}

/** A pane of glass, in the same order as world.glass (the sim's glass indices). */
export interface CompiledGlass extends GlassDef {
  id: string;
  color: number;
}

/**
 * A building's footprint (session 16), from its prefab's `building`: a rectangle centered on
 * (x, z) and turned by yaw, with its floor at y.
 */
export interface CompiledBuilding {
  /** The placement's path id, like a marker's. */
  id: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hx: number;
  hz: number;
  /** The color of its concrete base. */
  color: number;
}

type MarkerNode = Extract<
  MapNode,
  {
    type:
      | 'playerSpawn'
      | 'pmcSpawn'
      | 'enemySpawn'
      | 'lootContainer'
      | 'lootSpawn'
      | 'questMarker'
      | 'poi'
      | 'mapLabel'
      | 'zombieSpawn'
      | 'wallBuy'
      | 'mysteryBox';
  }
>;
const MARKER_TYPES = new Set<string>([
  'playerSpawn',
  'pmcSpawn',
  'enemySpawn',
  'lootContainer',
  'lootSpawn',
  'questMarker',
  'poi',
  'mapLabel',
  'zombieSpawn',
  'wallBuy',
  'mysteryBox',
]);

/** A point on a patrol in world space. Points to walk through have wait 0 and radius 0. */
export interface CompiledPatrolPoint {
  x: number;
  y: number;
  z: number;
  wait: number;
  radius: number;
}

/** A patrol route in world space. */
export interface CompiledPatrol {
  /** A path id, like a marker's. */
  id: string;
  points: CompiledPatrolPoint[];
  /** The points before this are the way in, walked once. */
  repeatFrom: number;
  loop: boolean;
}

type Placed<T> = T extends unknown
  ? Omit<T, 'id' | 'pos' | 'yaw'> & { id: string; x: number; y: number; z: number; yaw: number }
  : never;

/**
 * A gameplay marker in world space. Its id is the path of ids from the map down, joined
 * by "/"; a node without an id is "#" and its index. An enemy spawn's patrol is the
 * patrol's path id too. A loot container made of geometry (a node's `loot`) comes out as a
 * lootContainer marker too, at the middle of the base of its solids, with its footprint.
 */
export type CompiledMarker = Placed<MarkerNode> & {
  /** A container made of geometry: its solids, as indices into world.boxes. */
  solids?: number[];
  /** A container made of geometry: its footprint's half-width and half-depth, in its yaw. */
  hx?: number;
  hz?: number;
  /**
   * A loot spawn in a placed prefab with a `lootGroup` (its `oneOf` is then that name): the
   * copy's path id, so the group picks the copy as one, with all its spots.
   */
  unit?: string;
};

/**
 * A container with a searched look, by its container id: which of its two looks shows is
 * drawn by itself, not merged. `closed` are the same objects as in CompiledMap.shapes, which
 * keeps them so that everything else reading it (the map tab, the editor) gets the closed look.
 */
export interface SearchedLook {
  id: string;
  closed: Shape[];
  searched: Shape[];
}

/** A road's strip: each centerline sample's left and right edge, x y z each (world/roads.ts). */
export interface CompiledRoad {
  id: string;
  color: number;
  strip: number[];
}

export interface CompiledMap {
  id: string;
  name: string;
  environment: { sky: number; fogNear: number; fogFar: number };
  terrainColor: number;
  /** Bodies of water, the map's own (MapFile.water) first; the same as world.water. */
  water: CompiledWater[];
  world: WorldDef;
  /** Everything static that isn't instanced, merged by chunk when drawn. */
  shapes: Shape[];
  /**
   * The landmarks' shapes again (instanced prefabs flattened), drawn past the fog as one
   * flat silhouette (MT-1). They're in shapes or instanced as well.
   */
  landmarks: Shape[];
  instanced: InstancedGroup[];
  searchedLooks: SearchedLook[];
  doors: CompiledDoor[];
  movers: CompiledMover[];
  glass: CompiledGlass[];
  markers: CompiledMarker[];
  patrols: CompiledPatrol[];
  /** Zombies mode's barricaded windows. */
  barricades: CompiledBarricade[];
  /** Buildings' footprints; their concrete bases are in shapes and world.boxes. */
  buildings: CompiledBuilding[];
  zones: MapZone[];
  /** Drawn on the ground; the terrain in world is already graded under them. */
  roads: CompiledRoad[];
  /** How many rotating extraction zones a raid opens (MapFile.rotatingExtractions). */
  rotatingExtractions?: number | undefined;
  /** How far enemy spawns keep from player spawns (MapFile.enemyClearance). */
  enemyClearance?: number | undefined;
  /** How far noises carry for the AI there (MapFile.hearingScale); 1 if undefined. */
  hearingScale?: number | undefined;
  /** The share of scav slots in at raid start (MapFile.scavStartShare); a third if undefined. */
  scavStartShare?: number | undefined;
  /** Scavs per wave slot in a raid (MapFile.scavPerSlot); SCAV_WAVES.perSlot if undefined. */
  scavPerSlot?: number | undefined;
  /** The map tab's storeys, lowest first (MapFile.floors); one view from above if undefined. */
  floors?: { name: string; y: number }[] | undefined;
  /** How many of each loot group a raid uses (MapFile.lootGroups); one if not named. */
  lootGroups?: Readonly<Record<string, { pick: number }>> | undefined;
  /** PMC squads at raid start (MapFile.pmcs); none if undefined. */
  pmcs?:
    | {
        enemy?: string | undefined;
        count: [number, number];
        pmcSpawnsOnly?: boolean | undefined;
        squads?: number | undefined;
      }
    | undefined;
}

export type PrefabLookup = ReadonlyMap<string, PrefabFile>;

const DEG = Math.PI / 180;
const STEP_HEIGHT = 0.25;
/** How thick a stairs' side walls are. */
const STAIR_SIDE = 0.1;
const LADDER_WIDTH = 0.6;
const RUNG_SPACING = 0.3;
const DOOR_THICKNESS = 0.05;
/** How far from a switch's edge your feet can be to use it. */
const SWITCH_REACH = 2;
const GLASS_THICKNESS = 0.02;
/** A barricade's blocker: half its depth through the wall. */
const BLOCKER_DEPTH = 0.3;
const CYLINDER_SIDES = 8;
const WATER_OPACITY = 0.7;
const PATROL_WAIT = 3;
/** Concrete, for a base without a color of its own. */
const BASE_COLOR = 0x9e9b94;
/** How far a base goes into the ground below the lowest point under it. */
const BASE_BURY = 0.3;
/** Rise per meter below which a plane counts as level. */
const FLAT = 1e-6;
/** How much of a tilted wedge's up, or its slope's normal, must still point up. */
const MIN_UP = 0.3;

/** Where nodes are being placed: a position and a yaw about y. */
interface Frame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  cos: number;
  sin: number;
  /** Inside a tilted prefab or group: the whole turn, yaw included. Otherwise null. */
  tilt: Mat3 | null;
}

/** A mover before doors are numbered. */
type PendingMover = Omit<CompiledMover, 'door'> & { doorName: string };

/** A switch before its rows' doors are numbered. */
interface PendingSwitch extends Omit<SwitchDef, 'rows'> {
  rows: readonly {
    opens: string;
    timer?: number | undefined;
    noise?: string | undefined;
    lasts?: number | undefined;
    openNoise?: string | undefined;
  }[];
}

/** What a pass collects. A null list is skipped. */
interface Sink {
  shapes: Shape[] | null;
  boxes: BoxDef[] | null;
  ramps: RampDef[] | null;
  ladders: LadderDef[] | null;
  doors: CompiledDoor[] | null;
  /** Null draws a mover where it starts, as part of the map (as the editor shows it). */
  movers: PendingMover[] | null;
  switches: PendingSwitch[] | null;
  glass: CompiledGlass[] | null;
  /** Barbed wire's boxes (TU-2). */
  wires: BoxDef[] | null;
  /** Foliage's sight-only boxes (MT-3). */
  foliage: BoxDef[] | null;
  water: CompiledWater[] | null;
  markers: CompiledMarker[] | null;
  patrols: CompiledPatrol[] | null;
  barricades: CompiledBarricade[] | null;
  /** A barricade's blocker, for each in barricades. */
  blockers: BoxDef[] | null;
  /** Invisible boxes' solids: blockers too, after the barricades' in world.blockers. */
  invisible: BoxDef[] | null;
  buildings: CompiledBuilding[] | null;
  /** Instanced prefabs become groups; null flattens them into shapes like any prefab. */
  groups: Map<string, InstancedGroup> | null;
  /** Null leaves containers in their closed look, as the editor draws them. */
  looks: SearchedLook[] | null;
  /** Landmarks' shapes, again; null inside one, so a landmark in a landmark isn't doubled. */
  landmarks: Shape[] | null;
}

/** Collects nothing; given shapes, it collects only those, with instanced prefabs flattened. */
const DRAW_ONLY: Sink = {
  shapes: null,
  boxes: null,
  ramps: null,
  ladders: null,
  doors: null,
  movers: null,
  switches: null,
  glass: null,
  wires: null,
  foliage: null,
  water: null,
  markers: null,
  patrols: null,
  barricades: null,
  blockers: null,
  invisible: null,
  buildings: null,
  groups: null,
  looks: null,
  landmarks: null,
};

type PrefabNode = Extract<MapNode, { type: 'prefab' }>;

type Scope = Readonly<Record<string, number>>;

export function compileMap(map: MapFile, prefabs: PrefabLookup): CompiledMap {
  const source = `map ${map.id}`;
  const heights = map.terrain.heights;
  const boxes: BoxDef[] = [];
  const ramps: RampDef[] = [];
  const ladders: LadderDef[] = [];
  const out: Sink = {
    shapes: [],
    boxes,
    ramps,
    ladders,
    doors: [],
    movers: [],
    switches: [],
    glass: [],
    wires: [],
    foliage: [],
    water: [],
    markers: [],
    patrols: [],
    barricades: [],
    blockers: [],
    invisible: [],
    buildings: [],
    groups: new Map(),
    looks: [],
    landmarks: [],
  };
  const terrain = {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols: heights[0]!.length - 1,
    rows: heights.length - 1,
    heights: heights.flat(),
    holes: holeFlags(heights[0]!.length - 1, heights.length - 1, map.terrain.holes),
  };
  // Roads grade the ground under them (RD-1): everything after stands on the graded ground.
  const roadLines = gradeRoads(terrain, terrain.heights, map.roads ?? []);
  const roads: CompiledRoad[] = (map.roads ?? []).map((r, k) => ({
    id: r.id,
    color: hex(r.color ?? ROAD.color),
    strip: roadStrip(terrain, terrain.heights, roadLines[k]!, r.width),
  }));
  const scope = slotColors(map.colors ?? {});
  // The map's own water covers the whole terrain.
  if (map.water) {
    const hx = (terrain.cols * terrain.cellSize) / 2;
    const hz = (terrain.rows * terrain.cellSize) / 2;
    out.water!.push({
      x: terrain.minX + hx,
      z: terrain.minZ + hz,
      hx,
      hz,
      yaw: 0,
      level: map.water.level,
      color: hex(map.water.color),
      opacity: map.water.opacity,
    });
  }
  const compiler = new Compiler(source, prefabs, new HeightGrid(terrain));
  compiler.nodes(map.nodes, frame(0, 0, 0, 0), scope, '', [], out);
  const patrols = new Set(out.patrols!.map((p) => p.id));
  for (const m of out.markers!) {
    if (m.type === 'enemySpawn' && m.patrol !== undefined && !patrols.has(m.patrol))
      throw new ContentError(source, `${m.id}: no patrol "${m.patrol}" beside it`);
  }
  const windows = new Set(out.barricades!.map((b) => b.id));
  for (const m of out.markers!) {
    if (m.type === 'zombieSpawn' && m.window !== undefined && !windows.has(m.window))
      throw new ContentError(source, `${m.id}: no barricade "${m.window}" beside it`);
  }
  const doorIndex = doorFinder(source, out.doors!);
  const switches = out.switches!.map((s) => ({
    ...s,
    rows: s.rows.map((r) => {
      const door = doorIndex(s.id, r.opens);
      out.doors![door]!.switched = true;
      const timer = r.timer ?? 0;
      return {
        door,
        timer,
        noise: r.noise,
        lasts: r.lasts ?? timer,
        openNoise: r.openNoise,
      };
    }),
  }));
  const movers = out.movers!.map(({ doorName, ...m }) => ({
    ...m,
    door: doorIndex(m.id, doorName),
  }));

  return {
    id: map.id,
    name: map.name,
    environment: { ...map.environment, sky: hex(map.environment.sky) },
    terrainColor: hex(map.terrain.color),
    water: out.water!,
    world: {
      terrain,
      boxes,
      ramps,
      ladders,
      doors: out.doors!,
      glass: out.glass!,
      blockers: [...out.blockers!, ...out.invisible!],
      switches,
      wires: out.wires!,
      water: out.water!,
      foliage: out.foliage!,
    },
    shapes: out.shapes!,
    landmarks: out.landmarks!,
    instanced: [...out.groups!.values()],
    searchedLooks: out.looks!,
    doors: out.doors!,
    movers,
    glass: out.glass!,
    markers: out.markers!,
    patrols: out.patrols!,
    barricades: out.barricades!,
    buildings: out.buildings!,
    zones: map.zones,
    roads,
    rotatingExtractions: map.rotatingExtractions,
    lootGroups: map.lootGroups,
    enemyClearance: map.enemyClearance,
    hearingScale: map.hearingScale,
    scavStartShare: map.scavStartShare,
    scavPerSlot: map.scavPerSlot,
    pmcs: map.pmcs,
    floors: map.floors,
  };
}

/**
 * What compileNodes gives: everything in the nodes' own frame, instanced prefabs flattened.
 * There's no terrain, so no concrete bases (see concreteBase).
 */
export interface CompiledNodes {
  shapes: Shape[];
  boxes: BoxDef[];
  ramps: RampDef[];
  doors: CompiledDoor[];
  glass: CompiledGlass[];
  markers: CompiledMarker[];
  patrols: CompiledPatrol[];
  barricades: CompiledBarricade[];
  /** Invisible boxes' solids, which the editor draws see-through. */
  invisible: BoxDef[];
  buildings: CompiledBuilding[];
  water: CompiledWater[];
}

/**
 * Compiles some nodes on their own, as the map editor draws them. `colors` are the
 * slots of the map or prefab they're in.
 */
export function compileNodes(
  nodes: readonly MapNode[],
  prefabs: PrefabLookup,
  colors: Readonly<Record<string, string>> = {},
  source = 'editor',
): CompiledNodes {
  const out = {
    shapes: [],
    boxes: [],
    ramps: [],
    doors: [],
    glass: [],
    markers: [],
    patrols: [],
    barricades: [],
    invisible: [],
    buildings: [],
    water: [],
  };
  new Compiler(source, prefabs, null).nodes(nodes, frame(0, 0, 0, 0), slotColors(colors), '', [], {
    ...out,
    ladders: null,
    groups: null,
    looks: null,
    blockers: null,
    movers: null,
    switches: null,
    wires: null,
    foliage: null,
    landmarks: null,
  });
  return out;
}

/**
 * The concrete base under a building: a box from its floor down into the ground below
 * the lowest point of its footprint, or null if the ground is nowhere below the floor.
 */
export function concreteBase(
  terrain: HeightGrid,
  b: CompiledBuilding,
): Extract<Shape, { kind: 'box' }> | null {
  const { low } = groundUnder(terrain, b);
  if (low >= b.y - 0.005) return null;
  const bottom = low - BASE_BURY;
  const hy = (b.y - bottom) / 2;
  return {
    kind: 'box',
    x: b.x,
    y: bottom + hy,
    z: b.z,
    yaw: b.yaw,
    pitch: 0,
    roll: 0,
    color: b.color,
    hx: b.hx,
    hy,
    hz: b.hz,
  };
}

/**
 * The lowest and highest ground under a footprint, sampled every half meter or less (and
 * on its edges), which is close enough with the base buried a little.
 */
export function groundUnder(
  terrain: HeightGrid,
  b: Pick<CompiledBuilding, 'x' | 'z' | 'yaw' | 'hx' | 'hz'>,
): { low: number; high: number } {
  const step = Math.min(0.5, terrain.cellSize / 2);
  const nx = Math.max(1, Math.ceil((2 * b.hx) / step));
  const nz = Math.max(1, Math.ceil((2 * b.hz) / step));
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i <= nx; i++) {
    const lx = -b.hx + (2 * b.hx * i) / nx;
    for (let j = 0; j <= nz; j++) {
      const lz = -b.hz + (2 * b.hz * j) / nz;
      const h = terrain.heightAt(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
  }
  return { low, high };
}

class Compiler {
  constructor(
    private readonly source: string,
    private readonly prefabs: PrefabLookup,
    /** For concrete bases; null leaves them out. */
    private readonly terrain: HeightGrid | null,
  ) {}

  /** `unnamed` comes before the index in a node without an id: "3." inside group #3. */
  nodes(
    nodes: readonly MapNode[],
    f: Frame,
    scope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
    unnamed = '',
  ): void {
    nodes.forEach((node, i) => {
      const boxes = out.boxes?.length ?? 0;
      const markers = out.markers?.length ?? 0;
      const shapes = out.shapes?.length ?? 0;
      const look = 'loot' in node ? node.loot?.searched : undefined;
      // Its copies can't be instanced, as each has a look of its own.
      let sink = look ? { ...out, groups: null } : out;
      // A group has no id, so as a container it's "#" and its index.
      const id =
        (path ? `${path}/` : '') + (node.type !== 'group' && node.id ? node.id : `#${unnamed}${i}`);
      // A landmark's shapes, again, for its silhouette past the fog; a landmark inside it
      // is already in.
      const landmark = 'landmark' in node && node.landmark && out.landmarks;
      if (landmark) sink = { ...sink, landmarks: null };
      if (node.type === 'group') {
        // A group moves its nodes but adds nothing to their ids.
        const [x, y, z] = place(f, node.pos);
        const g = inner(f, x, y, z, node);
        const more = `${unnamed}${i}.`;
        if (landmark)
          this.nodes(node.nodes, g, scope, path, stack, { ...DRAW_ONLY, shapes: landmark }, more);
        this.nodes(node.nodes, g, scope, path, stack, sink, more);
      } else {
        if (landmark) this.node(node, f, scope, id, stack, { ...DRAW_ONLY, shapes: landmark });
        this.node(node, f, scope, id, stack, sink);
      }
      if ('loot' in node && node.loot) {
        const [x, y, z] = place(f, node.pos);
        // A box or cylinder tilts on its own, about its center: its look stays upright.
        const shape = node.type === 'box' || node.type === 'cylinder';
        const g = inner(f, x, y, z, shape ? { yaw: node.yaw } : node);
        this.container(node.loot, id, g.yaw, boxes, markers, out);
        if (look) this.searchedLook(look, g, scope, id, stack, shapes, out);
      }
      if ('switch' in node && node.switch) this.switchFrom(node.switch, id, boxes, out);
    });
  }

  /** Makes the solids a node just added (out.boxes from `first`) a switch. */
  private switchFrom(
    tag: NonNullable<Extract<MapNode, { type: 'box' }>['switch']>,
    path: string,
    first: number,
    out: Sink,
  ): void {
    if (!out.switches || !out.boxes) return;
    if (out.boxes.length === first)
      this.fail(path, 'a switch needs something that collides, to aim at');
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let bottom = Infinity;
    const solids: number[] = [];
    for (let k = first; k < out.boxes.length; k++) {
      const b = out.boxes[k]!;
      const r = Math.hypot(b.hx, b.hz);
      x0 = Math.min(x0, b.x - r);
      x1 = Math.max(x1, b.x + r);
      z0 = Math.min(z0, b.z - r);
      z1 = Math.max(z1, b.z + r);
      bottom = Math.min(bottom, b.y - b.hy);
      solids.push(k);
    }
    out.switches.push({
      id: path,
      name: tag.name ?? 'switch',
      x: (x0 + x1) / 2,
      y: bottom,
      z: (z0 + z1) / 2,
      reach: SWITCH_REACH + Math.max(x1 - x0, z1 - z0) / 2,
      useTime: tag.useTime ?? 0,
      solids,
      rows: tag.rows,
    });
  }

  /**
   * Makes the solids a node just added (out.boxes from `first`) a loot container: a
   * lootContainer marker at the middle of the base of their bounds, in the node's yaw.
   */
  private container(
    loot: { container: string; lootTable?: string | undefined; mix?: LootMix | undefined },
    path: string,
    yaw: number,
    first: number,
    firstMarker: number,
    out: Sink,
  ): void {
    if (!out.markers || !out.boxes) return;
    for (let k = firstMarker; k < out.markers.length; k++) {
      if (out.markers[k]!.type === 'lootContainer')
        this.fail(path, `a loot container can't hold another (${out.markers[k]!.id})`);
    }
    if (out.boxes.length === first)
      this.fail(path, 'a loot container needs something that collides, to aim at');
    // The bounds of its solids in its own yaw frame (turned back by yaw).
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let bottom = Infinity;
    const solids: number[] = [];
    for (let k = first; k < out.boxes.length; k++) {
      const b = out.boxes[k]!;
      const lx = b.x * c - b.z * s;
      const lz = b.x * s + b.z * c;
      const bc = Math.abs(Math.cos(b.yaw - yaw));
      const bs = Math.abs(Math.sin(b.yaw - yaw));
      const ex = b.hx * bc + b.hz * bs;
      const ez = b.hx * bs + b.hz * bc;
      x0 = Math.min(x0, lx - ex);
      x1 = Math.max(x1, lx + ex);
      z0 = Math.min(z0, lz - ez);
      z1 = Math.max(z1, lz + ez);
      bottom = Math.min(bottom, b.y - b.hy);
      solids.push(k);
    }
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    out.markers.push({
      type: 'lootContainer',
      id: path,
      x: mx * c + mz * s,
      y: bottom,
      z: -mx * s + mz * c,
      yaw,
      container: loot.container,
      ...(loot.lootTable !== undefined && { lootTable: loot.lootTable }),
      ...(loot.mix && { mix: loot.mix }),
      solids,
      hx: (x1 - x0) / 2,
      hz: (z1 - z0) / 2,
    });
  }

  /**
   * Records the two looks of the container just made from out.shapes from `first`. The
   * searched one is the named prefab, drawn only, with the colors of any slots it shares.
   */
  private searchedLook(
    name: string,
    f: Frame,
    scope: Scope,
    id: string,
    stack: readonly string[],
    first: number,
    out: Sink,
  ): void {
    const prefab = this.prefabs.get(name);
    if (!prefab) this.fail(id, `no prefab "${name}" for its searched look`);
    if (!out.looks || !out.shapes) return;
    const colors: Record<string, string> = {};
    for (const slot of Object.keys(prefab.colors ?? {})) if (slot in scope) colors[slot] = slot;
    const searched: Shape[] = [];
    const node = { type: 'prefab', prefab: name, pos: [0, 0, 0], colors } as const;
    this.prefab(node as unknown as PrefabNode, f, scope, `${id}/searched`, stack, {
      ...DRAW_ONLY,
      shapes: searched,
    });
    out.looks.push({ id, closed: out.shapes.slice(first), searched });
  }

  private fail(path: string, message: string): never {
    throw new ContentError(this.source, `${path}: ${message}`);
  }

  private color(ref: string, scope: Scope, path: string): number {
    if (ref.startsWith('#')) return hex(ref);
    const c = scope[ref];
    if (c === undefined) this.fail(path, `unknown color slot "${ref}"`);
    return c;
  }

  private node(
    node: MapNode,
    f: Frame,
    scope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
  ): void {
    if (node.type === 'patrol') {
      out.patrols?.push({
        id: path,
        points: node.points.map((p) => {
          const stop = !Array.isArray(p);
          const [x, y, z] = place(f, stop ? p.pos : p);
          return {
            x,
            y,
            z,
            wait: stop ? (p.wait ?? PATROL_WAIT) : 0,
            radius: stop ? (p.radius ?? 0) : 0,
          };
        }),
        repeatFrom: node.repeatFrom ?? 0,
        loop: node.loop ?? true,
      });
      return;
    }
    const [x, y, z] = place(f, node.pos);
    const yaw = f.yaw + ('yaw' in node ? (node.yaw ?? 0) * DEG : 0);

    // Not drawn: a solid only to movement (a map's edge).
    if (node.type === 'box' && node.invisible) {
      if (node.collide === false) this.fail(path, 'an invisible box has to collide');
      if (node.loot || node.switch)
        this.fail(path, "an invisible box can't be a loot container or a switch");
      if (f.tilt || node.pitch || node.roll) this.fail(path, "an invisible box can't tilt");
      const [hx, hy, hz] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      out.invisible?.push(plainBox([x, y + hy, z], hx, hy, hz, yaw));
      return;
    }

    switch (node.type) {
      case 'box':
      case 'cylinder': {
        const pitch = (node.pitch ?? 0) * DEG;
        const roll = (node.roll ?? 0) * DEG;
        const turn = f.tilt
          ? multiply(f.tilt, euler((node.yaw ?? 0) * DEG, pitch, roll))
          : pitch || roll
            ? euler(yaw, pitch, roll)
            : null;
        const color = this.color(node.color, scope, path);
        let hx: number;
        let hy: number;
        let hz: number;
        let shape: Shape;
        if (node.type === 'box') {
          [hx, hy, hz] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
          shape = { kind: 'box', x, y, z, yaw, pitch, roll, color, hx, hy, hz };
          if (node.bulge?.some((b) => b > 0)) shape.bulge = node.bulge;
          if (node.top) shape.top = [node.top[0] / 2, node.top[1] / 2];
          if (node.lean?.some((d) => d !== 0)) shape.lean = node.lean;
        } else {
          const radiusTop = node.radiusTop ?? node.radius;
          hx = hz = Math.max(node.radius, radiusTop);
          hy = node.height / 2;
          const sides = node.sides ?? CYLINDER_SIDES;
          const radius = node.radius;
          shape = {
            kind: 'cylinder',
            x,
            y,
            z,
            yaw,
            pitch,
            roll,
            color,
            radius,
            radiusTop,
            hy,
            sides,
          };
        }
        // pos is the middle of the base before tilting; tilting turns it about its center.
        [shape.x, shape.y, shape.z] = place(f, [node.pos[0], node.pos[1] + hy, node.pos[2]]);
        if (f.tilt) [shape.yaw, shape.pitch, shape.roll] = eulerOf(turn!);
        out.shapes?.push(shape);
        if (node.foliage) {
          if (node.collide === true) this.fail(path, "foliage can't collide");
          if (out.foliage) {
            const at: Vec3 = [shape.x, shape.y, shape.z];
            // A box hides as itself. A round shape hides by two stacked boxes, each half
            // as wide as 0.8 × its mean radius over that half (between in- and circumscribed).
            const parts: [number, number, number][] =
              shape.kind === 'box'
                ? [[0, hx, hy]]
                : [
                    [-hy / 2, 0.8 * ((3 * shape.radius + shape.radiusTop) / 4), hy / 2],
                    [hy / 2, 0.8 * ((shape.radius + 3 * shape.radiusTop) / 4), hy / 2],
                  ];
            for (const [dy, half, hh] of parts) {
              const depth = shape.kind === 'box' ? hz : half;
              if (turn) {
                const c: Vec3 = [
                  at[0] + turn[1]! * dy,
                  at[1] + turn[4]! * dy,
                  at[2] + turn[7]! * dy,
                ];
                out.foliage.push(tiltedBox(c, turn, shape.yaw, half, hh, depth));
              } else out.foliage.push(plainBox([at[0], at[1] + dy, at[2]], half, hh, depth, yaw));
            }
          }
          return;
        }
        if (node.collide !== false && out.boxes) {
          const at: Vec3 = [shape.x, shape.y, shape.z];
          out.boxes.push(
            turn ? tiltedBox(at, turn, shape.yaw, hx, hy, hz) : plainBox(at, hx, hy, hz, yaw),
          );
        }
        return;
      }

      case 'wall': {
        const [length, height, thick] = node.size;
        const pieces = wallPieces(length, height, node.openings);
        if (typeof pieces === 'string') this.fail(path, pieces);
        if (f.tilt && node.openings.some((o) => o.glass !== undefined))
          this.cantTilt(path, 'glass');
        const color = this.color(node.color, scope, path);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const g = inner(f, x, y, z, node);
        for (const p of pieces) {
          const mid = (p.from + p.to) / 2;
          const [hx, hy, hz] = [(p.to - p.from) / 2, (p.top - p.bottom) / 2, thick / 2];
          const at = place(g, [mid, p.bottom + hy, 0]);
          this.box(at, g, hx, hy, hz, color, node.collide !== false, out);
        }
        node.openings.forEach((o, k) => {
          if (o.glass === undefined) return;
          out.glass?.push({
            id: `${path}/glass${k}`,
            x: x + o.along * c,
            y: y + o.bottom,
            z: z - o.along * s,
            yaw,
            width: o.width,
            height: o.top - o.bottom,
            thickness: GLASS_THICKNESS,
            color: this.color(o.glass, scope, path),
          });
        });
        return;
      }

      case 'ramp':
      case 'stairs': {
        const [w, h, d] = node.size;
        const color = this.color(node.color, scope, path);
        if (f.tilt) {
          const g = inner(f, x, y, z, node);
          const flat: RampDef = {
            x: 0,
            z: 0,
            hx: w / 2,
            hz: d / 2,
            yaw: 0,
            bottom: 0,
            low: 0,
            high: h,
          };
          if (node.collide !== false) {
            const at = place(g, [0, h / 2, 0]);
            out.boxes?.push(tiltedWedge(at, g.tilt!, g.yaw, w / 2, h / 2, d / 2));
          }
          if (out.shapes) {
            const shapes =
              node.type === 'ramp'
                ? [wedgeOf(flat, color)]
                : [
                    ...stairSteps(flat, node.steps ?? stepsOf(h), color),
                    ...(node.sides ? stairSides(flat, node.sides, color) : []),
                  ];
            out.shapes.push(...shapes.map((s) => moved(g, s)));
          }
          return;
        }
        const ramp: RampDef = {
          x,
          z,
          hx: w / 2,
          hz: d / 2,
          yaw,
          bottom: y,
          low: y,
          high: y + h,
        };
        if (node.collide !== false) out.ramps?.push(ramp);
        if (!out.shapes) return;
        if (node.type === 'ramp') out.shapes.push(wedgeOf(ramp, color));
        else {
          out.shapes.push(...stairSteps(ramp, node.steps ?? stepsOf(h), color));
          if (node.sides) out.shapes.push(...stairSides(ramp, node.sides, color));
        }
        return;
      }

      case 'ladder': {
        if (f.tilt) this.cantTilt(path, 'ladders');
        const ladder: LadderDef = {
          x,
          z,
          yaw,
          halfWidth: (node.width ?? LADDER_WIDTH) / 2,
          bottom: y,
          top: y + node.height,
        };
        out.ladders?.push(ladder);
        out.shapes?.push(...ladderParts(ladder, this.color(node.color, scope, path)));
        return;
      }

      case 'door':
        if (f.tilt) {
          this.shutDoor(node, inner(f, x, y, z, node), scope, path, stack, out);
          return;
        }
        out.doors?.push({
          id: path,
          x,
          y,
          z,
          yaw,
          width: node.size[0],
          height: node.size[1],
          thickness: node.thickness ?? DOOR_THICKNESS,
          hinge: node.hinge ?? 'left',
          key: node.key,
          cost: node.cost,
          open: node.open ?? false,
          color: this.color(node.color, scope, path),
          ...(node.name !== undefined && { name: node.name }),
          ...(node.look !== undefined && {
            look: this.look(node.look, scope, path, stack),
            vanishes: true,
          }),
          ...(node.rollUp && { rollUp: true }),
          ...(node.lamp && { lamp: node.lamp }),
        });
        return;

      case 'mover': {
        if (f.tilt) this.cantTilt(path, 'movers');
        if (!out.movers) {
          // Where it starts, as part of what's drawn: the editor shows it there.
          const ref: PrefabNode = { type: 'prefab', prefab: node.prefab, pos: [0, 0, 0] };
          const sink = { ...DRAW_ONLY, shapes: out.shapes };
          this.prefab(ref, inner(f, x, y, z, node), scope, `${path}/look`, stack, sink);
          return;
        }
        const shapes = this.look(node.prefab, scope, path, stack);
        const [dx, dy, dz] = node.travel;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        out.movers.push({
          id: path,
          doorName: node.door,
          x,
          y,
          z,
          yaw,
          travel: [dx * c + dz * s, dy, -dx * s + dz * c],
          shapes,
        });
        return;
      }

      case 'glass':
        if (f.tilt) this.cantTilt(path, 'glass');
        out.glass?.push({
          id: path,
          x,
          y,
          z,
          yaw,
          width: node.size[0],
          height: node.size[1],
          thickness: node.thickness ?? GLASS_THICKNESS,
          color: this.color(node.color, scope, path),
        });
        return;

      case 'water': {
        if (f.tilt) this.cantTilt(path, 'water');
        out.water?.push({
          x,
          z,
          hx: node.size[0] / 2,
          hz: node.size[1] / 2,
          yaw,
          level: y,
          color: this.color(node.color, scope, path),
          opacity: node.opacity ?? WATER_OPACITY,
        });
        return;
      }

      case 'wire': {
        if (f.tilt) this.cantTilt(path, 'wire');
        const [w, h, d] = node.size;
        out.wires?.push({ x, y: y + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw });
        return;
      }

      case 'barricade': {
        if (f.tilt) this.cantTilt(path, 'barricades');
        const [width, height] = node.size;
        out.barricades?.push({ id: path, x, y, z, yaw, width, height, planks: node.planks ?? 6 });
        // Fills the opening, and a little beyond, so nothing squeezes past.
        out.blockers?.push({
          x,
          y: y + height / 2,
          z,
          hx: width / 2 + 0.05,
          hy: height / 2 + 0.05,
          hz: BLOCKER_DEPTH,
          yaw,
        });
        return;
      }

      case 'prefab':
        this.prefab(node, inner(f, x, y, z, node), scope, path, stack, out);
        return;

      default:
        if (MARKER_TYPES.has(node.type) && out.markers) {
          const { pos, ...rest } = node;
          const marker = { ...rest, id: path, x, y, z, yaw } as CompiledMarker;
          // A patrol is named beside the spawn; it comes out with its full path.
          if (marker.type === 'enemySpawn' && marker.patrol !== undefined)
            marker.patrol = path.slice(0, path.lastIndexOf('/') + 1) + marker.patrol;
          // And a zombie spawn's window, beside it too.
          if (marker.type === 'zombieSpawn' && marker.window !== undefined)
            marker.window = path.slice(0, path.lastIndexOf('/') + 1) + marker.window;
          out.markers.push(marker);
        }
    }
  }

  /** A box drawn and maybe solid, centered at `at` and turned as frame g is. */
  private box(
    at: Vec3,
    g: Frame,
    hx: number,
    hy: number,
    hz: number,
    color: number,
    collide: boolean,
    out: Sink,
  ): void {
    const [x, y, z] = at;
    const [yaw, pitch, roll] = g.tilt ? eulerOf(g.tilt) : [g.yaw, 0, 0];
    out.shapes?.push({ kind: 'box', x, y, z, yaw, pitch, roll, color, hx, hy, hz });
    if (!collide) return;
    out.boxes?.push(
      g.tilt ? tiltedBox(at, g.tilt, yaw, hx, hy, hz) : plainBox(at, hx, hy, hz, yaw),
    );
  }

  /** A door in something tilted: a door swings about y, so it's a panel fixed shut. */
  private shutDoor(
    node: Extract<MapNode, { type: 'door' }>,
    g: Frame,
    scope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
  ): void {
    const [width, height] = node.size;
    const thick = (node.thickness ?? DOOR_THICKNESS) / 2;
    const color = this.color(node.color, scope, path);
    const at = place(g, [0, height / 2, 0]);
    if (node.look === undefined) {
      this.box(at, g, width / 2, height / 2, thick, color, true, out);
      return;
    }
    out.boxes?.push(tiltedBox(at, g.tilt!, g.yaw, width / 2, height / 2, thick));
    const look = this.look(node.look, scope, path, stack);
    out.shapes?.push(...look.map((s) => moved(g, s)));
  }

  private cantTilt(path: string, what: string): never {
    this.fail(path, `${what} can't be in a prefab or group with pitch or roll`);
  }

  /** A prefab's shapes in its own frame, flattened: a door's look. */
  private look(prefab: string, scope: Scope, path: string, stack: readonly string[]): Shape[] {
    const shapes: Shape[] = [];
    const ref: PrefabNode = { type: 'prefab', prefab, pos: [0, 0, 0] };
    this.prefab(ref, frame(0, 0, 0, 0), scope, `${path}/look`, stack, { ...DRAW_ONLY, shapes });
    return shapes;
  }

  private prefab(
    node: PrefabNode,
    f: Frame,
    parentScope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
  ): void {
    const firstMarker = out.markers?.length ?? 0;
    this.placePrefab(node, f, parentScope, path, stack, out);
    // A copy in a loot group: its spots join the group as one (the outermost copy's wins).
    if (node.lootGroup !== undefined && out.markers) {
      for (let k = firstMarker; k < out.markers.length; k++) {
        const m = out.markers[k]!;
        if (m.type !== 'lootSpawn') continue;
        m.oneOf = node.lootGroup;
        m.unit = path;
      }
    }
  }

  private placePrefab(
    node: PrefabNode,
    f: Frame,
    parentScope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
  ): void {
    const prefab = this.prefabs.get(node.prefab);
    if (!prefab) this.fail(path, `unknown prefab "${node.prefab}"`);
    if (stack.includes(prefab.id))
      this.fail(
        path,
        `prefab "${prefab.id}" contains itself (${[...stack, prefab.id].join(' > ')})`,
      );
    const scope: Record<string, number> = slotColors(prefab.colors ?? {});
    for (const [slot, ref] of Object.entries(node.colors ?? {})) {
      if (!(slot in scope)) this.fail(path, `prefab "${prefab.id}" has no color slot "${slot}"`);
      scope[slot] = this.color(ref, parentScope, path);
    }
    const inner = [...stack, prefab.id];
    if (prefab.landmark && out.landmarks) {
      this.nodes(prefab.nodes, f, scope, path, inner, { ...DRAW_ONLY, shapes: out.landmarks });
      out = { ...out, landmarks: null };
    }

    if (prefab.building) {
      if (f.tilt) this.cantTilt(path, 'buildings');
      const [cx, cz] = prefab.building.center ?? [0, 0];
      const [x, y, z] = place(f, [cx, 0, cz]);
      const b: CompiledBuilding = {
        id: path,
        prefab: prefab.id,
        x,
        y,
        z,
        yaw: f.yaw,
        hx: prefab.building.size[0] / 2,
        hz: prefab.building.size[1] / 2,
        color:
          prefab.building.color === undefined
            ? BASE_COLOR
            : this.color(prefab.building.color, scope, path),
      };
      out.buildings?.push(b);
      const base = this.terrain && concreteBase(this.terrain, b);
      if (base) {
        out.shapes?.push(base);
        const { x, y, z, hx, hy, hz, yaw } = base;
        out.boxes?.push({ x, y, z, hx, hy, hz, yaw });
      }
    }

    if (
      !prefab.instanced ||
      f.tilt ||
      !out.groups ||
      !out.shapes ||
      holdsSearchedLook(prefab.nodes, this.prefabs)
    ) {
      this.nodes(prefab.nodes, f, scope, path, inner, out);
      return;
    }
    // Instanced: collision, doors and markers go into the map as usual, but the shapes
    // are built once per color set in the prefab's own frame.
    this.nodes(prefab.nodes, f, scope, path, inner, { ...out, shapes: null });
    const key = `${prefab.id} ${Object.keys(scope)
      .sort()
      .map((k) => scope[k])
      .join(' ')}`;
    let group = out.groups.get(key);
    if (!group) {
      const shapes: Shape[] = [];
      const local: Sink = { ...DRAW_ONLY, shapes };
      this.nodes(prefab.nodes, frame(0, 0, 0, 0), scope, path, inner, local);
      group = { prefab: prefab.id, shapes, placements: [] };
      out.groups.set(key, group);
    }
    group.placements.push({ x: f.x, y: f.y, z: f.z, yaw: f.yaw });
  }
}

/** Finds a door by its id beside `from` (a node's path id), else by its path id in the map. */
function doorFinder(
  source: string,
  doors: readonly CompiledDoor[],
): (from: string, name: string) => number {
  const index = new Map(doors.map((d, i) => [d.id, i]));
  return (from, name) => {
    const dir = from.slice(0, from.lastIndexOf('/') + 1);
    const i = index.get(dir + name) ?? index.get(name);
    if (i === undefined) throw new ContentError(source, `${from}: no door "${name}"`);
    return i;
  };
}

/** Whether any of these nodes, or the prefabs they place, is a container with a searched look. */
function holdsSearchedLook(
  nodes: readonly MapNode[],
  prefabs: PrefabLookup,
  seen = new Set<string>(),
): boolean {
  return nodes.some((n) => {
    if ('loot' in n && n.loot?.searched) return true;
    if (n.type === 'group') return holdsSearchedLook(n.nodes, prefabs, seen);
    if (n.type !== 'prefab' || seen.has(n.prefab)) return false;
    seen.add(n.prefab);
    return holdsSearchedLook(prefabs.get(n.prefab)?.nodes ?? [], prefabs, seen);
  });
}

function frame(x: number, y: number, z: number, yaw: number): Frame {
  return { x, y, z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), tilt: null };
}

/** The frame of a node at (x, y, z) in f, turned by its yaw, pitch and roll in degrees. */
function inner(
  f: Frame,
  x: number,
  y: number,
  z: number,
  node: { yaw?: number | undefined; pitch?: number | undefined; roll?: number | undefined },
): Frame {
  const yaw = (node.yaw ?? 0) * DEG;
  const pitch = (node.pitch ?? 0) * DEG;
  const roll = (node.roll ?? 0) * DEG;
  if (!f.tilt && !pitch && !roll) return frame(x, y, z, f.yaw + yaw);
  const tilt = f.tilt ? multiply(f.tilt, euler(yaw, pitch, roll)) : euler(f.yaw + yaw, pitch, roll);
  return { ...frame(x, y, z, eulerOf(tilt)[0]), tilt };
}

/** A position in a frame, in the frame's parent's space. */
function place(f: Frame, [lx, ly, lz]: readonly [number, number, number]): Vec3 {
  if (f.tilt) {
    const [wx, wy, wz] = turned(f.tilt, [lx, ly, lz]);
    return [f.x + wx, f.y + wy, f.z + wz];
  }
  return [f.x + lx * f.cos + lz * f.sin, f.y + ly, f.z - lx * f.sin + lz * f.cos];
}

/** A shape in frame g, in g's parent's space. */
function moved(g: Frame, s: Shape): Shape {
  const [x, y, z] = place(g, [s.x, s.y, s.z]);
  const [yaw, pitch, roll] = eulerOf(multiply(g.tilt!, euler(s.yaw, s.pitch, s.roll)));
  return { ...s, x, y, z, yaw, pitch, roll };
}

function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}

function slotColors(slots: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slot, color] of Object.entries(slots)) out[slot] = hex(color);
  return out;
}

type Vec3 = [number, number, number];
/** A rotation, by rows. */
type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** Yaw, then pitch, then roll, as three.js 'YXZ' turns things. */
function euler(yaw: number, pitch: number, roll: number): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return [
    cy * cr + sy * sp * sr,
    sy * sp * cr - cy * sr,
    sy * cp,
    cp * sr,
    cp * cr,
    -sp,
    cy * sp * sr - sy * cr,
    sy * sr + cy * sp * cr,
    cy * cp,
  ];
}

/** The yaw, pitch and roll of a rotation, the inverse of euler. */
function eulerOf(m: Mat3): Vec3 {
  const pitch = Math.asin(Math.min(1, Math.max(-1, -m[5])));
  if (Math.abs(m[5]) < 0.9999999) return [Math.atan2(m[2], m[8]), pitch, Math.atan2(m[3], m[4])];
  return [Math.atan2(-m[6], m[0]), pitch, 0];
}

function multiply(a: Mat3, b: Mat3): Mat3 {
  const at = (r: number, c: number): number =>
    a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[c + 3]! + a[r * 3 + 2]! * b[c + 6]!;
  return [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)];
}

function turned(m: Mat3, [x, y, z]: readonly [number, number, number]): Vec3 {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function plainBox(at: Vec3, hx: number, hy: number, hz: number, yaw: number): BoxDef {
  return { x: at[0], y: at[1], z: at[2], hx, hy, hz, yaw };
}

/** A footprint's local x and z directions in the world. */
function footprintAxes(yaw: number): [Vec3, Vec3] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [c, 0, -s],
    [s, 0, c],
  ];
}

/** A plane's rise per meter along directions e and g, from its normal. */
function rise(n: Vec3, e: Vec3, g: Vec3): [number, number] {
  return [-dot(n, e) / n[1], -dot(n, g) / n[1]];
}

/**
 * The solid of a box turned by r, centered at `at`: a slab (BoxSlope) over a rectangle at
 * `yaw`. Its top and underside are the pair of faces with the most floor under them, so a
 * thin board is its broad faces however steep it stands. Upright ends rather than leaning
 * ones are the only difference from the real box, and the slab is cut to the box's bounds.
 */
function tiltedBox(at: Vec3, r: Mat3, yaw: number, hx: number, hy: number, hz: number): BoxDef {
  const half = [hx, hy, hz];
  const [e, g] = footprintAxes(yaw);
  let [ex, ey, ez] = [0, 0, 0];
  let n: Vec3 = [0, 1, 0];
  let thick = hy;
  let most = -1;
  for (let k = 0; k < 3; k++) {
    const axis: Vec3 = [r[k]!, r[k + 3]!, r[k + 6]!];
    const h = half[k]!;
    ex += Math.abs(dot(axis, e)) * h;
    ey += Math.abs(axis[1]) * h;
    ez += Math.abs(dot(axis, g)) * h;
    const floor = Math.abs(axis[1]) / h;
    if (floor > most) {
      most = floor;
      n = axis[1] < 0 ? [-axis[0], -axis[1], -axis[2]] : axis;
      thick = h / Math.abs(axis[1]);
    }
  }
  const [slopeX, slopeZ] = rise(n, e, g);
  const box = plainBox(at, ex, ey, ez, yaw);
  // Turned a whole number of quarter turns: a plain box.
  if (Math.abs(slopeX) < FLAT && Math.abs(slopeZ) < FLAT) return box;
  const [topX, topZ] = [slopeX, slopeZ];
  const y = at[1];
  box.slope = { top: y + thick, topX, topZ, under: y - thick, underX: topX, underZ: topZ };
  return box;
}

/**
 * The solid of a wedge turned by r, centered at `at`, sloped on top as a ramp is. Stood too
 * steeply for its faces to be a top and underside, it's the solid of its box.
 */
function tiltedWedge(at: Vec3, r: Mat3, yaw: number, hx: number, hy: number, hz: number): BoxDef {
  const box = tiltedBox(at, r, yaw, hx, hy, hz);
  const up: Vec3 = [r[1], r[4], r[7]];
  const top = turned(r, [0, hz, -hy]);
  if (up[1] < MIN_UP || top[1] < MIN_UP * Math.hypot(hy, hz)) return box;
  const [e, g] = footprintAxes(yaw);
  const [topX, topZ] = rise(top, e, g);
  const [underX, underZ] = rise(up, e, g);
  // The base's plane goes through its middle, hy down the wedge's own up from the center.
  const base: Vec3 = [-up[0] * hy, -up[1] * hy, -up[2] * hy];
  const under = at[1] + base[1] - underX * dot(base, e) - underZ * dot(base, g);
  box.slope = { top: at[1], topX, topZ, under, underX, underZ };
  return box;
}

function stepsOf(height: number): number {
  return Math.max(1, Math.round(height / STEP_HEIGHT));
}

/** A ramp drawn as a wedge. */
function wedgeOf(ramp: RampDef, color: number): Shape {
  const hy = (ramp.high - ramp.bottom) / 2;
  const { x, z, yaw, hx, hz } = ramp;
  return { kind: 'wedge', x, y: ramp.bottom + hy, z, yaw, pitch: 0, roll: 0, color, hx, hy, hz };
}

/** Steps drawn over a ramp: each step's top is at the ramp's height halfway along it. */
function stairSteps(ramp: RampDef, n: number, color: number): Shape[] {
  const depth = (2 * ramp.hz) / n;
  const c = Math.cos(ramp.yaw);
  const s = Math.sin(ramp.yaw);
  return Array.from({ length: n }, (_, i) => {
    const lz = -ramp.hz + (i + 0.5) * depth;
    const top = ramp.low + ((i + 0.5) / n) * (ramp.high - ramp.low);
    return {
      kind: 'box',
      x: ramp.x + lz * s,
      y: (ramp.bottom + top) / 2,
      z: ramp.z + lz * c,
      yaw: ramp.yaw,
      pitch: 0,
      roll: 0,
      color,
      hx: ramp.hx,
      hy: (top - ramp.bottom) / 2,
      hz: depth / 2,
    };
  });
}

/**
 * A stairs' side walls: each a box `height` tall from the bottom with a wedge on top rising
 * as the steps do, so its top is one straight slope `height` above them.
 */
function stairSides(ramp: RampDef, height: number, color: number): Shape[] {
  const c = Math.cos(ramp.yaw);
  const s = Math.sin(ramp.yaw);
  const rise = (ramp.high - ramp.low) / 2;
  return [-1, 1].flatMap((side): Shape[] => {
    const lx = side * (ramp.hx - STAIR_SIDE / 2);
    const at = { x: ramp.x + lx * c, z: ramp.z - lx * s, yaw: ramp.yaw, pitch: 0, roll: 0 };
    const size = { color, hx: STAIR_SIDE / 2, hz: ramp.hz };
    return [
      { kind: 'box', ...at, ...size, y: ramp.low + height / 2, hy: height / 2 },
      { kind: 'wedge', ...at, ...size, y: ramp.low + height + rise, hy: rise },
    ];
  });
}

/** Two rails and rungs every 0.3 m, just in front of the wall. */
function ladderParts(l: LadderDef, color: number): Shape[] {
  const nx = Math.sin(l.yaw);
  const nz = Math.cos(l.yaw);
  const height = l.top - l.bottom;
  const at = (side: number, y: number, hx: number, hy: number): Shape => ({
    kind: 'box',
    x: l.x + nx * 0.05 + nz * side,
    y,
    z: l.z + nz * 0.05 - nx * side,
    yaw: l.yaw,
    pitch: 0,
    roll: 0,
    color,
    hx,
    hy,
    hz: 0.03,
  });
  const parts = [-1, 1].map((side) =>
    at(side * l.halfWidth, l.bottom + height / 2, 0.03, height / 2),
  );
  const rungs = Math.ceil(height / RUNG_SPACING - 1e-6) - 1;
  for (let k = 1; k <= rungs; k++)
    parts.push(at(0, l.bottom + k * RUNG_SPACING, l.halfWidth, 0.02));
  return parts;
}

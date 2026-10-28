import type { BoxDef, DoorDef, LadderDef, RampDef, WorldDef } from '../world/collision-world';
import { HeightGrid } from '../world/terrain';
import { ContentError } from './format';
import type { MapFile, MapNode, MapZone, PrefabFile } from './schema';

/*
 * Flattens a map and the prefabs it places into plain data: the collision WorldDef for
 * the simulation, plus shapes, doors and markers in world space for the renderer and the
 * raid. Angles come out in radians and colours as 0xrrggbb numbers.
 */

/** A shape to draw, centred on (x, y, z), rotated yaw then pitch then roll ('YXZ'). */
interface ShapeBase {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  colour: number;
}

export type Shape =
  | (ShapeBase & { kind: 'box'; hx: number; hy: number; hz: number })
  | (ShapeBase & { kind: 'cylinder'; radius: number; radiusTop: number; hy: number; sides: number })
  /** Rises from y − hy at local −z to y + hy at local +z. */
  | (ShapeBase & { kind: 'wedge'; hx: number; hy: number; hz: number });

/** Copies of one instanced prefab with one set of colours, drawn as one instanced mesh. */
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
  colour: number;
}

/**
 * A building's footprint (session 16), from its prefab's `building`: a rectangle centred on
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
  /** The colour of its concrete base. */
  colour: number;
}

type MarkerNode = Extract<
  MapNode,
  {
    type:
      'playerSpawn' | 'enemySpawn' | 'lootContainer' | 'lootSpawn' | 'extraction' | 'questMarker';
  }
>;
const MARKER_TYPES = new Set<string>([
  'playerSpawn',
  'enemySpawn',
  'lootContainer',
  'lootSpawn',
  'extraction',
  'questMarker',
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
 * patrol's path id too.
 */
export type CompiledMarker = Placed<MarkerNode>;

export interface CompiledMap {
  id: string;
  name: string;
  environment: { sky: number; fogNear: number; fogFar: number };
  terrainColour: number;
  water: { level: number; colour: number; opacity: number } | undefined;
  world: WorldDef;
  /** Everything static that isn't instanced, merged by chunk when drawn. */
  shapes: Shape[];
  instanced: InstancedGroup[];
  doors: CompiledDoor[];
  markers: CompiledMarker[];
  patrols: CompiledPatrol[];
  /** Buildings' footprints; their concrete bases are in shapes and world.boxes. */
  buildings: CompiledBuilding[];
  zones: MapZone[];
}

export type PrefabLookup = ReadonlyMap<string, PrefabFile>;

const DEG = Math.PI / 180;
const STEP_HEIGHT = 0.25;
const LADDER_WIDTH = 0.6;
const RUNG_SPACING = 0.3;
const DOOR_THICKNESS = 0.05;
const CYLINDER_SIDES = 8;
const PATROL_WAIT = 3;
/** Concrete, for a base without a colour of its own. */
const BASE_COLOUR = 0x9e9b94;
/** How far a base goes into the ground below the lowest point under it. */
const BASE_BURY = 0.3;

/** Where nodes are being placed: a position and a yaw about y. */
interface Frame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  cos: number;
  sin: number;
}

/** What a pass collects. A null list is skipped. */
interface Sink {
  shapes: Shape[] | null;
  boxes: BoxDef[] | null;
  ramps: RampDef[] | null;
  ladders: LadderDef[] | null;
  doors: CompiledDoor[] | null;
  markers: CompiledMarker[] | null;
  patrols: CompiledPatrol[] | null;
  buildings: CompiledBuilding[] | null;
  /** Instanced prefabs become groups; null flattens them into shapes like any prefab. */
  groups: Map<string, InstancedGroup> | null;
}

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
    markers: [],
    patrols: [],
    buildings: [],
    groups: new Map(),
  };
  const terrain = {
    minX: map.terrain.origin[0],
    minZ: map.terrain.origin[1],
    cellSize: map.terrain.cellSize,
    cols: heights[0]!.length - 1,
    rows: heights.length - 1,
    heights: heights.flat(),
  };
  const scope = slotColours(map.colours ?? {});
  const compiler = new Compiler(source, prefabs, new HeightGrid(terrain));
  compiler.nodes(map.nodes, frame(0, 0, 0, 0), scope, '', [], out);
  const patrols = new Set(out.patrols!.map((p) => p.id));
  for (const m of out.markers!) {
    if (m.type === 'enemySpawn' && m.patrol !== undefined && !patrols.has(m.patrol))
      throw new ContentError(source, `${m.id}: no patrol "${m.patrol}" beside it`);
  }

  return {
    id: map.id,
    name: map.name,
    environment: { ...map.environment, sky: hex(map.environment.sky) },
    terrainColour: hex(map.terrain.colour),
    water: map.water && { ...map.water, colour: hex(map.water.colour) },
    world: {
      terrain,
      boxes,
      ramps,
      ladders,
      doors: out.doors!,
    },
    shapes: out.shapes!,
    instanced: [...out.groups!.values()],
    doors: out.doors!,
    markers: out.markers!,
    patrols: out.patrols!,
    buildings: out.buildings!,
    zones: map.zones,
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
  markers: CompiledMarker[];
  patrols: CompiledPatrol[];
  buildings: CompiledBuilding[];
}

/**
 * Compiles some nodes on their own, as the map editor draws them. `colours` are the
 * slots of the map or prefab they're in.
 */
export function compileNodes(
  nodes: readonly MapNode[],
  prefabs: PrefabLookup,
  colours: Readonly<Record<string, string>> = {},
  source = 'editor',
): CompiledNodes {
  const out = {
    shapes: [],
    boxes: [],
    ramps: [],
    doors: [],
    markers: [],
    patrols: [],
    buildings: [],
  };
  new Compiler(source, prefabs, null).nodes(
    nodes,
    frame(0, 0, 0, 0),
    slotColours(colours),
    '',
    [],
    { ...out, ladders: null, groups: null },
  );
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
    colour: b.colour,
    hx: b.hx,
    hy,
    hz: b.hz,
  };
}

/**
 * The lowest and highest ground under a footprint, sampled every half metre or less (and
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
      if (node.type === 'group') {
        // A group moves its nodes but adds nothing to their ids.
        const [x, y, z] = place(f, node.pos);
        const g = frame(x, y, z, f.yaw + (node.yaw ?? 0) * DEG);
        this.nodes(node.nodes, g, scope, path, stack, out, `${unnamed}${i}.`);
        return;
      }
      const id = (path ? `${path}/` : '') + (node.id ?? `#${unnamed}${i}`);
      this.node(node, f, scope, id, stack, out);
    });
  }

  private fail(path: string, message: string): never {
    throw new ContentError(this.source, `${path}: ${message}`);
  }

  private colour(ref: string, scope: Scope, path: string): number {
    if (ref.startsWith('#')) return hex(ref);
    const c = scope[ref];
    if (c === undefined) this.fail(path, `unknown colour slot "${ref}"`);
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

    switch (node.type) {
      case 'box':
      case 'cylinder': {
        const pitch = (node.pitch ?? 0) * DEG;
        const roll = (node.roll ?? 0) * DEG;
        const colour = this.colour(node.colour, scope, path);
        let hx: number;
        let hy: number;
        let hz: number;
        let shape: Shape;
        if (node.type === 'box') {
          [hx, hy, hz] = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
          shape = { kind: 'box', x, y, z, yaw, pitch, roll, colour, hx, hy, hz };
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
            colour,
            radius,
            radiusTop,
            hy,
            sides,
          };
        }
        // pos is the middle of the base before tilting; tilting turns it about its centre.
        shape.y += hy;
        out.shapes?.push(shape);
        if (node.collide !== false && out.boxes) {
          // A tilted solid collides as its bounding box in its yaw frame.
          const [ex, ey, ez]: Vec3 =
            pitch || roll ? tiltExtents(hx, hy, hz, pitch, roll) : [hx, hy, hz];
          out.boxes.push({ x: shape.x, y: shape.y, z: shape.z, hx: ex, hy: ey, hz: ez, yaw });
        }
        return;
      }

      case 'ramp':
      case 'stairs': {
        const [w, h, d] = node.size;
        const colour = this.colour(node.colour, scope, path);
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
        if (node.type === 'ramp') {
          const [hx, hy, hz] = [w / 2, h / 2, d / 2];
          out.shapes.push({
            kind: 'wedge',
            x,
            y: y + hy,
            z,
            yaw,
            pitch: 0,
            roll: 0,
            colour,
            hx,
            hy,
            hz,
          });
        } else {
          const steps = node.steps ?? Math.max(1, Math.round(h / STEP_HEIGHT));
          out.shapes.push(...stairSteps(ramp, steps, colour));
        }
        return;
      }

      case 'ladder': {
        const ladder: LadderDef = {
          x,
          z,
          yaw,
          halfWidth: (node.width ?? LADDER_WIDTH) / 2,
          bottom: y,
          top: y + node.height,
        };
        out.ladders?.push(ladder);
        out.shapes?.push(...ladderParts(ladder, this.colour(node.colour, scope, path)));
        return;
      }

      case 'door':
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
          open: node.open ?? false,
          colour: this.colour(node.colour, scope, path),
        });
        return;

      case 'prefab':
        this.prefab(node, frame(x, y, z, yaw), scope, path, stack, out);
        return;

      default:
        if (MARKER_TYPES.has(node.type) && out.markers) {
          const { pos, ...rest } = node;
          const marker = { ...rest, id: path, x, y, z, yaw } as CompiledMarker;
          // A patrol is named beside the spawn; it comes out with its full path.
          if (marker.type === 'enemySpawn' && marker.patrol !== undefined)
            marker.patrol = path.slice(0, path.lastIndexOf('/') + 1) + marker.patrol;
          out.markers.push(marker);
        }
    }
  }

  private prefab(
    node: Extract<MapNode, { type: 'prefab' }>,
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
    const scope: Record<string, number> = slotColours(prefab.colours ?? {});
    for (const [slot, ref] of Object.entries(node.colours ?? {})) {
      if (!(slot in scope)) this.fail(path, `prefab "${prefab.id}" has no colour slot "${slot}"`);
      scope[slot] = this.colour(ref, parentScope, path);
    }
    const inner = [...stack, prefab.id];

    if (prefab.building) {
      const [cx, cz] = prefab.building.centre ?? [0, 0];
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
        colour:
          prefab.building.colour === undefined
            ? BASE_COLOUR
            : this.colour(prefab.building.colour, scope, path),
      };
      out.buildings?.push(b);
      const base = this.terrain && concreteBase(this.terrain, b);
      if (base) {
        out.shapes?.push(base);
        const { x, y, z, hx, hy, hz, yaw } = base;
        out.boxes?.push({ x, y, z, hx, hy, hz, yaw });
      }
    }

    if (!prefab.instanced || !out.groups || !out.shapes) {
      this.nodes(prefab.nodes, f, scope, path, inner, out);
      return;
    }
    // Instanced: collision, doors and markers go into the map as usual, but the shapes
    // are built once per colour set in the prefab's own frame.
    this.nodes(prefab.nodes, f, scope, path, inner, { ...out, shapes: null });
    const key = `${prefab.id} ${Object.keys(scope)
      .sort()
      .map((k) => scope[k])
      .join(' ')}`;
    let group = out.groups.get(key);
    if (!group) {
      const shapes: Shape[] = [];
      const local: Sink = {
        shapes,
        boxes: null,
        ramps: null,
        ladders: null,
        doors: null,
        markers: null,
        patrols: null,
        buildings: null,
        groups: null,
      };
      this.nodes(prefab.nodes, frame(0, 0, 0, 0), scope, path, inner, local);
      group = { prefab: prefab.id, shapes, placements: [] };
      out.groups.set(key, group);
    }
    group.placements.push({ x: f.x, y: f.y, z: f.z, yaw: f.yaw });
  }
}

function frame(x: number, y: number, z: number, yaw: number): Frame {
  return { x, y, z, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) };
}

/** A position in a frame, in the frame's parent's space. */
function place(f: Frame, [lx, ly, lz]: readonly [number, number, number]): Vec3 {
  return [f.x + lx * f.cos + lz * f.sin, f.y + ly, f.z - lx * f.sin + lz * f.cos];
}

function hex(colour: string): number {
  return parseInt(colour.slice(1), 16);
}

function slotColours(slots: Readonly<Record<string, string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [slot, colour] of Object.entries(slots)) out[slot] = hex(colour);
  return out;
}

/** Rotates a vector by roll (about z) then pitch (about x), as three.js 'YXZ' does. */
type Vec3 = [number, number, number];

function tilt(x: number, y: number, z: number, pitch: number, roll: number): Vec3 {
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const x1 = x * cr - y * sr;
  const y1 = x * sr + y * cr;
  return [x1, y1 * cp - z * sp, y1 * sp + z * cp];
}

/** Half-extents of the bounding box of a tilted box, in its yaw frame. */
function tiltExtents(hx: number, hy: number, hz: number, pitch: number, roll: number): Vec3 {
  const ax = tilt(hx, 0, 0, pitch, roll);
  const ay = tilt(0, hy, 0, pitch, roll);
  const az = tilt(0, 0, hz, pitch, roll);
  const e = (k: 0 | 1 | 2): number => Math.abs(ax[k]) + Math.abs(ay[k]) + Math.abs(az[k]);
  return [e(0), e(1), e(2)];
}

/** Steps drawn over a ramp: each step's top is at the ramp's height halfway along it. */
function stairSteps(ramp: RampDef, n: number, colour: number): Shape[] {
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
      colour,
      hx: ramp.hx,
      hy: (top - ramp.bottom) / 2,
      hz: depth / 2,
    };
  });
}

/** Two rails and rungs every 0.3 m, just in front of the wall. */
function ladderParts(l: LadderDef, colour: number): Shape[] {
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
    colour,
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

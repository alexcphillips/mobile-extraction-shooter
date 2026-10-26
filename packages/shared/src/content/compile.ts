import type { BoxDef, LadderDef, RampDef, WorldDef } from '../world/collision-world';
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

export interface CompiledDoor {
  id: string;
  /** Bottom middle of the doorway. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  thickness: number;
  hinge: 'left' | 'right';
  key: string | undefined;
  open: boolean;
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

type Placed<T> = T extends unknown
  ? Omit<T, 'id' | 'pos' | 'yaw'> & { id: string; x: number; y: number; z: number; yaw: number }
  : never;

/**
 * A gameplay marker in world space. Its id is the path of ids from the map down, joined
 * by "/"; a node without an id is "#" and its index.
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
  zones: MapZone[];
}

export type PrefabLookup = ReadonlyMap<string, PrefabFile>;

const DEG = Math.PI / 180;
const STEP_HEIGHT = 0.25;
const LADDER_WIDTH = 0.6;
const RUNG_SPACING = 0.3;
const DOOR_THICKNESS = 0.05;
const CYLINDER_SIDES = 8;

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
    groups: new Map(),
  };
  const scope = slotColours(map.colours ?? {});
  const compiler = new Compiler(source, prefabs);
  compiler.nodes(map.nodes, frame(0, 0, 0, 0), scope, '', [], out);

  return {
    id: map.id,
    name: map.name,
    environment: { ...map.environment, sky: hex(map.environment.sky) },
    terrainColour: hex(map.terrain.colour),
    water: map.water && { ...map.water, colour: hex(map.water.colour) },
    world: {
      terrain: {
        minX: map.terrain.origin[0],
        minZ: map.terrain.origin[1],
        cellSize: map.terrain.cellSize,
        cols: heights[0]!.length - 1,
        rows: heights.length - 1,
        heights: heights.flat(),
      },
      boxes,
      ramps,
      ladders,
    },
    shapes: out.shapes!,
    instanced: [...out.groups!.values()],
    doors: out.doors!,
    markers: out.markers!,
    zones: map.zones,
  };
}

class Compiler {
  constructor(
    private readonly source: string,
    private readonly prefabs: PrefabLookup,
  ) {}

  nodes(
    nodes: readonly MapNode[],
    f: Frame,
    scope: Scope,
    path: string,
    stack: readonly string[],
    out: Sink,
  ): void {
    nodes.forEach((node, i) => {
      const id = (path ? `${path}/` : '') + (node.id ?? `#${i}`);
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
    const [lx, ly, lz] = node.pos;
    const x = f.x + lx * f.cos + lz * f.sin;
    const y = f.y + ly;
    const z = f.z - lx * f.sin + lz * f.cos;
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
          out.markers.push({ ...rest, id: path, x, y, z, yaw } as CompiledMarker);
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

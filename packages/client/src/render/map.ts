import type {
  CompiledDoor,
  CompiledGlass,
  CompiledMap,
  CompiledRoad,
  CompiledWater,
  HeightGridDef,
  InstancedGroup,
  Shape,
} from '@mes/shared';
import { openingProgress } from '@mes/shared';
import * as THREE from 'three';
import { FaceCull } from './face-cull';
import { TriangleBuilder } from './geometry';
import { bakedMaterial, shadedMaterial } from './material';

export const CHUNK = 32;

/** How long a door's swing takes to draw, in seconds. The sim snaps it at once. */
const SWING = 0.2;

/** How much glass shows of what's behind it: drawn this opaque. */
export const GLASS_OPACITY = 0.3;

/** How long a shutter takes to roll up, in seconds. */
const ROLL = 2.5;
/** How much of a shutter's height is left when it's rolled up, before it's hidden. */
const ROLLED = 0.04;
/** A door's lamp: until its switch is used, its timer's flash and dark, and open. */
const LAMP_IDLE = 0x8a2b25;
const LAMP_FLASH = 0xffd23c;
const LAMP_DARK = 0x4a3c10;
const LAMP_OPEN = 0x35e06a;
/** Flashes per second. */
const LAMP_RATE = 2;

/** A door's pivot at its hinge, and how far open it's drawn. */
interface DoorView {
  pivot: THREE.Object3D;
  yaw: number;
  /** +1 or −1: which way opening into +z turns it. Opening into −z turns it the other way. */
  turn: number;
  /** How far open it's drawn, −1 (into −z) to 1 (into +z). */
  shown: number;
  /** Its lamp's color, if it has one. */
  lamp: THREE.MeshBasicMaterial | null;
  /** A shutter: where its bottom starts, its height and how far it has rolled up, 0 to 1. */
  roll: { y: number; height: number; shown: number } | null;
  /** Its own mesh, drawn only while it moves; at rest it's in MapView.doorBatch. */
  mesh: THREE.Mesh;
}

/** A prefab moved over a door's timer. (x, y, z) is where it starts. */
interface MoverView {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  travel: readonly [number, number, number];
  door: number;
}

export interface MapView {
  root: THREE.Group;
  /** By the sim's door index (the order of map.doors). */
  doors: DoorView[];
  movers: MoverView[];
  /** Seconds since it was built, for what flashes. */
  clock: number;
  /** Every pane of glass, one instance each by the sim's glass index; null with none. */
  glass: THREE.InstancedMesh | null;
  /** Which panes are drawn broken (gone). */
  glassBroken: boolean[];
  /** Containers with a searched look, by container id. */
  looks: Map<string, LookView>;
  /** Every door at rest, merged: one draw call. Rebuilt as doors start and stop moving. */
  doorBatch: THREE.Mesh;
  /** Which doors are in doorBatch, by door index. */
  batched: boolean[];
}

/** A container's two looks, and whether the searched one is showing in its chunk's mesh. */
interface LookView {
  closed: THREE.BufferGeometry;
  searched: THREE.BufferGeometry;
  shown: boolean;
  chunk: LookChunk;
}

/** The looks of the containers in one chunk, merged: one draw call, rebuilt as one changes. */
interface LookChunk {
  mesh: THREE.Mesh;
  looks: LookView[];
  stale: boolean;
}

/**
 * Builds a compiled map's scene: the terrain and static shapes merged into one mesh per
 * 32 m chunk, one instanced mesh per instanced prefab and color set, the doors at rest as
 * one mesh (and a mesh per door, drawn while it moves), one instanced see-through mesh for
 * all the glass, the looks of the containers with a searched look as one mesh per chunk,
 * and the water surface.
 */
export function buildMap(map: CompiledMap): MapView {
  const root = new THREE.Group();
  const apart = new Set(map.searchedLooks.flatMap((l) => l.closed));
  const merged = apart.size ? map.shapes.filter((s) => !apart.has(s)) : map.shapes;
  root.add(buildChunks(map.world.terrain, map.terrainColor, merged, map.roads));

  const baked = bakedMaterial();
  const looks = new Map<string, LookView>();
  const lookChunks = new Map<string, LookChunk>();
  for (const l of map.searchedLooks) {
    const first = l.closed[0] ?? l.searched[0];
    const key = first ? `${Math.floor(first.x / CHUNK)},${Math.floor(first.z / CHUNK)}` : '';
    let chunk = lookChunks.get(key);
    if (!chunk) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), baked);
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      chunk = { mesh, looks: [], stale: true };
      lookChunks.set(key, chunk);
    }
    const look = {
      closed: buildLook(l.closed),
      searched: buildLook(l.searched),
      shown: false,
      chunk,
    };
    chunk.looks.push(look);
    looks.set(l.id, look);
  }
  for (const chunk of lookChunks.values()) mergeLooks(chunk);

  const shaded = shadedMaterial();
  for (const group of map.instanced) root.add(buildInstanced(group, shaded));

  const doors = map.doors.map((door) => {
    const pivot = buildDoor(door, shaded);
    root.add(pivot);
    // A couch (a door with a look) never swings.
    const turn = door.look ? 0 : door.hinge === 'left' ? -Math.PI / 2 : Math.PI / 2;
    const lamp = door.lamp ? buildLamp(door, root) : null;
    const roll = door.rollUp ? { y: door.y, height: door.height, shown: 0 } : null;
    const mesh = pivot.children[0] as THREE.Mesh;
    return { pivot, yaw: door.yaw, turn, shown: door.open ? 1 : 0, lamp, roll, mesh };
  });
  const doorBatch = new THREE.Mesh(new THREE.BufferGeometry(), shaded);
  doorBatch.matrixAutoUpdate = false;
  doorBatch.name = 'doors';
  root.add(doorBatch);

  const movers = map.movers.map((m) => {
    const b = new TriangleBuilder(false);
    for (const s of m.shapes) b.shape(s);
    const mesh = new THREE.Mesh(b.build(), shaded);
    mesh.position.set(m.x, m.y, m.z);
    mesh.rotation.y = m.yaw;
    mesh.name = m.id;
    root.add(mesh);
    return { mesh, x: m.x, y: m.y, z: m.z, travel: m.travel, door: m.door };
  });

  const glass = map.glass.length ? buildGlass(map.glass) : null;
  if (glass) root.add(glass);

  const water = buildWater(map.water);
  if (water) root.add(water);
  const view: MapView = {
    root,
    doors,
    movers,
    clock: 0,
    glass,
    glassBroken: map.glass.map(() => false),
    looks,
    doorBatch,
    batched: doors.map(() => false),
  };
  batchDoors(view);
  return view;
}

/** Baked like the chunks, so a drawer matches the merged cabinet around it. */
function buildLook(shapes: readonly Shape[]): THREE.BufferGeometry {
  const b = new TriangleBuilder(true);
  for (const s of shapes) b.shape(s);
  return b.build();
}

/** Shows each container's look for the sim's searched flag, merging its chunk's again. */
export function updateSearchedLooks(
  view: MapView,
  containers: readonly { id: string; searched?: boolean }[],
): void {
  if (!view.looks.size) return;
  for (const c of containers) {
    const look = view.looks.get(c.id);
    const searched = !!c.searched;
    if (!look || look.shown === searched) continue;
    look.shown = searched;
    look.chunk.stale = true;
  }
  for (const look of view.looks.values()) if (look.chunk.stale) mergeLooks(look.chunk);
}

function mergeLooks(chunk: LookChunk): void {
  chunk.stale = false;
  chunk.mesh.geometry.dispose();
  chunk.mesh.geometry = mergeGeometry(chunk.looks.map((l) => (l.shown ? l.searched : l.closed)));
}

/**
 * Puts every door at rest (not swinging or rolling up, and not gone) in the batch, and
 * draws the others by themselves. Rebuilds the batch only when that changes.
 */
function batchDoors(view: MapView, moving?: readonly boolean[]): void {
  let changed = false;
  for (let i = 0; i < view.doors.length; i++) {
    const d = view.doors[i]!;
    const rest = d.pivot.visible && !moving?.[i];
    d.mesh.visible = !rest;
    if (view.batched[i] === rest) continue;
    view.batched[i] = rest;
    changed = true;
  }
  if (!changed) return;
  view.root.updateMatrixWorld();
  rootInverse.copy(view.root.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  const matrices: THREE.Matrix4[] = [];
  view.doors.forEach((d, i) => {
    if (!view.batched[i]) return;
    parts.push(d.mesh.geometry);
    matrices.push(new THREE.Matrix4().multiplyMatrices(rootInverse, d.mesh.matrixWorld));
  });
  view.doorBatch.geometry.dispose();
  view.doorBatch.geometry = mergeGeometry(parts, matrices);
  view.doorBatch.visible = parts.length > 0;
}

const rootInverse = new THREE.Matrix4();

/**
 * Non-indexed geometries end to end, each moved by its matrix if given. Normals are
 * turned by the matrix's 3 × 3 part, as the shaded material turns them, unnormalized.
 */
function mergeGeometry(
  parts: readonly THREE.BufferGeometry[],
  matrices?: readonly THREE.Matrix4[],
): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const count = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const names = parts[0] ? Object.keys(parts[0].attributes) : [];
  const v = new THREE.Vector3();
  const turn = new THREE.Matrix3();
  for (const name of names) {
    const size = parts[0]!.getAttribute(name).itemSize;
    const data = new Float32Array(count * size);
    let at = 0;
    parts.forEach((g, k) => {
      const a = g.getAttribute(name);
      const m = matrices?.[k];
      if (m) turn.setFromMatrix4(m);
      for (let i = 0; i < a.count; i++, at += size) {
        if (m && name === 'position') v.fromBufferAttribute(a, i).applyMatrix4(m).toArray(data, at);
        else if (m && name === 'normal')
          v.fromBufferAttribute(a, i).applyMatrix3(turn).toArray(data, at);
        else for (let c = 0; c < size; c++) data[at + c] = a.array[i * size + c]!;
      }
    });
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  out.computeBoundingSphere();
  return out;
}

/**
 * One mesh per chunk: its terrain cells, every shape whose center is in it, and the stretches
 * of road (RD-1) that start in it.
 */
export function buildChunks(
  terrain: HeightGridDef,
  terrainColor: number,
  shapes: readonly Shape[],
  roads: readonly CompiledRoad[] = [],
): THREE.Group {
  const cells = Math.max(1, Math.round(CHUNK / terrain.cellSize));
  const size = cells * terrain.cellSize;
  const nx = Math.ceil(terrain.cols / cells);
  const nz = Math.ceil(terrain.rows / cells);
  const byChunk: Shape[][] = Array.from({ length: nx * nz }, () => []);
  for (const s of shapes) {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((s.x - terrain.minX) / size)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor((s.z - terrain.minZ) / size)));
    byChunk[cz * nx + cx]!.push(s);
  }
  // Each road's samples split into runs by the chunk each stretch starts in.
  const runs: { road: CompiledRoad; from: number; to: number }[][] = Array.from(
    { length: nx * nz },
    () => [],
  );
  const chunkOf = (x: number, z: number) =>
    Math.min(nz - 1, Math.max(0, Math.floor((z - terrain.minZ) / size))) * nx +
    Math.min(nx - 1, Math.max(0, Math.floor((x - terrain.minX) / size)));
  for (const road of roads) {
    const n = road.strip.length / 6;
    let from = 0;
    let at = chunkOf(road.strip[0]!, road.strip[2]!);
    for (let k = 1; k < n - 1; k++) {
      const c = chunkOf(road.strip[k * 6]!, road.strip[k * 6 + 2]!);
      if (c === at) continue;
      runs[at]!.push({ road, from, to: k });
      [from, at] = [k, c];
    }
    if (n > 1) runs[at]!.push({ road, from, to: n - 1 });
  }

  const group = new THREE.Group();
  const material = bakedMaterial();
  // Faces against a box or under the ground are left out: they can't be seen.
  const cull = new FaceCull(shapes, terrain);
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      const b = new TriangleBuilder(true, cull);
      const i0 = cx * cells;
      const j0 = cz * cells;
      b.terrain(
        terrain,
        i0,
        Math.min(terrain.cols, i0 + cells),
        j0,
        Math.min(terrain.rows, j0 + cells),
        terrainColor,
      );
      for (const s of byChunk[cz * nx + cx]!) b.shape(s);
      for (const r of runs[cz * nx + cx]!) b.strip(r.road.strip, r.from, r.to, r.road.color);
      const mesh = new THREE.Mesh(b.build(), material);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}

function buildInstanced(group: InstancedGroup, material: THREE.Material): THREE.InstancedMesh {
  const b = new TriangleBuilder(false);
  for (const s of group.shapes) b.shape(s);
  const mesh = new THREE.InstancedMesh(b.build(), material, group.placements.length);
  const m = new THREE.Matrix4();
  group.placements.forEach((p, i) => {
    mesh.setMatrixAt(i, m.makeRotationY(p.yaw).setPosition(p.x, p.y, p.z));
  });
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  mesh.name = group.prefab;
  return mesh;
}

/**
 * Swings each drawn door towards the sim's open (on the side it opened to) or closed, over
 * SWING seconds.
 */
export function updateDoors(
  view: MapView,
  doors: readonly {
    open: boolean;
    flipped?: boolean;
    gone?: boolean;
    opening?: number;
    openingFor?: number;
  }[],
  dt: number,
): void {
  view.clock += dt;
  for (const m of view.movers) {
    const s = doors[m.door];
    const t = s ? openingProgress(s) : 0;
    // Hidden on arrival: the map's own copy of what it became is the solid one.
    m.mesh.visible = t < 1;
    m.mesh.position.set(m.x + m.travel[0] * t, m.y + m.travel[1] * t, m.z + m.travel[2] * t);
  }
  for (let i = 0; i < view.doors.length; i++) {
    const d = view.doors[i]!;
    const s = doors[i];
    moving[i] = false;
    if (d.lamp) d.lamp.color.setHex(lampColor(s, view.clock));
    if (d.roll) {
      const r = d.roll;
      moving[i] = !!s?.gone && r.shown < 1;
      if (moving[i]) r.shown = Math.min(1, r.shown + dt / ROLL);
      const left = 1 - r.shown * (1 - ROLLED);
      d.pivot.scale.y = left;
      d.pivot.position.y = r.y + r.height * (1 - left);
      d.pivot.visible = r.shown < 1;
      continue;
    }
    // A bought door (zombies mode) is gone from its doorway.
    d.pivot.visible = !s?.gone;
    const target = s?.open ? (s.flipped ? -1 : 1) : 0;
    if (d.shown === target) continue;
    moving[i] = true;
    const step = dt / SWING;
    d.shown =
      target > d.shown ? Math.min(target, d.shown + step) : Math.max(target, d.shown - step);
    // Eased out, so it slows into the wall.
    const a = Math.abs(d.shown);
    const t = Math.sign(d.shown) * (1 - (1 - a) * (1 - a));
    d.pivot.rotation.y = d.yaw + d.turn * t;
  }
  batchDoors(view, moving);
}

/** Which doors updateDoors moved this frame, by door index. */
const moving: boolean[] = [];

function lampColor(s: { open: boolean; opening?: number } | undefined, clock: number): number {
  if (s?.open) return LAMP_OPEN;
  if (s?.opening === undefined) return LAMP_IDLE;
  return (clock * LAMP_RATE) % 1 < 0.5 ? LAMP_FLASH : LAMP_DARK;
}

/** A door's lamp: lit, so it reads at a distance, and with a color of its own to change. */
function buildLamp(door: CompiledDoor, root: THREE.Object3D): THREE.MeshBasicMaterial {
  const { pos, size } = door.lamp!;
  const material = new THREE.MeshBasicMaterial({ color: LAMP_IDLE });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  const at = new THREE.Group();
  at.position.set(door.x, door.y, door.z);
  at.rotation.y = door.yaw;
  mesh.position.set(pos[0], pos[1] + size[1] / 2, pos[2]);
  at.add(mesh);
  root.add(at);
  return material;
}

/** See-through and flat, drawn after what's solid and leaving the depth buffer alone. */
export function glassMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: GLASS_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A pane's place and size, for a unit cube with its bottom at 0. */
function glassMatrix(g: CompiledGlass, m: THREE.Matrix4): THREE.Matrix4 {
  return m
    .makeRotationY(g.yaw)
    .scale(new THREE.Vector3(g.width, g.height, g.thickness))
    .setPosition(g.x, g.y, g.z);
}

const UNIT_PANE = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** All the panes as one instanced mesh, each its own tint: one draw call. */
function buildGlass(glass: readonly CompiledGlass[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(UNIT_PANE, glassMaterial(), glass.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  glass.forEach((g, i) => {
    mesh.setMatrixAt(i, glassMatrix(g, m));
    mesh.setColorAt(i, c.setHex(g.color));
  });
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;
  mesh.name = 'glass';
  return mesh;
}

/**
 * One pane on its own, with a material of its own tint, as the editor draws it. Its own
 * geometry too, as the editor disposes what it drew.
 */
export function buildGlassPane(g: CompiledGlass): THREE.Mesh {
  const material = glassMaterial();
  material.color.setHex(g.color);
  const mesh = new THREE.Mesh(UNIT_PANE.clone(), material);
  glassMatrix(g, mesh.matrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.renderOrder = 1;
  mesh.name = g.id;
  return mesh;
}

/** Stops drawing panes the sim has broken. Cheap when nothing changed. */
export function updateGlass(view: MapView, broken: readonly boolean[]): void {
  if (!view.glass) return;
  let changed = false;
  for (let i = 0; i < view.glassBroken.length; i++) {
    if (!broken[i] || view.glassBroken[i]) continue;
    view.glassBroken[i] = true;
    view.glass.setMatrixAt(i, ZERO_MATRIX);
    changed = true;
  }
  if (changed) view.glass.instanceMatrix.needsUpdate = true;
}

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** A pivot at the hinge holding the door panel. Seen from +z, a left hinge is at −x. */
export function buildDoor(door: CompiledDoor, material: THREE.Material): THREE.Object3D {
  if (door.look) {
    // A couch blocking the stairs (zombies mode): its prefab where the door is. It never
    // swings, so it hangs from its own middle, which updateDoors leaves be.
    const look = new TriangleBuilder(false);
    for (const s of door.look) look.shape(s);
    const at = new THREE.Group();
    at.position.set(door.x, door.y, door.z);
    at.rotation.y = door.yaw;
    at.add(new THREE.Mesh(look.build(), material));
    at.name = door.id;
    return at;
  }
  const side = door.hinge === 'left' ? -1 : 1;
  const b = new TriangleBuilder(false);
  b.shape({
    kind: 'box',
    x: (-side * door.width) / 2,
    y: door.height / 2,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    color: door.color,
    hx: door.width / 2,
    hy: door.height / 2,
    hz: door.thickness / 2,
  });
  const pivot = new THREE.Group();
  const c = Math.cos(door.yaw);
  const s = Math.sin(door.yaw);
  const hinge = (side * door.width) / 2;
  pivot.position.set(door.x + hinge * c, door.y, door.z - hinge * s);
  // Open swings the free edge towards +z.
  pivot.rotation.y = door.yaw + (door.open ? (side * Math.PI) / 2 : 0);
  pivot.add(new THREE.Mesh(b.build(), material));
  pivot.name = door.id;
  return pivot;
}

/**
 * Every body of water as one see-through mesh (MT-1): a flat rectangle each at its level,
 * colored and faded per body through vertex colors with alpha. One draw call; null with
 * none. Seen from both sides, so it shows from under the surface too.
 */
export function buildWater(water: readonly CompiledWater[]): THREE.Mesh | null {
  if (!water.length) return null;
  const pos = new Float32Array(water.length * 18);
  const col = new Float32Array(water.length * 24);
  const c = new THREE.Color();
  water.forEach((w, k) => {
    const cos = Math.cos(w.yaw);
    const sin = Math.sin(w.yaw);
    // Corners in its frame, then into the world as compile's place() does.
    const corners = [
      [-w.hx, -w.hz],
      [w.hx, -w.hz],
      [w.hx, w.hz],
      [-w.hx, -w.hz],
      [w.hx, w.hz],
      [-w.hx, w.hz],
    ] as const;
    c.setHex(w.color);
    corners.forEach(([lx, lz], i) => {
      pos.set([w.x + lx * cos + lz * sin, w.level, w.z - lx * sin + lz * cos], k * 18 + i * 3);
      col.set([c.r, c.g, c.b, w.opacity], k * 24 + i * 4);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.name = 'water';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

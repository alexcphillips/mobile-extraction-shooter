import type {
  CompiledDoor,
  CompiledGlass,
  CompiledMap,
  HeightGridDef,
  InstancedGroup,
  Shape,
} from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { bakedMaterial, shadedMaterial } from './material';

export const CHUNK = 32;

/** How long a door's swing takes to draw, in seconds. The sim snaps it at once. */
const SWING = 0.2;

/** How much glass shows of what's behind it: drawn this opaque. */
export const GLASS_OPACITY = 0.3;

/** A door's pivot at its hinge, and how far open it's drawn. */
interface DoorView {
  pivot: THREE.Object3D;
  yaw: number;
  /** +1 or −1: which way opening into +z turns it. Opening into −z turns it the other way. */
  turn: number;
  /** How far open it's drawn, −1 (into −z) to 1 (into +z). */
  shown: number;
}

export interface MapView {
  root: THREE.Group;
  /** By the sim's door index (the order of map.doors). */
  doors: DoorView[];
  /** Every pane of glass, one instance each by the sim's glass index; null with none. */
  glass: THREE.InstancedMesh | null;
  /** Which panes are drawn broken (gone). */
  glassBroken: boolean[];
  /** Containers with a searched look, by container id. */
  looks: Map<string, LookView>;
}

/** A container's two looks, one mesh each, and whether the searched one is showing. */
interface LookView {
  closed: THREE.Mesh;
  searched: THREE.Mesh;
  shown: boolean;
}

/**
 * Builds a compiled map's scene: the terrain and static shapes merged into one mesh per
 * 32 m chunk, one instanced mesh per instanced prefab and colour set, a mesh per door,
 * one instanced see-through mesh for all the glass, the two looks of each container with a
 * searched look, and the water surface.
 */
export function buildMap(map: CompiledMap): MapView {
  const root = new THREE.Group();
  const apart = new Set(map.searchedLooks.flatMap((l) => l.closed));
  const merged = apart.size ? map.shapes.filter((s) => !apart.has(s)) : map.shapes;
  root.add(buildChunks(map.world.terrain, map.terrainColour, merged));

  const baked = bakedMaterial();
  const looks = new Map<string, LookView>();
  for (const l of map.searchedLooks) {
    const closed = buildLook(l.closed, baked);
    const searched = buildLook(l.searched, baked);
    searched.visible = false;
    root.add(closed, searched);
    looks.set(l.id, { closed, searched, shown: false });
  }

  const shaded = shadedMaterial();
  for (const group of map.instanced) root.add(buildInstanced(group, shaded));

  const doors = map.doors.map((door) => {
    const pivot = buildDoor(door, shaded);
    root.add(pivot);
    // A couch (a door with a look) never swings.
    const turn = door.look ? 0 : door.hinge === 'left' ? -Math.PI / 2 : Math.PI / 2;
    return { pivot, yaw: door.yaw, turn, shown: door.open ? 1 : 0 };
  });

  const glass = map.glass.length ? buildGlass(map.glass) : null;
  if (glass) root.add(glass);

  if (map.water) {
    const t = map.world.terrain;
    const w = t.cols * t.cellSize;
    const d = t.rows * t.cellSize;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: map.water.colour,
        transparent: true,
        opacity: map.water.opacity,
        depthWrite: false,
      }),
    );
    water.position.set(t.minX + w / 2, map.water.level, t.minZ + d / 2);
    water.updateMatrix();
    water.matrixAutoUpdate = false;
    root.add(water);
  }
  return { root, doors, glass, glassBroken: map.glass.map(() => false), looks };
}

/** Baked like the chunks, so a drawer matches the merged cabinet around it. */
function buildLook(shapes: readonly Shape[], material: THREE.Material): THREE.Mesh {
  const b = new TriangleBuilder(true);
  for (const s of shapes) b.shape(s);
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Shows each container's look for the sim's searched flag, each by itself. */
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
    look.closed.visible = !searched;
    look.searched.visible = searched;
  }
}

/** One mesh per chunk: its terrain cells and every shape whose centre is in it. */
export function buildChunks(
  terrain: HeightGridDef,
  terrainColour: number,
  shapes: readonly Shape[],
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

  const group = new THREE.Group();
  const material = bakedMaterial();
  for (let cz = 0; cz < nz; cz++) {
    for (let cx = 0; cx < nx; cx++) {
      const b = new TriangleBuilder(true);
      const i0 = cx * cells;
      const j0 = cz * cells;
      b.terrain(
        terrain,
        i0,
        Math.min(terrain.cols, i0 + cells),
        j0,
        Math.min(terrain.rows, j0 + cells),
        terrainColour,
      );
      for (const s of byChunk[cz * nx + cx]!) b.shape(s);
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
  doors: readonly { open: boolean; flipped?: boolean; gone?: boolean }[],
  dt: number,
): void {
  for (let i = 0; i < view.doors.length; i++) {
    const d = view.doors[i]!;
    const s = doors[i];
    // A bought door (zombies mode) is gone from its doorway.
    d.pivot.visible = !s?.gone;
    const target = s?.open ? (s.flipped ? -1 : 1) : 0;
    if (d.shown === target) continue;
    const step = dt / SWING;
    d.shown =
      target > d.shown ? Math.min(target, d.shown + step) : Math.max(target, d.shown - step);
    // Eased out, so it slows into the wall.
    const a = Math.abs(d.shown);
    const t = Math.sign(d.shown) * (1 - (1 - a) * (1 - a));
    d.pivot.rotation.y = d.yaw + d.turn * t;
  }
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
    mesh.setColorAt(i, c.setHex(g.colour));
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
  material.color.setHex(g.colour);
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
    colour: door.colour,
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

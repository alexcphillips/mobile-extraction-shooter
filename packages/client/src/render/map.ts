import type { CompiledDoor, CompiledMap, HeightGridDef, InstancedGroup, Shape } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { bakedMaterial, shadedMaterial } from './material';

const CHUNK = 32;

/** How long a door's swing takes to draw, in seconds. The sim snaps it at once. */
const SWING = 0.2;

/** A door's pivot at its hinge, and how far open it's drawn (0 to 1). */
interface DoorView {
  pivot: THREE.Object3D;
  yaw: number;
  /** +1 or −1: which way opening turns it. */
  turn: number;
  shown: number;
}

export interface MapView {
  root: THREE.Group;
  /** By the sim's door index (the order of map.doors). */
  doors: DoorView[];
}

/**
 * Builds a compiled map's scene: the terrain and static shapes merged into one mesh per
 * 32 m chunk, one instanced mesh per instanced prefab and colour set, a mesh per door,
 * and the water surface.
 */
export function buildMap(map: CompiledMap): MapView {
  const root = new THREE.Group();
  root.add(buildChunks(map.world.terrain, map.terrainColour, map.shapes));

  const shaded = shadedMaterial();
  for (const group of map.instanced) root.add(buildInstanced(group, shaded));

  const doors = map.doors.map((door) => {
    const pivot = buildDoor(door, shaded);
    root.add(pivot);
    const turn = door.hinge === 'left' ? -Math.PI / 2 : Math.PI / 2;
    return { pivot, yaw: door.yaw, turn, shown: door.open ? 1 : 0 };
  });

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
  return { root, doors };
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

/** Swings each drawn door towards the sim's open or closed, over SWING seconds. */
export function updateDoors(view: MapView, open: readonly { open: boolean }[], dt: number): void {
  for (let i = 0; i < view.doors.length; i++) {
    const d = view.doors[i]!;
    const target = open[i]?.open ? 1 : 0;
    if (d.shown === target) continue;
    const step = dt / SWING;
    d.shown =
      target > d.shown ? Math.min(target, d.shown + step) : Math.max(target, d.shown - step);
    // Eased out, so it slows into the wall.
    const t = 1 - (1 - d.shown) * (1 - d.shown);
    d.pivot.rotation.y = d.yaw + d.turn * t;
  }
}

/** A pivot at the hinge holding the door panel. Seen from +z, a left hinge is at −x. */
export function buildDoor(door: CompiledDoor, material: THREE.Material): THREE.Object3D {
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

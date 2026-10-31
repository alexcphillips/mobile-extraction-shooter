import { compileNodes, type PrefabLookup } from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from '../render/geometry';
import { buildDoor } from '../render/map';
import { shadedMaterial } from '../render/material';

/*
 * Pictures of prefabs for the prefab browser: each drawn once by one small offscreen
 * renderer, from above at an angle, and kept as an image URL until what it draws changes.
 */

const SIZE = 160;
const FOV = 30;

export class Thumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2000);
  private readonly material = shadedMaterial();
  /** Image URLs by what was drawn (the compiled shapes and doors), so a change draws it again. */
  private readonly cache = new Map<string, string>();

  /** A picture of a prefab as it is now (nested prefabs included), or null if it doesn't compile. */
  get(id: string, prefabs: PrefabLookup): string | null {
    let out;
    try {
      out = compileNodes([{ type: 'prefab', prefab: id, pos: [0, 0, 0] }], prefabs, {});
    } catch {
      return null;
    }
    const key = JSON.stringify([out.shapes, out.doors]);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const scene = new THREE.Group();
    if (out.shapes.length) {
      const b = new TriangleBuilder(false);
      for (const s of out.shapes) b.shape(s);
      scene.add(new THREE.Mesh(b.build(), this.material));
    }
    for (const d of out.doors) scene.add(buildDoor(d, this.material));
    const url = this.draw(scene);
    scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.cache.set(key, url);
    return url;
  }

  private draw(object: THREE.Object3D): string {
    this.renderer ??= new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    const r = this.renderer;
    r.setSize(SIZE, SIZE, false);
    r.setClearColor(0, 0);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return '';
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const distance = (sphere.radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.05;
    this.camera.position.set(1, 0.75, 1).normalize().multiplyScalar(distance).add(sphere.center);
    this.camera.lookAt(sphere.center);
    const scene = new THREE.Scene();
    scene.add(object);
    r.render(scene, this.camera);
    return r.domElement.toDataURL('image/png');
  }
}

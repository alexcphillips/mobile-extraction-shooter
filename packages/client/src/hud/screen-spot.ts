import * as THREE from 'three';

/*
 * Where a point in the world is on screen, kept inside its edges: for the tutorial's marker.
 * (The quest markers drawn over the world used it too, until they moved to the map tab only,
 * 2026-11-09, the user's call.)
 */

/** Kept this far inside the screen's edges, in px, when the spot is off to one side. */
const EDGE = 28;

const projected = new THREE.Vector3();

/**
 * Where a point in the world is on screen, in whole px, kept `edge` px inside the screen;
 * one behind the camera or off to one side sits at the edge in its direction. Returns
 * x * 65536 + y, so a caller can tell cheaply whether it moved (x = r >> 16, y = r & 0xffff).
 */
export function screenSpot(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  edge = EDGE,
): number {
  // The window's size, not an element's, which would force a layout every frame.
  const w = innerWidth;
  const h = innerHeight;
  const v = projected.set(x, y, z).project(camera);
  // Behind the camera, the projection mirrors: flip it and push it to an edge.
  const behind = v.z > 1;
  let sx = behind ? -v.x : v.x;
  let sy = behind ? -v.y : v.y;
  if (behind || Math.abs(sx) > 1 || Math.abs(sy) > 1) {
    const m = Math.max(Math.abs(sx), Math.abs(sy), 1e-6);
    sx /= m;
    sy /= m;
  }
  const px = Math.round(Math.min(w - edge, Math.max(edge, ((sx + 1) / 2) * w)));
  const py = Math.round(Math.min(h - edge, Math.max(edge, ((1 - sy) / 2) * h)));
  return px * 65536 + py;
}

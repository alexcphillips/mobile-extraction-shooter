import type { Character, InvestigateSpot } from '@mes/shared';
import * as THREE from 'three';

/** How high over a marker's spot its label floats, in metres. */
const LIFT = 1.2;
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

/**
 * Quest markers to investigate (session 14b), seen through walls: a diamond and the
 * distance, over each of your markers not yet investigated. One off screen sits at the
 * edge in its direction. One element per marker, made once; each frame only moves them
 * when they've moved a whole pixel, and the text changes only when the whole metres do.
 */
export class QuestMarkers {
  private readonly els: HTMLElement[] = [];
  private readonly metres: number[] = [];
  /** Where each is drawn, in whole px, as x * 65536 + y. */
  private readonly at: number[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly spots: readonly InvestigateSpot[],
    private readonly player: Character,
  ) {
    root.replaceChildren();
    for (const s of spots) {
      if (s.holder !== player.id) continue;
      const el = document.createElement('div');
      el.className = 'quest-marker';
      root.append(el);
      this.els.push(el);
      this.metres.push(-1);
      this.at.push(-1);
    }
  }

  /** Call once per frame, after the camera has moved. `shown`: false hides them all. */
  update(camera: THREE.PerspectiveCamera, shown: boolean): void {
    let i = 0;
    for (const s of this.spots) {
      if (s.holder !== this.player.id) continue;
      const el = this.els[i]!;
      if (!shown || s.done) {
        el.hidden = true;
        i++;
        continue;
      }
      el.hidden = false;
      const at = screenSpot(camera, s.x, s.y + LIFT, s.z);
      if (at !== this.at[i]) {
        this.at[i] = at;
        el.style.transform = `translate(${at >> 16}px, ${at & 0xffff}px)`;
      }
      const d = Math.round(
        Math.hypot(s.x - this.player.x, s.y - this.player.y, s.z - this.player.z),
      );
      if (d !== this.metres[i]) {
        this.metres[i] = d;
        el.textContent = `${d} m`;
      }
      i++;
    }
  }
}

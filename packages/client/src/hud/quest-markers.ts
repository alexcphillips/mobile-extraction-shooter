import type { Character, InvestigateSpot } from '@mes/shared';
import * as THREE from 'three';

/** How high over a marker's spot its label floats, in metres. */
const LIFT = 1.2;
/** Kept this far inside the screen's edges, in px, when the spot is off to one side. */
const EDGE = 28;

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
  private readonly v = new THREE.Vector3();

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
    // The window's size, not the element's, which would force a layout every frame.
    const w = innerWidth;
    const h = innerHeight;
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
      const v = this.v.set(s.x, s.y + LIFT, s.z).project(camera);
      // Behind the camera, the projection mirrors: flip it and push it to an edge.
      const behind = v.z > 1;
      let x = behind ? -v.x : v.x;
      let y = behind ? -v.y : v.y;
      if (behind || Math.abs(x) > 1 || Math.abs(y) > 1) {
        const m = Math.max(Math.abs(x), Math.abs(y), 1e-6);
        x /= m;
        y /= m;
      }
      const px = Math.round(Math.min(w - EDGE, Math.max(EDGE, ((x + 1) / 2) * w)));
      const py = Math.round(Math.min(h - EDGE, Math.max(EDGE, ((1 - y) / 2) * h)));
      if (px * 65536 + py !== this.at[i]) {
        this.at[i] = px * 65536 + py;
        el.style.transform = `translate(${px}px, ${py}px)`;
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

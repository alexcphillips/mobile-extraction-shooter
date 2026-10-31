import { TOTAL_HP, totalHp, type Character } from '@mes/shared';
import * as THREE from 'three';

/** How high over an enemy's head its bar floats, in metres. */
const LIFT = 0.35;
/** Bars beyond this far away aren't shown, in metres. */
const RANGE = 120;

/**
 * The enemy health bars admin cheat (2026-10-30): a bar over each living enemy on screen,
 * seen through walls, filled by its total HP and labelled with it, e.g. "185/370". One
 * element per enemy, made as it's added; each frame only moves a bar when it has moved a
 * whole pixel, and only changes the fill and label when the whole HP does.
 */
export class EnemyBars {
  private readonly chars: Character[] = [];
  private readonly els: HTMLElement[] = [];
  private readonly fills: HTMLElement[] = [];
  private readonly labels: HTMLElement[] = [];
  /** The whole HP each shows. */
  private readonly hp: number[] = [];
  /** Where each is drawn, in whole px, as x * 65536 + y. */
  private readonly at: number[] = [];
  private readonly v = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
  }

  add(c: Character): void {
    const el = document.createElement('div');
    el.className = 'enemy-bar';
    el.hidden = true;
    const fill = document.createElement('div');
    const label = document.createElement('span');
    el.append(fill, label);
    this.root.append(el);
    this.chars.push(c);
    this.els.push(el);
    this.fills.push(fill);
    this.labels.push(label);
    this.hp.push(-1);
    this.at.push(-1);
  }

  /** Call once per frame, after the camera has moved. `shown`: false hides them all. */
  update(camera: THREE.PerspectiveCamera, shown: boolean): void {
    // The window's size, not the element's, which would force a layout every frame.
    const w = innerWidth;
    const h = innerHeight;
    for (let i = 0; i < this.chars.length; i++) {
      const c = this.chars[i]!;
      const el = this.els[i]!;
      const far = Math.hypot(c.x - camera.position.x, c.z - camera.position.z) > RANGE;
      const v =
        shown && !c.health.dead && !far ? this.v.set(c.x, c.y + c.height + LIFT, c.z) : null;
      if (v) v.project(camera);
      if (!v || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      const px = Math.round(((v.x + 1) / 2) * w);
      const py = Math.round(((1 - v.y) / 2) * h);
      if (px * 65536 + py !== this.at[i]) {
        this.at[i] = px * 65536 + py;
        el.style.transform = `translate(${px}px, ${py}px)`;
      }
      // Rounded up, so a wounded enemy never reads as 0.
      const hp = Math.ceil(totalHp(c.health));
      if (hp !== this.hp[i]) {
        this.hp[i] = hp;
        this.fills[i]!.style.width = `${(hp / TOTAL_HP) * 100}%`;
        this.labels[i]!.textContent = `${hp}/${TOTAL_HP}`;
        el.classList.toggle('low', hp < TOTAL_HP * 0.35);
      }
    }
  }
}

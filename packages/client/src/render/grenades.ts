import {
  GRENADE,
  itemDef,
  modelShapes,
  smokeRadius,
  type CollisionWorld,
  type GrenadeEffect,
  type Grenade,
  type ItemDb,
  type Smoke,
} from '@mes/shared';
import * as THREE from 'three';
import { TriangleBuilder } from './geometry';
import { shadedMaterial } from './material';

/** At most this many grenades drawn at once; more are rare, and skipped. */
const GRENADES = 8;
/** How fast one in flight tumbles, in turns per second. */
const SPIN = 2.5;

const FIREBALLS = 4;
const FIREBALL_MS = 380;
/** The fireball's size at its biggest, in metres. */
const FIREBALL_SIZE = 2.2;
const FIRE_HOT = new THREE.Color(0xfff0b0);
const FIRE_COOL = new THREE.Color(0x8a3a12);
/** A flash's burst: white, smaller and quicker than a fireball. */
const FLASH_MS = 160;
const FLASH_SIZE = 1.4;
const FLASH_HOT = new THREE.Color(0xffffff);
const FLASH_COOL = new THREE.Color(0xdde8ff);

const WAVES = 4;
/** The shockwave reaches the radius by then, and is gone by WAVE_MS. */
const WAVE_OUT_MS = 420;
const WAVE_MS = 1100;
/** It's drawn this far above the ground, clear of it. */
const WAVE_LIFT = 0.06;

/**
 * The shockwave ring as an SVG, drawn onto a flat square on the ground: clear in the
 * middle, brightening to a hard edge at the rim, so at full size its edge is the blast's
 * radius. A dashed line just inside the rim reads as debris at a glance.
 */
const SHOCKWAVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-128 -128 256 256" width="512" height="512">
  <defs>
    <radialGradient id="w" cx="0" cy="0" r="128" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5a3a20" stop-opacity="0.35"/>
      <stop offset="0.25" stop-color="#ffcf7a" stop-opacity="0"/>
      <stop offset="0.7" stop-color="#ffb347" stop-opacity="0.12"/>
      <stop offset="0.9" stop-color="#ffd890" stop-opacity="0.55"/>
      <stop offset="0.975" stop-color="#fff6dc" stop-opacity="1"/>
      <stop offset="1" stop-color="#fff6dc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle r="128" fill="url(#w)"/>
  <circle r="116" fill="none" stroke="#fff2c8" stroke-width="2.5" stroke-dasharray="10 7" opacity="0.7"/>
  <circle r="124.5" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
</svg>`;

/** Smoke clouds drawn at once; more are skipped. */
const SMOKES = 4;
/**
 * Each cloud's puffs, as [x, y, z, size] in shares of its radius: one in the middle and a
 * ring around it, a little lower, so it reads as a heap rather than a ball.
 */
const PUFFS: readonly (readonly [number, number, number, number])[] = [
  [0, 0.15, 0, 1.3],
  [0.55, -0.2, 0, 1],
  [-0.3, -0.15, 0.5, 1.05],
  [-0.35, -0.2, -0.45, 0.95],
  [0.25, 0.35, -0.3, 0.9],
  [-0.1, 0.4, 0.3, 0.85],
];
/** Most a cloud's puffs are opaque; they thin as it clears. */
const SMOKE_OPACITY = 0.92;

/**
 * One smoke puff as an SVG, drawn on a sprite that always faces the camera: a soft grey
 * blob, a few overlapping circles fading out at the edge, so puffs blend into a cloud.
 */
const SMOKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128">
  <defs>
    <radialGradient id="p">
      <stop offset="0" stop-color="#d8d8d4" stop-opacity="1"/>
      <stop offset="0.55" stop-color="#c6c6c2" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#b8b8b4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle r="62" fill="url(#p)"/>
  <circle cx="-18" cy="-14" r="34" fill="url(#p)"/>
  <circle cx="20" cy="10" r="30" fill="url(#p)"/>
</svg>`;

/**
 * Thrown grenades and their explosions (2026-10-30). Grenades are drawn with their item's
 * model from a fixed pool, between the last two ticks' positions, tumbling in flight. An
 * explosion is a fireball and a shockwave ring on the ground (an SVG texture) that grows
 * to the blast's radius and fades, so you can see how far it reached. A flash is a quick
 * white burst, and a smoke grenade's cloud (2026-10-31) a few camera-facing sprites of an
 * SVG puff, growing and thinning with the sim's cloud. All pooled, so nothing is allocated
 * as they come and go.
 */
export class GrenadeViews {
  readonly root = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  /** Each pooled mesh's grenade id, last tick's and this tick's positions. */
  private readonly ids = new Int32Array(GRENADES).fill(-1);
  private readonly prev = new Float64Array(GRENADES * 3);
  private readonly cur = new Float64Array(GRENADES * 3);
  private readonly resting = new Uint8Array(GRENADES);

  private readonly fireballs: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly fireEnds = new Float64Array(FIREBALLS);
  /** Whether each fireball is a flash's burst. */
  private readonly fireFlash = new Uint8Array(FIREBALLS);
  private nextFire = 0;
  private readonly waves: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly waveEnds = new Float64Array(WAVES);
  private readonly waveRadius = new Float64Array(WAVES);
  private nextWave = 0;
  /** Each cloud's puff sprites, sharing one material so they fade together. */
  private readonly smokes: THREE.Sprite[][] = [];

  constructor(
    private readonly items: ItemDb,
    private readonly world: CollisionWorld,
  ) {
    const material = shadedMaterial();
    for (let i = 0; i < GRENADES; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), material);
      m.visible = false;
      this.meshes.push(m);
      this.root.add(m);
    }

    const ball = new THREE.IcosahedronGeometry(0.5, 1);
    for (let i = 0; i < FIREBALLS; i++) {
      const m = new THREE.Mesh(
        ball,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.visible = false;
      this.fireballs.push(m);
      this.root.add(m);
    }

    const texture = new THREE.TextureLoader().load(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SHOCKWAVE_SVG)}`,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    // A unit square lying flat, so scaling it by the radius times 2 fits the blast.
    const square = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    for (let i = 0; i < WAVES; i++) {
      const m = new THREE.Mesh(
        square,
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      m.visible = false;
      m.renderOrder = 1;
      this.waves.push(m);
      this.root.add(m);
    }

    const puff = new THREE.TextureLoader().load(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SMOKE_SVG)}`,
    );
    puff.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < SMOKES; i++) {
      const material = new THREE.SpriteMaterial({
        map: puff,
        transparent: true,
        depthWrite: false,
      });
      const cloud: THREE.Sprite[] = [];
      for (let k = 0; k < PUFFS.length; k++) {
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        cloud.push(sprite);
        this.root.add(sprite);
      }
      this.smokes.push(cloud);
    }
  }

  /** Shows everything for the start-up draw, so shaders compile then, not mid-raid. */
  warm(on: boolean): void {
    for (const m of [...this.fireballs, ...this.waves]) m.visible = on;
    this.smokes[0]![0]!.visible = on;
  }

  /** Call after each tick, with the sim's grenades. */
  tick(grenades: readonly Grenade[]): void {
    for (let i = 0; i < GRENADES; i++) {
      const g = grenades[i];
      const o = i * 3;
      if (!g) {
        this.ids[i] = -1;
        this.meshes[i]!.visible = false;
        continue;
      }
      if (this.ids[i] !== g.id) {
        // New in this slot: no last position to ease from.
        this.ids[i] = g.id;
        this.meshes[i]!.geometry = this.geometry(g.item);
        this.meshes[i]!.visible = true;
        this.cur[o] = g.x;
        this.cur[o + 1] = g.y;
        this.cur[o + 2] = g.z;
      }
      this.prev[o] = this.cur[o]!;
      this.prev[o + 1] = this.cur[o + 1]!;
      this.prev[o + 2] = this.cur[o + 2]!;
      this.cur[o] = g.x;
      this.cur[o + 1] = g.y;
      this.cur[o + 2] = g.z;
      this.resting[i] = g.resting ? 1 : 0;
    }
  }

  /** Call after each tick, with the sim's smoke clouds: they change slowly, so per tick. */
  tickSmokes(smokes: readonly Smoke[]): void {
    for (let i = 0; i < SMOKES; i++) {
      const cloud = this.smokes[i]!;
      const s = smokes[i];
      if (!s) {
        if (cloud[0]!.visible) for (const p of cloud) p.visible = false;
        continue;
      }
      const r = smokeRadius(s);
      const fade = Math.min(1, Math.max(0, s.time - s.age) / GRENADE.smokeFade);
      cloud[0]!.material.opacity = SMOKE_OPACITY * fade;
      for (let k = 0; k < PUFFS.length; k++) {
        const [px, py, pz, size] = PUFFS[k]!;
        const p = cloud[k]!;
        p.position.set(s.x + px * r, s.y + py * r, s.z + pz * r);
        p.scale.setScalar(2 * r * size);
        p.visible = true;
      }
    }
  }

  /**
   * A grenade going off at (x, y, z) with this radius: a fireball and shockwave, a flash's
   * burst, or for smoke nothing (its cloud comes from the sim's smokes).
   */
  explode(
    now: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    effect: GrenadeEffect,
  ): void {
    if (effect === 'smoke') return;
    const f = this.fireballs[this.nextFire]!;
    const flash = effect === 'flash';
    this.fireEnds[this.nextFire] = now + (flash ? FLASH_MS : FIREBALL_MS);
    this.fireFlash[this.nextFire] = flash ? 1 : 0;
    this.nextFire = (this.nextFire + 1) % FIREBALLS;
    f.position.set(x, y + (flash ? 0.1 : 0.3), z);
    f.visible = true;
    if (flash) return;

    const w = this.waves[this.nextWave]!;
    this.waveEnds[this.nextWave] = now + WAVE_MS;
    this.waveRadius[this.nextWave] = radius;
    this.nextWave = (this.nextWave + 1) % WAVES;
    // On the floor under it: the ground, or what it lies on.
    w.position.set(x, this.world.groundAt(x, z, 0, y + 0.5) + WAVE_LIFT, z);
    w.visible = true;
  }

  /** Call every frame: alpha is how far between the last two ticks. */
  update(now: number, alpha: number): void {
    const spin = (now / 1000) * SPIN * Math.PI * 2;
    for (let i = 0; i < GRENADES; i++) {
      if (this.ids[i]! < 0) continue;
      const m = this.meshes[i]!;
      const o = i * 3;
      const p = this.prev;
      const c = this.cur;
      m.position.set(
        p[o]! + (c[o]! - p[o]!) * alpha,
        p[o + 1]! + (c[o + 1]! - p[o + 1]!) * alpha,
        p[o + 2]! + (c[o + 2]! - p[o + 2]!) * alpha,
      );
      if (!this.resting[i]) m.rotation.set(spin, spin * 0.6, 0);
    }

    for (let i = 0; i < FIREBALLS; i++) {
      const end = this.fireEnds[i]!;
      if (end === 0) continue;
      const f = this.fireballs[i]!;
      const flash = this.fireFlash[i] === 1;
      const t = 1 - Math.max(0, (end - now) / (flash ? FLASH_MS : FIREBALL_MS));
      if (t >= 1) {
        this.fireEnds[i] = 0;
        f.visible = false;
        continue;
      }
      // Fast out, then holding while it cools and fades.
      const size = flash ? FLASH_SIZE : FIREBALL_SIZE;
      f.scale.setScalar(size * (0.25 + 0.75 * (1 - (1 - t) ** 3)));
      f.material.color.lerpColors(flash ? FLASH_HOT : FIRE_HOT, flash ? FLASH_COOL : FIRE_COOL, t);
      f.material.opacity = 1 - t * t;
    }

    for (let i = 0; i < WAVES; i++) {
      const end = this.waveEnds[i]!;
      if (end === 0) continue;
      const w = this.waves[i]!;
      const age = WAVE_MS - (end - now);
      if (age >= WAVE_MS) {
        this.waveEnds[i] = 0;
        w.visible = false;
        continue;
      }
      const out = Math.min(1, age / WAVE_OUT_MS);
      w.scale.setScalar(this.waveRadius[i]! * (0.1 + 0.9 * (1 - (1 - out) ** 2)));
      // Full until it reaches the radius, then fading where it stands.
      w.material.opacity =
        age < WAVE_OUT_MS ? 1 : 1 - (age - WAVE_OUT_MS) / (WAVE_MS - WAVE_OUT_MS);
    }
  }

  /** An item's model, centred on its middle so it tumbles about it. */
  private geometry(id: string): THREE.BufferGeometry {
    let g = this.geometries.get(id);
    if (g) return g;
    const b = new TriangleBuilder(false);
    for (const s of modelShapes(itemDef(this.items, id).model)) b.shape(s);
    g = b.build();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    g.translate(
      -(box.min.x + box.max.x) / 2,
      -(box.min.y + box.max.y) / 2,
      -(box.min.z + box.max.z) / 2,
    );
    this.geometries.set(id, g);
    return g;
  }
}

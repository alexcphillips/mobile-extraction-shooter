import { TICK_SECONDS, type EntityId, type SimState } from '@mes/shared';
import * as THREE from 'three';

/** At most this many flames and smoke puffs drawn at once; more are skipped. */
const MAX_FLAMES = 400;
const MAX_SMOKE = 128;

/** The flame sheet: four flame frames, then a glow, side by side, each CELL_W × CELL_H. */
const CELLS = 5;
const FRAMES = 4;
const GLOW = 4;
const CELL_W = 64;
const CELL_H = 128;
/** Flame frames shown a second, each flame offset by its own seed. */
const FPS = 11;

/** Fire on the map at its biggest: a body of flame this tall, licks rising off it, a glow. */
const PATCH_SIZE = 1.1;
const PATCH_LICKS = 3;
/** Licks rise off the fire this many times a second, each this high (in its sizes). */
const LICK_RATE = 1.5;
const LICK_RISE = 0.5;
/** It grows in over this long, and dies away over its last this many seconds. */
const PATCH_GROW = 0.25;
const PATCH_FADE = 1.5;
/** Smoke puffs over each fire, rising this many times a second, this high, drifting. */
const PATCH_SMOKE = 2;
const SMOKE_RATE = 0.3;
const SMOKE_RISE = 2.6;
const SMOKE_DRIFT = 0.5;
const SMOKE_OPACITY = 0.4;
/** A flame in flight starts this big and grows to this at its range, as it spreads. */
const FLIGHT_MIN = 0.4;
const FLIGHT_MAX = 1.1;
/** About a flamethrower's range: a flame with this far left to go is at its smallest. */
const FLIGHT_RANGE = 15;
/** Someone alight: a flame at each of these heights up their body, and this tall. */
const BODY_AT = [0.2, 0.75, 1.25] as const;
const BODY_SIZE = 0.7;
/** Flames are this wide for their height (a cell is half as wide as it is tall). */
const WIDTH = 0.5;
/**
 * How much a flame hides what's behind it: below 1, the rest of its colour adds to the
 * scene, so it glows rather than looking pasted on, yet still reads in daylight.
 */
const COVER = 0.7;
/**
 * Flames and smoke closer to the camera than NEAR aren't drawn, and fade in out to FAR:
 * that close they'd cover the screen many times over (slow on a phone), and you're in the
 * fire anyway, which the HUD shows.
 */
const NEAR = 0.8;
const FAR = 2;
/**
 * An incendiary round's burst of fire where it lands (2026-10-31): at most this many at
 * once (the oldest goes), each lasting this long and this tall at its biggest.
 */
const BURSTS = 24;
const BURST_MS = 450;
const BURST_SIZE = 0.55;

/** Flame outlines, one per frame, in a cell's units: the tips lean and split differently. */
const OUTLINES = [
  'M32 8C38 32 56 50 54 84C53 108 44 124 32 124C20 124 10 108 10 86C10 64 22 54 24 36C28 46 30 50 31 54C30 38 28 22 32 8Z',
  'M40 6C40 28 58 46 55 80C53 106 45 124 32 124C19 124 9 106 11 84C13 66 20 58 20 42C25 50 27 56 29 60C30 42 38 28 40 6Z',
  'M24 10C22 32 8 50 10 82C11 108 20 124 32 124C45 124 55 108 53 84C51 64 42 56 42 40C38 48 36 54 34 58C34 40 28 26 24 10Z',
  'M22 16C26 36 16 52 14 78C12 106 21 124 32 124C44 124 54 106 51 80C49 60 44 48 46 24C40 38 38 48 35 58C33 46 28 32 22 16Z',
];
/** Each frame's white-hot core is the same teardrop, shifted with the flame's lean. */
const CORE =
  'M32 62C38 76 44 88 43 102C42 114 38 122 32 122C26 122 21 114 21 104C21 90 27 78 32 62Z';
const CORE_SHIFT = [0, 3, -3, 0];

/** The defs every flame shares: its colours up its height, its core, and soft edges. */
const FLAME_DEFS = `
    <linearGradient id="body" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#fff2b8"/>
      <stop offset="0.25" stop-color="#ffc040"/>
      <stop offset="0.55" stop-color="#ff7417" stop-opacity="0.95"/>
      <stop offset="0.82" stop-color="#d93a0c" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#9a1c06" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="core" cx="0.5" cy="0.72" r="0.6">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.5" stop-color="#fff4b4" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#ffd458" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.8"/>
    </filter>`;

/** One flame: the body, then its core over it, blurred at the edges unless sharp. */
const flame = (i: number, dx = 0, sharp = false): string =>
  `<g transform="translate(${dx} 0)"${sharp ? '' : ' filter="url(#soft)"'}>` +
  `<path fill="url(#body)" d="${OUTLINES[i]}"/>` +
  `<path fill="url(#core)" transform="translate(${CORE_SHIFT[i]} 0)" d="${CORE}"/></g>`;

/**
 * A single flame as an SVG (2026-10-31; softer and more lifelike the same day, at the
 * user's request): orange fading to red and clear at its tips, a white-hot core low down.
 * The HUD shows it along the bottom of the screen while you're on fire, without the blur
 * the 3D flames have: a browser may draw a blurred background again every frame, which
 * slowed a burning screen to a crawl.
 */
export const FIRE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CELL_W} ${CELL_H}" width="${CELL_W * 2}" height="${CELL_H * 2}">
  <defs>${FLAME_DEFS}</defs>${flame(0, 0, true)}
</svg>`;

/** The flame sheet: each frame in its cell, then a round glow for the light at a fire's foot. */
const SHEET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CELL_W * CELLS} ${CELL_H}" width="${CELL_W * CELLS * 2}" height="${CELL_H * 2}">
  <defs>${FLAME_DEFS}
    <radialGradient id="glow" cx="${GLOW * CELL_W + 32}" cy="100" r="30" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffb347" stop-opacity="0.6"/>
      <stop offset="0.5" stop-color="#ff7a24" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#ff5a10" stop-opacity="0"/>
    </radialGradient>
  </defs>
  ${OUTLINES.map((_, i) => flame(i, i * CELL_W)).join('')}
  <rect x="${GLOW * CELL_W}" y="60" width="${CELL_W}" height="${CELL_H - 60}" fill="url(#glow)"/>
</svg>`;

/** Smoke as an SVG: a soft dark puff, clear at the edge, so puffs blend into a column. */
const SMOKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128" width="128" height="128">
  <defs>
    <radialGradient id="p">
      <stop offset="0" stop-color="#4a4541" stop-opacity="0.9"/>
      <stop offset="0.6" stop-color="#3c3734" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#36322f" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle r="62" fill="url(#p)"/>
  <circle cx="-16" cy="-12" r="36" fill="url(#p)"/>
  <circle cx="18" cy="8" r="32" fill="url(#p)"/>
</svg>`;

function svgTexture(svg: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A basic material for camera-facing squares with two per-instance values: aFrame, which
 * cell of a sheet `cells` wide to show, and aFade, 0 to 1. A glow is drawn premultiplied
 * and only partly covering (COVER), so its colour adds to what's behind it.
 */
function spriteMaterial(map: THREE.Texture, cells: number, glow: boolean): THREE.Material {
  const m = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  if (glow) {
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
  }
  m.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float aFrame;\nattribute float aFade;\nvarying float vFade;\n' +
      shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\nvMapUv.x = (vMapUv.x + aFrame) / ${cells.toFixed(1)};\nvFade = aFade;`,
      );
    shader.fragmentShader =
      'varying float vFade;\n' +
      shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        glow
          ? `#include <dithering_fragment>\ngl_FragColor.a *= vFade;\ngl_FragColor.rgb *= gl_FragColor.a;\ngl_FragColor.a *= ${COVER.toFixed(2)};`
          : '#include <dithering_fragment>\ngl_FragColor.a *= vFade;',
      );
  };
  m.customProgramCacheKey = () => `fire-sprite-${cells}-${glow}`;
  return m;
}

/** One instanced kind of sprite: its mesh, standing squares, with a frame and fade each. */
class Sprites {
  readonly mesh: THREE.InstancedMesh;
  private readonly frame: THREE.InstancedBufferAttribute;
  private readonly fade: THREE.InstancedBufferAttribute;
  n = 0;

  constructor(
    material: THREE.Material,
    private readonly max: number,
  ) {
    // Standing on its bottom edge, so what's drawn on it rises from where it's put.
    const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    this.frame = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    g.setAttribute('aFrame', this.frame);
    g.setAttribute('aFade', this.fade);
    this.mesh = new THREE.InstancedMesh(g, material, max);
    this.mesh.count = 0;
    // The instances are all over the map; their bounds are never worked out.
    this.mesh.frustumCulled = false;
  }

  get full(): boolean {
    return this.n >= this.max;
  }

  add(m: THREE.Matrix4, frame: number, fade: number): void {
    this.mesh.setMatrixAt(this.n, m);
    this.frame.setX(this.n, frame);
    this.fade.setX(this.n, fade);
    this.n++;
  }

  finish(): void {
    this.mesh.count = this.n;
    if (this.n === 0) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.frame.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}

/** A steady pseudo-random 0..1 from a number, so each flame keeps its own pace. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

const fract = (x: number): number => x - Math.floor(x);

/**
 * Fire (2026-10-31; made more lifelike the same day, at the user's request): flamethrower
 * flames in flight, fire burning on the map, and anyone alight. Every flame is a
 * camera-facing square from one sheet of SVG frames: soft-edged flames, orange to red and
 * clear at the tips around a white-hot core, flipping between four frames at its own pace
 * and glowing onto what's behind (drawn premultiplied, partly covering). Fire on the map
 * is a body of flame with a glow at its foot, licks of flame rising off it and fading, and
 * dark smoke rising and drifting above; someone alight has flames up their body; an
 * incendiary round flares briefly where it lands (burst). All the
 * flames are one draw call and all the smoke another. The player's own fire isn't drawn
 * (it would fill the view): the HUD shows it instead.
 */
export class FireViews {
  readonly root = new THREE.Group();
  private readonly flames: Sprites;
  private readonly smoke: Sprites;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** Each burst's spot and when it ends (0 for none), in a ring. */
  private readonly burstAt = new Float32Array(BURSTS * 3);
  private readonly burstEnds = new Float64Array(BURSTS);
  private nextBurst = 0;

  constructor() {
    this.flames = new Sprites(spriteMaterial(svgTexture(SHEET_SVG), CELLS, true), MAX_FLAMES);
    this.smoke = new Sprites(spriteMaterial(svgTexture(SMOKE_SVG), 1, false), MAX_SMOKE);
    // Smoke first, so flames in front of it glow over it.
    this.smoke.mesh.renderOrder = 2;
    this.flames.mesh.renderOrder = 3;
    this.root.add(this.smoke.mesh, this.flames.mesh);
  }

  /** A burst of fire at (x, y, z): an incendiary round landing, whether or not it sets alight. */
  burst(now: number, x: number, y: number, z: number): void {
    const i = this.nextBurst;
    this.nextBurst = (i + 1) % BURSTS;
    this.burstAt[i * 3] = x;
    this.burstAt[i * 3 + 1] = y;
    this.burstAt[i * 3 + 2] = z;
    this.burstEnds[i] = now + BURST_MS;
  }

  /** Shows a flame and a puff for the start-up draw, so shaders compile then, not mid-raid. */
  warm(on: boolean): void {
    for (const sprites of [this.flames, this.smoke]) {
      sprites.n = 0;
      if (on) {
        this.m.makeTranslation(0, -100, 0);
        sprites.add(this.m, 0, 1);
      }
      sprites.finish();
    }
  }

  /**
   * Call every frame, after the camera has moved: alpha is how far between the last two
   * ticks, for moving flames and people. self is the player, whose own fire isn't drawn.
   */
  update(now: number, alpha: number, sim: SimState, camera: THREE.Camera, self: EntityId): void {
    const t = now / 1000;
    const ahead = alpha * TICK_SECONDS;
    camera.getWorldQuaternion(this.q);
    camera.getWorldPosition(this.eye);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.flames.n = 0;
    this.smoke.n = 0;

    for (const f of sim.flames ?? []) {
      // Bigger the further it's gone, as a stream spreads.
      const spread = 1 - Math.min(1, f.left / FLIGHT_RANGE);
      const size = FLIGHT_MIN + (FLIGHT_MAX - FLIGHT_MIN) * spread;
      const x = f.x + f.vx * ahead;
      const y = f.y + f.vy * ahead - size * 0.45;
      const z = f.z + f.vz * ahead;
      this.flame(x, y, z, size, t, f.id, 1);
      this.glow(x, y, z, size * 1.4, 0.8);
    }

    for (const p of sim.fires ?? []) {
      const grow = Math.min(1, 0.3 + p.age / PATCH_GROW);
      const dying = Math.min(1, Math.max(0, p.time - p.age) / PATCH_FADE);
      if (dying <= 0) continue;
      const size = PATCH_SIZE * grow * (0.5 + 0.5 * dying);
      this.glow(p.x, p.y - size * 0.15, p.z, size * 2, dying);
      this.flame(p.x, p.y, p.z, size, t, p.id, dying);
      this.licks(p.x, p.y, p.z, size, t, p.id, dying, PATCH_LICKS);
      for (let k = 0; k < PATCH_SMOKE; k++) {
        this.puff(p.x, p.y + size * 0.8, p.z, t, p.id * 7 + k, dying);
      }
    }

    for (const c of sim.entities) {
      if (!c.burn || c.health.dead || c.id === self) continue;
      const x = c.x + c.vx * ahead;
      const z = c.z + c.vz * ahead;
      // Shorter while crouched or prone: the flames follow the capsule down.
      const h = c.height / 1.8;
      for (let k = 0; k < BODY_AT.length; k++) {
        const y = c.y + BODY_AT[k]! * h - 0.15;
        this.flame(x, y, z, BODY_SIZE * (k === 1 ? 1.1 : 0.9), t, c.id * 5 + k, 1);
      }
      this.licks(x, c.y + 1.1 * h, z, BODY_SIZE, t, c.id, 1, 2);
      this.puff(x, c.y + 1.7 * h, z, t, c.id * 11, 0.8);
    }

    // Bursts: up fast, then shrinking and fading as they rise a little.
    for (let i = 0; i < BURSTS; i++) {
      const end = this.burstEnds[i]!;
      if (end === 0) continue;
      const left = (end - now) / BURST_MS;
      if (left <= 0) {
        this.burstEnds[i] = 0;
        continue;
      }
      const age = 1 - left;
      const size = BURST_SIZE * Math.min(1, age * 6) * (0.6 + 0.4 * left);
      const x = this.burstAt[i * 3]!;
      const y = this.burstAt[i * 3 + 1]! - size * 0.4 + age * 0.25;
      const z = this.burstAt[i * 3 + 2]!;
      this.glow(x, y, z, size * 1.6, left);
      this.flame(x, y, z, size, t, i + 7, left);
    }

    this.flames.finish();
    this.smoke.finish();
  }

  /** A flame standing at (x, y, z), flipping frames and flickering at its seed's pace. */
  private flame(
    x: number,
    y: number,
    z: number,
    size: number,
    t: number,
    seed: number,
    fade: number,
  ): void {
    if (this.flames.full) return;
    const a = hash(seed) * 10;
    const frame = Math.floor(t * FPS + a * 7) % FRAMES;
    const tall = size * (1 + 0.12 * Math.sin(t * 11 + a) + 0.06 * Math.sin(t * 27 + a * 2));
    const wide = size * WIDTH * (1 + 0.08 * Math.sin(t * 8 + a * 3));
    // Every other one mirrored, so a row of them doesn't look stamped.
    const near = this.place(x, y, z, seed % 2 ? -wide : wide, tall);
    if (near > 0 && fade > 0) this.flames.add(this.m, frame, fade * near);
  }

  /** The light at a fire's foot: a soft round glow. */
  private glow(x: number, y: number, z: number, size: number, fade: number): void {
    if (this.flames.full) return;
    const near = this.place(x, y, z, size * WIDTH * 2, size);
    if (near > 0 && fade > 0) this.flames.add(this.m, GLOW, fade * 0.9 * near);
  }

  /** Small flames breaking off the top of a fire and rising as they shrink and fade. */
  private licks(
    x: number,
    y: number,
    z: number,
    size: number,
    t: number,
    seed: number,
    fade: number,
    n: number,
  ): void {
    for (let k = 0; k < n; k++) {
      const h = hash(seed * 3 + k);
      const phase = fract(t * LICK_RATE * (0.8 + 0.4 * h) + h);
      const sway = (h - 0.5) * size * 0.5 + Math.sin(t * 5 + h * 9) * size * 0.08;
      // From the top half of the body, so they break off it rather than float above.
      const lift = size * (0.35 + phase * LICK_RISE);
      // In fast, out slowly: bright as it breaks off, gone by the top.
      const life = Math.min(1, phase * 6) * (1 - phase);
      this.flame(
        x + this.right.x * sway,
        y + lift,
        z + this.right.z * sway,
        size * (0.5 - phase * 0.3),
        t,
        seed * 13 + k,
        fade * life,
      );
    }
  }

  /** A smoke puff rising from (x, y, z), growing, drifting with the wind and thinning. */
  private puff(x: number, y: number, z: number, t: number, seed: number, fade: number): void {
    if (this.smoke.full) return;
    const phase = fract(t * SMOKE_RATE + hash(seed));
    const size = 0.5 + phase * 1.6;
    const drift = phase * phase * SMOKE_DRIFT;
    const w = seed % 2 ? -size : size;
    const near = this.place(
      x + drift,
      y + phase * SMOKE_RISE - size * 0.5,
      z + drift * 0.4,
      w,
      size,
    );
    const thin = fade * SMOKE_OPACITY * Math.min(1, phase * 4) * (1 - phase) * near;
    if (thin > 0) this.smoke.add(this.m, 0, thin);
  }

  /**
   * The matrix for a square at (x, y, z), w wide and h tall, facing the camera. Returns
   * how much of it to show for being near the camera: 0 (skip it) to 1.
   */
  private place(x: number, y: number, z: number, w: number, h: number): number {
    this.p.set(x, y + Math.abs(h) / 2, z);
    const d = this.p.distanceTo(this.eye);
    this.p.y = y;
    this.s.set(w, h, 1);
    this.m.compose(this.p, this.q, this.s);
    return Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
  }
}

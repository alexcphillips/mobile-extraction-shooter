import * as THREE from 'three';

const TRACERS = 24;
const TRACER_MS = 60;
const IMPACTS = 64;
const IMPACT_MS = 400;
const IMPACT_SIZE = 0.08;
/** Puffs a pane of glass breaks into. */
const SHARDS = 10;
const WORLD_DUST = new THREE.Color(0x6b5f50);
const BLOOD = new THREE.Color(0xb03028);
/** A blast gun's gust (the Gale Cannon, 2026-11-04): its puffs and streaks. */
const GUST = new THREE.Color(0x9fe8e2);
const GUST_PUFFS = 28;
const GUST_STREAKS = 10;
/** A tracer's colour: an ordinary round's, and an incendiary round's (2026-10-31). */
export const TRACER_COLOUR = 0xffe9a0;
export const INCENDIARY_TRACER = 0xff6a1a;

/**
 * Shot tracers and impact puffs, from fixed pools so firing allocates nothing: one line
 * mesh for every tracer (each its own colour) and one instanced mesh for every puff, two
 * draw calls in all.
 */
export class Effects {
  readonly root = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly linePos: Float32Array;
  private readonly lineColour: Float32Array;
  private readonly c = new THREE.Color();
  private readonly tracerEnds = new Float64Array(TRACERS);
  private nextTracer = 0;
  private readonly puffs: THREE.InstancedMesh;
  private readonly puffAt = new Float32Array(IMPACTS * 3);
  private readonly puffEnds = new Float64Array(IMPACTS);
  private nextPuff = 0;
  private readonly m = new THREE.Matrix4();

  constructor() {
    this.linePos = new Float32Array(TRACERS * 6);
    this.lineColour = new Float32Array(TRACERS * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.lineColour, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.lines.frustumCulled = false;

    const box = new THREE.BoxGeometry(IMPACT_SIZE, IMPACT_SIZE, IMPACT_SIZE);
    this.puffs = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), IMPACTS);
    this.puffs.frustumCulled = false;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < IMPACTS; i++) {
      this.puffs.setMatrixAt(i, this.m);
      this.puffs.setColorAt(i, WORLD_DUST);
    }
    this.root.add(this.lines, this.puffs);
  }

  tracer(
    now: number,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colour = TRACER_COLOUR,
  ) {
    const i = this.nextTracer;
    this.nextTracer = (i + 1) % TRACERS;
    const p = this.linePos;
    const o = i * 6;
    p[o] = x0;
    p[o + 1] = y0;
    p[o + 2] = z0;
    p[o + 3] = x1;
    p[o + 4] = y1;
    p[o + 5] = z1;
    this.tracerEnds[i] = now + TRACER_MS;
    this.c.setHex(colour);
    this.c.toArray(this.lineColour, o);
    this.c.toArray(this.lineColour, o + 3);
    this.lines.geometry.attributes.position!.needsUpdate = true;
    this.lines.geometry.attributes.color!.needsUpdate = true;
  }

  impact(now: number, x: number, y: number, z: number, blood: boolean): void {
    const i = this.nextPuff;
    this.nextPuff = (i + 1) % IMPACTS;
    this.puffAt[i * 3] = x;
    this.puffAt[i * 3 + 1] = y;
    this.puffAt[i * 3 + 2] = z;
    this.puffEnds[i] = now + IMPACT_MS;
    this.puffs.setColorAt(i, blood ? BLOOD : WORLD_DUST);
    this.puffs.instanceColor!.needsUpdate = true;
  }

  /**
   * A pane breaking: puffs of its tint scattered over it, from (x0, z0) to (x1, z1) along
   * its width and y0 to y1 up it.
   */
  shatter(
    now: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    colour: number,
  ): void {
    this.c.setHex(colour);
    for (let k = 0; k < SHARDS; k++) {
      const i = this.nextPuff;
      this.nextPuff = (i + 1) % IMPACTS;
      const a = Math.random();
      this.puffAt[i * 3] = x0 + (x1 - x0) * a;
      this.puffAt[i * 3 + 1] = y0 + (y1 - y0) * Math.random();
      this.puffAt[i * 3 + 2] = z0 + (z1 - z0) * a;
      this.puffEnds[i] = now + IMPACT_MS * 2;
      this.puffs.setColorAt(i, this.c);
    }
    this.puffs.instanceColor!.needsUpdate = true;
  }

  /**
   * A blast gun's gust from (x, y, z) along the unit (dx, dy, dz), out to range and spreading
   * to `angle` radians either side: pale puffs scattered through the cone and streaks fanning
   * out, from the same pools as everything else.
   */
  gust(
    now: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    range: number,
    angle: number,
  ): void {
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
    const at = (d: number, a: number, b: number, out: number[]): void => {
      const cp = Math.cos(pitch + b);
      out[0] = x - Math.sin(yaw + a) * cp * d;
      out[1] = y + Math.sin(pitch + b) * d;
      out[2] = z - Math.cos(yaw + a) * cp * d;
    };
    const p = [0, 0, 0];
    for (let k = 0; k < GUST_PUFFS; k++) {
      const i = this.nextPuff;
      this.nextPuff = (i + 1) % IMPACTS;
      const d = range * (0.15 + 0.85 * Math.random());
      at(d, (Math.random() * 2 - 1) * angle, (Math.random() * 2 - 1) * angle * 0.4, p);
      this.puffAt.set(p, i * 3);
      this.puffEnds[i] = now + IMPACT_MS * (1 + Math.random());
      this.puffs.setColorAt(i, GUST);
    }
    this.puffs.instanceColor!.needsUpdate = true;
    for (let k = 0; k < GUST_STREAKS; k++) {
      const a = ((k / (GUST_STREAKS - 1)) * 2 - 1) * angle;
      at(range * (0.5 + 0.5 * Math.random()), a, (Math.random() * 2 - 1) * angle * 0.3, p);
      this.tracer(now, x, y, z, p[0]!, p[1]!, p[2]!, GUST.getHex());
    }
  }

  /** Fades out old tracers and shrinks puffs; call every frame. */
  update(now: number): void {
    let lines = false;
    for (let i = 0; i < TRACERS; i++) {
      const end = this.tracerEnds[i]!;
      if (end > 0 && now >= end) {
        this.tracerEnds[i] = 0;
        // Collapse the segment onto its start.
        this.linePos.copyWithin(i * 6 + 3, i * 6, i * 6 + 3);
        lines = true;
      }
    }
    if (lines) this.lines.geometry.attributes.position!.needsUpdate = true;

    let puffs = false;
    for (let i = 0; i < IMPACTS; i++) {
      const end = this.puffEnds[i]!;
      if (end === 0) continue;
      const left = Math.max(0, (end - now) / IMPACT_MS);
      if (left === 0) this.puffEnds[i] = 0;
      this.m.makeScale(left, left, left);
      this.m.setPosition(this.puffAt[i * 3]!, this.puffAt[i * 3 + 1]!, this.puffAt[i * 3 + 2]!);
      this.puffs.setMatrixAt(i, this.m);
      puffs = true;
    }
    if (puffs) this.puffs.instanceMatrix.needsUpdate = true;
  }
}

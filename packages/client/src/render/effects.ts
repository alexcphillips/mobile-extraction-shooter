import * as THREE from 'three';

const TRACERS = 24;
const TRACER_MS = 60;
const IMPACTS = 32;
const IMPACT_MS = 400;
const IMPACT_SIZE = 0.08;
const WORLD_DUST = new THREE.Color(0x6b5f50);
const BLOOD = new THREE.Color(0xb03028);
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

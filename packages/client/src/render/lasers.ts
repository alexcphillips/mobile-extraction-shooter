import * as THREE from 'three';

/** The most lasers drawn at once; any past this aren't drawn that frame. */
const MAX = 8;
/** How bright the beam is where it leaves. */
const BEAM_ALPHA = 0.35;
/**
 * How it fades along its length: its brightness (a share of BEAM_ALPHA) at each distance
 * from the lens (m), steeply, so it's bright only near the gun and gone by the last.
 */
const FADE_AT = [0, 0.6, 1.8, 4.5] as const;
const FADE_TO = [1, 0.4, 0.12, 0] as const;
const BEAM_FADE = FADE_AT[FADE_AT.length - 1]!;
/** Cross-sections along a beam, a segment between each pair. */
const SECTIONS = FADE_AT.length;
const BEAM_VERTS = SECTIONS * 2;
const BEAM_INDICES = (SECTIONS - 1) * 6;
/** The beam's half-width where it leaves and where it has faded out (m). */
const BEAM_NEAR = 0.0012;
const BEAM_FAR = 0.004;
/** The dot's radius: a little at any range, and growing with it so it stays visible. */
const DOT_BASE = 0.012;
const DOT_GROW = 0.0015;
/** How far the dot sits off the surface, towards the camera, so it never sinks in. */
const DOT_LIFT = 0.02;
const DOT_SIDES = 8;

const BEAM_RED = [1, 0.12, 0.1] as const;
const DOT_CORE = [1, 0.35, 0.3] as const;
const DOT_EDGE = [1, 0.05, 0.05] as const;

const material = (): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

function dynamicGeometry(verts: number, index: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array(verts * 4), 4);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos);
  g.setAttribute('color', col);
  g.setIndex(index);
  g.setDrawRange(0, 0);
  return g;
}

/** Writes vertex i's position and color. */
function setVertex(
  pos: Float32Array,
  col: Float32Array,
  i: number,
  x: number,
  y: number,
  z: number,
  rgb: readonly [number, number, number],
  a: number,
): void {
  pos[i * 3] = x;
  pos[i * 3 + 1] = y;
  pos[i * 3 + 2] = z;
  col[i * 4] = rgb[0];
  col[i * 4 + 1] = rgb[1];
  col[i * 4 + 2] = rgb[2];
  col[i * 4 + 3] = a;
}

/** The beam's brightness (0–1) at a distance from the lens, between the fade's points. */
function fadeAt(t: number): number {
  for (let k = 1; k < SECTIONS; k++) {
    const at = FADE_AT[k]!;
    if (t <= at) {
      const from = FADE_AT[k - 1]!;
      const u = (t - from) / (at - from);
      return FADE_TO[k - 1]! + (FADE_TO[k]! - FADE_TO[k - 1]!) * u;
    }
  }
  return 0;
}

const side = new THREE.Vector3();
const toEye = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

/**
 * Laser beams and their dots, in the world so walls hide them: a faint beam from the
 * laser that fades out within a few meters, and a dot where it lands. Every laser drawn in
 * a frame goes in one mesh for beams and one for dots, refilled each frame between begin
 * and end, so they cost two draw calls however many there are.
 */
export class Lasers {
  readonly root = new THREE.Group();
  private readonly beams: THREE.Mesh;
  private readonly dots: THREE.Mesh;
  private readonly eye = new THREE.Vector3();
  private beamCount = 0;
  private dotCount = 0;

  constructor() {
    const beamIndex: number[] = [];
    // Each cross-section k is vertices 2k (one side) and 2k + 1 (the other).
    for (let i = 0; i < MAX; i++) {
      for (let k = 0; k < SECTIONS - 1; k++) {
        const o = i * BEAM_VERTS + k * 2;
        beamIndex.push(o, o + 1, o + 3, o, o + 3, o + 2);
      }
    }
    const dotIndex: number[] = [];
    for (let i = 0; i < MAX; i++) {
      const o = i * (DOT_SIDES + 1);
      for (let s = 0; s < DOT_SIDES; s++)
        dotIndex.push(o, o + 1 + s, o + 1 + ((s + 1) % DOT_SIDES));
    }
    this.beams = new THREE.Mesh(dynamicGeometry(MAX * BEAM_VERTS, beamIndex), material());
    this.dots = new THREE.Mesh(dynamicGeometry(MAX * (DOT_SIDES + 1), dotIndex), material());
    for (const m of [this.beams, this.dots]) {
      m.frustumCulled = false;
      this.root.add(m);
    }
  }

  /** Starts a frame's lasers, seen from this camera. */
  begin(camera: THREE.Camera): void {
    this.beamCount = 0;
    this.dotCount = 0;
    camera.getWorldPosition(this.eye);
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
  }

  /**
   * A laser from (sx, sy, sz) along a unit direction, landing at distance d (Infinity if
   * it lands on nothing in range); beam false leaves the beam out and draws only the dot.
   */
  add(
    sx: number,
    sy: number,
    sz: number,
    dx: number,
    dy: number,
    dz: number,
    d: number,
    beam = true,
  ): void {
    if (beam) this.addBeam(sx, sy, sz, dx, dy, dz, Math.min(d, BEAM_FADE));
    if (d < Infinity) this.addDot(sx + dx * d, sy + dy * d, sz + dz * d);
  }

  /**
   * A beam from (sx, sy, sz) along a unit direction, len long: a strip facing the eye with
   * a cross-section at each fade distance, cut short where it lands.
   */
  private addBeam(
    sx: number,
    sy: number,
    sz: number,
    dx: number,
    dy: number,
    dz: number,
    len: number,
  ): void {
    if (this.beamCount >= MAX || len <= 0) return;
    const g = this.beams.geometry;
    const pos = g.attributes.position!.array as Float32Array;
    const col = g.attributes.color!.array as Float32Array;
    const o = this.beamCount++ * BEAM_VERTS;
    for (let k = 0; k < SECTIONS; k++) {
      // Past where it lands, the rest collapse onto that point, at its brightness there.
      const t = Math.min(FADE_AT[k]!, len);
      const w = BEAM_NEAR + (BEAM_FAR - BEAM_NEAR) * (t / BEAM_FADE);
      const a = BEAM_ALPHA * fadeAt(t);
      this.section(pos, col, o + k * 2, sx + dx * t, sy + dy * t, sz + dz * t, dx, dy, dz, w, a);
    }
  }

  /**
   * One cross-section of a beam's strip: vertices i and i + 1, either side of (x, y, z) by
   * w, across the beam and across the line to the eye.
   */
  private section(
    pos: Float32Array,
    col: Float32Array,
    i: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    w: number,
    a: number,
  ): void {
    toEye.set(this.eye.x - x, this.eye.y - y, this.eye.z - z);
    side.set(dx, dy, dz).cross(toEye).normalize().multiplyScalar(w);
    setVertex(pos, col, i, x - side.x, y - side.y, z - side.z, BEAM_RED, a);
    setVertex(pos, col, i + 1, x + side.x, y + side.y, z + side.z, BEAM_RED, a);
  }

  /** A soft round dot facing the eye, lifted off the surface towards it. */
  private addDot(x: number, y: number, z: number): void {
    if (this.dotCount >= MAX) return;
    toEye.set(this.eye.x - x, this.eye.y - y, this.eye.z - z);
    const dist = toEye.length();
    if (dist > 1e-3) toEye.multiplyScalar(Math.min(DOT_LIFT, dist * 0.5) / dist);
    x += toEye.x;
    y += toEye.y;
    z += toEye.z;
    const r = DOT_BASE + dist * DOT_GROW;
    const g = this.dots.geometry;
    const pos = g.attributes.position!.array as Float32Array;
    const col = g.attributes.color!.array as Float32Array;
    const o = this.dotCount++ * (DOT_SIDES + 1);
    setVertex(pos, col, o, x, y, z, DOT_CORE, 1);
    for (let s = 0; s < DOT_SIDES; s++) {
      const t = (s / DOT_SIDES) * Math.PI * 2;
      const c = Math.cos(t) * r;
      const n = Math.sin(t) * r;
      const px = x + right.x * c + up.x * n;
      const py = y + right.y * c + up.y * n;
      const pz = z + right.z * c + up.z * n;
      setVertex(pos, col, o + 1 + s, px, py, pz, DOT_EDGE, 0);
    }
  }

  /** Ends the frame: draws what was added since begin. */
  end(): void {
    const finish = (m: THREE.Mesh, count: number, perIndex: number): void => {
      const g = m.geometry;
      g.setDrawRange(0, count * perIndex);
      m.visible = count > 0;
      if (!count) return;
      g.attributes.position!.needsUpdate = true;
      g.attributes.color!.needsUpdate = true;
    };
    finish(this.beams, this.beamCount, BEAM_INDICES);
    finish(this.dots, this.dotCount, DOT_SIDES * 3);
  }
}

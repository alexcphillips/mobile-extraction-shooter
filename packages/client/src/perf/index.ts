import {
  CollisionWorld,
  FixedTimestep,
  HeightGrid,
  TICK_SECONDS,
  createRng,
  createState,
  eyeHeight,
  nextFloat,
  spawnCharacter,
  step,
  type PlayerInput,
  type TickInputs,
} from '@mes/shared';
import * as THREE from 'three';
import { cloneCharacter, loadCharacter } from './characters';
import { Controls } from '../input/controls';
import type { PerfParams } from './params';
import { Stats } from '../debug/stats';
import { buildChunks } from '../render/map';
import { GRASS, boxShapes, makeBoxes, makeTerrain } from './world';

const SKY = 0x9fb3c8;
const EYE = 1.6;
const WANDER_RADIUS = 35;
const AIM_RANGE = 100;
const STRESS_RANGE = 60;

export interface PerfElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  status: HTMLElement;
  stick: HTMLElement;
  knob: HTMLElement;
  crosshair: HTMLElement;
  jump: HTMLElement;
  crouch: HTMLElement;
}

interface Wanderer {
  object: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  tx: number;
  tz: number;
  speed: number;
  heading: number;
}

/**
 * Session 2's go/no-go scene: merged chunks, fog, animated characters wandering,
 * raycasts every tick, touch move and look, and an FPS counter. The player moves with the
 * shared simulation; the movement playground from session 3 is now in the test map.
 */
export async function startPerfTest(el: PerfElements, params: PerfParams): Promise<void> {
  const renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    antialias: params.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(params.pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, params.fogFar * 0.4, params.fogFar);
  // The far plane follows the fog distance.
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, params.fogFar);
  camera.rotation.order = 'YXZ';

  const terrainDef = makeTerrain();
  const boxes = makeBoxes(params.boxes, 1, new HeightGrid(terrainDef));
  const world = new CollisionWorld({ terrain: terrainDef, boxes, ramps: [], ladders: [] });
  const terrain = world.terrain;
  scene.add(buildChunks(terrainDef, GRASS, boxShapes(boxes, 1)));

  const r = createRng(2);
  const rng = (): number => nextFloat(r);
  const controls = new Controls(el.canvas, el.stick, el.knob, el.jump, el.crouch);
  const sim = createState(1);
  const player = spawnCharacter(sim, world, 0, 0);
  const input: PlayerInput = {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    crouch: false,
    jump: false,
  };
  const inputs: TickInputs = { [player.id]: input };
  // The player's eye at the previous and latest tick, for interpolation.
  const prevEye = new THREE.Vector3(player.x, eyeHeight(player), player.z);
  const eye = prevEye.clone();

  const wanderers: Wanderer[] = [];
  let charTris = 0;
  try {
    el.status.textContent = 'loading character…';
    const template = await loadCharacter('/perf/robot-expressive.glb');
    charTris = template.triangles;
    const walk = template.clips.get('Walking');
    const run = template.clips.get('Running');
    for (let i = 0; i < params.chars; i++) {
      const object = cloneCharacter(template);
      const mixer = new THREE.AnimationMixer(object);
      const running = i % 3 === 0;
      const clip = running ? run : walk;
      if (clip) mixer.clipAction(clip).play().time = rng() * clip.duration;
      const a = rng() * Math.PI * 2;
      const d = 8 + rng() * 20;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      scene.add(object);
      wanderers.push({
        object,
        mixer,
        x,
        z,
        prevX: x,
        prevZ: z,
        tx: x,
        tz: z,
        speed: running ? 4 : 1.4,
        heading: 0,
      });
    }
    el.status.textContent = '';
  } catch (err) {
    el.status.textContent = `character failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Per-tick results, shown in the stats line.
  let aimDist = Infinity;
  let seenBy = 0;
  let rayCount = 0;
  const raysPerTick = 1 + wanderers.length + params.rays;
  const stats = new Stats(
    el.stats,
    renderer,
    `boxes ${params.boxes}  chars ${wanderers.length} (${charTris} tris each)  rays/tick ${raysPerTick}  fog ${params.fogFar}  aa ${params.antialias ? 'on' : 'off'}`,
    () =>
      `aim ${aimDist === Infinity ? '—' : `${aimDist.toFixed(1)} m`}  seen by ${seenBy}/${wanderers.length}  rays ${rayCount}\n` +
      `${player.mode}${player.height < 1.79 ? ' crouched' : ''}  y ${player.y.toFixed(2)}  ` +
      `speed ${Math.hypot(player.vx, player.vz).toFixed(1)} m/s`,
  );

  function tick(): void {
    const t0 = performance.now();
    controls.update();

    input.moveX = controls.moveX;
    input.moveY = controls.moveY;
    input.yaw = controls.yaw;
    input.pitch = controls.pitch;
    input.sprint = controls.sprint;
    input.crouch = controls.crouch;
    input.jump = controls.jump;
    prevEye.copy(eye);
    step(sim, world, inputs);
    eye.set(player.x, eyeHeight(player), player.z);

    for (const w of wanderers) {
      w.prevX = w.x;
      w.prevZ = w.z;
      let dx = w.tx - w.x;
      let dz = w.tz - w.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.5) {
        const a = rng() * Math.PI * 2;
        const wr = rng() * WANDER_RADIUS;
        w.tx = Math.cos(a) * wr;
        w.tz = Math.sin(a) * wr;
        dx = w.tx - w.x;
        dz = w.tz - w.z;
        d = Math.hypot(dx, dz);
      }
      const stepLen = Math.min(d, w.speed * TICK_SECONDS);
      w.x += (dx / d) * stepLen;
      w.z += (dz / d) * stepLen;
      w.heading = Math.atan2(dx, dz);
    }

    // Raycasts: the aim ray, each character's line of sight to the player, then stress rays.
    rayCount = 0;
    const sy = Math.sin(controls.yaw);
    const cy = Math.cos(controls.yaw);
    const cp = Math.cos(controls.pitch);
    aimDist = world.raycast(
      eye.x,
      eye.y,
      eye.z,
      -sy * cp,
      Math.sin(controls.pitch),
      -cy * cp,
      AIM_RANGE,
    );
    rayCount++;
    seenBy = 0;
    for (const w of wanderers) {
      const hy = terrain.heightAt(w.x, w.z) + EYE;
      const dx = eye.x - w.x;
      const dy = eye.y - hy;
      const dz = eye.z - w.z;
      const d = Math.hypot(dx, dy, dz);
      if (world.raycast(w.x, hy, w.z, dx / d, dy / d, dz / d, d) === Infinity) seenBy++;
      rayCount++;
    }
    for (let i = 0; i < params.rays; i++) {
      const a = rng() * Math.PI * 2;
      const e = (rng() - 0.5) * 0.4;
      const ce = Math.cos(e);
      const ox = eye.x + (rng() - 0.5) * 60;
      const oz = eye.z + (rng() - 0.5) * 60;
      world.raycast(
        ox,
        terrain.heightAt(ox, oz) + EYE,
        oz,
        Math.cos(a) * ce,
        Math.sin(e),
        Math.sin(a) * ce,
        STRESS_RANGE,
      );
      rayCount++;
    }
    stats.tick(performance.now() - t0);
  }

  let crosshairHit = false;
  function render(alpha: number, dt: number): void {
    camera.position.lerpVectors(prevEye, eye, alpha);
    // Look is applied every frame, not every tick, so turning never lags.
    camera.rotation.set(controls.pitch, controls.yaw, 0);

    for (const w of wanderers) {
      const x = w.prevX + (w.x - w.prevX) * alpha;
      const z = w.prevZ + (w.z - w.prevZ) * alpha;
      w.object.position.set(x, terrain.heightAt(x, z), z);
      w.object.rotation.y = w.heading;
      w.mixer.update(dt);
    }

    const hit = aimDist !== Infinity;
    if (hit !== crosshairHit) {
      crosshairHit = hit;
      el.crosshair.classList.toggle('hit', hit);
    }
    renderer.render(scene, camera);
  }

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = el.canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Draw everything once now, so geometry uploads and shader compiles happen here,
  // not as a hitch the first time something comes into view.
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  renderer.render(scene, camera);
  for (const o of culled) o.frustumCulled = true;

  const loop = new FixedTimestep();
  let last = -1;
  renderer.setAnimationLoop((time) => {
    const t0 = performance.now();
    const dtMs = last < 0 ? 16.7 : time - last;
    last = time;
    const alpha = loop.advance(dtMs / 1000, tick);
    render(alpha, dtMs / 1000);
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

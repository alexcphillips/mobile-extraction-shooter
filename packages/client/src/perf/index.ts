import { TICK_SECONDS } from '@mes/shared';
import * as THREE from 'three';
import { cloneCharacter, loadCharacter } from './characters';
import { Controls } from './controls';
import type { PerfParams } from './params';
import { BoxGrid } from './raycast';
import { makeRng } from './shade';
import { Stats } from './stats';
import { WORLD_MIN, WORLD_SIZE, buildWorld, makeBoxes, terrainHeight } from './world';

const SKY = 0x9fb3c8;
const EYE = 1.6;
const WALK = 3.5;
const SPRINT = 6;
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
 * raycasts every tick, touch move and look, and an FPS counter.
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

  const boxes = makeBoxes(params.boxes, 1);
  const world = buildWorld(boxes, 1);
  scene.add(world);
  const grid = new BoxGrid(boxes, WORLD_MIN, WORLD_MIN, WORLD_SIZE, 8);

  const rng = makeRng(2);
  const controls = new Controls(el.canvas, el.stick, el.knob);
  const player = { x: 0, z: 0, prevX: 0, prevZ: 0 };

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
      const r = 8 + rng() * 20;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
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
      `aim ${aimDist === Infinity ? '—' : `${aimDist.toFixed(1)} m`}  seen by ${seenBy}/${wanderers.length}  rays ${rayCount}`,
  );

  function tick(): void {
    const t0 = performance.now();
    controls.update();

    player.prevX = player.x;
    player.prevZ = player.z;
    const speed = controls.sprint ? SPRINT : WALK;
    const sy = Math.sin(controls.yaw);
    const cy = Math.cos(controls.yaw);
    // Forward is -Z rotated by yaw; right is +X rotated by yaw.
    player.x += (-sy * controls.moveY + cy * controls.moveX) * speed * TICK_SECONDS;
    player.z += (-cy * controls.moveY - sy * controls.moveX) * speed * TICK_SECONDS;
    const lim = WORLD_SIZE / 2 - 1;
    player.x = Math.max(-lim, Math.min(lim, player.x));
    player.z = Math.max(-lim, Math.min(lim, player.z));
    const eyeY = terrainHeight(player.x, player.z) + EYE;

    for (const w of wanderers) {
      w.prevX = w.x;
      w.prevZ = w.z;
      let dx = w.tx - w.x;
      let dz = w.tz - w.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.5) {
        const a = rng() * Math.PI * 2;
        const r = rng() * WANDER_RADIUS;
        w.tx = Math.cos(a) * r;
        w.tz = Math.sin(a) * r;
        dx = w.tx - w.x;
        dz = w.tz - w.z;
        d = Math.hypot(dx, dz);
      }
      const step = Math.min(d, w.speed * TICK_SECONDS);
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
      w.heading = Math.atan2(dx, dz);
    }

    // Raycasts: the aim ray, each character's line of sight to the player, then stress rays.
    rayCount = 0;
    const cp = Math.cos(controls.pitch);
    aimDist = grid.raycast(
      player.x,
      eyeY,
      player.z,
      -sy * cp,
      Math.sin(controls.pitch),
      -cy * cp,
      AIM_RANGE,
    );
    rayCount++;
    seenBy = 0;
    for (const w of wanderers) {
      const hy = terrainHeight(w.x, w.z) + EYE;
      const dx = player.x - w.x;
      const dy = eyeY - hy;
      const dz = player.z - w.z;
      const d = Math.hypot(dx, dy, dz);
      if (grid.raycast(w.x, hy, w.z, dx / d, dy / d, dz / d, d) === Infinity) seenBy++;
      rayCount++;
    }
    for (let i = 0; i < params.rays; i++) {
      const a = rng() * Math.PI * 2;
      const e = (rng() - 0.5) * 0.4;
      const ce = Math.cos(e);
      const ox = player.x + (rng() - 0.5) * 60;
      const oz = player.z + (rng() - 0.5) * 60;
      grid.raycast(
        ox,
        terrainHeight(ox, oz) + EYE,
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
    const px = player.prevX + (player.x - player.prevX) * alpha;
    const pz = player.prevZ + (player.z - player.prevZ) * alpha;
    camera.position.set(px, terrainHeight(px, pz) + EYE, pz);
    camera.rotation.set(controls.pitch, controls.yaw, 0);

    for (const w of wanderers) {
      const x = w.prevX + (w.x - w.prevX) * alpha;
      const z = w.prevZ + (w.z - w.prevZ) * alpha;
      w.object.position.set(x, terrainHeight(x, z), z);
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

  let last = -1;
  let acc = 0;
  renderer.setAnimationLoop((time) => {
    const t0 = performance.now();
    const dtMs = last < 0 ? 16.7 : time - last;
    last = time;
    // Clamp so a backgrounded tab doesn't run thousands of ticks on return.
    acc += Math.min(dtMs / 1000, 0.25);
    while (acc >= TICK_SECONDS) {
      tick();
      acc -= TICK_SECONDS;
    }
    render(acc / TICK_SECONDS, dtMs / 1000);
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

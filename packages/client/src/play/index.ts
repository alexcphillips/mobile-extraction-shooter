import {
  CollisionWorld,
  FixedTimestep,
  createRng,
  createState,
  eyeHeight,
  pick,
  spawnCharacter,
  step,
  type PlayerInput,
  type TickInputs,
} from '@mes/shared';
import * as THREE from 'three';
import { loadMap } from '../content';
import { Stats } from '../debug/stats';
import { Controls } from '../input/controls';
import { buildDebug } from '../render/debug';
import { buildMap } from '../render/map';

export interface PlayElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  stick: HTMLElement;
  knob: HTMLElement;
  jump: HTMLElement;
  crouch: HTMLElement;
}

export interface PlayOptions {
  map: string;
  /** A player spawn's id; otherwise one is picked at random. */
  spawn: string | null;
  /** Show markers and zones. */
  debug: boolean;
  pixelRatio: number;
}

/**
 * Walks around a map from content/ with the shared simulation. A stand-in for the raid
 * until sessions 5–11 build the HUD, combat and raid lifecycle.
 */
export function startPlay(el: PlayElements, options: PlayOptions): void {
  const map = loadMap(options.map);
  const world = new CollisionWorld(map.world);

  const renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(options.pixelRatio);
  const { sky, fogNear, fogFar } = map.environment;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, fogNear, fogFar);
  // The far plane follows the fog distance.
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, fogFar);
  camera.rotation.order = 'YXZ';

  scene.add(buildMap(map).root);
  if (options.debug) scene.add(buildDebug(map, world.terrain));

  const controls = new Controls(el.canvas, el.stick, el.knob, el.jump, el.crouch);
  const sim = createState(Date.now() >>> 0);
  const spawns = map.markers.filter((m) => m.type === 'playerSpawn');
  const spawn =
    spawns.find((m) => m.id === options.spawn) ?? pick(createRng(Date.now() >>> 0), spawns);
  // Below the spawn's height plus a little, so a spawn under a roof stays inside.
  const player = spawnCharacter(sim, world, spawn.x, spawn.z, spawn.yaw, spawn.y + 0.5);
  controls.yaw = spawn.yaw;
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
  const prevEye = new THREE.Vector3(player.x, eyeHeight(player), player.z);
  const eye = prevEye.clone();

  const stats = new Stats(
    el.stats,
    renderer,
    `${map.name}  spawn ${spawn.id}${options.debug ? '  debug' : ''}`,
    () =>
      `${player.mode}${player.height < 1.79 ? ' crouched' : ''}  ` +
      `x ${player.x.toFixed(1)} y ${player.y.toFixed(2)} z ${player.z.toFixed(1)}  ` +
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
    stats.tick(performance.now() - t0);
  }

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = el.canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Draw everything once now, so uploads and shader compiles don't hitch later.
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
    camera.position.lerpVectors(prevEye, eye, alpha);
    // Look is applied every frame, not every tick, so turning never lags.
    camera.rotation.set(controls.pitch, controls.yaw, 0);
    renderer.render(scene, camera);
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

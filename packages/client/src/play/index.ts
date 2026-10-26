import {
  CollisionWorld,
  FixedTimestep,
  ammoDef,
  brokenArms,
  createCharacterHit,
  createRayHit,
  createRng,
  createState,
  eyeHeight,
  giveWeapon,
  nextInt,
  pick,
  raycastCharacters,
  restoreHealth,
  shootCharacter,
  spawnCharacter,
  step,
  wearArmour,
  weaponDef,
  type Character,
  type PlayerInput,
  type TickInputs,
  type Zone,
} from '@mes/shared';
import * as THREE from 'three';
import { startLoop } from '../app/loop';
import { loadItems, loadMap } from '../content';
import { Stats } from '../debug/stats';
import type { Hud } from '../hud/hud';
import type { Vitals } from '../hud/vitals';
import { Controls } from '../input/controls';
import { buildDebug } from '../render/debug';
import { CapsuleBody } from '../render/dummies';
import { Effects } from '../render/effects';
import { buildMap } from '../render/map';
import { Viewmodel } from '../render/viewmodel';
import { settings } from '../settings';

export interface PlayElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  hud: Hud;
  vitals: Vitals;
}

export interface PlayOptions {
  map: string;
  /** A player spawn's id; otherwise one is picked at random. */
  spawn: string | null;
  /** The player's gun, an item id. */
  weapon: string;
  /** Show markers and zones, and turn quick slots 1 and 2 into hurt-me and heal-me. */
  debug: boolean;
  pixelRatio: number;
  /** Shown in the stats header, e.g. "standalone". */
  note: string;
}

const FOV = 70;
/** Iron sights zoom a little; optics in session 6b set their own zoom. */
const AIM_FOV = 55;
const SPARE_ROUNDS = 120;
/** Dead target dummies get up again after this long. */
const DUMMY_RESPAWN_MS = 6000;
/** How much aim assist slows looking while the crosshair is on an enemy. */
const ASSIST = { off: 1, low: 0.8, medium: 0.6, high: 0.45 } as const;

/**
 * A map from content/ with the shared simulation: walking, shooting and taking damage.
 * Every enemy spawn holds a target dummy that stands still and gets up again after dying.
 * A stand-in for the raid until sessions 7–11 add AI, inventory and the raid lifecycle.
 */
export function startPlay(el: PlayElements, options: PlayOptions): void {
  const map = loadMap(options.map);
  const items = loadItems();
  const world = new CollisionWorld(map.world);

  const renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(options.pixelRatio);
  // The world, then the gun over it with depth cleared, so it never pokes into walls.
  renderer.autoClear = false;
  // Count both passes in the stats.
  renderer.info.autoReset = false;
  const { sky, fogNear, fogFar } = map.environment;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, fogNear, fogFar);
  // The far plane follows the fog distance.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, fogFar);
  camera.rotation.order = 'YXZ';

  scene.add(buildMap(map).root);
  if (options.debug) scene.add(buildDebug(map, world.terrain));
  const effects = new Effects();
  scene.add(effects.root);
  const viewmodel = new Viewmodel();

  const controls = new Controls(el.canvas, el.hud);
  const sim = createState(Date.now() >>> 0);
  const spawns = map.markers.filter((m) => m.type === 'playerSpawn');
  const spawn =
    spawns.find((m) => m.id === options.spawn) ?? pick(createRng(Date.now() >>> 0), spawns);
  // Below the spawn's height plus a little, so a spawn under a roof stays inside.
  const player = spawnCharacter(sim, world, spawn.x, spawn.z, spawn.yaw, spawn.y + 0.5);
  giveWeapon(player, items, options.weapon, SPARE_ROUNDS);
  wearArmour(player, items, 'steel-helmet');
  wearArmour(player, items, 'plate-carrier');
  controls.yaw = spawn.yaw;

  // Target dummies. Spawns with a loadout (the boss) wear armour, to test it.
  const dummies: { c: Character; body: CapsuleBody; diedAt: number }[] = [];
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    const c = spawnCharacter(sim, world, m.x, m.z, m.yaw, m.y + 0.5);
    if (m.loadout) {
      wearArmour(c, items, 'steel-helmet');
      wearArmour(c, items, 'plate-carrier');
    }
    const body = new CapsuleBody();
    scene.add(body.root);
    dummies.push({ c, body, diedAt: 0 });
  }

  const input: PlayerInput = {
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    crouch: false,
    jump: false,
    fire: false,
    aim: false,
    reload: false,
  };
  const inputs: TickInputs = { [player.id]: input };
  // What the frame draws between ticks: the eye, aim and recoil from the last two ticks.
  const prev = { x: player.x, y: eyeHeight(player), z: player.z, aim: 0, rp: 0, ry: 0 };
  const cur = { ...prev };

  const stats = new Stats(
    el.stats,
    renderer,
    `${map.name}  spawn ${spawn.id}${options.debug ? '  debug' : ''}  ${options.note}`,
    () =>
      `${player.mode}${player.height < 1.79 ? ' crouched' : ''}  ` +
      `x ${player.x.toFixed(1)} y ${player.y.toFixed(2)} z ${player.z.toFixed(1)}  ` +
      `speed ${Math.hypot(player.vx, player.vz).toFixed(1)} m/s` +
      `${controls.sprint ? '  sprint' : ''}${controls.aim ? '  aim' : ''}${input.fire ? '  fire' : ''}`,
  );

  // Scratch for the auto-fire and aim-assist check.
  const aimHit = createCharacterHit();
  const aimWorld = createRayHit();
  /** Whether the crosshair (with recoil) is on a living enemy in range and in sight. */
  function onTarget(): boolean {
    if (!player.weapon) return false;
    const range = weaponDef(items, player.weapon.item).range;
    const yaw = controls.yaw + player.recoilYaw;
    const pitch = controls.pitch + player.recoilPitch;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const ey = eyeHeight(player);
    const wall = world.raycast(player.x, ey, player.z, dx, dy, dz, range, aimWorld);
    const reach = Math.min(wall, range);
    return (
      raycastCharacters(sim, player.x, ey, player.z, dx, dy, dz, reach, player.id, aimHit) <
      Infinity
    );
  }

  const debugRng = createRng(1);
  const muzzle = new THREE.Vector3();

  function tick(): void {
    const t0 = performance.now();
    const now = performance.now();
    controls.update();
    const dead = player.health.dead;
    const target = !dead && onTarget();
    controls.assist = target ? ASSIST[settings.current.aimAssist] : 1;
    let fire = controls.fire;
    if (target && settings.current.fire === 'auto' && player.weapon) {
      // Auto-fire holds the trigger; a semi-automatic gun is pulled every other tick.
      const semi = weaponDef(items, player.weapon.item).fireMode === 'semi';
      fire ||= !semi || sim.tick % 2 === 0;
    }
    input.moveX = controls.moveX;
    input.moveY = controls.moveY;
    input.yaw = controls.yaw;
    input.pitch = controls.pitch;
    input.sprint = controls.sprint;
    input.crouch = controls.crouch;
    input.jump = controls.jump;
    input.fire = fire;
    input.aim = controls.aim;
    input.reload = controls.reload;
    // Jumping lets go of a ladder, and ends sprint lock with it.
    if (controls.jump && player.mode === 'ladder') controls.unlockSprint();

    if (options.debug && controls.quickSlot === 0) {
      // Quick slot 1: a 5.56 round to a random zone, armour and bleeding included.
      const zone = nextInt(debugRng, 6) as Zone;
      shootCharacter(sim, items, player, zone, ammoDef(items, 'ammo-556'), 0);
      el.vitals.hurtFlash();
    } else if (options.debug && controls.quickSlot === 1) {
      restoreHealth(player, items);
    }

    prev.x = cur.x;
    prev.y = cur.y;
    prev.z = cur.z;
    prev.aim = cur.aim;
    prev.rp = cur.rp;
    prev.ry = cur.ry;
    step(sim, world, items, inputs);
    cur.x = player.x;
    cur.y = eyeHeight(player);
    cur.z = player.z;
    cur.aim = player.aim;
    cur.rp = player.recoilPitch;
    cur.ry = player.recoilYaw;

    for (const e of sim.events) {
      if (e.type === 'shot') {
        if (e.by === player.id) {
          viewmodel.fired(now);
          viewmodel.muzzleWorld(muzzle);
          effects.tracer(now, muzzle.x, muzzle.y, muzzle.z, e.toX, e.toY, e.toZ);
        } else {
          effects.tracer(now, e.fromX, e.fromY, e.fromZ, e.toX, e.toY, e.toZ);
        }
        if (e.hit !== 'none') effects.impact(now, e.toX, e.toY, e.toZ, e.hit === 'character');
      } else if (e.type === 'damage') {
        if (e.by === player.id && e.target !== player.id) el.vitals.hitMarker(now, false);
        if (e.target === player.id && e.amount > 0) el.vitals.hurtFlash();
      } else if (e.by === player.id && e.target !== player.id) {
        el.vitals.hitMarker(now, true);
      }
    }

    for (const d of dummies) {
      if (!d.c.health.dead) d.diedAt = 0;
      else if (!d.diedAt) d.diedAt = now;
      else if (now - d.diedAt > DUMMY_RESPAWN_MS) restoreHealth(d.c, items);
    }
    el.vitals.update(player, items, now);
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

  function render(): void {
    renderer.info.reset();
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(viewmodel.scene, camera);
  }

  // Draw everything once now, so uploads and shader compiles don't hitch later.
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  render();
  for (const o of culled) o.frustumCulled = true;

  const loop = new FixedTimestep();
  startLoop(renderer, controls, (time, dtMs) => {
    const t0 = performance.now();
    const alpha = loop.advance(dtMs / 1000, tick);
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    camera.position.set(lerp(prev.x, cur.x), lerp(prev.y, cur.y), lerp(prev.z, cur.z));
    // Look is applied every frame, not every tick, so turning never lags. Recoil is the
    // sim's, so it's interpolated between ticks.
    camera.rotation.set(
      controls.pitch + lerp(prev.rp, cur.rp),
      controls.yaw + lerp(prev.ry, cur.ry),
      0,
    );
    const aim = lerp(prev.aim, cur.aim);
    const fov = FOV + (AIM_FOV - FOV) * aim;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    for (const d of dummies) d.body.update(d.c, items);
    viewmodel.visible = !player.health.dead && !!player.weapon;
    viewmodel.update(camera, time, dtMs, aim, 1 + brokenArms(player.health) * 2);
    effects.update(performance.now());
    render();
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

import {
  CollisionWorld,
  FixedTimestep,
  NavGrid,
  ammoDef,
  attach,
  attachmentDef,
  detach,
  fits,
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
  resetEnemy,
  restoreHealth,
  shootCharacter,
  spawnCharacter,
  spawnEnemy,
  step,
  wearArmour,
  weaponDef,
  type AttachmentDef,
  type AttachmentSlot,
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
import type { OpticOverlay } from '../hud/optic';
import type { Vitals } from '../hud/vitals';
import { Controls } from '../input/controls';
import { buildDebug } from '../render/debug';
import { CapsuleBody } from '../render/capsule-body';
import { Effects } from '../render/effects';
import { buildMap } from '../render/map';
import { AiDebug, buildNavOverlay } from '../render/nav-debug';
import { Viewmodel } from '../render/viewmodel';
import { settings } from '../settings';

export interface PlayElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  hud: Hud;
  optic: OpticOverlay;
  vitals: Vitals;
}

export interface PlayOptions {
  map: string;
  /** A player spawn's id; otherwise one is picked at random. */
  spawn: string | null;
  /** The player's gun, an item id. */
  weapon: string;
  /** Attachment item ids to put on it. */
  attachments: string[];
  /**
   * Show markers, zones, patrols and what enemies are thinking, and turn the quick slots
   * into hurt me, heal me, next optic and next muzzle.
   */
  debug: boolean;
  /** Show the navigation grid. */
  nav: boolean;
  pixelRatio: number;
  /** Shown in the stats header, e.g. "standalone". */
  note: string;
}

const FOV = 70;
/** Iron sights and red dots zoom a little; scopes set their own zoom. */
const AIM_FOV = 55;
/** How far into aiming a red dot's reticle shows, once the sight has come up to the eye. */
const RETICLE_IN = 0.95;
/** How far into aiming a scope switches to its full-screen zoom. */
const SCOPE_IN = 0.9;
const DEG = Math.PI / 180;
const SPARE_ROUNDS = 120;
/** Dead enemies come back at their spawn after this long, until raids end (session 11). */
const ENEMY_RESPAWN_MS = 6000;
/** How much aim assist slows looking while the crosshair is on an enemy. */
const ASSIST = { off: 1, low: 0.8, medium: 0.6, high: 0.45 } as const;

/**
 * A map from content/ with the shared simulation: walking, shooting and taking damage.
 * Every enemy spawn has an enemy that guards it or walks its patrol, and notices you, but
 * doesn't shoot yet (session 8); it comes back after dying. A stand-in for the raid until
 * sessions 8–11 add combat, inventory and the raid lifecycle.
 */
export function startPlay(el: PlayElements, options: PlayOptions): void {
  const map = loadMap(options.map);
  const items = loadItems();
  const world = new CollisionWorld(map.world);
  const navStart = performance.now();
  const nav = new NavGrid(world);
  const navMs = performance.now() - navStart;

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
  if (options.nav) scene.add(buildNavOverlay(nav));
  const aiDebug = options.debug ? new AiDebug() : null;
  if (aiDebug) scene.add(aiDebug.root);
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
  giveWeapon(player, items, options.weapon, SPARE_ROUNDS, options.attachments);
  wearArmour(player, items, 'steel-helmet');
  wearArmour(player, items, 'plate-carrier');
  controls.yaw = spawn.yaw;

  // Enemies. Spawns with a loadout (the boss) wear armour, to test it.
  const patrols = new Map(map.patrols.map((p) => [p.id, p]));
  const enemies: { c: Character; body: CapsuleBody; diedAt: number }[] = [];
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    const patrol = m.patrol === undefined ? undefined : patrols.get(m.patrol);
    const c = spawnEnemy(sim, world, m.x, m.y, m.z, m.yaw, { patrol, radius: m.radius });
    if (m.loadout) {
      wearArmour(c, items, 'steel-helmet');
      wearArmour(c, items, 'plate-carrier');
    }
    const body = new CapsuleBody();
    scene.add(body.root);
    enemies.push({ c, body, diedAt: 0 });
  }
  const enemyChars = enemies.map((e) => e.c);

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
    `${map.name}  spawn ${spawn.id}${options.debug ? '  debug' : ''}  ` +
      `nav ${nav.nodeCount} nodes ${navMs.toFixed(0)} ms  ${options.note}`,
    () =>
      `${awarenessSummary()}  ${player.mode}${player.height < 1.79 ? ' crouched' : ''}  ` +
      `x ${player.x.toFixed(1)} y ${player.y.toFixed(2)} z ${player.z.toFixed(1)}  ` +
      `speed ${Math.hypot(player.vx, player.vz).toFixed(1)} m/s` +
      `${controls.sprint ? '  sprint' : ''}${controls.aim ? '  aim' : ''}${input.fire ? '  fire' : ''}`,
  );

  /** How many enemies are on edge, e.g. "1 alert 2 suspicious"; "calm" if none. */
  function awarenessSummary(): string {
    let alert = 0;
    let suspicious = 0;
    let searching = 0;
    for (const c of enemyChars) {
      if (c.health.dead || !c.ai) continue;
      if (c.ai.awareness === 'alert') alert++;
      else if (c.ai.awareness === 'suspicious') suspicious++;
      else if (c.ai.awareness === 'searching') searching++;
    }
    const parts = [];
    if (alert) parts.push(`${alert} alert`);
    if (suspicious) parts.push(`${suspicious} suspicious`);
    if (searching) parts.push(`${searching} searching`);
    return parts.length ? parts.join(' ') : 'calm';
  }

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

  /** Debug: the next attachment that fits in a slot of the player's gun, then none. */
  function nextAttachment(slot: AttachmentSlot): void {
    const w = player.weapon;
    if (!w) return;
    const gun = weaponDef(items, w.item);
    const choices = [...items.values()]
      .filter((i): i is AttachmentDef => i.type === 'attachment' && i.slot === slot)
      .filter((a) => fits(gun, a))
      .map((a) => a.id);
    const next = choices[choices.indexOf(w.attachments[slot] ?? '') + 1];
    if (next) attach(w, items, next);
    else detach(w, items, slot);
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
    } else if (options.debug && controls.quickSlot === 2) {
      nextAttachment('optic');
    } else if (options.debug && controls.quickSlot === 3) {
      nextAttachment('muzzle');
    }

    prev.x = cur.x;
    prev.y = cur.y;
    prev.z = cur.z;
    prev.aim = cur.aim;
    prev.rp = cur.rp;
    prev.ry = cur.ry;
    step(sim, world, items, inputs, nav);
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

    for (const e of enemies) {
      if (!e.c.health.dead) e.diedAt = 0;
      else if (!e.diedAt) e.diedAt = now;
      else if (now - e.diedAt > ENEMY_RESPAWN_MS) {
        restoreHealth(e.c, items);
        resetEnemy(e.c, world);
      }
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
    const w = player.weapon;
    const optic = w?.attachments.optic
      ? (attachmentDef(items, w.attachments.optic).optic ?? null)
      : null;
    const zoom = optic?.zoom ?? 1;
    // A scope snaps to its zoom behind the mask once aimed; until then it's like irons.
    const scoped = zoom > 1 && aim >= SCOPE_IN;
    const fov = scoped
      ? (2 * Math.atan(Math.tan((FOV / 2) * DEG) / zoom)) / DEG
      : FOV + (AIM_FOV - FOV) * aim;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Looking turns the view less when zoomed in, so it moves as fast on the screen.
    controls.zoom = scoped ? Math.tan((AIM_FOV / 2) * DEG) / Math.tan((fov / 2) * DEG) : 1;
    const alive = !player.health.dead;
    el.optic.set(optic);
    el.optic.visible = alive && aim >= (zoom > 1 ? SCOPE_IN : RETICLE_IN);
    for (const e of enemies) e.body.update(e.c, items);
    aiDebug?.update(enemyChars);
    viewmodel.visible = alive && !!w && !scoped;
    if (w) viewmodel.setAttachments(w, items);
    viewmodel.update(camera, time, dtMs, aim, 1 + brokenArms(player.health) * 2);
    effects.update(performance.now());
    render();
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

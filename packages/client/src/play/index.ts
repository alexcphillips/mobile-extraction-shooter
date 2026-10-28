import {
  CollisionWorld,
  FixedTimestep,
  NavGrid,
  ammoDef,
  attachmentDef,
  brokenArms,
  createCharacterHit,
  createRayHit,
  createRng,
  createState,
  equipLoadout,
  eyeHeight,
  nextInt,
  pick,
  raycastCharacters,
  resetEnemy,
  restoreHealth,
  shootCharacter,
  spawnCharacter,
  spawnEnemy,
  step,
  weaponDef,
  type Character,
  type CompiledMap,
  type RaidDef,
  type PlayerInput,
  type TickInputs,
  type Zone,
  heldWeapon,
  placeLootContainers,
  lootContainerById,
  type InventoryAction,
  type Item,
  type Owner,
  drawTime,
  meleeDef,
  type MedRef,
  TICK_RATE,
  fillLootContainers,
  gearItems,
  keptItems,
  rollEnemyLoot,
  rollLootSpawns,
  startRaid,
  itemDef,
  type LeaveReason,
  type Gear,
  findKey,
  keyName,
  syncDoors,
  investigateInReach,
  investigatedBy,
  keptGear,
  objectiveText,
  raidObjectives,
  raidProgress,
  startQuests,
  type Profile,
} from '@mes/shared';
import * as THREE from 'three';
import { startLoop } from '../app/loop';
import { pause } from '../app/pause';
import {
  checkEnemySpawns,
  checkLootContainers,
  loadEnemies,
  loadItems,
  loadLootContainers,
  loadLootTables,
  loadMap,
  loadQuests,
  loadRaid,
} from '../content';
import { Stats } from '../debug/stats';
import { HandsHud } from '../hud/hands';
import type { Hud } from '../hud/hud';
import { AIM_FOV, FOV, aimedFov, type OpticOverlay } from '../hud/optic';
import { QuestMarkers } from '../hud/quest-markers';
import type { RaidHud } from '../hud/raid-hud';
import type { Vitals } from '../hud/vitals';
import { Controls } from '../input/controls';
import { buildDebug } from '../render/debug';
import { CapsuleBody } from '../render/capsule-body';
import { DEFAULT_OUTFIT, loadCharacter } from '../render/character';
import { CharacterBody, CharacterRig } from '../render/character-body';
import { Effects } from '../render/effects';
import { buildExtractions } from '../render/extractions';
import { GroundItems } from '../render/ground-items';
import { buildMap, updateDoors } from '../render/map';
import { AiDebug, buildNavOverlay } from '../render/nav-debug';
import { Viewmodel } from '../render/viewmodel';
import { settings } from '../settings';
import type { RaidScreenHandle } from '../ui/raid';
import {
  clearSnapshot,
  saveResult,
  saveSnapshot,
  type RaidSnapshot,
  type SaveStatus,
} from '../raids';
import type { RaidResult } from '../ui/results';
import { lootableInReach } from './loot';

export interface PlayElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  hud: Hud;
  optic: OpticOverlay;
  vitals: Vitals;
  /** The raid timer and the extraction countdown. */
  raidHud: RaidHud;
  /** Where the raid screen (inventory, map, quests) opens. */
  raid: HTMLElement;
  /** Where the results screen opens when the raid ends for you. */
  results: HTMLElement;
  /** Where quest markers to investigate are drawn over the world. */
  questMarkers: HTMLElement;
}

export interface PlayOptions {
  /** A raid config's id, in content/raids. */
  raid: string;
  /**
   * Play-testing from the map editor (dev only): this map as edited and this raid config
   * instead of `raid`'s. Nothing is saved or sent, and a raid saved on the phone is left alone.
   */
  test: { map: CompiledMap; raid: RaidDef } | null;
  /** The raid's id on the server, which its result is sent to. */
  serverRaid: string;
  /**
   * The profile from the server as the raid started: the player wears its gear, and its
   * active quests set up markers and quest items.
   */
  profile: Profile;
  /** A raid saved when the page was hidden, to carry on instead of starting afresh. */
  resume: RaidSnapshot | null;
  /** Debug: the raid timer in seconds, instead of the raid's. */
  duration: number | null;
  /** A player spawn's id; otherwise one is picked at random. */
  spawn: string | null;
  /** Debug: start at this x, z instead of a spawn (facing the spawn's way). */
  at: [number, number] | null;
  /**
   * Show markers, zones, patrols and what enemies are thinking, and buttons (and keys 7
   * and 8) for hurt me and heal me.
   */
  debug: boolean;
  /** Show the navigation grid. */
  nav: boolean;
  /** Draw the simulation's hit-zone capsules, see-through, over enemies' bodies. */
  hitZones: boolean;
  /** Bring dead enemies back at their spawn, with a new loadout, after a few seconds. */
  respawn: boolean;
  /** Enemies come unarmed: they notice you and close in, but can't shoot. */
  peaceful: boolean;
  pixelRatio: number;
  /** Shown in the stats header, e.g. "standalone". */
  note: string;
}

/** How far into aiming a red dot's reticle shows, once the sight has come up to the eye. */
const RETICLE_IN = 0.95;
/** How far into aiming a scope switches to its full-screen zoom. */
const SCOPE_IN = 0.9;
const DEG = Math.PI / 180;
/** With ?respawn, dead enemies come back at their spawn after this long. */
const ENEMY_RESPAWN_MS = 6000;
/** How long after you die the results screen comes up. */
const RESULTS_AFTER_DEATH_MS = 1500;
/** How much aim assist slows looking while the crosshair is on an enemy. */
const ASSIST = { off: 1, low: 0.8, medium: 0.6, high: 0.45 } as const;

/**
 * A solo raid from a config in content/raids, on the shared simulation. You start at a
 * random player spawn wearing your profile's gear, from the server. Containers and
 * enemies' pockets are rolled from loot tables, and every enemy spawn has an enemy of its
 * type with a rolled loadout, which guards its spawn or walks its patrol, and fights you
 * once it notices you. The dead stay down. It ends for you when you extract, die or run
 * out of time, with a results screen. The raid is saved on the phone whenever the page is
 * hidden, and options.resume carries one on from there. Your active quests' markers on
 * this map show through walls until investigated, and their quest items lie at one of
 * their spots (session 14b).
 */
export async function startPlay(el: PlayElements, options: PlayOptions): Promise<void> {
  const raid = options.test?.raid ?? loadRaid(options.raid);
  const map = options.test?.map ?? loadMap(raid.map);
  const items = loadItems();
  const lootTables = loadLootTables();
  const { types, loadouts } = loadEnemies();
  checkEnemySpawns(map);
  checkLootContainers(map);
  const lootKinds = loadLootContainers();
  const quests = [...loadQuests().values()];
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

  const mapView = buildMap(map);
  scene.add(mapView.root);
  scene.add(buildExtractions(map));
  const groundItems = new GroundItems(items);
  scene.add(groundItems.root);
  if (options.debug) scene.add(buildDebug(map, world.terrain));
  if (options.nav) scene.add(buildNavOverlay(nav));
  const aiDebug = options.debug ? new AiDebug() : null;
  if (aiDebug) scene.add(aiDebug.root);
  const effects = new Effects();
  scene.add(effects.root);
  const viewmodel = new Viewmodel();
  const rig = new CharacterRig(await loadCharacter('/characters/mannequin.glb'));

  const controls = new Controls(el.canvas, el.hud);
  const resume = options.resume;
  const sim = resume?.sim ?? createState(Date.now() >>> 0);
  const spawns = map.markers.filter((m) => m.type === 'playerSpawn');
  const spawn =
    spawns.find((m) => m.id === (resume?.spawn ?? options.spawn)) ??
    pick(createRng(Date.now() >>> 0), spawns);
  let player: Character;
  if (resume) {
    const found = sim.entities.find((e) => e.id === resume.player);
    if (!found) throw new Error('the saved raid has no player');
    player = found;
    controls.yaw = player.yaw;
    controls.pitch = player.pitch;
  } else {
    // Below the spawn's height plus a little, so a spawn under a roof stays inside.
    const [startX, startZ] = options.at ?? [spawn.x, spawn.z];
    player = spawnCharacter(
      sim,
      world,
      startX,
      startZ,
      spawn.yaw,
      // ?at stands you on the floor nearest the ground there, not on a roof.
      options.at ? world.terrain.heightAt(startX, startZ) + 1 : spawn.y + 0.5,
    );
    player.gear = structuredClone(options.profile.gear);
    placeLootContainers(sim, map, lootKinds);
    fillLootContainers(sim, map, items, lootTables);
    rollLootSpawns(sim, map, items, lootTables);
    startRaid(sim, map, options.duration ?? raid.duration);
    startQuests(sim, map, items, player.id, raidObjectives(options.profile, quests, raid.map));
    controls.yaw = spawn.yaw;
  }
  const held = heldWeapon(player);
  if (held) viewmodel.setGun(held, items);
  const questMarkers = new QuestMarkers(el.questMarkers, sim.raid?.investigate ?? [], player);
  /** What each quest marker on this map is for, shown under the crosshair. */
  const markerText = new Map<string, string>();
  for (const q of quests) {
    for (const o of q.objectives) {
      if (o.type === 'investigate' && o.map === raid.map) markerText.set(o.marker, o.text);
    }
  }
  // Locked doors cut the nav grid now, not in the first frame.
  syncDoors(sim, world, nav);

  // Enemies: their type's skill, and its loadout (or the spawn's) rolled.
  const patrols = new Map(map.patrols.map((p) => [p.id, p]));
  const names = new Map<number, string>();
  /** Each enemy spawn marker's id, and the entity there, for saving the raid. */
  const spawned: Record<string, number> = {};
  const enemies: {
    c: Character;
    body: CharacterBody;
    zones: CapsuleBody | null;
    diedAt: number;
    arm: () => void;
  }[] = [];
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    const type = types.get(m.enemy)!;
    const loadout = loadouts.get(m.loadout ?? type.loadout)!;
    const patrol = m.patrol === undefined ? undefined : patrols.get(m.patrol);
    // Resumed, the enemy is already in the state, as it was.
    const saved = resume ? sim.entities.find((e) => e.id === resume.enemies[m.id]) : undefined;
    if (resume && !saved) continue;
    const c =
      saved ??
      spawnEnemy(sim, world, m.x, m.y, m.z, m.yaw, {
        patrol,
        radius: m.radius,
        skill: type.skill,
      });
    spawned[m.id] = c.id;
    const arm = (): void => {
      if (!options.peaceful) equipLoadout(c, items, loadout, sim.rng);
      rollEnemyLoot(c, items, lootTables, type.loot, m.lootWeights, sim.rng);
    };
    if (!saved) arm();
    const body = new CharacterBody(rig, type.outfit ?? DEFAULT_OUTFIT, c);
    scene.add(body.root);
    const zones = options.hitZones ? new CapsuleBody(0.45) : null;
    if (zones) scene.add(zones.root);
    enemies.push({ c, body, zones, diedAt: 0, arm });
    names.set(c.id, type.name);
  }
  const enemyChars = enemies.map((e) => e.c);
  const bodyOf = new Map(enemies.map((e) => [e.c.id, e.body]));

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
  // What the frame draws between ticks: the eye, aim, recoil and how far drawn what's in
  // hand is, from the last two ticks.
  const prev = { x: player.x, y: eyeHeight(player), z: player.z, aim: 0, rp: 0, ry: 0, drawn: 1 };
  const cur = { ...prev };

  const stats = new Stats(
    el.stats,
    renderer,
    `${raid.name}  ${map.name}  spawn ${spawn.id}${options.debug ? '  debug' : ''}  ` +
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
  /** The knife, if it's in hand. */
  const knifeOut = (): boolean => player.gear.hand === 'knife' && !!player.gear.knife;

  /**
   * Whether the crosshair (with recoil) is on a living enemy in range (the knife's reach
   * with the knife out) and in sight.
   */
  function onTarget(): boolean {
    const w = heldWeapon(player);
    const knife = player.gear.knife;
    let range: number;
    if (w) range = weaponDef(items, w.item).range;
    else if (knife && knifeOut()) range = meleeDef(items, knife.item).reach;
    else return false;
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

  // Debug: where the sim will fire (cyan: its eye, look and recoil, without spread, to the
  // first surface) and where the player's last shots landed (magenta). Drawn over
  // everything, so on the phone you can see whether they line up with the crosshair.
  function debugMarker(colour: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(1),
      new THREE.MeshBasicMaterial({ color: colour, depthTest: false, fog: false }),
    );
    m.renderOrder = 10;
    m.visible = false;
    scene.add(m);
    return m;
  }
  const aimMarker = options.debug ? debugMarker(0x00e5ff) : null;
  const shotMarkers = options.debug ? Array.from({ length: 5 }, () => debugMarker(0xff00ff)) : [];
  let nextShotMarker = 0;
  const markerHit = createRayHit();
  /** Keeps a marker about the same size on screen at any distance. */
  function placeMarker(m: THREE.Mesh, x: number, y: number, z: number, size: number): void {
    m.position.set(x, y, z);
    m.scale.setScalar(Math.max(0.01, camera.position.distanceTo(m.position) * size));
    m.visible = true;
  }

  // The hand-slot and heal buttons. A med picked from the heal button's picker is used
  // next tick.
  let picked: MedRef | 'cancel' | null = null;
  const hands = new HandsHud(el.hud, (ref) => (picked = ref));

  // Debug actions: hurt me, heal me; on screen and keys 7 and 8.
  if (options.debug) {
    const bar = document.createElement('div');
    bar.className = 'debug-actions';
    ['hurt', 'heal'].forEach((label, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 7} ${label}`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        controls.pressDebug(i);
      });
      bar.append(b);
    });
    document.body.append(bar);
  }

  // The raid screen: inventory and looting, map and quests. The raid keeps running while
  // it's open; you stand still. Its actions are sent with the next tick's input.
  let screen: RaidScreenHandle | null = null;
  let opening = false;
  let screenOpen = false;
  const pending: InventoryAction[] = [];
  input.inventory = pending;
  let inventoryChanged = false;
  const useButton = el.hud.button('interact');
  let useLabel = '';
  const nameOf = (o: Owner): string => {
    if (o.kind === 'container') {
      const l = lootContainerById(sim, o.id);
      return l ? (lootKinds.get(l.def)?.name ?? l.def) : 'Container';
    }
    if (o.kind === 'ground') return 'On the ground';
    return o.kind === 'body' ? `${names.get(o.id) ?? 'Body'} (dead)` : 'You';
  };
  function openScreen(target: Owner | null): void {
    controls.reset();
    screenOpen = true;
    if (screen) {
      screen.setTarget(target);
      el.raid.hidden = false;
      return;
    }
    if (opening) return;
    opening = true;
    import('../ui/raid')
      .then((ui) => {
        opening = false;
        if (!screenOpen) return;
        screen = ui.openRaidScreen(
          el.raid,
          {
            sim,
            player,
            items,
            map,
            profile: options.profile,
            quests,
            send: (a) => pending.push(a),
            // Started or stopped from the inventory: sent like the heal button's picker.
            use: (u) => (picked = u),
            nameOf,
            close: closeScreen,
          },
          target,
        );
      })
      .catch((err: unknown) => {
        opening = false;
        screenOpen = false;
        console.error('raid screen failed', err);
      });
  }
  function closeScreen(): void {
    screenOpen = false;
    pending.length = 0;
    screen?.hide();
    // A fresh handle next time, so it opens on the inventory tab.
    screen = null;
  }

  // The raid ends for you when you extract, die or run out of time; the results screen
  // comes up a moment later after a death, so you see it happen.
  let kills = resume?.kills ?? 0;
  /** The enemy type that killed you, if one did. */
  let killedBy: string | null = null;
  let ended: RaidResult | null = null;
  let saving: Promise<SaveStatus> | null = null;
  let resultsAt = 0;
  function endRaid(how: LeaveReason | 'killed', detail: string, now: number): void {
    if (ended) return;
    const survived = how === 'extracted';
    const kept = keptItems(player.gear, survived);
    const seconds = sim.tick / TICK_RATE;
    const investigated = investigatedBy(sim, player.id);
    // What the server will count, worked out the same way on copies: quest items it takes.
    const done = raidProgress(
      structuredClone(options.profile),
      quests,
      items,
      raid.map,
      investigated,
      keptGear(structuredClone(player.gear), survived),
    );
    const isQuestItem = (i: Item): boolean => itemDef(items, i.item).type === 'quest';
    ended = {
      how,
      detail,
      seconds,
      kills,
      kept: kept.filter((i) => !isQuestItem(i)),
      lost: gearItems(player.gear).filter((i) => !kept.includes(i)),
      quests: done.map((d) => ({ quest: d.quest.name, text: objectiveText(items, d.objective) })),
    };
    // Sent now, as it is: the server keeps what the outcome allows.
    const gear = JSON.parse(JSON.stringify(player.gear)) as Gear;
    if (options.test) saving = Promise.resolve({ kind: 'test' });
    else {
      saving = saveResult(options.serverRaid, { how, gear, seconds, kills, detail, investigated });
      clearSnapshot();
    }
    resultsAt = now + (how === 'killed' ? RESULTS_AFTER_DEATH_MS : 0);
    closeScreen();
  }
  function showResults(result: RaidResult): void {
    import('../ui/results')
      .then((ui) => {
        // The next raid starts from the page, which sends anything not yet saved first.
        ui.showResults(el.results, result, items, saving!, () => location.reload());
        // Nothing more to play: stop drawing.
        pause.set('ended', true);
      })
      .catch((err: unknown) => console.error('results screen failed', err));
  }

  // Saved whenever the page is hidden, in case iOS unloads it while you're away.
  const snapshot = (): void => {
    if (ended || options.test) return;
    saveSnapshot({
      version: 1,
      serverRaid: options.serverRaid,
      raid: options.raid,
      spawn: spawn.id,
      player: player.id,
      enemies: spawned,
      kills,
      sim,
    });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) snapshot();
  });
  window.addEventListener('pagehide', snapshot);

  function tick(): void {
    const t0 = performance.now();
    const now = performance.now();
    controls.update();
    // Dead, or out of the raid: no more control.
    const dead = player.health.dead || ended !== null;
    const target = !dead && onTarget();
    controls.assist = target ? ASSIST[settings.current.aimAssist] : 1;
    let fire = controls.fire;
    const held = heldWeapon(player);
    // Auto-fire holds the trigger (or swings the knife), but never stops a med being used.
    if (target && settings.current.fire === 'auto' && !player.using) {
      // A semi-automatic gun is pulled every other tick.
      const semi = !!held && weaponDef(items, held.item).fireMode === 'semi';
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
    input.draw = controls.draw;
    // A tap on the heal button uses what it shows, or stops a med being used.
    input.use = controls.heal ? (player.using ? 'cancel' : hands.choice) : picked;
    picked = null;
    if (controls.healPick && !dead) hands.showPicker(player, items);

    // The use button takes the item on the ground near the crosshair, opens, closes or
    // unlocks a door, or loots what's in reach; the bag button opens your inventory.
    const lootable =
      dead || screenOpen ? null : lootableInReach(sim, world, player, controls.yaw, controls.pitch);
    // A locked door names its key under the crosshair, and unlocks if you carry it.
    const doorIndex = lootable?.kind === 'door' ? lootable.index : -1;
    const door = doorIndex >= 0 ? sim.doors[doorIndex]! : null;
    const doorKey = door?.locked ? keyName(items, world, doorIndex) : null;
    const hasKey = !!door?.locked && !!findKey(player.gear, world.doors[doorIndex]!.key!);
    // A quest marker in reach beats a container or body, but not aiming at an item or door.
    const spot =
      dead || screenOpen || lootable?.kind === 'ground' || lootable?.kind === 'door'
        ? null
        : investigateInReach(sim, player);
    const label = spot
      ? 'investigate'
      : !lootable
        ? 'use'
        : door
          ? door.locked
            ? hasKey
              ? 'unlock'
              : 'locked'
            : door.open
              ? 'close'
              : 'open'
          : lootable.kind === 'ground'
            ? 'take'
            : 'loot';
    if (label !== useLabel) {
      useLabel = label;
      useButton.textContent = label;
      useButton.classList.toggle('idle', !lootable && !spot);
    }
    let taking: string | null = null;
    input.door = null;
    input.investigate = false;
    if (!dead && controls.interact && spot) {
      input.investigate = true;
    } else if (!dead && controls.interact && lootable?.kind === 'door') {
      input.door = lootable.index;
    } else if (!dead && controls.interact && lootable?.kind === 'ground') {
      // Picked up next tick: into an empty gear slot it fits, else into what you carry.
      const id = lootable.g.item.item;
      pending.push({
        type: 'quick',
        from: { owner: { kind: 'ground' }, ground: lootable.index, item: id },
        to: { kind: 'self' },
      });
      taking = itemDef(items, id).name;
    } else if (!dead && controls.interact && lootable) {
      if (lootable.kind === 'container') openScreen({ kind: 'container', id: lootable.c.id });
      else if (lootable.kind === 'body') openScreen({ kind: 'body', id: lootable.c.id });
    } else if (!dead && controls.bag) {
      if (screenOpen) closeScreen();
      else openScreen(null);
    }
    if (screenOpen) {
      if (dead) closeScreen();
      input.moveX = input.moveY = 0;
      input.sprint = input.jump = input.fire = input.aim = input.reload = false;
    }
    // Jumping lets go of a ladder, and ends sprint lock with it.
    if (controls.jump && player.mode === 'ladder') controls.unlockSprint();

    if (options.debug && controls.debug === 0) {
      // A 5.56 round to a random zone, armour and bleeding included.
      const zone = nextInt(debugRng, 6) as Zone;
      shootCharacter(sim, items, player, zone, ammoDef(items, 'ammo-556'), 0);
      el.vitals.hurtFlash();
    } else if (options.debug && controls.debug === 1) {
      restoreHealth(player, items);
    }

    prev.x = cur.x;
    prev.y = cur.y;
    prev.z = cur.z;
    prev.aim = cur.aim;
    prev.rp = cur.rp;
    prev.ry = cur.ry;
    prev.drawn = cur.drawn;
    inventoryChanged = false;
    step(sim, world, items, inputs, nav);
    pending.length = 0;
    cur.x = player.x;
    cur.y = eyeHeight(player);
    cur.z = player.z;
    cur.aim = player.aim;
    cur.rp = player.recoilPitch;
    cur.ry = player.recoilYaw;
    const total = drawTime(items, player.gear, player.gear.hand);
    cur.drawn = total > 0 ? 1 - player.draw / total : 1;

    for (const e of sim.events) {
      if (e.type === 'shot') {
        if (e.by === player.id) {
          viewmodel.fired(now);
          viewmodel.muzzleWorld(muzzle);
          effects.tracer(now, muzzle.x, muzzle.y, muzzle.z, e.toX, e.toY, e.toZ);
        } else {
          bodyOf.get(e.by)?.fired();
          effects.tracer(now, e.fromX, e.fromY, e.fromZ, e.toX, e.toY, e.toZ);
        }
        if (e.hit !== 'none') effects.impact(now, e.toX, e.toY, e.toZ, e.hit === 'character');
        if (e.by === player.id && e.hit !== 'none' && shotMarkers.length) {
          const m = shotMarkers[nextShotMarker++ % shotMarkers.length]!;
          placeMarker(m, e.toX, e.toY, e.toZ, 0.006);
        }
      } else if (e.type === 'swing') {
        if (e.by === player.id && player.gear.knife) {
          viewmodel.swung(now, meleeDef(items, player.gear.knife.item).swingTime);
        } else bodyOf.get(e.by)?.swung();
        if (e.hit !== 'none') effects.impact(now, e.x, e.y, e.z, e.hit === 'character');
      } else if (e.type === 'damage') {
        if (e.amount > 0) bodyOf.get(e.target)?.hit();
        if (e.by === player.id && e.target !== player.id) el.vitals.hitMarker(now, false);
        if (e.target === player.id && e.amount > 0) el.vitals.hurtFlash();
      } else if (e.type === 'death' && e.by === player.id && e.target !== player.id) {
        el.vitals.hitMarker(now, true);
        kills++;
      } else if (e.type === 'death' && e.target === player.id) {
        killedBy = names.get(e.by) ?? null;
      } else if (e.type === 'leave' && e.by === player.id) {
        const at = sim.raid?.extractions.find((p) => p.id === e.at);
        endRaid(e.how, at ? `at ${at.name}` : 'Time ran out', now);
      } else if (e.type === 'investigate' && e.by === player.id) {
        el.raidHud.note(`Investigated · ${markerText.get(e.marker) ?? 'quest marker'}`, now);
        if (screen) screen.refresh();
      } else if (e.type === 'door' && e.by === player.id && e.result === 'blocked') {
        el.raidHud.warn('Someone’s in the doorway', now);
      } else if (e.type === 'inventory' && e.by === player.id) {
        inventoryChanged = true;
        if (taking && !e.ok) el.raidHud.warn(`No room for ${taking}`, now);
      }
    }

    for (const e of enemies) {
      e.body.tick(e.c);
      if (!e.c.health.dead) e.diedAt = 0;
      else if (!e.diedAt) e.diedAt = now;
      else if (options.respawn && now - e.diedAt > ENEMY_RESPAWN_MS) {
        restoreHealth(e.c, items);
        resetEnemy(e.c, world);
        e.arm();
      }
    }
    // Redraw the raid screen when the inventory changed, and now and then for what's in
    // reach and what enemies took from their dead; more often while a med or repair is in
    // use, for its progress.
    if (screen && (inventoryChanged || sim.tick % (player.using ? 3 : 10) === 0)) screen.refresh();
    // From the state, not the death event: a debug hurt kills outside the tick.
    if (player.health.dead) {
      endRaid('killed', killedBy ? `by a ${killedBy}` : 'from bleeding or a fall', now);
    }
    el.vitals.update(player, items, now);
    el.raidHud.update(sim, player, ended !== null);
    // The item the use button would take: lit up, and named under the crosshair. Picking
    // one up this tick may have moved the rest along the list.
    const onGround = lootable?.kind === 'ground' && sim.ground[lootable.index] === lootable.g;
    groundItems.update(sim.ground, onGround ? lootable.index : -1);
    el.raidHud.setPrompt(
      onGround
        ? groundLabel(lootable.g.item)
        : doorKey
          ? hasKey
            ? `Unlock with ${doorKey}`
            : `Locked · needs ${doorKey}`
          : spot
            ? (markerText.get(spot.marker) ?? '')
            : '',
      now,
    );
    hands.update(player, items);
    if (ended && resultsAt && now >= resultsAt) {
      resultsAt = 0;
      showResults(ended);
    }
    stats.tick(performance.now() - t0);
  }

  /** An item's name, with its count if it's a stack. */
  function groundLabel(item: Item): string {
    const name = itemDef(items, item.item).name;
    return item.count > 1 ? `${name} ×${item.count}` : name;
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
  /** How far the gun is lowered for using a med, eased each frame. */
  let lowered = 0;
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
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
    const w = heldWeapon(player);
    const optic = w?.attachments.optic
      ? (attachmentDef(items, w.attachments.optic).optic ?? null)
      : null;
    const zoom = optic?.zoom ?? 1;
    // A scope snaps to its zoom behind the mask once aimed; until then it's like irons.
    const scoped = zoom > 1 && aim >= SCOPE_IN;
    const fov = scoped ? aimedFov(zoom) : FOV + (AIM_FOV - FOV) * aim;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // Looking turns the view less when zoomed in, so it moves as fast on the screen.
    controls.zoom = scoped ? Math.tan((AIM_FOV / 2) * DEG) / Math.tan((fov / 2) * DEG) : 1;
    const alive = !player.health.dead;
    el.optic.set(optic);
    el.optic.visible = alive && aim >= (zoom > 1 ? SCOPE_IN : RETICLE_IN);
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    for (const e of enemies) {
      e.body.update(e.c, items, alpha, dtMs / 1000, camera, frustum);
      e.zones?.update(e.c, items);
    }
    aiDebug?.update(enemyChars);
    questMarkers.update(camera, alive && !screenOpen && !ended);
    updateDoors(mapView, sim.doors, dtMs / 1000);
    if (aimMarker) {
      const yaw = player.yaw + player.recoilYaw;
      const pitch = player.pitch + player.recoilPitch;
      const cp = Math.cos(pitch);
      const dx = -Math.sin(yaw) * cp;
      const dy = Math.sin(pitch);
      const dz = -Math.cos(yaw) * cp;
      const ey = eyeHeight(player);
      const d = Math.min(200, world.raycast(player.x, ey, player.z, dx, dy, dz, 200, markerHit));
      placeMarker(aimMarker, player.x + dx * d, ey + dy * d, player.z + dz * d, 0.01);
    }
    const knife = !w && knifeOut();
    viewmodel.visible = alive && (!!w || knife) && !scoped;
    if (w) viewmodel.setGun(w, items);
    else if (knife) viewmodel.setKnife();
    lowered += ((player.using ? 1 : 0) - lowered) * (1 - Math.exp(-dtMs / 90));
    viewmodel.update(
      camera,
      time,
      dtMs,
      aim,
      1 + brokenArms(player.health) * 2,
      w?.reloading ?? 0,
      lerp(prev.drawn, cur.drawn),
      lowered,
    );
    effects.update(performance.now());
    render();
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

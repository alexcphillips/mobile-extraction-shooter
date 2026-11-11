import {
  advanceTutorial,
  startTutorial,
  type CompiledTutorial,
  armourDef,
  CollisionWorld,
  FixedTimestep,
  GRAPHICS_QUALITY,
  GRENADE,
  grenadeDef,
  grenadeEffect,
  smokeBlocks,
  smokeRadius,
  NavGrid,
  ammoDef,
  burnOf,
  attachmentDef,
  brokenArms,
  createCharacterHit,
  createRayHit,
  createRng,
  createState,
  equipLoadout,
  gunRecoil,
  MOVEMENT,
  eyeHeight,
  eyeX,
  eyeZ,
  nextInt,
  pick,
  raycastCharacters,
  resetEnemy,
  killCharacter,
  restoreHealth,
  shootCharacter,
  spawnCharacter,
  extractionsOf,
  openExtractions,
  spawnEnemy,
  step,
  weaponDef,
  type Character,
  type Hand,
  type EntityId,
  type EnemyDef,
  type EnemySpawnOptions,
  type Outfit,
  type SpawnRequestEvent,
  type CompiledMap,
  type RaidDef,
  type PlayerInput,
  type Zone,
  heldWeapon,
  entityById,
  loadedAmmo,
  placeLootContainers,
  searchKey,
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
  markBrought,
  settleFound,
  keptItems,
  rollEnemyLoot,
  startEnemies,
  rollLootSpawns,
  startRaid,
  factionOf,
  itemDef,
  type LeaveReason,
  type Gear,
  type KillCounts,
  type GraphicsQuality,
  findKey,
  keyName,
  syncDoors,
  syncGlass,
  investigateInReach,
  investigatedBy,
  keptGear,
  objectiveText,
  raidObjectives,
  raidProgress,
  startQuests,
  type Profile,
  type SimState,
  totalHp,
  isBleeding,
  HEALTH,
  ZONE_COUNT,
  RAID_FORMAT_VERSION,
  adminGiveGun,
  adminPowerup,
  buyInReach,
  holdsDeathMachine,
  windowInReach,
  pointsOf,
  spotPrice,
  barricadeWindows,
  startZombies,
  type Powerup,
  type ZombiesDef,
} from '@mes/shared';
import * as THREE from 'three';
import { startLoop } from '../app/loop';
import { pause } from '../app/pause';
import { SoundCues } from '../audio/cues';
import { sounds } from '../audio/sounds';
import {
  checkEnemySpawns,
  checkLootContainers,
  loadEnemies,
  loadItems,
  loadLootContainers,
  loadLootTables,
  loadMap,
  loadContracts,
  loadQuests,
  loadRaid,
} from '../content';
import { Stats } from '../debug/stats';
import { HandsHud } from '../hud/hands';
import type { Hud } from '../hud/hud';
import { AIM_FOV, FOV, aimedFov, type OpticOverlay } from '../hud/optic';
import { EnemyBars } from '../hud/enemy-bars';
import type { RaidHud } from '../hud/raid-hud';
import { SpectateBar } from '../hud/spectate';
import type { HitDirection } from '../hud/hit-direction';
import type { Vitals } from '../hud/vitals';
import { Controls } from '../input/controls';
import { inputMode } from '../input/mode';
import { PadRumble } from '../input/pad-rumble';
import { HIP_FOLLOW, PAD_FOLLOW, bearing, followRate } from '../input/aim-follow';
import {
  anyCheat,
  applySimCheats,
  applyZombieCheats,
  readCheats,
  readZombieCheats,
} from '../admin-cheats';
import { ZombiesAdmin } from './zombies-admin';
import { buildDebug } from '../render/debug';
import {
  fightWith,
  fireKey,
  lastCombat,
  logBleed,
  logBurn,
  logFight,
  logHit,
  logKiller,
  logKillingHit,
  type DamageLog,
  type FightInfo,
  type FightLog,
} from './damage-log';
import { CapsuleBody } from '../render/capsule-body';
import { DEFAULT_OUTFIT, loadCharacter } from '../render/character';
import { CharacterBody, CharacterRig } from '../render/character-body';
import { Effects } from '../render/effects';
import { buildExtractions } from '../render/extractions';
import { FIRE_SVG, FireViews } from '../render/fire';
import { INCENDIARY_TRACER, TRACER_COLOUR } from '../render/effects';
import { GrenadeViews } from '../render/grenades';
import { GroundItems } from '../render/ground-items';
import { LandmarkPass } from '../render/landmarks';
import { buildMap, updateDoors, updateGlass, updateSearchedLooks } from '../render/map';
import { buildWallBuys } from '../render/wall-buys';
import { BoxOffers } from '../render/box-offers';
import { Barricades } from '../render/barricades';
import { Powerups } from '../render/powerups';
import { AiDebug, buildNavOverlay } from '../render/nav-debug';
import { Viewmodel } from '../render/viewmodel';
import { settings } from '../settings';
import type { RaidScreenHandle } from '../ui/raid';
import { clearSnapshot, saveResult, saveSnapshot, type RaidSnapshot } from '../raids';
import type { RaidKill, RaidResult } from '../ui/results';
import { contractRaidLines } from '../ui/hangar-text';
import { CoopGuest, CoopHost, type CoopOptions, type Welcome } from './coop';
import { giveUp, skipTutorial } from './give-up';
import { TutorialCard } from '../hud/tutorial-card';
import { lootableInReach } from './loot';

export interface PlayElements {
  canvas: HTMLCanvasElement;
  stats: HTMLElement;
  hud: Hud;
  optic: OpticOverlay;
  vitals: Vitals;
  /** Where hits on you came from (TU-1). */
  hitDirection: HitDirection;
  /** The raid timer and the extraction countdown. */
  raidHud: RaidHud;
  /** Where the raid screen (inventory, map, quests) opens. */
  raid: HTMLElement;
  /** Where the results screen opens when the raid ends for you. */
  results: HTMLElement;
  /** For the enemy health bars admin cheat. */
  enemyBars: HTMLElement;
  /** Where the tutorial's prompt card and marker go (TU-3). */
  tutorial: HTMLElement;
}

/** What dev-only extras in a raid get (the map notes, dev-notes.ts, 2026-10-30). */
export interface DevHooks {
  scene: THREE.Scene;
  player: Character;
  /**
   * Opens or closes a dev screen: while open, you stand still and have the cursor, as with
   * the inventory. Call it from the key or click that opens or closes it.
   */
  screen(open: boolean): void;
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
  /**
   * Debug: start at this x, z instead of a spawn (facing the spawn's way): on the highest
   * floor at or below y if given, else on the floor nearest the ground.
   */
  at: [number, number] | [number, number, number] | null;
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
  /** Enemies never notice you: the admin cheat, from ?peaceful. */
  peaceful: boolean;
  /** Shown in the stats header, e.g. "standalone". */
  note: string;
  /** A party raid (docs/coop.md, C5): this device hosts it, or joins the host's. */
  coop?: CoopOptions | null;
  /** Says what a party raid is waiting for while it connects. */
  status?: (text: string) => void;
  /**
   * A zombies game (2026-11-04) instead of a raid: this mode's map and rules, and you wear
   * the profile's gear (its kit, not your stash). Nothing is saved or sent.
   */
  zombies?: ZombiesDef | null;
  /**
   * The tutorial (TU-3) in its offline raid (`raid`), wearing the profile's gear (its kit):
   * its steps' prompts on screen as they come. Nothing is saved or sent; `leave` is called
   * to skip it or, from the results, to go on.
   */
  tutorial?: { def: CompiledTutorial; leave: () => void } | null;
}

/** How far into aiming a red dot's reticle shows, once the sight has come up to the eye. */
const RETICLE_IN = 0.95;
/** How far into aiming a scope switches to its full-screen zoom. */
const SCOPE_IN = 0.9;
const DEG = Math.PI / 180;
/** The view tilts this much of the body's lean angle. */
const LEAN_ROLL = 0.35;
/** With ?respawn, dead enemies come back at their spawn after this long. */
const ENEMY_RESPAWN_MS = 6000;
/** How long after you die the results screen comes up. */
const RESULTS_AFTER_DEATH_MS = 1500;
/** How much aim assist slows looking while the crosshair is on an enemy. */
const ASSIST = { off: 1, low: 0.8, medium: 0.6, high: 0.45 } as const;
/**
 * The same with a controller (CP-1): a stick can't flick back onto a target as a thumb or
 * mouse can, so it slows more. A first guess, for the user to tune with the real pad.
 */
const PAD_ASSIST = { off: 1, low: 0.7, medium: 0.5, high: 0.35 } as const;
/** The point on a target that rotational aim assist follows: about chest height. */
const FOLLOW_HEIGHT = 0.7;

/** The primary △ takes out: the other one if you carry it, else whichever you carry. */
function otherPrimary(gear: Character['gear']): Hand | null {
  const first = gear.primary1 ? 'primary1' : null;
  const second = gear.primary2 ? 'primary2' : null;
  if (gear.hand === 'primary1') return second;
  if (gear.hand === 'primary2') return first;
  return first ?? second;
}

/** What the HUD calls each power-up. */
const POWERUP_NAMES: Record<Powerup, string> = {
  instaKill: 'Insta-kill',
  maxAmmo: 'Max ammo',
  doublePoints: 'Double points',
  carpenter: 'Carpenter',
  deathMachine: 'Death machine',
};

/** A zombies game as a raid config, for what reads one: its map, and no timer to speak of. */
/** What an enemy spawn takes from its type. */
function typeOptions(type: EnemyDef): EnemySpawnOptions {
  return {
    skill: type.skill,
    faction: type.faction,
    outfits: type.outfits?.length ?? 1,
    type: type.id,
    voiced: !!(type.voice?.breathe || type.voice?.mutter),
    limbHealth: type.limbHealth,
  };
}

/** The outfit an enemy of this type was given at spawn (Character.look). */
function outfitOf(type: EnemyDef, outfit: number): Outfit {
  const outfits = type.outfits;
  if (!outfits) return DEFAULT_OUTFIT;
  return outfits[outfit] ?? outfits[0]!;
}

function zombiesRaid(def: ZombiesDef): RaidDef {
  return {
    formatVersion: RAID_FORMAT_VERSION,
    id: `zombies-${def.id}`,
    name: def.name,
    map: def.map,
    duration: 1,
  };
}

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
  const coop = options.coop ?? null;
  const status = options.status ?? (() => {});
  // A guest connects first: the host's raid is where it starts from, like a saved raid.
  let guest: CoopGuest | null = null;
  let welcome: Welcome | null = null;
  if (coop?.role === 'guest') {
    ({ guest, welcome } = await CoopGuest.connect(coop, coop.name, options.profile.gear, status));
    status('');
  }
  const zombiesMode = options.zombies ?? null;
  const tutorialMode = options.tutorial ?? null;
  const raid =
    options.test?.raid ?? (zombiesMode ? zombiesRaid(zombiesMode) : loadRaid(options.raid));
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

  // The graphics setting: antialiasing is fixed with the context, so a change to it waits
  // for the next raid; the pixel ratio follows a change at once (below, with resize).
  const graphics = (): (typeof GRAPHICS_QUALITY)[GraphicsQuality] =>
    GRAPHICS_QUALITY[settings.current.graphics];
  const renderer = new THREE.WebGLRenderer({
    canvas: el.canvas,
    antialias: graphics().antialias,
    powerPreference: 'high-performance',
  });
  const pixelRatio = (): number => Math.min(window.devicePixelRatio, graphics().pixelRatio);
  renderer.setPixelRatio(pixelRatio());
  // Landmarks past the fog, the world over them, then the gun over it, depth cleared
  // between each, so the gun never pokes into walls.
  renderer.autoClear = false;
  // Count every pass in the stats.
  renderer.info.autoReset = false;
  const { sky, fogNear, fogFar } = map.environment;
  const scene = new THREE.Scene();
  // The sky is the clear colour, not the scene's background: a background clears the
  // screen, which would wipe the landmarks drawn before the world.
  renderer.setClearColor(sky);
  scene.fog = new THREE.Fog(sky, fogNear, fogFar);
  // The far plane follows the fog distance.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, fogFar);
  camera.rotation.order = 'YXZ';
  const landmarks = new LandmarkPass(map);

  const mapView = buildMap(map);
  scene.add(mapView.root);
  // The raid's open extraction points, drawn once it has them: built again when they
  // change (the raid starting, or a co-op guest getting the host's pick).
  let extractView: THREE.Mesh | null = null;
  let extractShown: readonly unknown[] | null = null;
  let extractCount = -1;
  const showExtractions = (): void => {
    // Yours (the raid's list for you is made once, so a change of it is a new array).
    const open = sim.raid ? (sim.raid.open?.[player.id] ?? sim.raid.extractions) : null;
    if (open === extractShown && (open?.length ?? -1) === extractCount) return;
    extractShown = open;
    extractCount = open?.length ?? -1;
    if (extractView) {
      scene.remove(extractView);
      extractView.geometry.dispose();
      (extractView.material as THREE.Material).dispose();
    }
    extractView = open ? buildExtractions(extractionsOf(sim, player)) : null;
    if (extractView) scene.add(extractView);
  };
  if (zombiesMode) scene.add(buildWallBuys(map, items, world));
  const groundItems = new GroundItems(items);
  scene.add(groundItems.root);
  if (options.debug) scene.add(buildDebug(map, world.terrain));
  if (options.nav) scene.add(buildNavOverlay(nav));
  const aiDebug = options.debug ? new AiDebug() : null;
  if (aiDebug) scene.add(aiDebug.root);
  const effects = new Effects();
  scene.add(effects.root);
  const grenades = new GrenadeViews(items, world);
  scene.add(grenades.root);
  const fires = new FireViews();
  scene.add(fires.root);
  const viewmodel = new Viewmodel();
  const cues = new SoundCues(sounds(), world, items, types);
  // Rendered now rather than as each is first heard (if audio is unlocked yet).
  sounds().prepare();
  const rig = new CharacterRig(await loadCharacter('/characters/mannequin.glb'));

  const controls = new Controls(el.canvas, el.hud);
  const rumble = new PadRumble();
  controls.pad.onSoundLocked = () =>
    el.raidHud.note('No sound yet: click or press a key once', performance.now(), 5000);
  const resume: RaidSnapshot | null =
    options.resume ??
    (welcome && {
      version: 1,
      serverRaid: options.serverRaid,
      raid: options.raid,
      spawn: welcome.spawn,
      player: welcome.you,
      kills: 0,
      taken: [],
      sim: welcome.state,
    });
  const sim = resume?.sim ?? createState(Date.now() >>> 0);
  // A raid saved before grenades (2026-10-30) has none in flight, nor smoke or fire
  // (2026-10-31).
  (sim as Partial<SimState>).grenades ??= [];
  (sim as Partial<SimState>).smokes ??= [];
  (sim as Partial<SimState>).flames ??= [];
  (sim as Partial<SimState>).fires ??= [];
  // How far noises carry for the AI on this map (AI rework session 1).
  sim.hearingScale = map.hearingScale ?? 1;
  const spawns = map.markers.filter((m) => m.type === 'playerSpawn');
  const spawn =
    spawns.find((m) => m.id === (resume?.spawn ?? options.spawn)) ??
    pick(createRng(Date.now() >>> 0), spawns);
  let player: Character;
  if (resume) {
    const found = sim.entities.find((e) => e.id === resume.player);
    if (!found) throw new Error('the saved raid has no player');
    player = found;
    // A raid saved before found-in-raid marks: nothing in it counts as found.
    if (!player.marked) markBrought(player);
    controls.yaw = player.yaw;
    controls.pitch = player.pitch;
  } else {
    // Below the spawn's height plus a little, so a spawn under a roof stays inside.
    const [startX, startZ, startY] = options.at ?? [spawn.x, spawn.z];
    player = spawnCharacter(
      sim,
      world,
      startX,
      startZ,
      spawn.yaw,
      // ?at without a height stands you on the floor nearest the ground there, not on a roof.
      startY ?? (options.at ? world.terrain.heightAt(startX, startZ) + 1 : spawn.y + 0.5),
    );
    player.gear = structuredClone(options.profile.gear);
    markBrought(player);
    if (zombiesMode) startZombies(sim, map, zombiesMode);
    else {
      placeLootContainers(sim, map, lootKinds);
      fillLootContainers(sim, map, items, lootTables, lootKinds);
      rollLootSpawns(sim, map, items, lootTables);
      startRaid(sim, map, options.duration ?? raid.duration);
      // Your extractions: those your spawn allows, rotating ones picked for it.
      openExtractions(sim, player, spawn);
      if (!tutorialMode)
        startQuests(sim, map, items, player.id, raidObjectives(options.profile, quests, raid.map));
    }
    controls.yaw = spawn.yaw;
  }
  // Admin cheats (dev builds only); ?peaceful turns that one on too. Set again when
  // resuming, so a change on the admin page applies.
  const cheats = readCheats();
  cheats.peaceful ||= options.peaceful;
  applySimCheats(player, cheats);
  // Zombies cheats (dev builds only): infinite points, and guns to start a new game with.
  const zombieCheats = zombiesMode ? readZombieCheats() : null;
  if (zombieCheats) {
    applyZombieCheats(player, zombieCheats);
    if (!resume)
      for (const id of zombieCheats.guns) if (items.has(id)) adminGiveGun(sim, items, player, id);
  }
  if (
    anyCheat(cheats) ||
    zombieCheats?.infinitePoints ||
    zombieCheats?.alwaysDrop ||
    zombieCheats?.guns.length
  )
    el.raidHud.note('Admin cheats on', performance.now());
  const held = heldWeapon(player);
  if (held) viewmodel.setGun(held, items);
  // The tutorial's steps (TU-3), followed after every tick; its card shows the one on.
  const tutorialProgress = tutorialMode ? startTutorial(player) : null;
  const tutorialCard = tutorialMode
    ? new TutorialCard(el.tutorial, tutorialMode.def, el.hud, tutorialMode.leave)
    : null;
  tutorialCard?.show(0);
  skipTutorial.set(tutorialMode && tutorialMode.leave);
  /** A dev screen (a note being written, or the zombies admin panel) is open. */
  let devScreen = false;
  // Zombies mode's in-game admin panel, on the dev server.
  const zombiesAdmin =
    import.meta.env.DEV && zombiesMode
      ? new ZombiesAdmin(
          items,
          [...new Set([...zombiesMode.box.map((o) => o.item), zombiesMode.powerups.minigun])],
          (open) => {
            devScreen = open;
            controls.reset();
            controls.cursor.want(!open);
          },
        )
      : null;
  // Map notes in every raid on the dev server; a build leaves them out.
  if (import.meta.env.DEV) {
    const dev: DevHooks = {
      scene,
      player,
      screen: (open) => {
        devScreen = open;
        controls.reset();
        controls.cursor.want(!open);
      },
    };
    import('../dev-notes')
      .then((m) => m.showNotes(raid.map, dev))
      .catch((err: unknown) => console.error('map notes failed', err));
  }
  /** What each quest marker on this map is for, shown under the crosshair. */
  const markerText = new Map<string, string>();
  for (const q of quests) {
    for (const o of q.objectives) {
      if (o.type === 'investigate' && o.map === raid.map) markerText.set(o.marker, o.text);
    }
  }
  // Zombies mode's windows' planks.
  // Outside a zombies game (a map's play-test without zombie spawns), a barricade still
  // blocks, so it's drawn boarded up full.
  const barricades = sim.zombies
    ? new Barricades(sim.zombies.windows)
    : map.barricades.length
      ? new Barricades(barricadeWindows(map))
      : null;
  if (barricades) {
    if (!sim.zombies) barricades.update(barricadeWindows(map));
    scene.add(barricades.root);
  }
  const powerupViews = sim.zombies ? new Powerups() : null;
  if (powerupViews) scene.add(powerupViews.root);
  // The mystery box's gun, hovering over it.
  const boxOffers = sim.zombies ? new BoxOffers(sim.zombies.buys, items, world) : null;
  if (boxOffers) scene.add(boxOffers.root);
  // Locked doors cut the nav grid now, not in the first frame.
  syncDoors(sim, world, nav);
  syncGlass(sim, world);
  updateGlass(mapView, sim.glass);
  updateSearchedLooks(mapView, sim.loot);

  // Enemies: their type's skill, and its loadout (or the spawn's) rolled.
  const patrols = new Map(map.patrols.map((p) => [p.id, p]));
  const names = new Map<number, string>();
  /** Whether someone's gun is loaded with incendiary rounds (for their shots' look). */
  const incendiary = (id: number): boolean => {
    const c = entityById(sim, id);
    const w = c && heldWeapon(c);
    const round = w ? items.get(loadedAmmo(items, w)) : undefined;
    return round?.type === 'ammo' && !!round.incendiary;
  };
  /** Whoever set you alight, for the damage log. */
  const burnerName = (by: number): string =>
    by === player.id ? 'Your own flamethrower' : (names.get(by) ?? 'Someone');
  const enemies: {
    c: Character;
    body: CharacterBody;
    zones: CapsuleBody | null;
    diedAt: number;
    arm: () => void;
  }[] = [];
  const enemyChars: Character[] = [];
  const bodyOf = new Map<number, CharacterBody>();
  const enemyBars = cheats.enemyHealth ? new EnemyBars(el.enemyBars) : null;
  el.enemyBars.hidden = !enemyBars;
  /**
   * Draws an enemy of a type (or a zombie, in zombies mode) that's in the state, armed by
   * `arm` (if it isn't yet).
   */
  function addEnemy(c: Character, name: string, outfit: Outfit, arm: () => void): void {
    const body = new CharacterBody(rig, outfit, c);
    scene.add(body.root);
    const zones = options.hitZones ? new CapsuleBody(0.45) : null;
    if (zones) scene.add(zones.root);
    enemies.push({ c, body, zones, diedAt: 0, arm });
    enemyChars.push(c);
    bodyOf.set(c.id, body);
    names.set(c.id, name);
    enemyBars?.add(c);
  }
  // A new raid puts its enemies in (sim/waves.ts): the bosses and a third of the scavs now,
  // the rest of the scavs in waves. Resumed, or a co-op guest, they're in the state already.
  if (!resume) {
    startEnemies(sim, world, map, items, { types, loadouts, tables: lootTables, patrols });
  } else {
    // Saved before enemies kept their look (AI rework session 2): their type from the
    // spawn marker, or the spawner gun's key, they were saved under; the first outfit.
    for (const [key, id] of Object.entries(resume.enemies ?? {})) {
      const c = sim.entities.find((e) => e.id === id);
      const marker = map.markers.find((m) => m.id === key);
      const type = key.startsWith('spawner:')
        ? key.split(':')[1]
        : marker?.type === 'enemySpawn'
          ? marker.enemy
          : undefined;
      if (c && !c.look && type) c.look = { type, outfit: 0 };
    }
  }
  /** Arming for ?respawn: its type's loadout and loot (not a spawn's own). */
  const armOf = (c: Character, type: EnemyDef) => (): void => {
    equipLoadout(c, items, loadouts.get(type.loadout)!, sim.rng);
    rollEnemyLoot(c, items, lootTables, type.loot, undefined, sim.rng);
  };
  /**
   * Draws every enemy in the state not drawn yet: at the start, and each tick for those
   * arriving in waves or from a spawner gun, on the host and on co-op guests alike.
   */
  function drawNewEnemies(): void {
    for (const c of sim.entities) {
      if (!c.look || bodyOf.has(c.id)) continue;
      const type = types.get(c.look.type);
      if (type) addEnemy(c, type.name, outfitOf(type, c.look.outfit), armOf(c, type));
    }
  }
  drawNewEnemies();
  // The other players in a party raid, drawn like enemies but never armed or brought back.
  const others: { c: Character; body: CharacterBody }[] = [];
  function addOther(c: Character, name: string): void {
    const body = new CharacterBody(rig, DEFAULT_OUTFIT, c);
    scene.add(body.root);
    others.push({ c, body });
    bodyOf.set(c.id, body);
    names.set(c.id, name);
  }
  let host: CoopHost | null = null;
  if (coop?.role === 'host') {
    host = await CoopHost.connect(coop, status);
    status(host.size ? 'Letting everyone in…' : '');
    // Guests start beside the host, either side of it in turn.
    const rx = Math.cos(spawn.yaw);
    const rz = -Math.sin(spawn.yaw);
    const admitted = await host.admit(
      (_name, gear, i) => {
        const side = (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1) * 0.9;
        const c = spawnCharacter(
          sim,
          world,
          player.x + rx * side,
          player.z + rz * side,
          spawn.yaw,
          spawn.y + 0.5,
        );
        c.gear = structuredClone(gear);
        markBrought(c);
        // Beside you, from your spawn: the same extractions as yours.
        openExtractions(sim, c, spawn);
        return c;
      },
      { spawn: spawn.id, host: player, name: coop.name },
      sim,
    );
    for (const a of admitted) addOther(a.character, a.name);
    status('');
  }
  if (guest && welcome) {
    for (const [id, name] of Object.entries(welcome.players)) {
      const c = sim.entities.find((e) => e.id === Number(id));
      if (c && c !== player) addOther(c, name);
    }
    guest.start();
  }

  /** An admin spawner gun's shot landed: an enemy of its type there, armed, facing back. */
  function spawnRequested(e: SpawnRequestEvent): void {
    const type = types.get(e.enemy);
    if (!type) return;
    const c = spawnEnemy(sim, world, e.x, e.y, e.z, e.yaw, typeOptions(type));
    armOf(c, type)();
    drawNewEnemies();
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
  const inputs: Record<EntityId, PlayerInput> = { [player.id]: input };
  // What the frame draws between ticks: the eye, aim, recoil and how far drawn what's in
  // hand is, from the last two ticks.
  // The view between ticks. Look (yaw, pitch) is only used spectating: your own is the
  // controls', every frame.
  const prev = {
    x: eyeX(player),
    y: eyeHeight(player),
    z: eyeZ(player),
    lean: 0,
    aim: 0,
    rp: 0,
    ry: 0,
    sp: 0,
    sy: 0,
    drawn: 1,
    yaw: 0,
    pitch: 0,
  };
  const cur = { ...prev };

  const stats = new Stats(
    el.stats,
    renderer,
    `${raid.name}  ${map.name}  spawn ${spawn.id}${options.debug ? '  debug' : ''}  ` +
      `nav ${nav.nodeCount} nodes ${navMs.toFixed(0)} ms  ${options.note}`,
    () =>
      `${awarenessSummary()}  ${player.mode}${player.height < 1.19 ? ' prone' : player.height < 1.79 ? ' crouched' : ''}  ` +
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
   * with the knife out) and in sight; not on another player.
   */
  function onTarget(): boolean {
    const w = heldWeapon(player);
    const knife = player.gear.knife;
    let range: number;
    if (w) range = weaponDef(items, w.item).range;
    else if (knife && knifeOut()) range = meleeDef(items, knife.item).reach;
    else return false;
    const yaw = controls.yaw + player.recoilYaw + (player.swayYaw ?? 0);
    const pitch = controls.pitch + player.recoilPitch + (player.swayPitch ?? 0);
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    const ex = eyeX(player);
    const ey = eyeHeight(player);
    const ez = eyeZ(player);
    const wall = world.raycast(ex, ey, ez, dx, dy, dz, range, aimWorld);
    const reach = Math.min(wall, range);
    const d = raycastCharacters(sim, ex, ey, ez, dx, dy, dz, reach, player.id, aimHit);
    // No help aiming at someone hidden in smoke, or at another player in a party raid.
    return (
      d < Infinity &&
      !others.some((o) => o.c.id === aimHit.id) &&
      !smokeBlocks(sim.smokes, ex, ey, ez, ex + dx * d, ey + dy * d, ez + dz * d)
    );
  }

  // Rotational aim assist on a pad: the bearing to the target under the crosshair, a tick
  // ago and now, by target (input/aim-follow.ts).
  let followId = 0;
  const followPrev = { yaw: 0, pitch: 0 };
  const followNow = { yaw: 0, pitch: 0 };
  const followOut = { yaw: 0, pitch: 0 };
  function followTarget(target: boolean): void {
    const share = PAD_FOLLOW[settings.current.aimAssist] * (controls.aim ? 1 : HIP_FOLLOW);
    const c = target && inputMode.gamepad && share > 0 ? entityById(sim, aimHit.id) : undefined;
    if (!c) {
      followId = 0;
      controls.followYaw = controls.followPitch = 0;
      return;
    }
    bearing(
      eyeX(player),
      eyeHeight(player),
      eyeZ(player),
      c.x,
      c.y + c.height * FOLLOW_HEIGHT,
      c.z,
      followNow,
    );
    if (followId === c.id) followRate(followPrev, followNow, 1 / TICK_RATE, share, followOut);
    else followOut.yaw = followOut.pitch = 0;
    controls.followYaw = followOut.yaw;
    controls.followPitch = followOut.pitch;
    followId = c.id;
    followPrev.yaw = followNow.yaw;
    followPrev.pitch = followNow.pitch;
  }

  const debugRng = createRng(1);
  const muzzle = new THREE.Vector3();
  const gunPoint = new THREE.Vector3();
  const viewInverse = new THREE.Quaternion();

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
  // Rounds picked from the reload button's picker, loaded with the next tick's reload.
  // The grenade picked is named on screen too (on a desktop, where the button is hidden).
  const hands = new HandsHud(
    el.hud,
    (ref) => (picked = ref),
    (name) => el.raidHud.note(`Grenade · ${name}`, performance.now()),
  );
  controls.picker = hands;
  // A flash's white screen, the grey of standing in smoke, and flames while you burn.
  const blindEl = document.getElementById('blind')!;
  const smokeVeil = document.getElementById('smoke-veil')!;
  const burnEl = document.getElementById('burn')!;
  // The flame drawn once now into a bitmap at the size it's shown (style.css: 70 × 140), not
  // left an SVG: the browser drew the SVG afresh for each of the row's flames the first time
  // you caught fire, which stalled the game for most of a second (2026-10-31).
  const glowEdge =
    'radial-gradient(ellipse at center, transparent 55%, rgb(255 110 30 / 0.45) 100%)';
  const flameImage = new Image();
  flameImage.onload = () => {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(70 * scale);
    canvas.height = Math.round(140 * scale);
    canvas.getContext('2d')?.drawImage(flameImage, 0, 0, canvas.width, canvas.height);
    burnEl.style.backgroundImage = `url("${canvas.toDataURL()}"), ${glowEdge}`;
  };
  flameImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FIRE_SVG)}`;
  burnEl.style.backgroundImage = glowEdge;
  let burnShown = false;
  let blindShown = -1;
  let veilShown = -1;
  // A mask's narrower view and muffled sound (AI-7), by the helmet they were last set for.
  const maskEl = document.getElementById('mask-view')!;
  let maskFor: string | null = null;
  maskEl.classList.remove('on');
  sounds().setMuffle(null);

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
  // What the open screen shows beside your gear (a container or body is searched while open).
  let openTarget: Owner | null = null;
  const pending: InventoryAction[] = [];
  input.inventory = pending;
  let inventoryChanged = false;
  const useButton = el.hud.button('interact');
  let useLabel = '';
  // Zombies mode has no inventory: nothing to open it with.
  if (zombiesMode) el.hud.button('bag').hidden = true;
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
    openTarget = target;
    controls.cursor.want(false);
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
            world,
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
    openTarget = null;
    // From the key or click that closed it, if it was one: browsers only lock on a gesture.
    if (!ended) controls.cursor.want(true);
    pending.length = 0;
    screen?.hide();
    // A fresh handle next time, so it opens on the inventory tab.
    screen = null;
  }

  // The raid ends for you when you extract, die or run out of time; the results screen
  // comes up a moment later after a death, so you see it happen.
  let kills = resume?.kills ?? 0;
  /** Kills by the faction killed (H6: contracts count them). */
  const killed: KillCounts = { ...resume?.killed };
  /** Who you killed and when, oldest first (for the results' kill list). */
  const killList: RaidKill[] = resume?.killList ?? [];
  /** The enemy type that killed you, if one did. */
  let killedBy: string | null = null;
  /** What hurt you, for the results screen after a death. */
  const taken: DamageLog = resume?.taken ?? [];
  // Fetch the screens a raid opens later (inventory, settings, results) now, while the
  // build this page came from is still the one deployed: a deploy mid-raid would leave their
  // chunks missing (2026-11-10, "settings failed" while spectating). Failing here reloads
  // (app/stale-build.ts), before the raid has much to lose.
  void Promise.all([import('../ui/raid'), import('../ui/results'), import('../ui/menu')]).catch(
    () => undefined,
  );
  /** Hits between you and enemies, for the fight with your killer. */
  const fight: FightLog = resume?.fight ?? [];
  /** The enemy that killed you, if one did. */
  let killerId = 0;
  let ended: RaidResult | null = null;
  let resultsAt = 0;
  // Giving up from the settings screen kills you on the next tick.
  let givingUp = false;
  let gaveUp = false;
  if (!tutorialMode)
    giveUp.set(() => {
      givingUp = true;
      // The results screen wants the cursor free.
      controls.cursor.want(false);
    });
  /** The fight with whoever killed you, newest hit first. */
  const fightOf = (): RaidResult['fight'] => {
    const hits = killerId ? fightWith(fight, killerId) : [];
    return hits.length ? { name: names.get(killerId) ?? 'Someone', hits } : undefined;
  };
  /** The latest fight, everyone in it, newest hit first, each with the other's name. */
  const combatOf = (): NonNullable<RaidResult['combat']> =>
    lastCombat(fight).map((h) => ({ ...h, name: names.get(h.other) ?? 'Someone' }));
  /** How far apart, and the shooter's gun and round (or knife), as a hit lands. */
  const fightInfo = (e: { by: number; target: number; cause: string }): FightInfo => {
    const from = sim.entities.find((c) => c.id === e.by);
    const to = sim.entities.find((c) => c.id === e.target);
    const info: FightInfo = {};
    if (from && to) info.distance = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
    if (from && e.cause === 'melee' && from.gear.knife) info.weapon = from.gear.knife.item;
    const gun = from && e.cause === 'shot' ? heldWeapon(from) : null;
    if (gun) {
      info.weapon = gun.item;
      info.ammo = loadedAmmo(items, gun);
    }
    return info;
  };
  function endRaid(how: LeaveReason | 'killed', detail: string, now: number, place?: string): void {
    if (ended) return;
    el.hitDirection.clear();
    giveUp.set(null);
    skipTutorial.set(null);
    tutorialCard?.close();
    if (tutorialMode) {
      // Nothing to keep, lose or save.
      ended = {
        how,
        detail,
        seconds: sim.tick / TICK_RATE,
        kills,
        kept: [],
        lost: [],
        quests: [],
        taken,
        fight: fightOf(),
        keptAll: false,
        tutorial: true,
      };
      resultsAt = now + (how === 'killed' ? RESULTS_AFTER_DEATH_MS : 0);
      closeScreen();
      return;
    }
    if (zombiesMode) {
      // Nothing to keep, lose or save: how far you got.
      ended = {
        how,
        detail,
        seconds: sim.tick / TICK_RATE,
        kills,
        kept: [],
        lost: [],
        quests: [],
        taken,
        fight: fightOf(),
        keptAll: false,
        zombies: {
          mode: zombiesMode.name,
          round: sim.zombies?.round ?? 0,
          points: pointsOf(sim, player.id),
        },
      };
      resultsAt = now + (how === 'killed' ? RESULTS_AFTER_DEATH_MS : 0);
      closeScreen();
      return;
    }
    const survived = how === 'extracted';
    const keepAll = survived || cheats.keepGear;
    const kept = keptItems(player.gear, keepAll);
    const seconds = sim.tick / TICK_RATE;
    const investigated = investigatedBy(sim, player.id);
    // What the server will count, worked out the same way on copies: quest items it takes.
    const done = raidProgress(
      structuredClone(options.profile),
      quests,
      items,
      raid.map,
      investigated,
      keptGear(structuredClone(player.gear), keepAll),
    );
    const isQuestItem = (i: Item): boolean => itemDef(items, i.item).type === 'quest';
    ended = {
      how,
      detail,
      seconds,
      kills,
      killList: [...killList].reverse(),
      map: raid.name,
      ...(place ? { place } : {}),
      player: { ...player, gear: structuredClone(player.gear) },
      kept: kept.filter((i) => !isQuestItem(i)),
      lost: gearItems(player.gear).filter((i) => !kept.includes(i)),
      quests: [
        ...done.map((d) => ({ quest: d.quest.name, text: objectiveText(items, d.objective) })),
        ...contractRaidLines(
          options.profile,
          loadContracts(),
          raid.map,
          killed,
          { item: (id) => itemDef(items, id).name, vendor: (id) => id },
          () => raid.name,
        ),
      ],
      taken,
      fight: fightOf(),
      ...(how === 'killed' ? { combat: combatOf(), killedBy: killedBy ?? detail } : {}),
      keptAll: keepAll,
    };
    // Sent now, as it is: the server keeps what the outcome allows.
    const gear = JSON.parse(JSON.stringify(player.gear)) as Gear;
    settleFound(gear);
    if (!options.test) {
      saveResult(options.serverRaid, {
        how,
        gear,
        seconds,
        kills,
        killed,
        detail,
        investigated,
        ...(cheats.keepGear ? { keepGear: true } : {}),
      }).catch((err: unknown) => console.error('saving the raid failed', err));
      clearSnapshot();
    }
    resultsAt = now + (how === 'killed' ? RESULTS_AFTER_DEATH_MS : 0);
    closeScreen();
  }
  let resultsShown = false;
  function showResults(result: RaidResult): void {
    if (resultsShown) return;
    resultsShown = true;
    // A guest is done with the host's raid: let it stop sending.
    guest?.close();
    import('../ui/results')
      .then((ui) => {
        // The next raid starts from the page, which sends anything not yet saved first.
        ui.showResults(el.results, result, items, () =>
          tutorialMode ? tutorialMode.leave() : location.reload(),
        );
        // Nothing more to play: stop drawing. A host keeps the raid going for its guests.
        if (!host?.playing(sim)) pause.set('ended', true);
      })
      .catch((err: unknown) => console.error('results screen failed', err));
  }

  // Spectating (docs/coop.md, C8): killed in a party raid, you watch through the eyes of a
  // teammate still in it, until they're out too or you go to the results. Only what they
  // see, never a free camera, so it tells you no more than they could.
  let watching: Character | null = null;
  /** The view's sideways jolt from the last hit (TU-1), radians; it fades each frame. */
  let punchRoll = 0;
  const spectateBar = coop
    ? new SpectateBar(
        () => watch(-1),
        () => watch(1),
        () => stopWatching(),
      )
    : null;
  const stillIn = (c: Character): boolean => !c.health.dead && sim.entities.includes(c);
  /** Watches the next teammate still in the raid (or the one before), or goes to the results. */
  function watch(step: 1 | -1): void {
    const live = others.filter((o) => stillIn(o.c));
    if (!live.length) return stopWatching();
    const i = live.findIndex((o) => o.c === watching);
    watching = live[i < 0 ? 0 : (i + step + live.length) % live.length]!.c;
    showOthers();
    el.hitDirection.clear();
    // Straight there, not swept across the map from the last view.
    follow();
    Object.assign(prev, cur);
    spectateBar?.show(names.get(watching.id) ?? 'Teammate');
  }
  function stopWatching(): void {
    watching = null;
    spectateBar?.hide();
    showOthers();
    showResults(ended!);
  }
  /** The other players still in the raid are drawn, but not the one you see through. */
  function showOthers(): void {
    for (const o of others) o.body.root.visible = o.c !== watching && sim.entities.includes(o.c);
  }
  /** Where the view is after a tick: through your eyes, or the teammate's you're watching. */
  function follow(): void {
    const v = watching ?? player;
    cur.x = eyeX(v);
    cur.y = eyeHeight(v);
    cur.z = eyeZ(v);
    cur.lean = v.lean ?? 0;
    cur.aim = v.aim;
    cur.rp = v.recoilPitch;
    cur.ry = v.recoilYaw;
    cur.sp = v.swayPitch ?? 0;
    cur.sy = v.swayYaw ?? 0;
    const total = drawTime(items, v.gear, v.gear.hand);
    cur.drawn = total > 0 ? 1 - v.draw / total : 1;
    cur.yaw = v.yaw;
    cur.pitch = v.pitch;
  }

  // Saved whenever the page is hidden, in case iOS unloads it while you're away.
  const snapshot = (): void => {
    // A party raid can't be picked up again from one device (C7).
    if (ended || options.test || coop || zombiesMode || tutorialMode) return;
    saveSnapshot({
      version: 1,
      serverRaid: options.serverRaid,
      raid: options.raid,
      spawn: spawn.id,
      player: player.id,
      kills,
      killed,
      killList,
      taken,
      fight,
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
    controls.assist = target
      ? (inputMode.gamepad ? PAD_ASSIST : ASSIST)[settings.current.aimAssist]
      : 1;
    followTarget(target);
    // Mid-burst, assist only slows turning sideways, never pulling down against recoil.
    controls.assistPitch = (player.recoil?.shots ?? 0) > 0 ? 1 : controls.assist;
    let fire = controls.fire;
    const held = heldWeapon(player);
    // Auto-fire holds the trigger (or swings the knife), but never stops a med being used,
    // and never fires an admin spawner gun: its new enemy is under the crosshair.
    const spawner = !!held && weaponDef(items, held.item).spawns !== undefined;
    if (
      target &&
      settings.current.fire === 'auto' &&
      !player.using &&
      !player.extinguish &&
      !spawner
    ) {
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
    input.prone = controls.prone;
    input.lean = controls.lean;
    input.jump = controls.jump;
    input.fire = fire;
    input.aim = controls.aim;
    input.thumb = !inputMode.desktop;
    input.reload = controls.reload;
    input.draw = controls.draw ?? (controls.swapPrimary ? otherPrimary(player.gear) : null);
    if (input.draw && input.draw !== player.gear.hand && holdsDeathMachine(sim, player))
      el.raidHud.warn('Not while you hold the minigun', performance.now());
    input.throw = controls.throw;
    input.grenade = hands.grenadeChoice;
    input.detonate = controls.detonate;
    input.extinguish = controls.extinguish;
    if (controls.throwPick && !dead) hands.showGrenadePicker(player, items);
    // A tap on the heal button uses what it shows, or stops a med being used.
    input.use = controls.heal ? (player.using ? 'cancel' : hands.choice) : picked;
    picked = null;
    if (controls.healPick && !dead) hands.showPicker(player, items);

    // The use button takes the item on the ground near the crosshair, opens, closes or
    // unlocks a door, or loots what's in reach, and shuts the raid screen when it's
    // open; the bag button opens your inventory.
    const lootable =
      dead || screenOpen
        ? null
        : lootableInReach(sim, world, map.searchedLooks, player, controls.yaw, controls.pitch);
    // A locked door names its key under the crosshair, and unlocks if you carry it.
    const doorIndex = lootable?.kind === 'door' ? lootable.index : -1;
    const door = doorIndex >= 0 ? sim.doors[doorIndex]! : null;
    const doorKey = door?.locked ? keyName(items, world, doorIndex) : null;
    const switchIndex = lootable?.kind === 'switch' ? lootable.index : -1;
    const switchUseTime = switchIndex >= 0 ? world.switches[switchIndex]!.useTime : 0;
    const key = doorIndex >= 0 ? world.doors[doorIndex]!.key : undefined;
    const hasKey = !!door?.locked && key !== undefined && !!findKey(player.gear, key);
    // Zombies mode: a door bought with points, and a buy spot in reach (an item or a door
    // aimed at comes first).
    const doorCost = door?.locked ? world.doors[doorIndex]!.cost : undefined;
    const buySpot =
      !zombiesMode || dead || screenOpen || lootable?.kind === 'ground' || lootable?.kind === 'door'
        ? -1
        : buyInReach(sim, player);
    // A barricade in reach to nail planks up on, held, when nothing else is.
    const barricade =
      !zombiesMode || dead || screenOpen || buySpot >= 0 || lootable?.kind === 'door'
        ? -1
        : windowInReach(sim, player);
    // A quest marker in reach beats a container or body, but not aiming at an item or door.
    const spot =
      dead || screenOpen || lootable?.kind === 'ground' || lootable?.kind === 'door'
        ? null
        : investigateInReach(sim, player);
    const label = spot
      ? 'investigate'
      : switchIndex >= 0
        ? 'activate'
        : buySpot >= 0
          ? sim.zombies!.buys[buySpot]!.offer?.by === player.id
            ? 'take'
            : 'buy'
          : barricade >= 0
            ? 'rebuild'
            : !lootable
              ? 'use'
              : door
                ? door.locked
                  ? doorCost !== undefined
                    ? 'buy'
                    : hasKey
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
      useButton.classList.toggle('idle', !lootable && !spot && buySpot < 0 && barricade < 0);
    }
    // The pad's □ uses only when there's something to use, else reloads (CP-1).
    controls.canUse = label !== 'use' && label !== 'locked';
    controls.screenOpen = screenOpen;
    controls.uiOpen = screenOpen || !!ended || devScreen;

    let taking: string | null = null;
    input.door = null;
    input.search = null;
    input.investigate = false;
    input.buy = null;
    input.rebuild = !dead && barricade >= 0 && controls.interactHeld;
    input.switch =
      !dead && !spot && switchIndex >= 0 && (controls.interact || controls.interactHeld)
        ? switchIndex
        : null;
    if (!dead && controls.interact && screenOpen) {
      closeScreen();
    } else if (!dead && controls.interact && spot) {
      input.investigate = true;
    } else if (!dead && controls.interact && buySpot >= 0) {
      input.buy = buySpot;
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
      if (lootable.kind === 'container') {
        // The only place a search completes: a timed search would send this when it ends.
        input.search = lootable.c.id;
        openScreen({ kind: 'container', id: lootable.c.id });
      } else if (lootable.kind === 'body') openScreen({ kind: 'body', id: lootable.c.id });
    } else if (!dead && controls.bag && !zombiesMode) {
      if (screenOpen) closeScreen();
      else openScreen(null);
    }
    // Searched for as long as it's open (search.ts).
    input.looting = screenOpen && openTarget ? searchKey(openTarget) : null;
    if (screenOpen) {
      if (dead) closeScreen();
      input.moveX = input.moveY = 0;
      input.sprint = input.jump = input.fire = input.aim = input.reload = false;
      input.throw = input.detonate = false;
    }
    // Jumping lets go of a ladder, and ends sprint lock with it.
    if (controls.jump && player.mode === 'ladder') controls.unlockSprint();

    if (guest) {
      // A guest's hurt and heal would be undone by the host's next tick.
    } else if (options.debug && controls.debug === 0) {
      // An AKM round to a random zone, armour and bleeding included.
      const zone = nextInt(debugRng, 6) as Zone;
      shootCharacter(sim, items, player, zone, ammoDef(items, 'ammo-762x39'), 0);
      el.vitals.hurtFlash();
    } else if (options.debug && controls.debug === 1) {
      restoreHealth(player, items);
    }
    if (givingUp) {
      givingUp = false;
      if (!dead) {
        // A guest's character is the host's to kill.
        if (guest) guest.giveUp();
        else killCharacter(sim, player, 0);
        gaveUp = true;
      }
    }

    prev.x = cur.x;
    prev.y = cur.y;
    prev.z = cur.z;
    prev.lean = cur.lean;
    prev.aim = cur.aim;
    prev.rp = cur.rp;
    prev.ry = cur.ry;
    prev.sp = cur.sp;
    prev.sy = cur.sy;
    prev.drawn = cur.drawn;
    prev.yaw = cur.yaw;
    prev.pitch = cur.pitch;
    inventoryChanged = false;
    // HP lost this tick that no hit explains is bleeding or burning (healing the same tick
    // hides some). A death with no hit is the fire's, if you're alight.
    const bleeding = isBleeding(player.health);
    const burn = player.burn ? { ...player.burn } : null;
    const hpBefore = bleeding || burn ? totalHp(player.health) : -1;
    if (guest) {
      // A guest's raid runs on the host: send this tick's input, and take what came back.
      guest.sendInput(input);
      guest.catchUp(sim);
      syncDoors(sim, world, nav);
      syncGlass(sim, world);
    } else {
      host?.fillInputs(inputs, (c) => killCharacter(sim, c, 0));
      step(sim, world, items, inputs, nav);
      host?.afterTick(sim);
      // The zombies admin panel's asks, after the tick so their events are seen below.
      if (zombiesAdmin && sim.zombies) {
        for (const a of zombiesAdmin.actions.splice(0)) {
          if (a.kind === 'powerup') adminPowerup(sim, items, player, a.powerup);
          else if (a.kind === 'gun') adminGiveGun(sim, items, player, a.item);
          else if (a.kind === 'points')
            sim.zombies.points[player.id] = pointsOf(sim, player.id) + a.amount;
          else
            for (const c of sim.entities)
              if (c.ai?.zombie && !c.health.dead) killCharacter(sim, c, player.id);
        }
      }
    }
    pending.length = 0;
    if (tutorialMode && advanceTutorial(tutorialMode.def, tutorialProgress!, sim, player.id))
      tutorialCard!.show(tutorialProgress!.step);
    follow();
    // Whose eyes and ears the screen and sound are: yours, or the teammate's you watch.
    const viewer = watching ?? player;

    cues.tick(sim, viewer, watching ? watching.yaw : controls.yaw);
    grenades.tick(sim.grenades);
    grenades.tickSmokes(sim.smokes);
    let hitLost = 0;
    let lastHit = burn ? fireKey(burn.by) : 'bleeding';
    let lit = false;
    let died = false;
    // The last blast this tick, for where its hits came from (its event comes first).
    let blastX = viewer.x;
    let blastZ = viewer.z;
    for (const e of sim.events) {
      // Being hit (TU-1): where from, for the arcs; any hit, even one doing no damage.
      if (e.type === 'shot' && e.hit === 'character' && e.target === viewer.id) {
        el.hitDirection.hit(viewer.x, viewer.z, e.fromX, e.fromZ, now / 1000);
      } else if (e.type === 'swing' && e.hit === 'character' && e.target === viewer.id) {
        const by = entityById(sim, e.by);
        if (by) el.hitDirection.hit(viewer.x, viewer.z, by.x, by.z, now / 1000);
      } else if (e.type === 'explosion') {
        blastX = e.x;
        blastZ = e.z;
      } else if (e.type === 'damage' && e.cause === 'explosion' && e.target === viewer.id) {
        el.hitDirection.hit(viewer.x, viewer.z, blastX, blastZ, now / 1000);
      }
      if (e.type === 'shot' && e.by === player.id && e.pellet === 0) {
        const gun = heldWeapon(player);
        rumble.fired(gun ? weaponDef(items, gun.item).recoil.up : 1, now);
      }
      if (e.type === 'shot' && e.blast) {
        // A blast gun's gust (zombies mode's Gale Cannon): no tracer, a cone of wind.
        if (e.by === viewer.id) viewmodel.fired(now);
        else bodyOf.get(e.by)?.fired();
        const shooter = entityById(sim, e.by);
        const gun = shooter && heldWeapon(shooter);
        const angle = (gun ? (weaponDef(items, gun.item).blast?.angle ?? 30) : 30) * DEG;
        const dx = (e.toX - e.fromX) / e.blast;
        const dy = (e.toY - e.fromY) / e.blast;
        const dz = (e.toZ - e.fromZ) / e.blast;
        effects.gust(now, e.fromX, e.fromY - 0.15, e.fromZ, dx, dy, dz, e.blast, angle);
      } else if (e.type === 'shot') {
        // A launched grenade or a flame has no tracer: it's drawn flying (grenades, fires).
        const tracer = !e.grenade && !e.flame;
        // An incendiary round: an orange tracer, and a burst of fire where it lands.
        const fiery = tracer && incendiary(e.by);
        const colour = fiery ? INCENDIARY_TRACER : TRACER_COLOUR;
        if (e.by === viewer.id) {
          if (e.pellet === 0) viewmodel.fired(now);
          viewmodel.muzzleWorld(muzzle);
          if (tracer)
            effects.tracer(now, muzzle.x, muzzle.y, muzzle.z, e.toX, e.toY, e.toZ, colour);
        } else {
          if (e.pellet === 0) bodyOf.get(e.by)?.fired();
          if (tracer) effects.tracer(now, e.fromX, e.fromY, e.fromZ, e.toX, e.toY, e.toZ, colour);
        }
        if (e.hit !== 'none') effects.impact(now, e.toX, e.toY, e.toZ, e.hit === 'character');
        if (fiery && e.hit !== 'none') fires.burst(now, e.toX, e.toY, e.toZ);
        if (e.by === player.id && e.hit !== 'none' && shotMarkers.length) {
          const m = shotMarkers[nextShotMarker++ % shotMarkers.length]!;
          placeMarker(m, e.toX, e.toY, e.toZ, 0.006);
        }
      } else if (e.type === 'swing') {
        if (e.by === viewer.id && viewer.gear.knife) {
          viewmodel.swung(now, meleeDef(items, viewer.gear.knife.item).swingTime);
        } else bodyOf.get(e.by)?.swung();
        if (e.hit !== 'none') effects.impact(now, e.x, e.y, e.z, e.hit === 'character');
      } else if (e.type === 'glass') {
        const g = map.glass[e.glass];
        if (g) {
          const ex = (Math.cos(g.yaw) * g.width) / 2;
          const ez = (-Math.sin(g.yaw) * g.width) / 2;
          effects.shatter(
            now,
            g.x - ex,
            g.z - ez,
            g.x + ex,
            g.z + ez,
            g.y,
            g.y + g.height,
            g.colour,
          );
        }
      } else if (e.type === 'explosion') {
        grenades.explode(now, e.x, e.y, e.z, e.radius, grenadeEffect(grenadeDef(items, e.item)));
        if (!player.health.dead) {
          rumble.blast(Math.hypot(e.x - player.x, e.y - player.y, e.z - player.z), e.radius, now);
        }
      } else if (e.type === 'ignite' && e.target === player.id) {
        lit = true;
        el.raidHud.warn(
          inputMode.desktop
            ? 'You’re on fire · V to put it out'
            : inputMode.gamepad
              ? 'You’re on fire · D-pad ↓ to put it out'
              : 'You’re on fire · put it out',
          now,
        );
      } else if (e.type === 'damage') {
        if (e.amount > 0) bodyOf.get(e.target)?.hit();
        // A hit always shows, even one doing no damage (TU-1); a fall only when it hurts.
        const felt = e.amount > 0 || e.cause !== 'fall';
        if (e.target === viewer.id && felt) {
          el.vitals.hurtFlash();
          // The view jolts sideways a little, the way the sim's punch threw the aim (cut to a
          // tenth with PUNCH, 2026-11-10).
          punchRoll = (viewer.recoilYaw >= 0 ? -1 : 1) * Math.min(0.4, 0.15 + e.amount / 200) * DEG;
        }
        if (e.target === player.id) {
          if (felt) rumble.hurt(e.amount, now);
          hitLost += e.amount;
          const by = e.by === player.id ? 'Your own grenade' : names.get(e.by);
          lastHit = logHit(taken, e, by ?? 'Someone');
        }
        // Only yours, either way: the lookups are for those (logFight checks the rest).
        if ((e.by === player.id) !== (e.target === player.id) && e.by !== 0)
          logFight(fight, e, player.id, sim.tick, fightInfo(e));
      } else if (e.type === 'death' && e.by === player.id && e.target !== player.id) {
        kills++;
        killList.push({ name: names.get(e.target) ?? 'Unknown', tick: sim.tick });
        const target = sim.entities.find((c) => c.id === e.target);
        const faction = target && factionOf(target);
        if (faction) killed[faction] = (killed[faction] ?? 0) + 1;
      } else if (e.type === 'death' && e.target === player.id) {
        killedBy = names.get(e.by) ?? null;
        if (e.by !== 0 && e.by !== player.id) killerId = e.by;
        died = true;
      } else if (e.type === 'leave' && e.by === player.id) {
        const at = sim.raid?.extractions.find((p) => p.id === e.at);
        endRaid(e.how, at ? `at ${at.name}` : 'Time ran out', now, at?.name);
      } else if (e.type === 'investigate' && e.by === player.id) {
        el.raidHud.note(`Investigated · ${markerText.get(e.marker) ?? 'quest marker'}`, now);
        if (screen) screen.refresh();
      } else if (e.type === 'switch' && e.by === player.id) {
        el.raidHud.note(`${world.switches[e.index]?.name ?? 'Switch'} on`, now);
      } else if (e.type === 'door' && e.by === player.id && e.result === 'blocked') {
        el.raidHud.warn('Someone’s in the doorway', now);
      } else if (e.type === 'door' && e.by === player.id && e.result === 'poor') {
        el.raidHud.warn('Not enough points', now);
      } else if (e.type === 'door' && e.by === player.id && e.result === 'bought') {
        const name = map.doors[e.door]?.name;
        el.raidHud.note(name ? `${name} cleared` : 'Door bought', now);
      } else if (e.type === 'buy' && e.by === player.id) {
        const name = e.item ? itemDef(items, e.item).name : '';
        if (e.result === 'poor') el.raidHud.warn('Not enough points', now);
        else if (e.result === 'full') el.raidHud.warn('Your ammo is full', now);
        else if (e.result === 'busy') el.raidHud.warn('Not while you hold the minigun', now);
        else if (e.result === 'ammo')
          el.raidHud.note(name ? `${name} ammo filled` : 'Ammo filled', now);
        else if (e.result === 'theirs') el.raidHud.warn('That gun is someone else’s', now);
        else if (e.result === 'rolled') el.raidHud.note(`Mystery box · ${name}`, now);
        else if (e.result === 'taken') el.raidHud.note(`Took ${name}`, now);
        else el.raidHud.note(`Bought ${name}`, now);
        inventoryChanged = true;
      } else if (e.type === 'plank' && e.by === player.id && e.points > 0) {
        el.raidHud.note(`Barricade · +${e.points}`, now);
      } else if (e.type === 'powerup' && (e.what === 'picked' || e.what === 'ended')) {
        const name = POWERUP_NAMES[e.kind];
        if (e.what === 'picked') el.raidHud.note(`${name}!`, now);
        else if (e.by === 0 || e.by === player.id) el.raidHud.note(`${name} over`, now);
        inventoryChanged = true;
      } else if (e.type === 'round') {
        if (e.started) el.raidHud.note(`Round ${e.round}`, now);
        else el.raidHud.note(`Round ${e.round} survived`, now);
      } else if (e.type === 'spawnRequest' && !guest) {
        spawnRequested(e);
      } else if (e.type === 'inventory' && e.by === player.id) {
        inventoryChanged = true;
        if (taking && !e.ok) el.raidHud.warn(`No room for ${taking}`, now);
      }
    }

    if (hpBefore >= 0) {
      const lost = hpBefore - totalHp(player.health) - hitLost;
      // Both at once: shared by how fast each takes HP.
      const bleedRate = bleeding
        ? player.health.bleeding.filter(Boolean).length * HEALTH.bleedRate
        : 0;
      // Whatever lit it: fuel, an incendiary round or a molotov (not only ammo).
      const burnRate = burn ? ZONE_COUNT * (burnOf(items, burn.item)?.burnDamage ?? 0) : 0;
      const toFire = burnRate > 0 ? lost * (burnRate / (burnRate + bleedRate)) : 0;
      if (burn) logBurn(taken, burn.by, burnerName(burn.by), toFire);
      if (bleeding) logBleed(taken, lost - toFire);
    }
    // Lit this tick: one more time set alight, by whoever it was.
    if (lit && player.burn) logBurn(taken, player.burn.by, burnerName(player.burn.by), 0, true);
    // The death event comes before the hit that caused it, so this waits for the loop.
    if (died) logKiller(taken, lastHit);
    // A hit, not their fire or your bleeding, finished you.
    if (died && killerId && lastHit.startsWith(`${killerId}:`) && lastHit !== fireKey(killerId))
      logKillingHit(fight, killerId);

    // Gone from the raid: zombies' bodies a few seconds after dying, and PMC squads that
    // extracted (AI rework session 4).
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (sim.entities.includes(e.c)) continue;
      scene.remove(e.body.root);
      e.body.dispose();
      if (e.zones) scene.remove(e.zones.root);
      enemies.splice(i, 1);
      enemyChars.splice(enemyChars.indexOf(e.c), 1);
      bodyOf.delete(e.c.id);
      enemyBars?.remove(e.c);
    }
    if (zombiesMode) {
      for (const c of sim.entities)
        if (c.ai?.zombie && !bodyOf.has(c.id))
          addEnemy(c, zombiesMode.zombie.name, zombiesMode.zombie.outfit, () => {});
    }
    // Scavs arriving in waves (sim/waves.ts), here and on co-op guests.
    drawNewEnemies();
    for (const e of enemies) {
      e.body.tick(e.c);
      if (!e.c.health.dead) e.diedAt = 0;
      else if (!e.diedAt) e.diedAt = now;
      else if (options.respawn && !guest && now - e.diedAt > ENEMY_RESPAWN_MS) {
        restoreHealth(e.c, items);
        resetEnemy(e.c, world);
        e.arm();
      }
    }
    // The teammate you watch died or left: on to the next, or the results if none is left.
    if (watching && (!stillIn(watching) || guest?.lost)) {
      if (guest?.lost) stopWatching();
      else watch(1);
    }
    // Gone from the raid (extracted, or out of time): no longer drawn.
    for (const o of others) o.body.tick(o.c);
    showOthers();
    if (guest?.lost && !ended) endRaid('mia', 'Lost the connection to the host', now);
    // A host that's out keeps the raid going until its guests are too.
    if (host && resultsShown && !host.playing(sim)) pause.set('ended', true);
    // Redraw the raid screen when the inventory changed, and now and then for what's in
    // reach and what enemies took from their dead; more often while a med or repair is in
    // use, for its progress.
    // More often while using something or searching, so it shows as it goes.
    const often = player.using || input.looting;
    if (screen && (inventoryChanged || sim.tick % (often ? 3 : 10) === 0)) screen.refresh();
    showExtractions();
    // From the state, not the death event: a debug hurt or giving up kills outside the tick.
    if (player.health.dead) {
      const killer = taken.find((s) => s.killed)?.key;
      const how = gaveUp
        ? 'Gave up'
        : killer === `${player.id}:explosion`
          ? 'By your own grenade'
          : killer === fireKey(player.id)
            ? 'In your own fire'
            : killer === 'bleeding'
              ? 'Bled out'
              : killer === 'fall'
                ? 'From a fall'
                : 'From bleeding or a fall';
      endRaid('killed', killedBy ? `by a ${killedBy}` : how, now);
    }
    // Spectating, the HUD shows the teammate you watch: their limbs, gun and rounds (the
    // user's call, 2026-11-06).
    el.vitals.update(watching ?? player, items);
    el.raidHud.update(sim, player, ended !== null);
    const flipping = player.switching;
    el.raidHud.setUse(flipping ? flipping.held / world.switches[flipping.index]!.useTime : null);
    // The item the use button would take: lit up, and named under the crosshair. Picking
    // one up this tick may have moved the rest along the list.
    const onGround = lootable?.kind === 'ground' && sim.ground[lootable.index] === lootable.g;
    groundItems.update(sim.ground, onGround ? lootable.index : -1);
    const prompt = onGround
      ? groundLabel(lootable.g.item)
      : switchIndex >= 0
        ? `${switchUseTime > 0 ? 'Hold to activate ' : ''}${world.switches[switchIndex]!.name}`
        : door?.opening !== undefined
          ? `Opening in ${Math.ceil(door.opening)} s`
          : doorCost !== undefined
            ? `${map.doors[doorIndex]?.name ? `Clear the ${map.doors[doorIndex]!.name!.toLowerCase()}` : 'Open door'} · ${doorCost.toLocaleString()} points`
            : buySpot >= 0
              ? buyLabel(buySpot)
              : barricade >= 0
                ? 'Hold to rebuild the barricade'
                : doorKey
                  ? hasKey
                    ? `Unlock with ${doorKey}`
                    : `Locked · needs ${doorKey}`
                  : spot
                    ? (markerText.get(spot.marker) ?? '')
                    : '';
    // Desktop has no use button to say what F does, so the prompt says it (□ on a pad).
    if (!inputMode.touch && useLabel !== 'use' && useLabel !== 'locked') {
      // A door a switch is opening says so rather than offering to open it.
      const verb = useLabel[0]!.toUpperCase() + useLabel.slice(1);
      el.raidHud.setPrompt(
        onGround
          ? `Take ${prompt}`
          : lootable?.kind === 'container'
            ? `Loot ${nameOf({ kind: 'container', id: lootable.c.id })}`
            : lootable?.kind === 'body'
              ? `Loot ${nameOf({ kind: 'body', id: lootable.c.id })}`
              : switchIndex >= 0
                ? switchUseTime > 0
                  ? prompt
                  : `${verb} ${prompt}`
                : prompt || `${verb}${door ? ' door' : ''}`,
        now,
        inputMode.gamepad ? '□' : 'F',
      );
    } else el.raidHud.setPrompt(prompt, now);
    const shown = watching ?? player;
    let armed = false;
    for (const g of sim.grenades) if (g.remote && g.by === shown.id) armed = true;
    hands.update(shown, items, armed && !shown.health.dead);
    // The mouse is captured unless a screen needs the cursor.
    controls.cursor.want(!screenOpen && !ended && !hands.pickerOpen && !devScreen);
    if (ended && resultsAt && now >= resultsAt) {
      resultsAt = 0;
      // Killed in a party raid: watch a teammate first, if one's still in it.
      if (ended.how === 'killed' && coop) watch(1);
      else showResults(ended);
    }
    stats.tick(performance.now() - t0);
  }

  /** What a zombies buy spot sells you now, and for how much. */
  function buyLabel(i: number): string {
    const b = sim.zombies!.buys[i]!;
    const { cost, ammo } = spotPrice(sim, player, i);
    const price = `${cost.toLocaleString()} points`;
    if (b.offer)
      return b.offer.by === player.id
        ? `Take ${itemDef(items, b.offer.item).name}`
        : 'Mystery box · in use';
    if (b.kind === 'mysteryBox') return `Mystery box · ${price}`;
    const name = itemDef(items, b.item!).name;
    return ammo ? `${name} ammo · ${price}` : `Buy ${name} · ${price}`;
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
  settings.subscribe(() => {
    if (renderer.getPixelRatio() === pixelRatio()) return;
    renderer.setPixelRatio(pixelRatio());
    resize();
  });

  function render(): void {
    renderer.info.reset();
    renderer.clear();
    if (landmarks.render(renderer, camera)) renderer.clearDepth();
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
  grenades.warm(true);
  fires.warm(true);
  render();
  grenades.warm(false);
  fires.warm(false);
  for (const o of culled) o.frustumCulled = true;

  const loop = new FixedTimestep();
  /** How far the gun is lowered for using a med, eased each frame. */
  let lowered = 0;
  const frustum = new THREE.Frustum();
  const tmpSmoke = new THREE.Vector3();
  const viewProjection = new THREE.Matrix4();
  startLoop(renderer, controls, (time, dtMs) => {
    const t0 = performance.now();
    controls.frame(dtMs);
    const alpha = loop.advance(dtMs / 1000, tick);
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    camera.position.set(lerp(prev.x, cur.x), lerp(prev.y, cur.y), lerp(prev.z, cur.z));
    // Look is applied every frame, not every tick, so turning never lags. Recoil is the
    // sim's, so it's interpolated between ticks. A teammate's look only comes with ticks.
    const v = watching ?? player;
    let yaw = controls.yaw;
    let pitch = controls.pitch;
    if (watching) {
      let turn = cur.yaw - prev.yaw;
      turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
      yaw = prev.yaw + turn * alpha;
      pitch = lerp(prev.pitch, cur.pitch);
    }
    // Leaning tilts the view a third as far as the body (about 10°), towards the lean.
    // A hit's jolt (TU-1) fades in about a fifth of a second.
    punchRoll *= Math.exp(-dtMs / 70);
    const roll = -lerp(prev.lean, cur.lean) * MOVEMENT.leanAngle * LEAN_ROLL + punchRoll;
    const aim = lerp(prev.aim, cur.aim);
    const w = heldWeapon(v);
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
    // Aimed, recoil's first few degrees climb the sights and the rest the view (gunRecoil);
    // sway is all the gun's. The view's share is eased between ticks, so it stays smooth;
    // the sights' isn't (below).
    const rp = lerp(prev.rp, cur.rp);
    const ry = lerp(prev.ry, cur.ry);
    camera.rotation.set(
      pitch + rp - gunRecoil(rp, aim, controls.zoom),
      yaw + ry - gunRecoil(ry, aim, controls.zoom),
      roll,
    );
    const alive = !v.health.dead;
    el.hitDirection.update(yaw, camera.position.x, camera.position.z, time / 1000);
    el.optic.set(optic);
    el.optic.visible = alive && aim >= (zoom > 1 ? SCOPE_IN : RETICLE_IN);
    // Where the gun points, from the camera: the sim's aim, so the reticle is where shots go.
    // Recoil here is the last tick's, not eased between ticks: the next round fires with it,
    // and in a burst it moves too far in a tick for the eased value to stay true (2026-11-04).
    const aimYaw = yaw + cur.ry + lerp(prev.sy, cur.sy);
    const aimPitch = pitch + cur.rp + lerp(prev.sp, cur.sp);
    const aimCos = Math.cos(aimPitch);
    gunPoint
      .set(-Math.sin(aimYaw) * aimCos, Math.sin(aimPitch), -Math.cos(aimYaw) * aimCos)
      .applyQuaternion(viewInverse.copy(camera.quaternion).invert());
    const pointYaw = Math.atan2(-gunPoint.x, -gunPoint.z);
    const pointPitch = Math.asin(gunPoint.y);
    const perHalfHeight = 50 / (-gunPoint.z * Math.tan((fov / 2) * DEG));
    el.optic.aimAt(gunPoint.x * perHalfHeight, -gunPoint.y * perHalfHeight);
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    for (const e of enemies) {
      e.body.update(e.c, items, alpha, dtMs / 1000, camera, frustum);
      e.zones?.update(e.c, items);
    }
    for (const o of others) o.body.update(o.c, items, alpha, dtMs / 1000, camera, frustum);
    aiDebug?.update(enemyChars);
    tutorialCard?.update(camera, player, alive && !screenOpen && !ended);
    enemyBars?.update(camera, alive && !screenOpen && !ended);
    updateDoors(mapView, sim.doors, dtMs / 1000);
    if (barricades && sim.zombies) barricades.update(sim.zombies.windows);
    if (powerupViews && sim.zombies) powerupViews.update(sim.zombies.drops, time / 1000);
    if (boxOffers && sim.zombies) boxOffers.update(sim.zombies.buys, time / 1000);
    updateSearchedLooks(mapView, sim.loot);
    updateGlass(mapView, sim.glass);
    if (aimMarker) {
      const yaw = player.yaw + player.recoilYaw + (player.swayYaw ?? 0);
      const pitch = player.pitch + player.recoilPitch + (player.swayPitch ?? 0);
      const cp = Math.cos(pitch);
      const dx = -Math.sin(yaw) * cp;
      const dy = Math.sin(pitch);
      const dz = -Math.cos(yaw) * cp;
      const ex = eyeX(player);
      const ey = eyeHeight(player);
      const ez = eyeZ(player);
      const d = Math.min(200, world.raycast(ex, ey, ez, dx, dy, dz, 200, markerHit));
      placeMarker(aimMarker, ex + dx * d, ey + dy * d, ez + dz * d, 0.01);
    }
    const knife = !w && v.gear.hand === 'knife' && !!v.gear.knife;
    viewmodel.visible = alive && (!!w || knife) && !scoped;
    if (w) viewmodel.setGun(w, items);
    else if (knife) viewmodel.setKnife(v.gear.knife!.item, items);
    // Lowered for a med, and while putting yourself out.
    const down = v.using || v.extinguish ? 1 : 0;
    lowered += (down - lowered) * (1 - Math.exp(-dtMs / 90));
    viewmodel.update(
      camera,
      time,
      dtMs,
      aim,
      1 + brokenArms(v.health) * 2,
      w?.reloading ?? 0,
      lerp(prev.drawn, cur.drawn),
      lowered,
      pointYaw,
      pointPitch,
    );
    effects.update(performance.now());
    grenades.update(performance.now(), alpha);
    fires.update(performance.now(), alpha, sim, camera, v.id);
    // On fire: flames along the bottom of the screen, flickering.
    const burning = alive && !!v.burn;
    if (burning !== burnShown) {
      burnShown = burning;
      burnEl.classList.toggle('on', burning);
    }
    // Blinded by a flash: all white, fading out over its last moments.
    const blind = alive ? Math.min(1, (v.blind ?? 0) / GRENADE.blindFade) : 0;
    const blindStep = Math.round(blind * 50) / 50;
    if (blindStep !== blindShown) {
      blindShown = blindStep;
      blindEl.style.opacity = String(blindStep);
    }
    // Wearing a mask (AI-7, Jug's): the view's edges hidden and every sound muffled, until
    // the raid is over.
    const helmet = alive && !ended ? (v.gear.helmet?.item ?? null) : null;
    if (helmet !== maskFor) {
      maskFor = helmet;
      const mask = helmet ? armourDef(items, helmet).mask : undefined;
      maskEl.classList.toggle('on', !!mask?.edge);
      if (mask?.edge) maskEl.style.setProperty('--edge', `${mask.edge * 100}%`);
      sounds().setMuffle(mask?.muffle ?? null);
    }
    // In a smoke cloud: greyer the deeper in, so being inside one hides the world too.
    let veil = 0;
    for (const s of sim.smokes) {
      const r = smokeRadius(s);
      if (r <= 0) continue;
      const d = camera.position.distanceTo(tmpSmoke.set(s.x, s.y, s.z)) / r;
      veil = Math.max(veil, Math.min(0.95, (1 - d) * 2.5));
    }
    const veilStep = Math.round(veil * 50) / 50;
    if (veilStep !== veilShown) {
      veilShown = veilStep;
      smokeVeil.style.opacity = String(veilStep);
    }
    render();
    stats.frame(time, dtMs, performance.now() - t0);
  });
}

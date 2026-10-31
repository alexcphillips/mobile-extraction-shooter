import type { EnemySkill } from '../content/enemies';
import { grenadeDef, weaponDef, type ItemDb } from '../content/items';
import type { NavGrid } from '../nav/nav-grid';
import { findPath } from '../nav/path';
import { chance, nextFloat, nextRange } from '../rng';
import { TICK_SECONDS } from '../tick';
import type { CollisionWorld } from '../world/collision-world';
import { openDoorAhead } from './doors';
import type { Grenade } from './grenades';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import { MOVEMENT } from './movement';
import {
  entityById,
  eyeHeight,
  spawnCharacter,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';
import { heldWeapon } from './gear';
import { createWeaponStats, reloadRound, weaponStats } from './weapons';

/*
 * Enemy AI. Session 7: getting around, seeing and hearing. Session 8: fighting. Each
 * enemy is an ordinary character that writes its own PlayerInput every tick, so it moves
 * and shoots through exactly the same code as a player. All its state is plain data in
 * the character, so it saves, restores and runs on a co-op server like everything else.
 *
 * Awareness: unaware → suspicious (heard or glimpsed something) → alert (knows where you
 * are) → searching (lost you) → unaware.
 *
 * Fighting (alert): it engages while it can see you: a reaction time before the first
 * shot, then aim that wanders less the longer it watches you, fired in bursts. After a
 * while in the open, when hit, or to reload, it takes cover nearby and peeks out again.
 * When it loses sight of you it pushes to where you were or holds the angle, then
 * searches. If you're somewhere it can't walk to, it holds the ways up instead, moves
 * about near them, and gives up after a while.
 */

const DEG = Math.PI / 180;

/** AI tuning. Distances in metres, times in seconds, rates per second. */
export const AI = {
  /** Sight and hearing are checked every this many ticks, staggered across enemies. */
  perceiveEvery: 3,
  sightRange: 70,
  /** The whole field of view, in degrees. */
  fov: 120,
  /** Seconds to notice someone in plain view closer than nearRange. */
  reaction: 0.5,
  nearRange: 8,
  /** Noticing at sightRange happens at this fraction of the rate. */
  farRate: 0.08,
  /** Within this angle from straight ahead, full rate; at the edge of view, peripheralRate. */
  centreAngle: 25,
  peripheralRate: 0.35,
  crouchedRate: 0.6,
  /** Prone on top of crouched. */
  proneRate: 0.6,
  stillRate: 0.7,
  sprintingRate: 1.3,
  /** An enemy that's already on edge notices faster. */
  waryRate: 1.6,
  /** In view this close is noticed at once. */
  instantRange: 2.5,
  /** Noticing fades this fast while nobody is in view. */
  forget: 0.15,
  /** Noticing this much (out of 1) is a glimpse: suspicious. 1 is alert. */
  glimpse: 0.3,
  /**
   * Shots are heard within their loudness: suspicious and turns to look. Within this
   * fraction of it, walks over to investigate; within alertShot, alert.
   */
  investigateShot: 0.5,
  alertShot: 0.15,
  /** A shot with walls or ground between it and the listener is heard as this much as loud. */
  muffled: 0.5,
  /** A shot passing or landing this close is being shot at: alert. */
  nearMiss: 3,
  /**
   * An enemy spawn this close to a player spawn, or in sight of it, is flagged: a raid
   * should start out of the enemies' sight (see exposedSpawns).
   */
  spawnClearance: 60,
  /** Footsteps are heard this far away. Crouch-walking and standing still are silent. */
  sprintSteps: 15,
  walkSteps: 6,
  /** Where a noise came from is off by up to this fraction of its distance, at most noiseErrorMax. */
  noiseError: 0.1,
  noiseErrorMax: 8,
  /** After losing sight while alert, it still knows where you went for this long... */
  intuition: 1,
  /** ...and starts searching after this long. */
  loseTrack: 4,
  /** Stick pushes: patrolling, investigating and alert. */
  patrolPace: 0.55,
  investigatePace: 0.8,
  alertPace: 1,
  /** Turning speed in radians per second, calm and on edge. */
  turnRate: 2.5,
  alertTurnRate: 6,
  /** Turns to look at something suspicious for this long before going to check it. */
  lookTime: 1.5,
  /** Looks around this long where the noise was, or at a noise not worth checking. */
  scanTime: 5,
  calmTime: 3,
  /** Spots to check when searching, each within searchRadius of where you were last seen. */
  searchSpots: 3,
  searchRadius: 12,
  searchScan: 2.5,
  /** Guarding: looks a new way every guardLook seconds or so, within guardArc of its spawn's. */
  guardLook: 5,
  guardArc: 70,
  /** Without a gun, an alert enemy closes in to this distance and holds. */
  approachRange: 10,
  /** With one, it closes in until within the gun's range × engageRange, at most maxEngage. */
  engageRange: 0.3,
  maxEngage: 45,
  /** Lost sight for longer than this: it reacts from scratch when it sees you again... */
  reacquire: 1,
  /** ...if you're more than this far from where it last saw you; otherwise it fires again after quickReaction. */
  relocated: 2,
  quickReaction: 0.15,
  /** Degrees added to its settled aim error by a target moving at sprint speed... */
  targetMoveError: 2.5,
  /** ...while it moves itself... */
  selfMoveError: 0.5,
  /** ...and in one go when it's hit. */
  hitFlinch: 3,
  /** How much of its own recoil it pulls down against. */
  recoilControl: 0.5,
  /** Only fires while facing within this many degrees of where it's aiming. */
  fireCone: 8,
  /** Rounds per burst from an automatic, within closeRange and beyond it. */
  closeRange: 15,
  closeBurst: [3, 6],
  farBurst: [2, 3],
  /** Seconds between bursts, and between pulls of a semi-automatic. */
  burstPause: [0.35, 0.8],
  semiPause: [0.25, 0.5],
  /** Aims down the sights at targets further than this. */
  aimDownRange: 12,
  /** Sidesteps while fighting in range: stick push and how long each way. */
  strafePace: 0.5,
  strafeTime: [0.8, 2],
  /** Seconds in the open while fighting before it looks for cover. */
  expose: [3, 6],
  /** Cover: searched for within coverRadius, at most coverSamples spots tried, never this close to the threat. */
  coverRadius: 10,
  coverSamples: 12,
  coverMinThreat: 4,
  /** A spot is only cover if it's still hidden this far either side of it. */
  coverMargin: 0.4,
  /** Cover searches across all enemies in one tick; the rest wait a tick. */
  coversPerTick: 1,
  /** Seconds in cover before peeking out, and peeking before giving up on it. */
  coverTime: [1.5, 3],
  peekTime: 1.5,
  /** Seconds to get down in cover before seeing its target means the cover is no good. */
  settleInCover: 0.5,
  /** Holding an angle where you vanished (reachable) before searching. */
  holdAngle: 8,
  /** Unreachable: holds a way up this long, then moves to a spot within loiterRadius of it... */
  holdTime: 8,
  loiterRadius: 8,
  /** ...and gives up after this long without seeing you. */
  giveUp: 45,
  /** Waypoints count as reached this close; the end of a path at `arrive`. */
  waypoint: 0.5,
  arrive: 0.7,
  /** Patrol points walked through (no wait) count as reached this close, so it doesn't slow. */
  passBy: 1.2,
  /** Moving slower than this for stuckTime means stuck: plan again, then give up. */
  stuckSpeed: 0.3,
  stuckTime: 1.5,
  /** Path searches across all enemies in one tick; the rest wait a tick. */
  plansPerTick: 2,
  /** A goal that moves further than this needs a new path. */
  replanDistance: 1.5,
  /**
   * A grenade it can see within its radius plus this is run from, to a spot this far
   * outside the radius, the nearest of fleeDirections around the grenade.
   */
  fleeMargin: 2,
  fleeDirections: 12,
} as const;

export type Awareness = 'unaware' | 'suspicious' | 'alert' | 'searching';

/** What it's doing, within its awareness state. */
export type AiActivity =
  | 'patrol' // walking to the next patrol point
  | 'wait' // standing at a patrol point, looking around
  | 'guard' // no patrol: standing at its spawn, looking around
  | 'look' // suspicious: turned to look at what it noticed
  | 'investigate' // suspicious: walking over to check it
  | 'scan' // looking around where it was, or at a noise not worth checking
  | 'engage' // alert: fighting you, or pushing to (or holding) where it last saw you
  | 'takeCover' // alert: moving to cover
  | 'cover' // alert: in cover, reloading
  | 'peek' // alert: out of cover to look for you again
  | 'hold' // alert, can't reach you: holding a way up
  | 'loiter' // alert, can't reach you: moving to another spot near the way up
  | 'search' // walking to a spot to check
  | 'searchScan'; // looking around a searched spot

export interface AiState {
  awareness: Awareness;
  activity: AiActivity;
  /** The controls it gives itself, read by movement and weapons like a player's. */
  input: PlayerInput;
  /** How well it fights, from its enemy type. */
  skill: EnemySkill;
  homeX: number;
  homeY: number;
  homeZ: number;
  homeYaw: number;
  /** Patrol points as flat x, y, z; empty to guard its spawn. */
  patrol: number[];
  /** Seconds to stand at each point; 0 walks through it. */
  patrolWaits: number[];
  /** Each visit to a point goes to a random spot within its radius. */
  patrolRadii: number[];
  /** The points before this are the way in, walked once. */
  patrolRepeatFrom: number;
  patrolLoop: boolean;
  patrolIndex: number;
  /** Where it's going for the current point; legSet false means not picked yet. */
  legSet: boolean;
  legX: number;
  legY: number;
  legZ: number;
  /** +1 or −1: which way along a back-and-forth patrol. */
  patrolStep: number;
  /** Counts down the current activity. */
  timer: number;
  /** How much it has noticed whoever it can see, 0..1. */
  notice: number;
  /** Who it's alert to, or 0. */
  target: EntityId;
  /** Whether it saw its target at the last look. */
  seesTarget: boolean;
  /** Seconds since it last saw its target. */
  unseen: number;
  /** Where whatever it's interested in is: what it noticed, heard, or last saw. */
  focusX: number;
  focusY: number;
  focusZ: number;
  /** Whether what it's suspicious of is worth walking over to. */
  investigate: boolean;
  /** Which way it looks around from while standing. */
  lookYaw: number;
  /** The current path as flat x, y, z waypoints, and the next one to reach. */
  path: number[];
  pathIndex: number;
  /** Where the path goes; hasGoal false means it needs planning. */
  hasGoal: boolean;
  goalX: number;
  goalY: number;
  goalZ: number;
  stuck: number;
  replans: number;
  searchLeft: number;
  /** Whether its target stands somewhere it can walk to, last it checked. */
  reachable: boolean;
  /** After losing sight: true pushes to where it last saw you, false holds the angle. */
  push: boolean;
  /** Seconds before it may fire at what it sees. */
  reaction: number;
  /** How far its aim wanders, in radians, and where in the wander it started. */
  aimError: number;
  aimPhase: number;
  /** Seconds left holding the trigger, and until the next burst. */
  burst: number;
  pause: number;
  /** Seconds fighting in the open, and how long before it looks for cover. */
  exposed: number;
  exposeLimit: number;
  /** Sidestepping: −1 left, 0 not, 1 right; and for how long. */
  strafe: number;
  strafeTimer: number;
  /** Hit since it last thought about cover. */
  hurt: boolean;
  /** Its cover, or the spot it holds; low cover is crouched behind and peeked over standing. */
  coverX: number;
  coverY: number;
  coverZ: number;
  coverLow: boolean;
  /** Where it was fighting from before taking cover, to peek out to. */
  peekX: number;
  peekY: number;
  peekZ: number;
  /** The closest it can get to an unreachable target: the way up it holds. */
  wayX: number;
  wayY: number;
  wayZ: number;
  /**
   * Running from a grenade: its id and where it runs to; null or missing (older saves)
   * when not. Whatever it was doing waits until the grenade has gone off.
   */
  flee?: { grenade: number; x: number; y: number; z: number } | null;
}

export interface PatrolDef {
  points: readonly { x: number; y: number; z: number; wait: number; radius: number }[];
  repeatFrom: number;
  loop: boolean;
}

export interface EnemySpawnOptions {
  patrol?: PatrolDef | undefined;
  /** Spawns at a random clear spot within this many metres. */
  radius?: number | undefined;
  /** How well it fights; DEFAULT_SKILL if left out. */
  skill?: EnemySkill | undefined;
}

/** A middling enemy, for tests and enemies with no type. */
export const DEFAULT_SKILL: EnemySkill = {
  reaction: 0.6,
  aimError: 6,
  aimSettled: 0.8,
  aimSettle: 1.5,
  holdChance: 0.4,
};

function createInput(): PlayerInput {
  return {
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
}

/**
 * Adds an enemy at a spawn, guarding it or walking a patrol from its first point. With a
 * radius it stands at a random clear spot within it; that spot is its home.
 */
export function spawnEnemy(
  state: SimState,
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  yaw: number,
  options: EnemySpawnOptions = {},
): Character {
  const { patrol, radius = 0, skill = DEFAULT_SKILL } = options;
  let sx = x;
  let sz = z;
  for (let tries = 0; radius > 0 && tries < 10; tries++) {
    const r = radius * Math.sqrt(nextFloat(state.rng));
    const a = nextFloat(state.rng) * Math.PI * 2;
    const tx = x + Math.cos(a) * r;
    const tz = z + Math.sin(a) * r;
    const ground = world.groundAt(tx, tz, MOVEMENT.radius, y + 0.5);
    const low = ground + MOVEMENT.stepUp;
    if (!world.overlaps(tx, tz, MOVEMENT.radius, low, ground + MOVEMENT.standHeight)) {
      sx = tx;
      sz = tz;
      break;
    }
  }
  // Below the spawn's height plus a little, so a spawn under a roof stays inside.
  const c = spawnCharacter(state, world, sx, sz, yaw, y + 0.5, false);
  c.ai = {
    awareness: 'unaware',
    activity: 'guard',
    input: createInput(),
    skill: { ...skill },
    homeX: c.x,
    homeY: c.y,
    homeZ: c.z,
    homeYaw: yaw,
    patrol: patrol ? patrol.points.flatMap((p) => [p.x, p.y, p.z]) : [],
    patrolWaits: patrol ? patrol.points.map((p) => p.wait) : [],
    patrolRadii: patrol ? patrol.points.map((p) => p.radius) : [],
    patrolRepeatFrom: patrol?.repeatFrom ?? 0,
    patrolLoop: patrol?.loop ?? true,
    patrolIndex: 0,
    legSet: false,
    legX: 0,
    legY: 0,
    legZ: 0,
    patrolStep: 1,
    timer: 0,
    notice: 0,
    target: 0,
    seesTarget: false,
    unseen: 0,
    focusX: 0,
    focusY: 0,
    focusZ: 0,
    investigate: false,
    lookYaw: yaw,
    path: [],
    pathIndex: 0,
    hasGoal: false,
    goalX: 0,
    goalY: 0,
    goalZ: 0,
    stuck: 0,
    replans: 0,
    searchLeft: 0,
    reachable: true,
    push: true,
    reaction: 0,
    aimError: 0,
    // Each enemy's aim wanders differently.
    aimPhase: c.id * 2.4,
    burst: 0,
    pause: 0,
    exposed: 0,
    exposeLimit: 0,
    strafe: 0,
    strafeTimer: 0,
    hurt: false,
    coverX: 0,
    coverY: 0,
    coverZ: 0,
    coverLow: false,
    peekX: 0,
    peekY: 0,
    peekZ: 0,
    wayX: 0,
    wayY: 0,
    wayZ: 0,
  };
  calmDown(c, c.ai, false);
  return c;
}

/** Puts an enemy back at its spawn, unaware, as if it had just spawned. */
export function resetEnemy(c: Character, world: CollisionWorld): void {
  const ai = c.ai;
  if (!ai) return;
  c.x = ai.homeX;
  c.z = ai.homeZ;
  c.y = world.groundAt(c.x, c.z, MOVEMENT.radius, ai.homeY + 0.5);
  c.vx = c.vy = c.vz = 0;
  c.yaw = ai.homeYaw;
  c.pitch = 0;
  c.mode = 'ground';
  ai.patrolIndex = 0;
  ai.patrolStep = 1;
  calmDown(c, ai, false);
}

const DT = TICK_SECONDS;
const PERCEIVE_DT = AI.perceiveEvery * DT;
const HALF_FOV_COS = Math.cos((AI.fov / 2) * DEG);
const CENTRE_COS = Math.cos(AI.centreAngle * DEG);

/** How far above a goal's given height its ground may be (patrol points on a slope). */
const GOAL_RISE = 1.5;

// Path and cover searches left this tick, shared by every enemy.
let plansLeft = 0;
let coversLeft = 0;

/**
 * Every enemy perceives (sight and footsteps every few ticks, shots and hits every tick,
 * from this tick's events) and decides its input for the next tick, opening a door in its
 * way straight away. Runs at the end of the tick, after everything has moved and fired.
 */
export function updateAi(
  state: SimState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): void {
  plansLeft = AI.plansPerTick;
  coversLeft = AI.coversPerTick;
  for (const c of state.entities) {
    const ai = c.ai;
    if (!ai) continue;
    const input = ai.input;
    input.moveX = input.moveY = 0;
    input.fire = input.aim = input.reload = input.crouch = input.sprint = false;
    if (c.health.dead) continue;
    if ((state.tick + c.id) % AI.perceiveEvery === 0) {
      look(state, c, ai, world, nav);
      listenForSteps(state, c, ai);
    }
    hearEvents(state, c, ai, world);
    behave(state, c, ai, world, items, nav);
    // A closed door on the way to the next waypoint opens as it gets there.
    const i = ai.pathIndex * 3;
    if (ai.hasGoal && i < ai.path.length && (input.moveX !== 0 || input.moveY !== 0))
      openDoorAhead(state, world, items, c, ai.path[i]!, ai.path[i + 2]!);
  }
}

// ---------------------------------------------------------------------------- perception

/** Sight: notices whoever it can see best, and keeps track of its target while alert. */
function look(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): void {
  let best: Character | undefined;
  let bestRate = 0;
  const saw = ai.seesTarget;
  ai.seesTarget = false;
  for (const e of state.entities) {
    if (e.ai || e.health.dead || e.admin?.peaceful) continue;
    const rate = sightRate(c, ai, e, world);
    if (e.id === ai.target && rate > 0) ai.seesTarget = true;
    if (rate > bestRate) {
      bestRate = rate;
      best = e;
    }
  }

  if (ai.awareness === 'alert') {
    const target = entityById(state, ai.target);
    if (!target || target.health.dead) {
      calmDown(c, ai);
      return;
    }
    if (ai.seesTarget && !saw) {
      // Back in sight. Where it last saw you (focus, still) it's ready for; somewhere
      // else after a while takes a fresh reaction, and aim off by about how far you went.
      const moved = Math.hypot(target.x - ai.focusX, target.z - ai.focusZ);
      if (ai.unseen > AI.reacquire && moved > AI.relocated) {
        const d = Math.max(1, Math.hypot(target.x - c.x, target.z - c.z));
        ai.reaction = ai.skill.reaction;
        ai.aimError = Math.max(
          ai.aimError,
          Math.min(ai.skill.aimError * DEG, 2 * Math.atan2(moved, d)),
        );
      } else {
        ai.reaction = Math.max(ai.reaction, AI.quickReaction);
      }
    } else if (saw && !ai.seesTarget) {
      // Holds the angle only if it can see where it last saw you (focus, not yet moved on).
      ai.push =
        !chance(state.rng, ai.skill.holdChance) ||
        !clearLine(world, c.x, eyeHeight(c), c.z, ai.focusX, ai.focusY + 1.2, ai.focusZ);
    }
    // Knows roughly where you went for a moment after losing sight of you.
    if (ai.seesTarget || ai.unseen < AI.intuition) setFocus(ai, target.x, target.y, target.z);
    ai.unseen = ai.seesTarget ? 0 : ai.unseen + PERCEIVE_DT;
    checkReachable(ai, c, target, nav);
    if (!ai.reachable && ai.unseen >= AI.giveUp) {
      calmDown(c, ai);
      return;
    }
    if (ai.seesTarget || !best) return;
  }

  if (!best) {
    ai.notice = Math.max(0, ai.notice - AI.forget * PERCEIVE_DT);
    return;
  }
  ai.notice = Math.min(1, ai.notice + bestRate * PERCEIVE_DT);
  if (ai.notice >= 1) alarm(ai, best, best.x, best.y, best.z);
  else if (ai.notice >= AI.glimpse || ai.awareness !== 'unaware')
    suspect(c, ai, best.x, best.y, best.z, true);
}

/**
 * Whether it can walk to where its target stands. Somewhere with no nav node (climbing a
 * ladder, in the air) keeps the last answer.
 */
function checkReachable(ai: AiState, c: Character, target: Character, nav: NavGrid): void {
  const there = nav.nearest(target.x, target.y, target.z);
  const here = nav.nearest(c.x, c.y, c.z);
  if (there >= 0 && here >= 0) ai.reachable = nav.component[there] === nav.component[here];
}

/** How fast it notices e (per second), or 0 if it can't see e. */
function sightRate(c: Character, ai: AiState, e: Character, world: CollisionWorld): number {
  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;
  const dx = e.x - ox;
  const dz = e.z - oz;
  const across = Math.hypot(dx, dz);
  if (across > AI.sightRange) return 0;
  const ahead = across > 1e-6 ? (dx * -Math.sin(c.yaw) + dz * -Math.cos(c.yaw)) / across : 1;
  if (ahead < HALF_FOV_COS) return 0;
  // In sight if the head or the middle of the body is.
  const head = e.y + e.height - 0.12;
  const body = e.y + e.height * 0.6;
  if (
    !clearLine(world, ox, oy, oz, e.x, head, e.z) &&
    !clearLine(world, ox, oy, oz, e.x, body, e.z)
  )
    return 0;
  const d = Math.hypot(across, head - oy);
  if (d < AI.instantRange) return Infinity;

  let rate = 1 / AI.reaction;
  if (d > AI.nearRange) {
    const far = Math.min(1, (d - AI.nearRange) / (AI.sightRange - AI.nearRange));
    rate *= 1 - (1 - AI.farRate) * Math.sqrt(far);
  }
  if (ahead < CENTRE_COS) {
    const edge = (CENTRE_COS - ahead) / (CENTRE_COS - HALF_FOV_COS);
    rate *= 1 - (1 - AI.peripheralRate) * edge;
  }
  if (e.height < MOVEMENT.standHeight - 0.1) rate *= AI.crouchedRate;
  if (e.height < MOVEMENT.crouchHeight - 0.1) rate *= AI.proneRate;
  const speed = Math.hypot(e.vx, e.vz);
  if (speed < 0.2) rate *= AI.stillRate;
  else if (speed > MOVEMENT.walkSpeed + 0.5) rate *= AI.sprintingRate;
  if (ai.awareness !== 'unaware') rate *= AI.waryRate;
  return rate;
}

function clearLine(
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  tx: number,
  ty: number,
  tz: number,
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  return world.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d) === Infinity;
}

/** An enemy spawn too near a player spawn. Ids are the markers' path ids. */
export interface ExposedSpawn {
  enemy: string;
  player: string;
  distance: number;
  /** Whether they can see each other, standing. */
  seen: boolean;
}

/**
 * Enemy spawns too near a player spawn: within AI.spawnClearance, or within sight range
 * with nothing between their standing eyes.
 */
export function exposedSpawns(
  markers: readonly { type: string; id: string; x: number; y: number; z: number }[],
  world: CollisionWorld,
): ExposedSpawn[] {
  const eye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  const ground = (m: { x: number; y: number; z: number }): number =>
    world.groundAt(m.x, m.z, MOVEMENT.radius, m.y + 0.5) + eye;
  const out: ExposedSpawn[] = [];
  for (const p of markers) {
    if (p.type !== 'playerSpawn') continue;
    const py = ground(p);
    for (const e of markers) {
      if (e.type !== 'enemySpawn') continue;
      const distance = Math.hypot(e.x - p.x, e.z - p.z);
      if (distance > Math.max(AI.spawnClearance, AI.sightRange)) continue;
      const seen = distance <= AI.sightRange && clearLine(world, p.x, py, p.z, e.x, ground(e), e.z);
      if (seen || distance < AI.spawnClearance)
        out.push({ enemy: e.id, player: p.id, distance, seen });
    }
  }
  return out;
}

/** Footsteps: sprinting and walking are heard nearby; crouching is silent. */
function listenForSteps(state: SimState, c: Character, ai: AiState): void {
  for (const e of state.entities) {
    if (e.ai || e.health.dead || e.admin?.peaceful || e.mode !== 'ground') continue;
    if (e.height < MOVEMENT.standHeight - 0.1) continue;
    const speed = Math.hypot(e.vx, e.vz);
    const range = speed > MOVEMENT.walkSpeed + 0.5 ? AI.sprintSteps : speed > 1 ? AI.walkSteps : 0;
    const d = Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z);
    if (d > range) continue;
    if (ai.awareness === 'alert') {
      if (e.id === ai.target) setFocus(ai, e.x, e.y, e.z);
    } else {
      heardAt(state, c, ai, e, d, true);
    }
  }
}

/** Shots and hits from this tick's events. */
function hearEvents(state: SimState, c: Character, ai: AiState, world: CollisionWorld): void {
  for (const ev of state.events) {
    if (ev.type === 'damage') {
      if (ev.target !== c.id || ev.by === 0 || ev.by === c.id) continue;
      const by = entityById(state, ev.by);
      if (by && !by.ai && !by.admin?.peaceful) {
        alarm(ai, by, by.x, by.y, by.z);
        ai.hurt = true;
        ai.aimError += AI.hitFlinch * DEG;
      }
      continue;
    }
    if (ev.type === 'explosion') {
      heardExplosion(state, c, ai, world, ev.x, ev.y, ev.z, ev.loudness, ev.by);
      continue;
    }
    if (ev.type !== 'shot' || ev.by === c.id) continue;
    const by = entityById(state, ev.by);
    if (!by || by.health.dead) continue;
    if (by.ai) {
      allyShot(state, c, ai, world, by, ev.fromX, ev.fromY, ev.fromZ, ev.loudness);
      continue;
    }
    const cy = c.y + c.height * 0.6;
    const miss = segmentDistance(
      c.x,
      cy,
      c.z,
      ev.fromX,
      ev.fromY,
      ev.fromZ,
      ev.toX,
      ev.toY,
      ev.toZ,
    );
    const d = Math.hypot(ev.fromX - c.x, ev.fromY - eyeHeight(c), ev.fromZ - c.z);
    if (miss <= AI.nearMiss) {
      alarm(ai, by, by.x, by.y, by.z);
      continue;
    }
    if (d > ev.loudness) continue;
    const loud = heardLoudness(world, c, ev.fromX, ev.fromY, ev.fromZ, ev.loudness);
    if (d <= loud * AI.alertShot) {
      alarm(ai, by, by.x, by.y, by.z);
    } else if (d <= loud && ai.awareness !== 'alert') {
      heardAt(state, c, ai, by, d, d <= loud * AI.investigateShot);
    }
  }
}

/**
 * Another enemy firing joins it in the fight: alert to its target close by (they call
 * out where it is), and walks over to where the shots came from within half the shot's
 * loudness. Further away it's ignored.
 */
function allyShot(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  ally: Character,
  x: number,
  y: number,
  z: number,
  loudness: number,
): void {
  if (ai.awareness === 'alert' || !ally.ai || ally.ai.target === 0) return;
  const d = Math.hypot(x - c.x, y - eyeHeight(c), z - c.z);
  if (d > loudness * AI.investigateShot) return;
  const target = entityById(state, ally.ai.target);
  if (!target || target.health.dead || target.admin?.peaceful) return;
  const loud = heardLoudness(world, c, x, y, z, loudness);
  if (d <= loud * AI.alertShot) alarm(ai, target, target.x, target.y, target.z);
  else if (d <= loud * AI.investigateShot)
    heardNoise(state, c, ai, ally.x, ally.y, ally.z, d, true);
}

/**
 * A grenade going off: suspicious of where it went off, not of who threw it (that may be
 * far away), and goes to look anywhere it's heard (the user's call, 2026-10-30: they're
 * loud enough to bring in enemies from across the map). Those it hurt are alarmed by the
 * damage instead. A peaceful admin's grenades go unheard.
 */
function heardExplosion(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  loudness: number,
  by: EntityId,
): void {
  if (ai.awareness === 'alert' || entityById(state, by)?.admin?.peaceful) return;
  const d = Math.hypot(x - c.x, y - eyeHeight(c), z - c.z);
  if (d > loudness) return;
  const loud = heardLoudness(world, c, x, y, z, loudness);
  if (d <= loud) heardNoise(state, c, ai, x, y, z, d, true);
}

/** A shot's loudness as heard by c: muffled with walls or ground in the way. */
function heardLoudness(
  world: CollisionWorld,
  c: Character,
  x: number,
  y: number,
  z: number,
  loudness: number,
): number {
  return clearLine(world, x, y, z, c.x, eyeHeight(c), c.z) ? loudness : loudness * AI.muffled;
}

/** Suspicious of a noise from e, d metres away. */
function heardAt(
  state: SimState,
  c: Character,
  ai: AiState,
  e: Character,
  d: number,
  investigate: boolean,
): void {
  if (e.admin?.peaceful) return;
  heardNoise(state, c, ai, e.x, e.y, e.z, d, investigate);
}

/** Suspicious of a noise at (x, y, z), d metres away: placed with an error that grows with d. */
function heardNoise(
  state: SimState,
  c: Character,
  ai: AiState,
  x: number,
  y: number,
  z: number,
  d: number,
  investigate: boolean,
): void {
  const off = Math.min(AI.noiseErrorMax, d * AI.noiseError) * Math.sqrt(nextFloat(state.rng));
  const around = nextFloat(state.rng) * Math.PI * 2;
  suspect(c, ai, x + Math.cos(around) * off, y, z + Math.sin(around) * off, investigate);
}

function segmentDistance(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t =
    len2 > 0
      ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / len2))
      : 0;
  return Math.hypot(ax + abx * t - px, ay + aby * t - py, az + abz * t - pz);
}

// ----------------------------------------------------------------------- awareness changes

function setFocus(ai: AiState, x: number, y: number, z: number): void {
  ai.focusX = x;
  ai.focusY = y;
  ai.focusZ = z;
}

/** Something's off at (x, y, z). Never lowers an alert. */
function suspect(
  c: Character,
  ai: AiState,
  x: number,
  y: number,
  z: number,
  investigate: boolean,
): void {
  if (ai.awareness === 'alert') return;
  const was = ai.awareness;
  ai.awareness = 'suspicious';
  setFocus(ai, x, y, z);
  if (was === 'suspicious' && ai.activity === 'investigate') return;
  ai.investigate = investigate || (was === 'suspicious' && ai.investigate);
  ai.activity = 'look';
  ai.timer = AI.lookTime;
  ai.hasGoal = false;
  ai.lookYaw = c.yaw;
}

/** Knows someone is there: alert. */
function alarm(ai: AiState, target: Character, x: number, y: number, z: number): void {
  // Peaceful (an admin cheat): never noticed, even when it shoots.
  if (target.admin?.peaceful) return;
  if (ai.awareness !== 'alert') {
    ai.hasGoal = false;
    ai.activity = 'engage';
    ai.reaction = ai.skill.reaction;
    ai.aimError = ai.skill.aimError * DEG;
    ai.burst = ai.pause = 0;
    ai.exposed = 0;
    ai.exposeLimit = (AI.expose[0] + AI.expose[1]) / 2;
    ai.hurt = false;
    ai.push = true;
    ai.reachable = true;
  }
  ai.awareness = 'alert';
  ai.target = target.id;
  ai.notice = 1;
  ai.unseen = 0;
  setFocus(ai, x, y, z);
}

function startSearch(ai: AiState): void {
  ai.awareness = 'searching';
  ai.activity = 'search';
  ai.searchLeft = AI.searchSpots;
  ai.notice = AI.glimpse;
  ai.hasGoal = false;
}

/**
 * Back to normal: unaware, and walking its patrol or guarding. Resuming a patrol picks it
 * up at the nearest point; otherwise it carries on from patrolIndex.
 */
function calmDown(c: Character, ai: AiState, resume = true): void {
  ai.awareness = 'unaware';
  ai.notice = 0;
  ai.target = 0;
  ai.seesTarget = false;
  ai.hasGoal = false;
  ai.replans = 0;
  ai.burst = 0;
  if (ai.patrol.length > 0) {
    ai.activity = 'patrol';
    ai.legSet = false;
    let best = Infinity;
    for (let i = 0; resume && i < ai.patrol.length / 3; i++) {
      const d = Math.hypot(ai.patrol[i * 3]! - c.x, ai.patrol[i * 3 + 2]! - c.z);
      if (d < best) {
        best = d;
        ai.patrolIndex = i;
      }
    }
  } else {
    ai.activity = 'guard';
    ai.lookYaw = ai.homeYaw;
    ai.timer = AI.guardLook;
  }
}

// ------------------------------------------------------------------------------ behaviour

function behave(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): void {
  ai.timer -= DT;
  let faceYaw = c.yaw;
  let facePitch = 0;
  let turn: number = ai.awareness === 'unaware' ? AI.turnRate : AI.alertTurnRate;

  if (fleeGrenade(state, c, ai, world, items, nav)) {
    faceYaw = fleeYaw;
    turn = AI.alertTurnRate;
    ai.input.sprint = true;
  } else
    switch (ai.activity) {
      case 'patrol': {
        if (!ai.legSet) pickLeg(state, ai, nav);
        const wait = ai.patrolWaits[ai.patrolIndex]!;
        const arrive = wait > 0 ? AI.arrive : AI.passBy;
        const r = moveTo(
          state,
          c,
          ai,
          nav,
          ai.legX,
          ai.legY,
          ai.legZ,
          AI.patrolPace,
          false,
          arrive,
        );
        faceYaw = moveYaw;
        if (r === 'moving') break;
        if (wait > 0) {
          ai.activity = 'wait';
          ai.timer = wait;
          ai.lookYaw = c.yaw;
        } else {
          nextPatrolPoint(ai);
        }
        break;
      }
      case 'wait':
        faceYaw = lookAround(ai);
        if (ai.timer <= 0) {
          nextPatrolPoint(ai);
          ai.activity = 'patrol';
        }
        break;
      case 'guard':
        if (Math.hypot(ai.homeX - c.x, ai.homeZ - c.z) > 1.5) {
          moveTo(state, c, ai, nav, ai.homeX, ai.homeY, ai.homeZ, AI.patrolPace);
          faceYaw = moveYaw;
          break;
        }
        faceYaw = ai.lookYaw;
        turn = AI.turnRate / 2;
        if (ai.timer <= 0) {
          ai.lookYaw = ai.homeYaw + nextRange(state.rng, -AI.guardArc, AI.guardArc) * DEG;
          ai.timer = AI.guardLook * nextRange(state.rng, 0.6, 1.4);
        }
        break;
      case 'look':
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        if (ai.timer <= 0) {
          ai.activity = ai.investigate ? 'investigate' : 'scan';
          ai.timer = AI.calmTime;
          ai.lookYaw = faceYaw;
          ai.hasGoal = false;
        }
        break;
      case 'investigate': {
        const r = moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.investigatePace);
        faceYaw = moveYaw;
        if (r !== 'moving') {
          ai.activity = 'scan';
          ai.timer = AI.scanTime;
          ai.lookYaw = c.yaw;
        }
        break;
      }
      case 'scan':
        faceYaw = lookAround(ai);
        if (ai.timer <= 0) calmDown(c, ai);
        break;
      case 'engage': {
        const target = entityById(state, ai.target);
        if (!target || target.health.dead) {
          calmDown(c, ai);
          break;
        }
        if (!ai.seesTarget) {
          if (!ai.reachable) {
            if (ai.unseen >= AI.intuition && startHold(state, c, ai, world, nav, target)) break;
          } else if (ai.unseen >= (ai.push ? AI.loseTrack : AI.holdAngle)) {
            startSearch(ai);
            break;
          }
        }
        const w = heldWeapon(c);
        if (!w) {
          // Unarmed: faces you and closes in.
          faceYaw = yawTo(c, ai.focusX, ai.focusZ);
          const across = Math.hypot(ai.focusX - c.x, ai.focusZ - c.z);
          facePitch = Math.atan2(ai.focusY + MOVEMENT.standHeight * 0.8 - eyeHeight(c), across);
          if (!ai.seesTarget || across > AI.approachRange)
            moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.alertPace, true);
          break;
        }
        fight(state, c, ai, world, items, nav, target);
        faceYaw = aimYaw;
        facePitch = aimPitch;
        if (!ai.seesTarget) break;
        ai.exposed += DT;
        const wantCover =
          ai.hurt || ai.exposed >= ai.exposeLimit || (w.mag === 0 && ai.exposed > 0.5);
        if (!wantCover || coversLeft <= 0) break;
        coversLeft--;
        ai.hurt = false;
        if (
          findCover(state, c, ai, world, nav, c.x, c.y, c.z, target.x, eyeHeight(target), target.z)
        ) {
          ai.activity = 'takeCover';
          ai.hasGoal = false;
          ai.peekX = c.x;
          ai.peekY = c.y;
          ai.peekZ = c.z;
        } else {
          ai.exposed = 0;
        }
        break;
      }
      case 'takeCover': {
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        reloadIfLow(c, items, 1);
        // Right onto the spot: a little off it may not be hidden.
        const r = moveTo(
          state,
          c,
          ai,
          nav,
          ai.coverX,
          ai.coverY,
          ai.coverZ,
          AI.alertPace,
          true,
          0.3,
        );
        if (r === 'failed') {
          backToFight(state, ai);
        } else if (r === 'arrived') {
          ai.activity = 'cover';
          ai.timer = nextRange(state.rng, AI.coverTime[0], AI.coverTime[1]);
          ai.exposed = 0;
        }
        break;
      }
      case 'cover':
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        ai.input.crouch = ai.coverLow;
        reloadIfLow(c, items, 1);
        // Time in cover. Once it has crouched and looked again, still seeing its target
        // means it's seen from somewhere else: this cover is no good.
        ai.exposed += DT;
        if (ai.seesTarget && ai.exposed > AI.settleInCover) backToFight(state, ai);
        else if (ai.timer <= 0 && !heldWeapon(c)?.reloading) {
          ai.activity = 'peek';
          ai.hasGoal = false;
          ai.timer =
            AI.peekTime + Math.hypot(ai.peekX - c.x, ai.peekZ - c.z) / (MOVEMENT.walkSpeed * 0.8);
        }
        break;
      case 'peek': {
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        // Stands up over low cover, or steps back out to where it was fighting from.
        const out =
          ai.coverLow ||
          near(c, ai.peekX, ai.peekY, ai.peekZ) ||
          moveTo(state, c, ai, nav, ai.peekX, ai.peekY, ai.peekZ, AI.alertPace, true) !== 'moving';
        if (ai.seesTarget || (out && ai.timer <= 0)) backToFight(state, ai);
        break;
      }
      case 'hold': {
        if (ai.seesTarget || ai.reachable) {
          backToFight(state, ai);
          break;
        }
        if (!near(c, ai.coverX, ai.coverY, ai.coverZ)) {
          const r = moveTo(state, c, ai, nav, ai.coverX, ai.coverY, ai.coverZ, AI.alertPace);
          ai.timer = AI.holdTime;
          if (r === 'moving') {
            faceYaw = moveYaw;
            break;
          }
          // There, or as close as it gets: hold here.
          ai.coverX = c.x;
          ai.coverY = c.y;
          ai.coverZ = c.z;
        }
        // Watching the way up, ready.
        faceYaw = yawTo(c, ai.wayX, ai.wayZ);
        const across = Math.hypot(ai.wayX - c.x, ai.wayZ - c.z);
        facePitch = Math.atan2(ai.wayY + 1 - eyeHeight(c), across);
        ai.input.aim = true;
        reloadIfLow(c, items, 1);
        if (
          ai.timer <= 0 &&
          randomSpotNear(state, c, nav, ai.wayX, ai.wayY, ai.wayZ, AI.loiterRadius)
        ) {
          ai.activity = 'loiter';
          ai.hasGoal = false;
          ai.coverX = spotX;
          ai.coverY = spotY;
          ai.coverZ = spotZ;
        }
        break;
      }
      case 'loiter': {
        if (ai.seesTarget || ai.reachable) {
          backToFight(state, ai);
          break;
        }
        const r = moveTo(state, c, ai, nav, ai.coverX, ai.coverY, ai.coverZ, AI.investigatePace);
        faceYaw = moveYaw;
        if (r !== 'moving') {
          ai.activity = 'hold';
          ai.coverX = c.x;
          ai.coverY = c.y;
          ai.coverZ = c.z;
          ai.hasGoal = false;
        }
        break;
      }
      case 'search': {
        const r = moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.alertPace);
        faceYaw = moveYaw;
        if (r !== 'moving') {
          ai.activity = 'searchScan';
          ai.timer = AI.searchScan;
          ai.lookYaw = c.yaw;
        }
        break;
      }
      case 'searchScan':
        faceYaw = lookAround(ai);
        if (ai.timer > 0) break;
        if (ai.searchLeft-- <= 0 || !pickSearchSpot(state, c, ai, nav)) {
          calmDown(c, ai);
        } else {
          ai.activity = 'search';
          ai.hasGoal = false;
        }
        break;
    }

  const input = ai.input;
  input.yaw = turnToward(c.yaw, faceYaw, turn * DT);
  input.pitch = c.pitch + Math.max(-turn * DT, Math.min(turn * DT, facePitch - c.pitch));
  // The stick is relative to where it faces; moveTo left a world direction in wishX, Z.
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  input.moveX = cy * wishX - sy * wishZ;
  input.moveY = -(sy * wishX + cy * wishZ);
  wishX = wishZ = 0;
}

// Where fleeGrenade wants it to face.
let fleeYaw = 0;
// A flee spot at least this far outside the blast radius counts as safe.
const FLEE_SAFE = 0.5;

/**
 * A grenade close enough to hurt it, with nothing between it and its eye (it saw it, or
 * heard it land): it sprints for a walkable spot outside the blast that it can reach, the
 * nearest to it, and turns to face the grenade once there. Whatever it was doing waits,
 * planning afresh once the grenade has gone off. Returns whether it's running (or waiting
 * out the blast); false too when there's nowhere to run.
 */
function fleeGrenade(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): boolean {
  const eye = eyeHeight(c);
  let found: Grenade | null = null;
  let radius = 0;
  for (const g of state.grenades) {
    const r = grenadeDef(items, g.item).radius;
    if (Math.hypot(g.x - c.x, g.y - c.y, g.z - c.z) > r + AI.fleeMargin) continue;
    if (ai.flee?.grenade !== g.id && !clearLine(world, c.x, eye, c.z, g.x, g.y + 0.1, g.z))
      continue;
    found = g;
    radius = r;
    break;
  }
  if (!found) {
    if (ai.flee) {
      ai.flee = null;
      ai.hasGoal = false;
    }
    return false;
  }
  // A new grenade, or this one has bounced or rolled up to where it was running: run anew.
  const f0 = ai.flee;
  if (
    f0?.grenade !== found.id ||
    Math.hypot(f0.x - found.x, f0.z - found.z) < radius + FLEE_SAFE
  ) {
    if (!pickFleeSpot(c, ai, nav, found, radius) && f0?.grenade !== found.id) return false;
    ai.hasGoal = false;
  }
  const f = ai.flee!;
  const r = moveTo(state, c, ai, nav, f.x, f.y, f.z, AI.alertPace);
  fleeYaw = r === 'moving' ? moveYaw : yawTo(c, found.x, found.z);
  return true;
}

/** The walkable spot outside a grenade's blast nearest c that c can walk to, into ai.flee. */
function pickFleeSpot(
  c: Character,
  ai: AiState,
  nav: NavGrid,
  g: Grenade,
  radius: number,
): boolean {
  const from = nav.nearest(c.x, c.y, c.z);
  if (from < 0) return false;
  const dist = radius + AI.fleeMargin;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < AI.fleeDirections; k++) {
    const a = (k / AI.fleeDirections) * Math.PI * 2;
    const node = nav.nearest(g.x + Math.cos(a) * dist, c.y, g.z + Math.sin(a) * dist, 3);
    if (node < 0 || nav.component[node] !== nav.component[from]) continue;
    const x = nav.nodeX(node);
    const z = nav.nodeZ(node);
    if (Math.hypot(x - g.x, z - g.z) < radius + FLEE_SAFE) continue;
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  if (best < 0) return false;
  ai.flee = { grenade: g.id, x: nav.nodeX(best), y: nav.nodeY(best), z: nav.nodeZ(best) };
  return true;
}

/** Sweeps the view either side of lookYaw while standing. */
function lookAround(ai: AiState): number {
  return ai.lookYaw + Math.sin(ai.timer * 1.2) * 0.9;
}

/**
 * On to the next point: through the way in once, then round the repeating points in a
 * loop, or back and forth between the first and last of them.
 */
function nextPatrolPoint(ai: AiState): void {
  const first = ai.patrolRepeatFrom;
  const last = ai.patrol.length / 3 - 1;
  ai.legSet = false;
  ai.hasGoal = false;
  if (ai.patrolIndex < first) {
    ai.patrolIndex++;
  } else if (ai.patrolLoop) {
    ai.patrolIndex = ai.patrolIndex >= last ? first : ai.patrolIndex + 1;
  } else {
    const next = ai.patrolIndex + ai.patrolStep;
    if (next < first || next > last) ai.patrolStep = -ai.patrolStep;
    ai.patrolIndex += ai.patrolStep;
  }
}

/** Where to go for the current patrol point: a random walkable spot within its radius. */
function pickLeg(state: SimState, ai: AiState, nav: NavGrid): void {
  const i = ai.patrolIndex;
  ai.legX = ai.patrol[i * 3]!;
  ai.legY = ai.patrol[i * 3 + 1]!;
  ai.legZ = ai.patrol[i * 3 + 2]!;
  ai.legSet = true;
  const radius = ai.patrolRadii[i]!;
  if (radius <= 0) return;
  const centre = nav.nearest(ai.legX, ai.legY, ai.legZ, GOAL_RISE);
  for (let tries = 0; tries < 8; tries++) {
    const r = radius * Math.sqrt(nextFloat(state.rng));
    const a = nextFloat(state.rng) * Math.PI * 2;
    const n = nav.nearest(ai.legX + Math.cos(a) * r, ai.legY, ai.legZ + Math.sin(a) * r, GOAL_RISE);
    if (n >= 0 && (centre < 0 || nav.component[n] === nav.component[centre])) {
      ai.legX = nav.nodeX(n);
      ai.legY = nav.nodeY(n);
      ai.legZ = nav.nodeZ(n);
      return;
    }
  }
}

/** A random reachable spot near where the target was last seen, as the new focus. */
function pickSearchSpot(state: SimState, c: Character, ai: AiState, nav: NavGrid): boolean {
  if (!randomSpotNear(state, c, nav, ai.focusX, ai.focusY, ai.focusZ, AI.searchRadius))
    return false;
  setFocus(ai, spotX, spotY, spotZ);
  return true;
}

// What randomSpotNear found.
let spotX = 0;
let spotY = 0;
let spotZ = 0;

/** A random spot within radius of (x, y, z) that c can walk to, in spotX, Y, Z. */
function randomSpotNear(
  state: SimState,
  c: Character,
  nav: NavGrid,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  if (here < 0) return false;
  for (let tries = 0; tries < 8; tries++) {
    const r = radius * Math.sqrt(nextFloat(state.rng));
    const a = nextFloat(state.rng) * Math.PI * 2;
    const n = nav.nearest(x + Math.cos(a) * r, y + 1, z + Math.sin(a) * r);
    if (n >= 0 && nav.component[n] === nav.component[here]) {
      spotX = nav.nodeX(n);
      spotY = nav.nodeY(n);
      spotZ = nav.nodeZ(n);
      return true;
    }
  }
  return false;
}

/** Close enough to a spot to be there, without planning a path to it. */
function near(c: Character, x: number, y: number, z: number): boolean {
  return Math.hypot(x - c.x, z - c.z) < 1.2 && Math.abs(y - c.y) < 1;
}

// ---------------------------------------------------------------------------- fighting

// Where fight() and aimAt() want it to look.
let aimYaw = 0;
let aimPitch = 0;
// Scratch for weapon stats and the check for allies in the way.
const gunStats = createWeaponStats();
const allyHit = createCharacterHit();

/**
 * One tick of fighting with a gun: closes in to its range or sidesteps, aims with an
 * error that settles while it watches its target, and fires in bursts once it has
 * reacted. Without sight of its target it pushes to where it last saw it, or holds the
 * angle. Leaves where to look in aimYaw, aimPitch.
 */
function fight(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
  target: Character,
): void {
  const w = heldWeapon(c)!;
  const def = weaponDef(items, w.item);
  const input = ai.input;
  const sees = ai.seesTarget;
  // The middle of the body, or the head if that's all it can see over cover: of the
  // target itself while seen, else where it was.
  const tx = sees ? target.x : ai.focusX;
  const tz = sees ? target.z : ai.focusZ;
  let ty = sees ? target.y + target.height * 0.6 : ai.focusY + MOVEMENT.standHeight * 0.6;
  if (sees && !clearLine(world, c.x, eyeHeight(c), c.z, tx, ty, tz))
    ty = target.y + target.height - 0.15;
  const across = Math.hypot(tx - c.x, tz - c.z);

  let moving = false;
  if (!sees) {
    if (ai.push)
      moving =
        moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.alertPace, true) === 'moving';
  } else if (across > Math.min(def.range * AI.engageRange, AI.maxEngage)) {
    moving =
      moveTo(state, c, ai, nav, target.x, target.y, target.z, AI.alertPace, true) === 'moving';
  } else {
    moving = sidestep(state, c, ai, nav);
  }

  if (sees) {
    ai.reaction -= DT;
    const speed = Math.min(1, Math.hypot(target.vx, target.vz) / MOVEMENT.sprintSpeed);
    const settled =
      (ai.skill.aimSettled + AI.targetMoveError * speed + (moving ? AI.selfMoveError : 0)) * DEG;
    ai.aimError = settled + (ai.aimError - settled) * Math.exp(-DT / ai.skill.aimSettle);
  }
  aimAt(state, c, ai, tx, ty, tz);
  input.aim = sees && across > AI.aimDownRange;
  reloadIfLow(c, items, sees ? 0 : 0.5);

  const ready =
    sees &&
    ai.reaction <= 0 &&
    w.mag > 0 &&
    w.reloading === 0 &&
    across <= def.range &&
    Math.abs(angleDiff(c.yaw, aimYaw)) < AI.fireCone * DEG;
  const semi = def.fireMode === 'semi';
  if (ai.burst <= 0 && ai.pause <= 0 && ready) {
    const [min, max] = across < AI.closeRange ? AI.closeBurst : AI.farBurst;
    // A semi-automatic's burst is one pull: the trigger held for a tick.
    ai.burst = semi ? DT / 2 : (Math.round(nextRange(state.rng, min, max)) * 60) / def.rpm;
  }
  if (ai.burst > 0) {
    input.fire = ready && clearOfAllies(state, c, target, tx, ty, tz);
    ai.burst -= DT;
    if (ai.burst <= 0) {
      const [min, max] = semi ? AI.semiPause : AI.burstPause;
      // Slower, steadier shots further away.
      ai.pause = nextRange(state.rng, min, max) * (1 + across / 40);
    }
  } else {
    ai.pause -= DT;
  }
}

/** Looks at a point, off by its aim error, wandering smoothly, and pulls against recoil. */
function aimAt(state: SimState, c: Character, ai: AiState, x: number, y: number, z: number): void {
  const t = state.tick * DT;
  const e = ai.aimError;
  aimYaw = yawTo(c, x, z) + e * Math.sin(t * 2.3 + ai.aimPhase);
  aimPitch =
    Math.atan2(y - eyeHeight(c), Math.hypot(x - c.x, z - c.z)) +
    e * 0.7 * Math.sin(t * 3.1 + ai.aimPhase * 1.7) -
    c.recoilPitch * AI.recoilControl;
}

/** Whether a shot at (x, y, z) would reach the target before any other enemy. */
function clearOfAllies(
  state: SimState,
  c: Character,
  target: Character,
  x: number,
  y: number,
  z: number,
): boolean {
  const oy = eyeHeight(c);
  const dx = x - c.x;
  const dy = y - oy;
  const dz = z - c.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  if (raycastCharacters(state, c.x, oy, c.z, dx / d, dy / d, dz / d, d, c.id, allyHit) === Infinity)
    return true;
  return allyHit.id === target.id || !entityById(state, allyHit.id)?.ai;
}

/**
 * Steps left or right now and then while fighting, only onto ground on its own level, so
 * it never steps off a roof. Returns whether it's moving.
 */
function sidestep(state: SimState, c: Character, ai: AiState, nav: NavGrid): boolean {
  ai.strafeTimer -= DT;
  if (ai.strafeTimer <= 0) {
    const r = nextFloat(state.rng);
    ai.strafe = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
    ai.strafeTimer = nextRange(state.rng, AI.strafeTime[0], AI.strafeTime[1]);
  }
  if (ai.strafe === 0) return false;
  // To its right (or left): yaw 0 faces −z, so right is +x.
  const rx = Math.cos(c.yaw) * ai.strafe;
  const rz = -Math.sin(c.yaw) * ai.strafe;
  const px = c.x + rx;
  const pz = c.z + rz;
  const n = nav.nearest(px, c.y, pz);
  if (
    n < 0 ||
    Math.abs(nav.nodeY(n) - c.y) > MOVEMENT.stepUp ||
    Math.hypot(nav.nodeX(n) - px, nav.nodeZ(n) - pz) > nav.cellSize
  ) {
    ai.strafe = -ai.strafe;
    return false;
  }
  wishX = rx * AI.strafePace;
  wishZ = rz * AI.strafePace;
  return true;
}

/** Reloads when the magazine is below this fraction of full (0: only when empty). */
function reloadIfLow(c: Character, items: ItemDb, fraction: number): void {
  const w = heldWeapon(c);
  if (!w || w.reloading > 0 || reloadRound(c, items, w) === null) return;
  const full = weaponStats(items, w, gunStats).magazine;
  if (w.mag === 0 || w.mag < full * fraction) c.ai!.input.reload = true;
}

/** Back to fighting in the open, for a fresh while before looking for cover again. */
function backToFight(state: SimState, ai: AiState): void {
  ai.activity = 'engage';
  ai.hasGoal = false;
  ai.exposed = 0;
  ai.exposeLimit = nextRange(state.rng, AI.expose[0], AI.expose[1]);
}

/**
 * Its target is somewhere it can't walk to: finds the closest it can get (the way up)
 * and a spot nearby that's hidden from the target but watches the way up. False if it
 * has to wait a tick for a path or cover search.
 */
function startHold(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
  target: Character,
): boolean {
  if (plansLeft <= 0 || coversLeft <= 0) return false;
  plansLeft--;
  coversLeft--;
  findPath(nav, nav.nearest(c.x, c.y, c.z), nav.nearest(target.x, target.y, target.z), ai.path);
  const end = ai.path.length - 3;
  ai.wayX = end >= 0 ? ai.path[end]! : c.x;
  ai.wayY = end >= 0 ? ai.path[end + 1]! : c.y;
  ai.wayZ = end >= 0 ? ai.path[end + 2]! : c.z;
  const ty = eyeHeight(target);
  if (
    !findCover(state, c, ai, world, nav, ai.wayX, ai.wayY, ai.wayZ, target.x, ty, target.z, true)
  ) {
    ai.coverX = ai.wayX;
    ai.coverY = ai.wayY;
    ai.coverZ = ai.wayZ;
  }
  ai.activity = 'hold';
  ai.hasGoal = false;
  return true;
}

/**
 * Looks for cover from a threat's eye at (tx, ty, tz) within coverRadius of (cx, cy, cz):
 * a spot it can walk to where the threat can't see it crouched, not too close to the
 * threat, and not already taken by another enemy. Over low cover it can stand up to see
 * the threat. With watch, the spot must also hide it standing, and see the way up (wayX,
 * Y, Z) from there. Picks the nearest one it finds, in coverX, Y, Z and coverLow.
 */
function findCover(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
  cx: number,
  cy: number,
  cz: number,
  tx: number,
  ty: number,
  tz: number,
  watch = false,
): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  if (here < 0) return false;
  const crouchedEye = MOVEMENT.crouchHeight - MOVEMENT.eyeBelowTop;
  const standingEye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  let best = Infinity;
  for (let i = 0; i < AI.coverSamples; i++) {
    const r = nextRange(state.rng, 1.5, AI.coverRadius);
    const a = nextFloat(state.rng) * Math.PI * 2;
    const n = nav.nearest(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r);
    if (n < 0 || nav.component[n] !== nav.component[here]) continue;
    const x = nav.nodeX(n);
    const y = nav.nodeY(n);
    const z = nav.nodeZ(n);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= best || Math.hypot(x - tx, z - tz) < AI.coverMinThreat || taken(state, c, x, z))
      continue;
    // Hidden a little either side of the spot too, as it stops near it, not on it.
    const td = Math.hypot(x - tx, z - tz);
    const sx = ((z - tz) / td) * AI.coverMargin;
    const sz = (-(x - tx) / td) * AI.coverMargin;
    const ey = y + crouchedEye;
    if (
      clearLine(world, tx, ty, tz, x, ey, z) ||
      clearLine(world, tx, ty, tz, x + sx, ey, z + sz) ||
      clearLine(world, tx, ty, tz, x - sx, ey, z - sz)
    )
      continue;
    const low = clearLine(world, tx, ty, tz, x, y + standingEye, z);
    if (watch && (low || !clearLine(world, x, y + standingEye, z, ai.wayX, ai.wayY + 1, ai.wayZ)))
      continue;
    best = d;
    ai.coverX = x;
    ai.coverY = y;
    ai.coverZ = z;
    ai.coverLow = low;
  }
  return best < Infinity;
}

/** Whether another enemy is in or heading for cover at (x, z). */
function taken(state: SimState, c: Character, x: number, z: number): boolean {
  for (const e of state.entities) {
    const o = e.ai;
    if (e === c || !o || e.health.dead) continue;
    const a = o.activity;
    if (
      (a === 'takeCover' || a === 'cover' || a === 'hold') &&
      Math.hypot(o.coverX - x, o.coverZ - z) < 1.2
    )
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------- moving

// What moveTo decided this tick: a world direction scaled by pace, and the way it's going.
let wishX = 0;
let wishZ = 0;
let moveYaw = 0;

/**
 * Walks along a path to (x, y, z), planning one when the goal changes. Leaves the move in
 * wishX, wishZ and its heading in moveYaw. 'arrived' at the end of the path (or the
 * closest it can get), 'failed' if there's no way at all.
 */
function moveTo(
  state: SimState,
  c: Character,
  ai: AiState,
  nav: NavGrid,
  x: number,
  y: number,
  z: number,
  pace: number,
  strafe = false,
  arrive: number = AI.arrive,
): 'moving' | 'arrived' | 'failed' {
  moveYaw = c.yaw;
  if (!ai.hasGoal || Math.hypot(ai.goalX - x, ai.goalY - y, ai.goalZ - z) > AI.replanDistance) {
    if (plansLeft <= 0) return 'moving';
    plansLeft--;
    const result = findPath(
      nav,
      nav.nearest(c.x, c.y, c.z),
      nav.nearest(x, y, z, GOAL_RISE),
      ai.path,
    );
    ai.hasGoal = true;
    ai.goalX = x;
    ai.goalY = y;
    ai.goalZ = z;
    ai.pathIndex = ai.path.length > 3 ? 1 : 0;
    ai.stuck = 0;
    if (result === 'none' && Math.hypot(x - c.x, z - c.z) > arrive) return 'failed';
  }

  const last = ai.path.length / 3 - 1;
  while (ai.pathIndex <= last) {
    const i = ai.pathIndex * 3;
    const reach = ai.pathIndex === last ? arrive : AI.waypoint;
    if (Math.hypot(ai.path[i]! - c.x, ai.path[i + 2]! - c.z) > reach) break;
    ai.pathIndex++;
  }
  if (ai.pathIndex > last) {
    ai.hasGoal = false;
    ai.replans = 0;
    return 'arrived';
  }

  // Stuck against something: plan again from here, and give up after a few tries.
  if (Math.hypot(c.vx, c.vz) < AI.stuckSpeed) ai.stuck += DT;
  else ai.stuck = 0;
  if (ai.stuck > AI.stuckTime) {
    ai.hasGoal = false;
    ai.stuck = 0;
    if (++ai.replans > 2) {
      ai.replans = 0;
      return 'failed';
    }
  }

  const i = ai.pathIndex * 3;
  const dx = ai.path[i]! - c.x;
  const dz = ai.path[i + 2]! - c.z;
  const d = Math.hypot(dx, dz);
  moveYaw = Math.atan2(-dx, -dz);
  // Turn before walking off sideways, unless it's meant to (alert, facing its target).
  const off = Math.abs(angleDiff(c.yaw, moveYaw));
  const speed = strafe || off < Math.PI / 3 ? pace : pace * 0.3;
  wishX = (dx / d) * speed;
  wishZ = (dz / d) * speed;
  return 'moving';
}

function yawTo(c: Character, x: number, z: number): number {
  const dx = x - c.x;
  const dz = z - c.z;
  return dx === 0 && dz === 0 ? c.yaw : Math.atan2(-dx, -dz);
}

/** The signed smallest turn from a to b, in −π..π. */
function angleDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function turnToward(from: number, to: number, step: number): number {
  const d = angleDiff(from, to);
  return from + Math.max(-step, Math.min(step, d));
}

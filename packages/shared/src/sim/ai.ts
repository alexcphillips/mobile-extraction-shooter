import type { EnemySkill, Faction } from '../content/enemies';
import {
  carrierOf,
  grenadeDef,
  grenadeEffect,
  itemDef,
  weaponDef,
  type GrenadeDef,
  type ItemDb,
} from '../content/items';
import { NAV, type NavGrid } from '../nav/nav-grid';
import { findPath, type Avoid } from '../nav/path';
import { chance, nextFloat, nextRange } from '../rng';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { openDoorAhead } from './doors';
import { hostile } from './factions';
import { FIRE, inFire } from './fire';
import { breakGlass, glassHit } from './glass';
import {
  GRENADE,
  dropGrenade,
  predictThrow,
  smokeBlocks,
  throwable,
  type Grenade,
} from './grenades';
import { HEALTH, LEFT_ARM, RIGHT_LEG, TOTAL_HP, isLimb, totalHp, type Zone } from './health';
import { zoneToTreat, type MedRef } from './meds';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import { MOVEMENT } from './movement';
import {
  bodyPoint,
  entityById,
  eyeHeight,
  spawnCharacter,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';
import { QUICK_GRIDS, carriedGrid, chestArmor, heldWeapon } from './gear';
import { canReload, createWeaponStats, weaponStats } from './weapons';
import { loadNoise } from './weight';
import {
  ROUTES,
  chooseExtraction,
  extractSpot,
  inExtraction,
  nearestStop,
  pickBody,
  pickContainer,
  pickStop,
  searchTime,
  squadState,
  stopToward,
  takeLoot,
  lootInReach,
  type LootTarget,
  type SquadState,
} from './routes';
import { searchContainer } from './looting';
import { timeLeft } from './raid';
import { ZOMBIES, type WindowState, type ZombieMind } from './zombies';

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

/** AI tuning. Distances in meters, times in seconds, rates per second. */
export const AI = {
  /** Sight and hearing are checked every this many ticks, staggered across enemies. */
  perceiveEvery: 3,
  sightRange: 70,
  /** The whole field of view, in degrees. */
  fov: 120,
  /** Seconds to notice someone in plain view closer than nearRange. */
  reaction: 0.5,
  nearRange: 8,
  /**
   * Beyond nearRange the rate falls as (nearRange / distance) to this power: in plain view
   * straight ahead, walking, about 3 s at 25 m, 9 s at 50 m and 16 s at 70 m to notice
   * fully (2026-11-01; it was a square root down to 8% at 70 m, which noticed you about
   * 60 m away in 3 s, crouched or not).
   */
  farFalloff: 1.6,
  /**
   * Players first (2026-11-08, the user's call): choosing whom to notice, a player counts
   * playerFirst times as noticeable as an AI, so at similar distances it's you. Fighting an
   * AI, it turns on a player it can see within playerSwitch meters who is no further than
   * playerCloser times the one it's fighting, or once it has lost sight of that one.
   */
  playerFirst: 1.5,
  playerSwitch: 45,
  playerCloser: 1.25,
  /**
   * AI fights stay local (2026-11-08, the user's call): it ignores a hostile AI further off
   * than this unless it's already fighting it (one shot at it, say). Players are seen out to
   * sightRange as ever.
   */
  aiEngage: 35,
  /** Within this angle from straight ahead, full rate; at the edge of view, peripheralRate. */
  centerAngle: 25,
  peripheralRate: 0.35,
  crouchedRate: 0.6,
  /** Prone on top of crouched. */
  proneRate: 0.6,
  stillRate: 0.7,
  sprintingRate: 1.3,
  /** Leaning all the way (2026-11-01), less for a part lean: a peek is harder to notice. */
  leaningRate: 0.75,
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
  /**
   * Gunfire and blasts (2026-11-01, the user's report: one shot pulled every enemy on the
   * map to it, single file through a held door): at most this many go to check the same
   * one, anything placed within responderRadius of a spot already being checked, the
   * nearest first. The rest turn to look and stay where they are. The radius is over twice
   * noiseErrorMax, so the same noise placed by two listeners always counts as one.
   */
  responders: 2,
  responderRadius: 20,
  /**
   * Going to check gunfire or a blast, it stops at the first spot within watchRange that
   * can see where it came from (watchHeight above it), watches it aimed for watchTime, then
   * creeps in at creepPace, still aimed. Footsteps and glimpses are walked straight up to.
   */
  watchRange: 12,
  watchHeight: 1,
  watchTime: 6,
  creepPace: 0.45,
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
  /**
   * Erratic movement (AI rework session 2, scavs): with skill.erratic 1, a quirk about
   * every quirkEvery seconds (×0.5–1.5) while walking about: a stop, a crouch-walk or a
   * short sprint, each lasting its range in seconds. While fighting only crouches, as often.
   */
  quirkEvery: 6,
  quirkStop: [0.6, 1.8] as const,
  quirkCrouch: [1.2, 3] as const,
  quirkSprint: [0.8, 2] as const,
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
  /**
   * Out of sight for no longer than this (a flicker of sight round the edge of low cover),
   * it fires on with no fresh reaction (2026-11-08: Jug stood beside a counter seeing you
   * for a moment at a time, each one restarting quickReaction, and never fired).
   */
  blink: 0.3,
  /** Degrees added to its settled aim error by a target moving at sprint speed... */
  targetMoveError: 2.5,
  /** ...while it moves itself... */
  selfMoveError: 0.5,
  /** ...and in one go when it's hit. */
  hitFlinch: 3,
  /**
   * Where on a body it aims (2026-11-08, the user's call: torso and head, not legs): the
   * upper chest, this share of the body's height (1.35 m of a 1.8 m body: the chest zone is
   * 0.85–1.49 m, the forearms of a rifle hold cross it at 1.08–1.31, the legs end at 0.96).
   * Its aim wanders aimVertical as much up and down as across. Measured standing in the open
   * (PMC at 10 / 15 / 25 m): chest 84 / 70 / 43%, arms 16 / 25 / 45%, head 0 / 5 / 13%, legs
   * none (were 0 / 8 / 18%, aiming at 0.6 with 0.7 vertical wander).
   * GZ-3 (2026-11-12, client/src/shots-to-kill.measure.test.ts: a PMC's AKM on someone
   * standing still facing it, hits that landed, at 10 / 25 / 50 m): thorax 30 / 41 / 38%,
   * stomach 17 / 9 / 13%, face 13 / 18 / 7%, head 9 / 2 / 4%, arms 27 / 26 / 33%, legs 5 / 4 /
   * 5%. Kept here, over the thorax: aiming at the middle of the torso (0.65) put a fifth of
   * hits in the legs and took twice the hits to kill through a plate carrier.
   */
  aimHeight: 0.75,
  aimVertical: 0.45,
  /** How much of its own recoil it pulls against, up and sideways. */
  recoilControl: 1,
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
  /** A spot tried in the threat's view moves this far behind what's on the way to it. */
  coverBehind: 0.7,
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
  /**
   * Covering less than stuckSpeed × stuckTime in stuckTime means stuck: plan again, then
   * give up. By ground covered, not speed (2026-11-08): a PMC leader jittered against
   * scenery at 0.3–1.3 m/s for 12 minutes without moving, so never counted as stuck.
   */
  stuckSpeed: 0.3,
  stuckTime: 1.5,
  /** Stuck, it sidesteps this many seconds before going on (AI rework session 4). */
  unstickTime: 0.6,
  /** Path searches across all enemies in one tick; the rest wait a tick. */
  plansPerTick: 2,
  /**
   * Stranded on an island of the nav grid (this many nodes or fewer: a tabletop it climbed
   * onto by a chair the grid doesn't link) with no way to where it's going, it walks
   * straight off the edge to the nearest real floor within offReach across and offDrop
   * down (2026-11-08: two PMC squads on Northpoint stood on a dining table to the end of
   * the raid).
   */
  island: 64,
  offReach: [0.6, 1, 1.8, 2.6] as const,
  offDrop: 1.5,
  /** Up on something with no node of its own counts from this far above the floor's node. */
  perched: 0.6,
  /** Stepping off this long without getting down, it stops trying for offRetry. */
  offGiveUp: 4,
  offRetry: 20,
  /** A goal that moves further than this needs a new path. */
  replanDistance: 1.5,
  /**
   * A grenade it can see within its radius plus this is run from, to a spot this far
   * outside the radius, the nearest of fleeDirections around the grenade.
   */
  fleeMargin: 2,
  fleeDirections: 12,
  /**
   * Of the spots outside the blast, one out of the thrower's sight counts as this many
   * meters nearer (2026-11-08): it breaks for cover when there's some about, but a grenade
   * still flushes it into the open rather than send it the long way round.
   */
  fleeHidden: 4,
} as const;

/**
 * How a squad fights (AI rework session 5; design.md → AI → PMCs → Fighting). Distances in
 * meters, times in seconds, angles in degrees; first guesses to tune in play.
 */
export const TACTICS = {
  /** A squad member spotting someone calls out, unless a mate did within this long. */
  calloutGap: 4,
  /**
   * Its target out of sight of the whole squad for AI.intuition, the squad splits: the
   * last half (rounded down) by place flank, the rest hold and fire at its cover...
   */
  suppressTime: [6, 10] as const,
  /** ...in bursts of this many rounds, this many seconds apart... */
  suppressBurst: [4, 8] as const,
  suppressPause: [0.3, 0.7] as const,
  /** ...only where its rounds would hit this close short of where it last saw it, or past it. */
  coverSlack: 2.5,
  /**
   * A holder whose rounds can't get there for repositionAfter moves to a spot within
   * vantageRadius they can from, at least vantageMin from where it lost its target, the
   * nearest of vantageSamples tried (2026-11-08, an AI-5 loose end: it just watched).
   */
  repositionAfter: 1,
  vantageRadius: 8,
  vantageMin: 6,
  vantageSamples: 12,
  /**
   * A flanker goes to a spot that sees where its target was at least flankAngle off the
   * line from the holders, flankRange from it, the nearest of flankSamples tried...
   */
  flankAngle: 45,
  flankRange: [6, 18] as const,
  flankSamples: 16,
  /** ...that still sees it this far either side... */
  flankMargin: 0.4,
  /**
   * ...going round, not past it: its way keeps flankShun from where it last saw it (each
   * meter of path inside costs flankShunCost more), as from fire (2026-11-08).
   */
  flankShun: 4.5,
  flankShunCost: 2,
  /** ...sprinting while further than this from it, giving up after flankTime, there this close... */
  sprintFrom: 8,
  flankTime: 20,
  flankArrive: 0.4,
  /** ...and watches from there this long before searching. */
  flankWatch: 6,
  /**
   * Hearing its target reload or heal (skill.listen): it pushes to it for this long, not
   * taking cover, sprinting while further than rushSprint from where it heard it.
   */
  rushTime: 5,
  rushSprint: 4,
  /**
   * Grenades (AI-6; design.md → AI → PMCs → Fighting): an enemy carrying a frag that has
   * lost its target for throwAfter, but no longer than throwFresh, may throw it at where it
   * was, about throwRate times a second while it holds the angle, holds a way up, fires at
   * its cover or waits in cover; never while pushing at it (the user's call, 2026-11-08)...
   */
  throwAfter: 1.5,
  throwFresh: 12,
  throwRate: 0.4,
  /**
   * ...at least throwMin from it (the user's call, 2026-11-08: not from close up; outside a
   * frag's blast, which it would run from though it can't be hurt by its own), when an arc first lands within throwSlack of the spot, with a clear line from
   * there to it...
   */
  throwMin: 10,
  throwSlack: 2.5,
  /**
   * ...and the area's token is free: no grenade of any AI's live, or about to be thrown,
   * within tokenRadius of the spot. Each thrower waits throwGap before its next, or retry
   * after finding no arc.
   */
  tokenRadius: 20,
  throwGap: 20,
  retry: 2,
  /** It gives up turning to throw after this long. */
  throwTurn: 1.5,
  /**
   * An edge for PMCs in AI fights (2026-11-08, the user's request: they should come out
   * ahead of scavs; it never touches how either treats a player): a scav notices a PMC at
   * scavSpotsPmc its usual rate and takes scavReactsPmc times as long to fire at one.
   */
  scavSpotsPmc: 0.6,
  scavReactsPmc: 1.6,
  /**
   * And for bosses against PMCs (2026-11-08, the user's go-ahead: PMCs killed Jug in every
   * raid): a PMC notices a boss at pmcSpotsBoss its usual rate, and takes pmcReactsBoss
   * seconds longer to fire at one (about 1.25 s in all). Never towards players.
   */
  pmcSpotsBoss: 0.6,
  pmcReactsBoss: 0.8,
  /** Open ground, for a leaving squad's sprint: openRays of 8 rays clear for openReach. */
  openReach: 12,
  openRays: 6,
  /**
   * A PMC (skill.sprintToCover) doesn't go for cover from a target it sees this close, and
   * turns to fight one that comes this close on its way (2026-11-08: two in three PMCs that
   * died on Northpoint died going to cover, most to a scav 2–6 m off).
   */
  closeFight: 8,
};

/**
 * How Jug fights (AI-7; design.md → AI → Jug), through his skill's `bold`, `charge`, `slide`
 * and `relentless`. Distances in meters, times in seconds; first guesses to tune in play.
 */
export const JUG = {
  /** Bold: it looks this long at what it heard before going to it (others AI.lookTime). */
  boldLook: 0.4,
  /** Charging: it walks at a target it sees, firing, down to this far... */
  chargeClose: 4,
  /** ...and out of sight sprints to where it was, while further than this. */
  chargeSprint: 6,
  /**
   * Sliding: sprinting at its target, seen or where it was, from this far off, when nothing
   * is in the way for slideClear along where it's going (a slide is about 3.8 m), and no
   * sooner than slideGap after the last.
   */
  slideRange: [4, 10] as const,
  slideClear: 4,
  slideGap: 3,
  /**
   * The hunt (relentless): the way its quarry goes, a point each time it has gone trailStep
   * from the last, the newest trailMax kept (the oldest dropped). It walks them in turn,
   * dropping each it gets within trailReach of, and sprints while the newest is further than
   * trailSprint.
   */
  trailStep: 1.5,
  trailMax: 80,
  trailReach: 1,
  trailSprint: 8,
  /**
   * On its perception ticks it skips ahead to the newest point it can see within trailSee,
   * looking at no more than trailLooks of them, newest first.
   */
  trailSee: 25,
  trailLooks: 16,
  /**
   * Volume of fire (skill.charge, 2026-11-08): bursts of this many rounds, with pauses of
   * this many seconds between (others: AI.closeBurst, farBurst and burstPause, the pause
   * growing with distance). Against a PMC squad he held the trigger a third of the time
   * he saw them, and died in about 3 s of fighting having fired 3–19 rounds.
   */
  burst: [10, 18] as const,
  burstPause: [0.1, 0.3] as const,
  /**
   * Suppression (AI-8, skill.charge): its target gone behind cover it still knows it's
   * behind (within pinSlack of where it last saw it), for no longer than pinFresh, it holds
   * the trigger down at that spot while its rounds would land there, walking in. It reloads
   * only when empty, whether or not it's suppressing.
   */
  pinFresh: 8,
  pinSlack: 3,
  /**
   * Kicking doors (AI-8, skill.smash): alert, it kicks a closed, unlocked door in its way
   * open from kickReach (others open one from DOOR.aiReach), without slowing, heard within
   * kickLoudness. Smashing glass: alert, it breaks a whole pane within smashReach ahead of
   * it or towards where it's after.
   */
  kickReach: 2,
  kickLoudness: 30,
  smashReach: 1.6,
  /**
   * Charging at grenades (AI-8, skill.charge): a hostile's grenade it can see within
   * baitRange, while it can't see its target, draws it at a sprint for baitTime.
   */
  baitRange: 20,
  baitTime: 4,
  /**
   * Enraged (AI-8, skill.enrage): losing rageDamage HP within rageWindow to hits from
   * someone it can't see, it drops a smoke at its feet (if it has one), fires blind down
   * the line the hits came from for rageFire, then sprints at where they came from through
   * the smoke for up to rageCharge. Not again for rageGap.
   */
  rageDamage: 30,
  rageWindow: 2,
  rageFire: 2,
  rageCharge: 6,
  rageGap: 15,
  /**
   * Stagger (AI-8, skill.stagger): a shot by a round of staggerRound damage or more (before
   * armor and the zone's multiplier) throws its aim off by staggerAim degrees, and it
   * can't fire, sprint or slide for staggerTime, moving at staggerPace.
   */
  staggerRound: 60,
  staggerAim: 12,
  staggerTime: 0.6,
  staggerPace: 0.3,
  /**
   * Breathing and muttering (AI-8, an enemy type with those voice lines): a breath every
   * breathEvery seconds, every mutterEvery-th a mutter instead, while calm, or hunting
   * someone it hasn't seen for quietAfter. Not while firing.
   */
  breathEvery: 4,
  mutterEvery: 3,
  quietAfter: 5,
};

/**
 * An enemy breathing or muttering (AI-8, Jug): a voice line the client plays from its
 * type's voice, if it has one.
 */
export interface VoiceEvent {
  type: 'voice';
  by: EntityId;
  line: 'breathe' | 'mutter';
}

/**
 * Treating itself (skill.heals, 2026-11-08, PMCs; design.md → AI → PMCs → Healing).
 */
export const HEAL = {
  /** A medkit once below this share of its full HP, or any zone below zoneShare of its own. */
  hpShare: 0.7,
  zoneShare: 0.5,
  /** Fighting, only once its target has been out of sight this long. */
  unseen: 1,
  /** Spots tried for cover to treat itself in (others AI.coverSamples): it matters more. */
  coverSamples: 24,
};

/** A squad member shouting that it has spotted someone (AI rework session 5). */
export interface CalloutEvent {
  type: 'callout';
  by: EntityId;
  target: EntityId;
}

export type Awareness = 'unaware' | 'suspicious' | 'alert' | 'searching';

/** What it's doing, within its awareness state. */
export type AiActivity =
  | 'patrol' // walking to the next patrol point
  | 'wait' // standing at a patrol point, looking around
  | 'guard' // no patrol: standing at its spawn, looking around
  | 'look' // suspicious: turned to look at what it noticed
  | 'investigate' // suspicious: walking over to check it
  | 'watch' // suspicious: stopped short of gunfire or a blast, watching where it was, aimed
  | 'creep' // suspicious: done watching, creeping in to check it, aimed
  | 'scan' // looking around where it was, or at a noise not worth checking
  | 'engage' // alert: fighting you, or pushing to (or holding) where it last saw you
  | 'takeCover' // alert: moving to cover
  | 'cover' // alert: in cover, reloading
  | 'peek' // alert: out of cover to look for you again
  | 'suppress' // alert, a squad member (AI-5): holding, firing at where it lost you
  | 'flank' // alert, a squad member (AI-5): going to a spot that sees where it lost you from the side
  | 'hold' // alert, can't reach you: holding a way up
  | 'loiter' // alert, can't reach you: moving to another spot near the way up
  | 'search' // walking to a spot to check
  | 'searchScan' // looking around a searched spot
  | 'follow' // a squad member (AI-3): keeping its place beside its leader
  | 'route' // a squad's leader (AI-4): walking to its next point of interest, or its extraction
  | 'loot' // a squad member (AI-4): walking to a container or body and searching it
  | 'extract'; // a squad member (AI-4): standing in its extraction zone until it leaves

export interface AiState {
  awareness: Awareness;
  activity: AiActivity;
  /** The controls it gives itself, read by movement and weapons like a player's. */
  input: PlayerInput;
  /** How well it fights, from its enemy type. */
  skill: EnemySkill;
  /** Who it sides with, from its enemy type (see factions.ts). Missing (older saves) is scav. */
  faction?: Faction;
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
  /**
   * Whether it's gunfire or a blast, approached with care: it stops short to watch
   * before creeping in (2026-11-01). Missing (older saves) is false.
   */
  cautious?: boolean;
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
  /**
   * Stepping off an island (stepOff): seconds spent at it so far, and the tick it may try
   * again after giving up. Missing is none.
   */
  offFor?: number;
  offAgain?: number;
  /** Where it was when the current stuck window started. Missing (older saves) is here. */
  stuckX?: number;
  stuckZ?: number;
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
  /**
   * The newest fire on the map (by id) its path was planned or checked knowing of
   * (2026-10-31): newer fire across the rest of the path plans it again, round it.
   * Missing (older saves) is 0.
   */
  fires?: number;
  /** A zombie's (zombies mode, sim/zombies.ts): it hunts instead (see hunt). Missing for others. */
  zombie?: ZombieMind | null;
  /**
   * An erratic enemy's current quirk (AI rework session 2, skill.erratic): 'stop', 'crouch'
   * or 'sprint' for quirkTime more seconds; quirkNext counts down to the next. Missing
   * (older saves, and enemies that aren't erratic) is none.
   */
  quirk?: Quirk | null;
  quirkTime?: number;
  quirkNext?: number;
  /**
   * A PMC's squad (AI rework session 3): its id, shared by its members, who are allies
   * (factions.ts hostile). Missing for an enemy on its own.
   */
  squad?: number;
  /**
   * Its place in the squad: the living member with the lowest leads, the rest follow it
   * in formation (in this order). Missing is 0.
   */
  squadSlot?: number;
  /**
   * A follower's: the leader's heading its place was last worked out from, and whether its
   * side of the formation is swapped (−1) since the leader turned back. Missing is none, 1.
   */
  followYaw?: number;
  followSide?: number;
  /**
   * A squad member's (AI rework session 4): the container or body it's going to search, or
   * searching; null or missing when none.
   */
  loot?: LootTarget | null;
  /** A squad's leader: back on the route at the nearest stop, after a fight or a check. */
  reroute?: boolean;
  /**
   * Stuck: seconds left sidestepping, and which way (1 right, −1 left). Missing (older
   * saves) is none.
   */
  unstick?: number;
  unstickSide?: number;
  /**
   * A leaving squad's leader whose way out kept stopping short: the stop it goes by first
   * (an index into SimState.pois), and how many it has tried.
   */
  detour?: number | undefined;
  detours?: number;
  /** A squad's leader: paths that got only part way to its stop so far (ROUTES.partial). */
  legTries?: number;
  /** A squad member hunting someone it lost: seconds left before it gives up. */
  hunt?: number | undefined;
  /**
   * Heard its target reload or heal (AI rework session 5): seconds left pushing at it.
   * Missing is none.
   */
  rush?: number;
  /**
   * A squad member: whether it has taken its part (holding or flanking) since it last saw
   * its target, so it splits from the squad once per time it loses it. Missing is false.
   */
  planned?: boolean;
  /**
   * Holding for a squad that flanks only when its target is pinned (skill.pinFlank, MT-12):
   * seconds until it looks for a flanking spot again, having found none. Missing is 0.
   */
  pinTry?: number;
  /** The tick it last called out a target it spotted (AI rework session 5). */
  calledAt?: number;
  /**
   * About to throw a grenade (AI-6): the item, the spot it's thrown at, the look it's
   * thrown along (before the throw's loft) and seconds left to turn to it. It holds its
   * area's token meanwhile. Null or missing when not.
   */
  toss?: {
    item: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    time: number;
  } | null;
  /** The tick it may next think about throwing one. Missing is any time. */
  nextThrow?: number;
  /** The tick it may next slide (AI-7, skill.slide). Missing is any time. */
  nextSlide?: number;
  /**
   * A relentless enemy's quarry (AI-7, Jug): who last hit it, hunted until one of them is
   * dead, and the way the quarry has gone since it was last seen, as flat x, y, z points
   * (JUG.trailStep apart). Missing or 0 when not hunting.
   */
  quarry?: EntityId;
  trail?: number[];
  /**
   * A holder (suppress): seconds its rounds couldn't reach where it lost its target, and
   * the spot it's moving to that they can from (null or missing when none).
   */
  blocked?: number;
  vantage?: { x: number; y: number; z: number } | null;
  /**
   * Alerted without seeing its target, and not seen it since (skill.sprints: it sprints to
   * close the gap). Missing is false.
   */
  aggro?: boolean;
  /** On open ground, as it last looked (a leaving squad sprints across it). Missing is false. */
  open?: boolean;
  /** Where it last saw its target (AI-8: what it suppresses). Missing until it has. */
  seenX?: number;
  seenY?: number;
  seenZ?: number;
  /** The newest grenade it has charged at (AI-8, skill.charge). Missing is none. */
  bait?: number;
  /**
   * Enraged (AI-8, skill.enrage): who hurt it, where from, and seconds since; null or
   * missing when not. rageHurt is HP lost to unseen hits since the tick rageSince, and
   * nextRage the tick it may next be enraged.
   */
  rage?: { by: EntityId; x: number; y: number; z: number; time: number } | null;
  rageHurt?: number;
  rageSince?: number;
  nextRage?: number;
  /**
   * Treating itself in a fight (skill.heals): whether it has looked for cover to do it in
   * yet. Missing is false.
   */
  healCover?: boolean;
  /** Seconds left staggered by a heavy round (AI-8, skill.stagger). Missing is none. */
  stagger?: number;
  /** Breathes and mutters (AI-8): its type has those voice lines. Missing is false. */
  voiced?: boolean;
  /*
   * The tutorial's flags (TU-2, 2026-11-09), from its spawn. Missing is false.
   */
  /** Hears nothing (footsteps, hands, shots, blasts, doors, glass); a hit still alarms it. */
  deaf?: boolean;
  /** Notices nobody by sight or sound; cleared once it's hit or set alight. */
  passive?: boolean;
  /** Its hits do no damage (health.ts woundZone), but are hits in every other way. */
  harmless?: boolean;
}

export type Quirk = 'stop' | 'crouch' | 'sprint';

export interface PatrolDef {
  points: readonly { x: number; y: number; z: number; wait: number; radius: number }[];
  repeatFrom: number;
  loop: boolean;
}

export interface EnemySpawnOptions {
  patrol?: PatrolDef | undefined;
  /** Spawns at a random clear spot within this many meters. */
  radius?: number | undefined;
  /** How well it fights; DEFAULT_SKILL if left out. */
  skill?: EnemySkill | undefined;
  /** Who it sides with; scav if left out. */
  faction?: Faction | undefined;
  /** How many outfits its type has: one is picked at random. 1 if left out. */
  outfits?: number | undefined;
  /** Its enemy type's id, put in Character.look with the outfit for drawing. */
  type?: string | undefined;
  /** Breathes and mutters now and then (AI-8): its type has those voice lines. */
  voiced?: boolean | undefined;
  /** Its arms' and legs' HP as a multiple of everyone's (the enemy type's limbHealth). */
  limbHealth?: number | undefined;
  /** The tutorial's flags (TU-2), from its spawn: see AiState.deaf, passive and harmless. */
  deaf?: boolean | undefined;
  passive?: boolean | undefined;
  harmless?: boolean | undefined;
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
  const {
    patrol,
    radius = 0,
    skill = DEFAULT_SKILL,
    faction = 'scav',
    outfits = 1,
    type,
    voiced = false,
    limbHealth = 1,
  } = options;
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
  // Only rolled when there's a choice, so a type with one outfit draws nothing from the RNG.
  const outfit = outfits > 1 ? Math.floor(nextFloat(state.rng) * outfits) : 0;
  if (type !== undefined) c.look = { type, outfit };
  c.ai = {
    awareness: 'unaware',
    activity: 'guard',
    // Facing its spawn's way from the first tick (it faced −z for a tick before: AI-7).
    input: { ...createInput(), yaw },
    skill: { ...skill },
    faction,
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
    cautious: false,
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
  if (voiced) c.ai.voiced = true;
  if (options.deaf) c.ai.deaf = true;
  if (options.passive) c.ai.passive = true;
  if (options.harmless) c.ai.harmless = true;
  // Tougher limbs (Jug, 2026-11-08): more HP, kept in the state like any other.
  for (let z = LEFT_ARM; z <= RIGHT_LEG; z++) c.health.hp[z] = HEALTH.maxHp[z]! * limbHealth;
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
  c.yaw = ai.input.yaw = ai.homeYaw;
  c.pitch = ai.input.pitch = 0;
  c.mode = 'ground';
  ai.patrolIndex = 0;
  ai.patrolStep = 1;
  calmDown(c, ai, false);
}

const DT = TICK_SECONDS;
const PERCEIVE_DT = AI.perceiveEvery * DT;
const HALF_FOV_COS = Math.cos((AI.fov / 2) * DEG);
const CENTER_COS = Math.cos(AI.centerAngle * DEG);

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
    input.extinguish = input.throw = input.slide = false;
    input.use = null;
    if (c.health.dead) continue;
    if (ai.zombie) hunt(state, c, ai, items, nav);
    else {
      if ((state.tick + c.id) % AI.perceiveEvery === 0) {
        // Passive (the tutorial's scav, TU-2): nothing is noticed until it's hit.
        if (!ai.passive) look(state, c, ai, world, nav);
        if (!ai.deaf && !ai.passive) listenForSteps(state, c, ai, items);
        if (ai.skill.listen && !ai.deaf && !ai.passive) listenForHands(state, c, ai);
        if (ai.squad !== undefined) shareTarget(state, c, ai);
        if (ai.quarry) track(state, c, ai);
        if (ai.awareness === 'alert') considerThrow(state, c, ai, world, items);
        // Out in the open on the way out (skill.sprints): sprinting across it.
        if (ai.skill.sprints)
          ai.open = !!squadState(state, ai.squad)?.leaving && openAround(world, c);
      }
      hearEvents(state, c, ai, world, nav);
      behave(state, c, ai, world, items, nav);
      // Out of a fight, it tops its magazine up from what it carries (2026-11-08: PMCs
      // walked into the next fight half empty and ran dry).
      // Its magazines fill as they go in (MG-4, weapons.ts: magRounds), so one is always
      // full while it has loose rounds; no packing.
      if (ai.awareness === 'unaware' && !c.using && !ai.zombie) reloadIfLow(state, c, items, 1);
      if (ai.voiced) breathe(state, c, ai);
    }
    // A closed door on the way to the next waypoint opens as it gets there; Jug, alert,
    // kicks it open from further off (AI-8).
    const i = ai.pathIndex * 3;
    if (ai.hasGoal && i < ai.path.length && (input.moveX !== 0 || input.moveY !== 0)) {
      const kick = !!ai.skill.smash && ai.awareness === 'alert';
      openDoorAhead(
        state,
        world,
        items,
        c,
        ai.path[i]!,
        ai.path[i + 2]!,
        kick ? JUG.kickReach : undefined,
      );
    }
  }
}

/**
 * Breathing and muttering through the mask (AI-8; design.md → AI → Jug → Tells): now and
 * then while calm, or hunting someone who has gone quiet. By the tick, not the RNG, so it
 * changes no other roll.
 */
function breathe(state: SimState, c: Character, ai: AiState): void {
  if (c.health.dead || ai.input.fire) return;
  const quiet = ai.awareness !== 'alert' || (!ai.seesTarget && ai.unseen >= JUG.quietAfter);
  if (!quiet) return;
  const every = Math.round(JUG.breathEvery / DT);
  const t = state.tick + c.id * 37;
  if (t % every !== 0) return;
  const line = Math.floor(t / every) % JUG.mutterEvery === 0 ? 'mutter' : 'breathe';
  state.events.push({ type: 'voice', by: c.id, line });
}

// ---------------------------------------------------------------------------- perception

/**
 * Sight: notices whoever hostile it can see best (players, and other factions' enemies:
 * AI rework session 1), and keeps track of its target while alert.
 */
function look(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): void {
  let best: Character | undefined;
  let bestRate = 0;
  let bestPick = 0;
  // The nearest player it can see, for turning on mid-fight with an AI.
  let player: Character | undefined;
  let playerD = Infinity;
  const saw = ai.seesTarget;
  ai.seesTarget = false;
  for (const e of state.entities) {
    if (e.health.dead || e.admin?.peaceful || !hostile(c, e)) continue;
    // Another AI further off than aiEngage isn't its business, unless it's fighting it.
    if (e.ai && e.id !== ai.target && Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z) > AI.aiEngage)
      continue;
    const rate = sightRate(state, c, ai, e, world);
    if (e.id === ai.target && rate > 0) ai.seesTarget = true;
    // Picked by how noticeable, a player first at similar distances.
    const pick = e.ai ? rate : rate * AI.playerFirst;
    if (pick > bestPick) {
      bestPick = pick;
      bestRate = rate;
      best = e;
    }
    if (rate > 0 && !e.ai) {
      const d = Math.hypot(e.x - c.x, e.z - c.z);
      if (d < playerD) {
        playerD = d;
        player = e;
      }
    }
  }

  if (ai.awareness === 'alert') {
    const target = entityById(state, ai.target);
    if (!target || target.health.dead) {
      calmDown(c, ai);
      return;
    }
    // Fighting an AI with a player in view and near enough: it turns on the player.
    if (target.ai && player && playerD <= AI.playerSwitch) {
      const td = Math.hypot(target.x - c.x, target.z - c.z);
      if (!ai.seesTarget || playerD <= td * AI.playerCloser) {
        turnOn(ai, player);
        return;
      }
    }
    if (ai.seesTarget && !saw) {
      // Back in sight. Where it last saw you (focus, still) it's ready for; somewhere
      // else after a while takes a fresh reaction, and aim off by about how far you went.
      const moved = Math.hypot(target.x - ai.focusX, target.z - ai.focusZ);
      if (ai.unseen > AI.reacquire && moved > AI.relocated) {
        const d = Math.max(1, Math.hypot(target.x - c.x, target.z - c.z));
        ai.reaction = reactionTo(ai, target);
        ai.aimError = Math.max(
          ai.aimError,
          Math.min(ai.skill.aimError * DEG, 2 * Math.atan2(moved, d)),
        );
      } else if (ai.unseen > AI.blink) {
        ai.reaction = Math.max(ai.reaction, AI.quickReaction);
      }
    } else if (saw && !ai.seesTarget) {
      // Holds the angle only if it can see where it last saw you (focus, not yet moved on).
      ai.push =
        !chance(state.rng, ai.skill.holdChance) ||
        !clearLine(world, c.x, eyeHeight(c), c.z, ai.focusX, ai.focusY + 1.2, ai.focusZ);
      // Or rushes your position (skill.pushChance, 2026-11-08): one of a squad at a time.
      if (
        ai.skill.pushChance &&
        ai.reachable &&
        !mateRushing(state, c, ai) &&
        chance(state.rng, ai.skill.pushChance)
      ) {
        ai.push = true;
        ai.rush = TACTICS.rushTime;
      }
    }
    if (ai.seesTarget) ai.aggro = false;
    // Seeing it again, it may take its part in the squad's plan afresh next time it loses it.
    if (ai.seesTarget) {
      ai.planned = false;
      ai.seenX = target.x;
      ai.seenY = target.y;
      ai.seenZ = target.z;
    }
    // Knows roughly where you went for a moment after losing sight of you.
    if (ai.seesTarget || ai.unseen < AI.intuition) setFocus(ai, target.x, target.y, target.z);
    ai.unseen = ai.seesTarget ? 0 : ai.unseen + PERCEIVE_DT;
    checkReachable(ai, c, target, nav);
    if (!ai.reachable && ai.unseen >= AI.giveUp && ai.quarry !== ai.target) {
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
  if (ai.notice >= 1) {
    const was = ai.awareness;
    alarm(ai, best, best.x, best.y, best.z);
    if (was !== 'alert' && ai.squad !== undefined) callout(state, c, ai, best);
  } else if (ai.notice >= AI.glimpse || ai.awareness !== 'unaware')
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

// Scratch for where a target's head and chest are, leaned.
const headPoint = { x: 0, y: 0, z: 0 };
const chestPoint = { x: 0, y: 0, z: 0 };

/**
 * How fast it notices e (per second), or 0 if it can't see e: not while blinded by a
 * flash, nor through smoke (2026-10-31).
 */
function sightRate(
  state: SimState,
  c: Character,
  ai: AiState,
  e: Character,
  world: CollisionWorld,
): number {
  if (c.blind) return 0;
  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;
  const dx = e.x - ox;
  const dz = e.z - oz;
  const across = Math.hypot(dx, dz);
  if (across > AI.sightRange) return 0;
  const ahead = across > 1e-6 ? (dx * -Math.sin(c.yaw) + dz * -Math.cos(c.yaw)) / across : 1;
  const halfFov = ai.skill.fov === undefined ? HALF_FOV_COS : Math.cos((ai.skill.fov / 2) * DEG);
  if (ahead < halfFov) return 0;
  // In sight if the head or the middle of the body is, leaned out from cover or not.
  const h = headPoint;
  const b = chestPoint;
  bodyPoint(e, e.height - 0.12, h);
  bodyPoint(e, e.height * 0.6, b);
  if (!clearLine(world, ox, oy, oz, h.x, h.y, h.z) && !clearLine(world, ox, oy, oz, b.x, b.y, b.z))
    return 0;
  if (
    smokeBlocks(state.smokes, ox, oy, oz, h.x, h.y, h.z) &&
    smokeBlocks(state.smokes, ox, oy, oz, b.x, b.y, b.z)
  )
    return 0;
  const d = Math.hypot(across, h.y - oy);
  if (d < AI.instantRange) return Infinity;

  let rate = 1 / AI.reaction;
  if (d > AI.nearRange) rate *= (AI.nearRange / d) ** AI.farFalloff;
  if (ahead < CENTER_COS) {
    const edge = (CENTER_COS - ahead) / (CENTER_COS - halfFov);
    rate *= 1 - (1 - AI.peripheralRate) * edge;
  }
  if (e.height < MOVEMENT.standHeight - 0.1) rate *= AI.crouchedRate;
  if (e.height < MOVEMENT.crouchHeight - 0.1) rate *= AI.proneRate;
  if (e.lean) rate *= 1 - (1 - AI.leaningRate) * Math.abs(e.lean);
  const speed = Math.hypot(e.vx, e.vz);
  if (speed < 0.2) rate *= AI.stillRate;
  else if (speed > MOVEMENT.walkSpeed + 0.5) rate *= AI.sprintingRate;
  if (ai.awareness !== 'unaware') rate *= AI.waryRate;
  // Scavs are slower to spot a PMC (2026-11-08): PMCs come out of AI fights ahead.
  if (scavSeesPmc(ai, e)) rate *= TACTICS.scavSpotsPmc;
  if (pmcSeesBoss(ai, e)) rate *= TACTICS.pmcSpotsBoss;
  return rate;
}

/**
 * Leaving the raid across open ground (skill.sprints, 2026-11-08): it sprints, at full
 * stick, this tick. ai.open is kept up on its perception ticks while its squad leaves.
 */
function sprintOpen(ai: AiState): void {
  if (!ai.skill.sprints || !ai.open) return;
  const d = Math.hypot(wishX, wishZ);
  if (d < 1e-6) return;
  wishX /= d;
  wishZ /= d;
  ai.input.sprint = true;
}

/**
 * Whether (x, z) is on its ground (skill.territory): within that of a point of its patrol,
 * or of its spawn without one. Always, for an enemy without a territory.
 */
function onGround(ai: AiState, x: number, z: number, beyond = 0): boolean {
  if (ai.skill.territory === undefined) return true;
  const r = ai.skill.territory + beyond;
  const p = ai.patrol;
  if (p.length === 0) return Math.hypot(x - ai.homeX, z - ai.homeZ) <= r;
  for (let i = 0; i < p.length; i += 3) if (Math.hypot(x - p[i]!, z - p[i + 2]!) <= r) return true;
  return false;
}

/** Whether a squad mate of c is rushing its target already. */
function mateRushing(state: SimState, c: Character, ai: AiState): boolean {
  if (ai.squad === undefined) return false;
  for (const e of state.entities) {
    const m = e.ai;
    if (e !== c && m && m.squad === ai.squad && !e.health.dead && (m.rush ?? 0) > 0) return true;
  }
  return false;
}

/**
 * Whether c stands on open ground (2026-11-08): of 8 rays at chest height, at least
 * TACTICS.openRays reach TACTICS.openReach without hitting anything.
 */
function openAround(world: CollisionWorld, c: Character): boolean {
  let clear = 0;
  const y = c.y + 1.2;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (world.raycast(c.x, y, c.z, Math.cos(a), 0, Math.sin(a), TACTICS.openReach) === Infinity)
      clear++;
  }
  return clear >= TACTICS.openRays;
}

/** Whether ai is a scav's and e a PMC (AI against AI only: never a player). */
function scavSeesPmc(ai: AiState, e: Character): boolean {
  return (ai.faction ?? 'scav') === 'scav' && e.ai?.faction === 'pmc';
}

/** Whether ai is a PMC's and e a boss (AI against AI only). */
function pmcSeesBoss(ai: AiState, e: Character): boolean {
  return ai.faction === 'pmc' && e.ai?.faction === 'boss';
}

/**
 * Seconds from seeing target to its first shot: its skill's, longer for a scav at a PMC
 * and a PMC at a boss.
 */
function reactionTo(ai: AiState, target: Character): number {
  return (
    ai.skill.reaction * (scavSeesPmc(ai, target) ? TACTICS.scavReactsPmc : 1) +
    (pmcSeesBoss(ai, target) ? TACTICS.pmcReactsBoss : 0)
  );
}

/**
 * Whether nothing solid is between two points (glass is seen and heard through), nor
 * foliage unless throughLeaves (for sound and blasts).
 */
export function clearLine(
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  tx: number,
  ty: number,
  tz: number,
  throughLeaves = false,
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const dz = tz - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  // Glass is seen and heard through. Foliage hides (MT-3) but sound and blasts pass it.
  if (world.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d, undefined, true) !== Infinity)
    return false;
  return throughLeaves || !world.foliageWithin(ox, oy, oz, dx / d, dy / d, dz / d, d);
}

/**
 * How far the nearest living player is from an eye at (x, eye, z); 0 if one can see it
 * (within sight range). Infinity with none. For spawning enemies out of players' way.
 */
export function playerDistance(
  state: SimState,
  world: CollisionWorld,
  x: number,
  eye: number,
  z: number,
): number {
  let best = Infinity;
  for (const e of state.entities) {
    if (e.ai || e.health.dead) continue;
    const ey = eyeHeight(e);
    const d = Math.hypot(e.x - x, ey - eye, e.z - z);
    if (d <= AI.sightRange && clearLine(world, e.x, ey, e.z, x, eye, z)) return 0;
    if (d < best) best = d;
  }
  return best;
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
 * Enemy spawns too near a player spawn: within `clearance` (the map's enemyClearance, else
 * AI.spawnClearance), or within sight range with nothing between their standing eyes.
 */
export function exposedSpawns(
  markers: readonly { type: string; id: string; x: number; y: number; z: number }[],
  world: CollisionWorld,
  clearance: number = AI.spawnClearance,
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
      if (distance > Math.max(clearance, AI.sightRange)) continue;
      const seen = distance <= AI.sightRange && clearLine(world, p.x, py, p.z, e.x, ground(e), e.z);
      if (seen || distance < clearance) out.push({ enemy: e.id, player: p.id, distance, seen });
    }
  }
  return out;
}

/**
 * How much further a character's footsteps carry for its chest armor (GZ-4: a carrier's
 * noise) and, a player's, for its load (BW-3): quieter light, louder heavy.
 */
function stepNoise(items: ItemDb, e: Character): number {
  const chest = chestArmor(items, e.gear);
  const carrier = (chest && carrierOf(itemDef(items, chest.item))?.noise) || 1;
  return carrier * (e.ai || e.load === undefined ? 1 : loadNoise(e.load));
}

/**
 * Footsteps: sprinting and walking are heard nearby; crouching is silent. Players' only:
 * enemies don't go looking for each other (AI rework session 1), they fight on sight.
 */
function listenForSteps(state: SimState, c: Character, ai: AiState, items: ItemDb): void {
  for (const e of state.entities) {
    if (e.ai || e.health.dead || e.admin?.peaceful || e.mode !== 'ground') continue;
    if (e.height < MOVEMENT.standHeight - 0.1) continue;
    const speed = Math.hypot(e.vx, e.vz);
    const range =
      (speed > MOVEMENT.walkSpeed + 0.5 ? AI.sprintSteps : speed > 1 ? AI.walkSteps : 0) *
      (ai.skill.hearing ?? 1) *
      stepNoise(items, e);
    const d = Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z);
    if (d > range) continue;
    if (ai.awareness === 'alert') {
      if (e.id === ai.target) setFocus(ai, e.x, e.y, e.z);
    } else {
      heardAt(state, c, ai, e, d, true);
    }
  }
}

/**
 * A squad member that has just spotted someone shouts (design.md → AI → PMCs → Seeing you):
 * a voice line the client plays. It still fires only after its reaction time. One shout
 * for a squad at a time, so a squad seeing you together calls out once.
 */
function callout(state: SimState, c: Character, ai: AiState, target: Character): void {
  const gap = TACTICS.calloutGap / DT;
  for (const e of state.entities) {
    const m = e.ai;
    if (m && m.squad === ai.squad && !e.health.dead && state.tick - (m.calledAt ?? -Infinity) < gap)
      return;
  }
  ai.calledAt = state.tick;
  state.events.push({ type: 'callout', by: c.id, target: target.id });
}

/**
 * Hearing a player reload or use a med within skill.listen (AI rework session 5; design.md
 * → AI → PMCs → Fighting): by its sound, walls or not, as for footsteps. Fighting that
 * player out of sight, it pushes round the corner at it; otherwise it goes to check.
 * Players' only, like footsteps.
 */
function listenForHands(state: SimState, c: Character, ai: AiState): void {
  const range = ai.skill.listen!;
  for (const e of state.entities) {
    if (e.ai || e.health.dead || e.admin?.peaceful) continue;
    if (!e.using && !((heldWeapon(e)?.reloading ?? 0) > 0)) continue;
    const d = Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z);
    if (d > range) continue;
    const fighting = ai.awareness === 'alert' || ai.awareness === 'searching';
    if (fighting && e.id === ai.target) {
      if (ai.awareness === 'alert' && ai.seesTarget) continue;
      if (ai.awareness !== 'alert') alarm(ai, e, e.x, e.y, e.z);
      setFocus(ai, e.x, e.y, e.z);
      ai.unseen = 0;
      ai.push = true;
      ai.rush = TACTICS.rushTime;
      if (ai.activity !== 'engage') {
        ai.activity = 'engage';
        ai.hasGoal = false;
      }
    } else if (ai.awareness !== 'alert') {
      heardAt(state, c, ai, e, d, true);
    }
  }
}

/** Shots and hits from this tick's events. */
function hearEvents(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): void {
  // The map's hearing scale (AI rework session 1): guns are heard 110–190 m, about all of
  // a small map, so a map can make every noise carry less there. Jug hears further (AI-7).
  const scale = (state.hearingScale ?? 1) * (ai.skill.hearing ?? 1);
  for (const ev of state.events) {
    if (ev.type === 'damage') {
      if (ev.target !== c.id || ev.by === 0 || ev.by === c.id) continue;
      const by = entityById(state, ev.by);
      if (by && !by.health.dead && hostile(c, by) && !by.admin?.peaceful) {
        // A hit wakes a passive enemy (TU-2): from now on it sees as any other does.
        delete ai.passive;
        // Hurt by someone it can't see (asked before it turns to them): Jug's rage (AI-8).
        if (ai.skill.enrage && !ai.rage) hurtUnseen(state, c, ai, world, by, ev.amount);
        alarm(ai, by, by.x, by.y, by.z);
        ai.hurt = true;
        ai.aimError += AI.hitFlinch * DEG;
        if (ai.skill.stagger && ev.cause === 'shot')
          staggered(ai, ev.zone, ev.amount + ev.absorbed);
        // The hunt is for players (2026-11-08): an AI that shoots it is fought where it is.
        if (ai.skill.relentless && !by.ai && ai.quarry !== by.id) startHunt(ai, by);
      }
      continue;
    }
    // Deaf, or passive until hit (TU-2): only being hurt or set alight gets through.
    if ((ai.deaf || ai.passive) && ev.type !== 'death' && ev.type !== 'ignite') continue;
    if (ev.type === 'door') {
      // Jug kicking a door in (AI-8): heard like glass breaking, further. An ally's isn't
      // worth checking.
      const d = world.doors[ev.door];
      const by = entityById(state, ev.by);
      if (ev.result === 'kicked' && d && by && hostile(c, by))
        heardExplosion(state, c, ai, world, d.x, d.y + 1, d.z, JUG.kickLoudness * scale, ev.by);
      continue;
    }
    if (ev.type === 'explosion') {
      heardExplosion(state, c, ai, world, ev.x, ev.y, ev.z, ev.loudness * scale, ev.by);
      continue;
    }
    if (ev.type === 'pain') {
      // A player's blacked stomach groaning (GZ-3): heard as far as sprinting footsteps,
      // walls or not, and placed as they are. Enemies' groans are for players only.
      const by = entityById(state, ev.by);
      if (!by || by.ai || by.health.dead || by.admin?.peaceful) continue;
      const d = Math.hypot(by.x - c.x, by.y - c.y, by.z - c.z);
      if (d > AI.sprintSteps * (ai.skill.hearing ?? 1)) continue;
      if (ai.awareness !== 'alert') heardAt(state, c, ai, by, d, true);
      else if (by.id === ai.target) setFocus(ai, by.x, by.y, by.z);
      continue;
    }
    if (ev.type === 'glass') {
      // Glass breaking: go and look, as for a blast. An ally's isn't worth it.
      const by = entityById(state, ev.by);
      if (!by || hostile(c, by))
        heardExplosion(state, c, ai, world, ev.x, ev.y, ev.z, ev.loudness * scale, ev.by);
      continue;
    }
    if (ev.type === 'death') {
      // A squad remembers who it killed, to search the body (AI rework session 4).
      if (ev.by === c.id && ev.target !== c.id && ai.squad !== undefined) {
        const sq = squadState(state, ai.squad);
        if (sq && !sq.kills.includes(ev.target)) sq.kills.push(ev.target);
      }
      continue;
    }
    if (ev.type === 'ignite') {
      // Set alight: as good as shot, by whoever lit it.
      if (ev.target !== c.id || ev.by === 0 || ev.by === c.id) continue;
      const by = entityById(state, ev.by);
      if (by && !by.health.dead && hostile(c, by) && !by.admin?.peaceful) {
        delete ai.passive;
        alarm(ai, by, by.x, by.y, by.z);
        ai.hurt = true;
      }
      continue;
    }
    if (ev.type !== 'shot' || ev.by === c.id) continue;
    const by = entityById(state, ev.by);
    if (!by || by.health.dead) continue;
    // An ally's shots join it in the fight; a hostile's (a player's, or another
    // faction's: AI rework session 1) are heard as below, a noise to check.
    if (!hostile(c, by)) {
      if (by.ai)
        allyShot(state, c, ai, world, by, ev.fromX, ev.fromY, ev.fromZ, ev.loudness * scale);
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
    // A PMC squad fights AI it runs into or sees, but doesn't go looking for their fights
    // (2026-11-08, the user's call: squads walked into scav fights and died there); nor does
    // a boss off its ground (skill.territory).
    if (by.ai && ai.squad !== undefined) continue;
    if (by.ai && !onGround(ai, ev.fromX, ev.fromZ)) continue;
    if (d > ev.loudness * scale) continue;
    const loud = heardLoudness(world, c, ev.fromX, ev.fromY, ev.fromZ, ev.loudness * scale);
    // A squad on a route (AI rework session 4): alert within 20%, stops and advances within
    // 70%, and further out turns its route that way without stopping.
    const routed = !!squadState(state, ai.squad);
    if (d <= loud * (routed ? ROUTES.alertShot : AI.alertShot)) {
      alarm(ai, by, by.x, by.y, by.z);
    } else if (routed && d > loud * ROUTES.advanceShot) {
      if (d <= loud && ai.awareness !== 'alert') headToward(state, c, ai, by.x, by.z, nav);
    } else if (d <= loud && ai.awareness !== 'alert') {
      heardAt(
        state,
        c,
        ai,
        by,
        d,
        d <= loud * (routed ? ROUTES.advanceShot : AI.investigateShot),
        true,
      );
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
  if (!target || target.health.dead || target.admin?.peaceful || !hostile(c, target)) return;
  // An ally's fight with AI off its ground isn't a boss's (skill.territory).
  if (target.ai && !onGround(ai, x, z)) return;
  const loud = heardLoudness(world, c, x, y, z, loudness);
  if (d <= loud * AI.alertShot) alarm(ai, target, target.x, target.y, target.z);
  else if (d <= loud * AI.investigateShot)
    heardNoise(state, c, ai, ally.x, ally.y, ally.z, d, true, true);
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
  const source = entityById(state, by);
  if (ai.awareness === 'alert' || source?.admin?.peaceful) return;
  // A squad doesn't go looking for AI's fights (as for their gunfire), nor a boss off its
  // ground.
  if (source?.ai && (ai.squad !== undefined || !onGround(ai, x, z))) return;
  const d = Math.hypot(x - c.x, y - eyeHeight(c), z - c.z);
  if (d > loudness) return;
  const loud = heardLoudness(world, c, x, y, z, loudness);
  if (d <= loud) heardNoise(state, c, ai, x, y, z, d, true, true);
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
  return clearLine(world, x, y, z, c.x, eyeHeight(c), c.z, true) ? loudness : loudness * AI.muffled;
}

/** Suspicious of a noise from e, d meters away. */
function heardAt(
  state: SimState,
  c: Character,
  ai: AiState,
  e: Character,
  d: number,
  investigate: boolean,
  loud = false,
): void {
  if (e.admin?.peaceful) return;
  heardNoise(state, c, ai, e.x, e.y, e.z, d, investigate, loud);
}

/**
 * Suspicious of a noise at (x, y, z), d meters away: placed with an error that grows with
 * d. A loud one (gunfire or a blast) is checked by only a few, with care.
 */
function heardNoise(
  state: SimState,
  c: Character,
  ai: AiState,
  x: number,
  y: number,
  z: number,
  d: number,
  investigate: boolean,
  loud = false,
): void {
  const off = Math.min(AI.noiseErrorMax, d * AI.noiseError) * Math.sqrt(nextFloat(state.rng));
  const around = nextFloat(state.rng) * Math.PI * 2;
  const nx = x + Math.cos(around) * off;
  const nz = z + Math.sin(around) * off;
  // A boss leaves its ground only for what's within skill.roam of it (2026-11-08): further
  // off, it turns to look and stays.
  if (investigate && ai.skill.roam !== undefined && !onGround(ai, x, z, ai.skill.roam))
    investigate = false;
  // A squad decides as one and isn't held to the scavs' cap (AI rework session 4).
  const capped =
    loud &&
    investigate &&
    ai.awareness !== 'alert' &&
    ai.squad === undefined &&
    !ai.skill.bold &&
    !joinResponders(state, c, nx, nz);
  suspect(c, ai, nx, y, nz, investigate && !capped, loud);
  // Enough are going already: it looks, and stops checking anything else.
  if (capped) ai.investigate = false;
}

/**
 * Whether it's close enough to the loud noise it's going to check, and can see where it
 * was, to stop and watch. Checked on its perception ticks only.
 */
function canWatch(state: SimState, c: Character, ai: AiState, world: CollisionWorld): boolean {
  if ((state.tick + c.id) % AI.perceiveEvery !== 0) return false;
  if (Math.hypot(ai.focusX - c.x, ai.focusY - c.y, ai.focusZ - c.z) > AI.watchRange) return false;
  return clearLine(world, c.x, eyeHeight(c), c.z, ai.focusX, ai.focusY + AI.watchHeight, ai.focusZ);
}

/** Whether it's suspicious of something and going to check it, or about to. */
function responding(ai: AiState): boolean {
  return (
    ai.awareness === 'suspicious' &&
    ai.investigate &&
    (ai.activity === 'look' ||
      ai.activity === 'investigate' ||
      ai.activity === 'watch' ||
      ai.activity === 'creep')
  );
}

/**
 * Whether an enemy is free to be sent to gunfire by the trickle (sim/waves.ts): alive, not
 * fighting, not running from a grenade, and not already going to check something.
 */
export function freeToCheck(c: Character): boolean {
  const ai = c.ai;
  return (
    !!ai &&
    !ai.zombie &&
    !c.health.dead &&
    !ai.flee &&
    !ai.deaf &&
    !ai.passive &&
    ai.awareness !== 'alert' &&
    !(ai.awareness === 'suspicious' && ai.investigate)
  );
}

/**
 * Sends an enemy to check gunfire at (x, y, z), with care (stopping short to watch), past
 * the responder cap: the trickle to a long fight (sim/waves.ts).
 */
export function checkGunfire(c: Character, x: number, y: number, z: number): void {
  suspect(c, c.ai!, x, y, z, true, true);
}

/**
 * Whether c may go to check a loud noise at (x, z): at most AI.responders of its allies go
 * to the same one, the nearest first (another faction's don't count). A nearer enemy takes the place of the furthest one going, which
 * stays where it is and looks around.
 */
function joinResponders(state: SimState, c: Character, x: number, z: number): boolean {
  let count = 0;
  let furthest: Character | null = null;
  let furthestD = -1;
  for (const e of state.entities) {
    if (e === c || !e.ai || e.health.dead || !responding(e.ai) || hostile(c, e)) continue;
    if (Math.hypot(e.ai.focusX - x, e.ai.focusZ - z) > AI.responderRadius) continue;
    count++;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > furthestD) {
      furthestD = d;
      furthest = e;
    }
  }
  if (count < AI.responders) return true;
  if (!furthest || Math.hypot(c.x - x, c.z - z) >= furthestD) return false;
  const ai = furthest.ai!;
  ai.investigate = false;
  if (ai.activity !== 'look') {
    ai.activity = 'scan';
    ai.timer = AI.scanTime;
    ai.lookYaw = furthest.yaw;
    ai.hasGoal = false;
  }
  return true;
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

/**
 * Something's off at (x, y, z); cautious for gunfire or a blast. Never lowers an alert.
 * Already on its way to check something, it just goes to the new spot instead.
 */
function suspect(
  c: Character,
  ai: AiState,
  x: number,
  y: number,
  z: number,
  investigate: boolean,
  cautious = false,
): void {
  if (ai.awareness === 'alert') return;
  // Bold (AI-7, Jug): straight there, never stopping short to watch.
  if (ai.skill.bold) cautious = false;
  const was = ai.awareness;
  ai.awareness = 'suspicious';
  ai.loot = null;
  setFocus(ai, x, y, z);
  if (
    investigate &&
    was === 'suspicious' &&
    (ai.activity === 'investigate' || ai.activity === 'watch' || ai.activity === 'creep')
  ) {
    if (cautious && ai.activity === 'investigate') ai.cautious = true;
    return;
  }
  ai.investigate = investigate || (was === 'suspicious' && ai.investigate);
  ai.cautious = investigate ? cautious : ai.investigate && !!ai.cautious;
  ai.activity = 'look';
  ai.timer = ai.skill.bold ? JUG.boldLook : AI.lookTime;
  ai.hasGoal = false;
  ai.lookYaw = c.yaw;
}

/**
 * Already fighting, it turns on someone else it can see (a player, 2026-11-08): a new
 * target, seen now, with a fresh reaction and the squad's plan made afresh.
 */
function turnOn(ai: AiState, e: Character): void {
  ai.target = e.id;
  ai.seesTarget = true;
  ai.unseen = 0;
  ai.notice = 1;
  ai.reaction = Math.max(ai.reaction, reactionTo(ai, e));
  ai.aimError = Math.max(ai.aimError, ai.skill.aimError * DEG);
  ai.planned = false;
  ai.push = true;
  ai.burst = 0;
  setFocus(ai, e.x, e.y, e.z);
  ai.seenX = e.x;
  ai.seenY = e.y;
  ai.seenZ = e.z;
  // Out of whatever it was doing about the other one (holding, flanking, cover).
  if (ai.activity !== 'engage' && ai.activity !== 'takeCover' && ai.activity !== 'cover') {
    ai.activity = 'engage';
    ai.hasGoal = false;
  }
}

/** Knows someone is there: alert. */
function alarm(ai: AiState, target: Character, x: number, y: number, z: number): void {
  // Peaceful (an admin cheat): never noticed, even when it shoots.
  if (target.admin?.peaceful) return;
  if (ai.awareness !== 'alert') {
    ai.hasGoal = false;
    ai.activity = 'engage';
    ai.loot = null;
    ai.hunt = undefined;
    if (ai.squad !== undefined) ai.reroute = true;
    ai.reaction = reactionTo(ai, target);
    ai.aimError = ai.skill.aimError * DEG;
    ai.burst = ai.pause = 0;
    ai.exposed = 0;
    ai.exposeLimit = (AI.expose[0] + AI.expose[1]) / 2;
    ai.hurt = false;
    ai.push = true;
    ai.reachable = true;
    ai.rush = 0;
    ai.planned = false;
    // Not seen yet: closing the gap at a sprint (skill.sprints) until it is.
    ai.aggro = true;
    // Where it knows its target is, as good as seen there.
    ai.seenX = x;
    ai.seenY = y;
    ai.seenZ = z;
  }
  ai.awareness = 'alert';
  ai.target = target.id;
  ai.notice = 1;
  ai.unseen = 0;
  setFocus(ai, x, y, z);
}

/**
 * Searching for its target, or, holding its ground (skill.anchored, MT-12) with the target
 * last known off it, going back to its patrol rather than out after it.
 */
function searchOrReturn(state: SimState, c: Character, ai: AiState): void {
  if (!mayGo(ai, ai.focusX, ai.focusZ)) calmDown(c, ai);
  else startSearch(state, ai);
}

/**
 * Whether it may go after a target at (x, z): anywhere, unless it holds its ground
 * (skill.anchored), then within skill.roam of it (2026-11-11, the user's call: the
 * foreman's crew came out for noise but never pushed you just outside the mill).
 */
function mayGo(ai: AiState, x: number, z: number): boolean {
  return !ai.skill.anchored || onGround(ai, x, z, ai.skill.roam ?? 0);
}

function startSearch(state: SimState, ai: AiState): void {
  ai.awareness = 'searching';
  ai.activity = 'search';
  ai.searchLeft = AI.searchSpots;
  ai.notice = AI.glimpse;
  ai.hasGoal = false;
  // A squad on a route hunts on until it's gone 15–20 s without seeing its target.
  if (squadState(state, ai.squad))
    ai.hunt = Math.max(2, nextRange(state.rng, ROUTES.huntTime[0], ROUTES.huntTime[1]) - ai.unseen);
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
  ai.loot = null;
  ai.hunt = undefined;
  ai.rush = 0;
  if (ai.squad !== undefined && (ai.squadSlot ?? 0) > 0) {
    // A squad member keeps its place by the leader (or leads, if the leader's gone).
    ai.activity = 'follow';
    ai.legSet = false;
  } else if (ai.patrol.length > 0) {
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

// ------------------------------------------------------------------------------ behavior

function behave(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): void {
  ai.timer -= DT;
  if (ai.stagger) ai.stagger = Math.max(0, ai.stagger - DT);
  let faceYaw = c.yaw;
  let facePitch = 0;
  let turn: number = ai.awareness === 'unaware' ? AI.turnRate : AI.alertTurnRate;

  if (fleeGrenade(state, c, ai, world, items, nav)) {
    faceYaw = fleeYaw;
    turn = AI.alertTurnRate;
    ai.input.sprint = true;
  } else if (ai.toss && throwing(state, c, ai)) {
    faceYaw = tossYaw;
    facePitch = tossPitch;
    turn = AI.alertTurnRate;
  } else if (ai.rage && raging(state, c, ai, world, items, nav)) {
    faceYaw = aimYaw;
    facePitch = aimPitch;
    turn = AI.alertTurnRate;
  } else if (ai.skill.heals && treating(state, c, ai, world, items, nav)) {
    faceYaw = treatYaw;
    turn = AI.alertTurnRate;
  } else if (
    // Calm and stranded up on furniture (2026-11-08): down first, whatever it was doing,
    // since from there nothing looks reachable.
    ai.awareness !== 'alert' &&
    stepOff(state, c, ai, nav, AI.patrolPace)
  ) {
    faceYaw = moveYaw;
    ai.hasGoal = false;
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
          // A squad on a route; a boss's with his guards (MT-12) walks his patrol.
          if (ai.squad !== undefined && squadState(state, ai.squad)) {
            // Done watching a choke: on to the next stop.
            endStop(state, ai);
          } else {
            nextPatrolPoint(ai);
            ai.activity = 'patrol';
          }
        }
        break;
      case 'guard':
        // A squad's leader with a route walks it (AI rework session 4); without, it guards.
        if (ai.squad !== undefined && squadState(state, ai.squad)) {
          ai.activity = 'route';
          ai.legSet = false;
          ai.hasGoal = false;
          break;
        }
        if (Math.hypot(ai.homeX - c.x, ai.homeZ - c.z) > 1.5) {
          const r = moveTo(
            state,
            c,
            ai,
            nav,
            ai.homeX,
            ai.homeY,
            ai.homeZ,
            AI.patrolPace,
            false,
            AI.arrive,
            ROUTES.greed,
          );
          faceYaw = moveYaw;
          if (r === 'moving') break;
          // As close as it gets (a long way round that runs out of search, or a spot it
          // can't stand on): it guards here, rather than planning the same way every tick
          // (AI rework session 5: one scav on Northpoint cost 5 ms a tick doing that).
          ai.homeX = c.x;
          ai.homeY = c.y;
          ai.homeZ = c.z;
          ai.hasGoal = false;
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
        if (ai.timer <= 0 && ai.investigate && tellLeader(state, c, ai)) break;
        if (ai.timer <= 0) {
          // Off its route to check something: back on it at the nearest stop afterwards.
          if (ai.investigate && ai.squad !== undefined) ai.reroute = true;
          ai.activity = ai.investigate ? 'investigate' : 'scan';
          ai.timer = AI.calmTime;
          ai.lookYaw = faceYaw;
          ai.hasGoal = false;
        }
        break;
      case 'investigate': {
        if (ai.cautious && canWatch(state, c, ai, world)) {
          ai.activity = 'watch';
          ai.timer = AI.watchTime;
          ai.hasGoal = false;
          faceYaw = yawTo(c, ai.focusX, ai.focusZ);
          ai.input.aim = true;
          break;
        }
        const pace = ai.skill.bold ? AI.alertPace : AI.investigatePace;
        const r = moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, pace);
        faceYaw = moveYaw;
        if (r !== 'moving') {
          ai.activity = 'scan';
          ai.timer = AI.scanTime;
          ai.lookYaw = c.yaw;
        }
        break;
      }
      case 'watch': {
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        const across = Math.hypot(ai.focusX - c.x, ai.focusZ - c.z);
        facePitch = Math.atan2(ai.focusY + AI.watchHeight - eyeHeight(c), across);
        ai.input.aim = true;
        reloadIfLow(state, c, items, 1);
        if (ai.timer <= 0) {
          ai.activity = 'creep';
          ai.hasGoal = false;
        }
        break;
      }
      case 'creep': {
        const r = moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.creepPace);
        faceYaw = moveYaw;
        ai.input.aim = true;
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
        // Heard you reload or heal: pushing at you meanwhile (listenForHands).
        const rushing = (ai.rush ?? 0) > 0;
        if (rushing) ai.rush! -= DT;
        // Jug hunting whoever hit him (AI-7): along the way they went, never searching.
        const hunting = !!ai.quarry && ai.quarry === ai.target && !!ai.trail?.length;
        if (!ai.seesTarget) {
          if (!ai.reachable) {
            if (ai.unseen >= AI.intuition && startHold(state, c, ai, world, nav, target)) break;
          } else if (rushing) {
            // Straight at it: where it heard it, or a grenade Jug charges (AI-8).
          } else if (hunting) {
            followTrail(state, c, ai, world);
          } else if (
            ai.squad !== undefined &&
            !ai.planned &&
            ai.unseen >= AI.intuition &&
            takePart(state, c, ai, world, nav)
          ) {
            break;
          } else if (ai.unseen >= (ai.push ? AI.loseTrack : AI.holdAngle)) {
            searchOrReturn(state, c, ai);
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
        // Charging (AI-7, Jug) sprints after you out of sight, like a rush, unless it knows
        // you're behind cover it can put rounds into: then it walks in firing (AI-8).
        const charging = !!ai.skill.charge && !rushing;
        const pinning = charging && pinDown(state, c, ai, world, items, target);
        if (pinning) {
          faceYaw = aimYaw;
          facePitch = aimPitch;
        }
        quarryPoint(ai, target, hunting);
        // Closing the gap when first alerted without seeing it (skill.sprints, 2026-11-08).
        const aggro = !!ai.skill.sprints && !!ai.aggro;
        if (
          (rushing || charging || aggro) &&
          !pinning &&
          !ai.seesTarget &&
          !c.slide &&
          (wishX !== 0 || wishZ !== 0) &&
          Math.hypot(quarryX - c.x, quarryZ - c.z) >
            (charging ? JUG.chargeSprint : rushing ? TACTICS.rushSprint : TACTICS.sprintFrom)
        ) {
          // Sprinting round the corner, slowing to come round it aimed.
          faceYaw = moveYaw;
          facePitch = 0;
          ai.input.sprint = true;
        }
        if (ai.skill.slide && !pinning) {
          const s = slideIn(state, c, ai, world, nav);
          if (s === 'sprint') {
            faceYaw = Math.atan2(-wishX, -wishZ);
            facePitch = 0;
          } else if (c.slide && !ai.seesTarget) {
            // Coming round the corner low, facing where it's after.
            faceYaw = yawTo(c, quarryX, quarryZ);
          }
        }
        if (!ai.seesTarget) break;
        ai.exposed += DT;
        // Not hiding while you reload: that's the moment to push. Jug never hides (AI-7).
        const wantCover =
          !rushing &&
          !ai.skill.charge &&
          !(
            ai.skill.sprintToCover &&
            Math.hypot(target.x - c.x, target.z - c.z) < TACTICS.closeFight
          ) &&
          (ai.hurt || ai.exposed >= ai.exposeLimit || (w.mag === 0 && ai.exposed > 0.5));
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
        const target = entityById(state, ai.target);
        const sees =
          ai.seesTarget && !!target && !target.health.dead && !!heldWeapon(c) && !c.using;
        // A PMC turns to fight a target that has come close rather than show it its back.
        if (
          sees &&
          ai.skill.sprintToCover &&
          Math.hypot(target!.x - c.x, target!.z - c.z) < TACTICS.closeFight
        ) {
          backToFight(state, ai);
          break;
        }
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        // Topping up on the way only out of sight: a reload stops it firing.
        if (!sees) reloadIfLow(state, c, items, 1);
        // A PMC sprints there (AI rework session 5), turning to face you for the last of it;
        // seeing its target, it walks there firing instead (2026-11-08).
        const sprint =
          !!ai.skill.sprintToCover && !sees && Math.hypot(ai.coverX - c.x, ai.coverZ - c.z) > 2;
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
          !sprint,
          0.3,
        );
        if (sprint && r === 'moving') {
          faceYaw = moveYaw;
          ai.input.sprint = true;
        }
        if (sees && r === 'moving') {
          // Firing at it as it goes (fight only aims and fires: the move is moveTo's).
          const wx = wishX;
          const wz = wishZ;
          fight(state, c, ai, world, items, nav, target!, true);
          wishX = wx;
          wishZ = wz;
          faceYaw = aimYaw;
          facePitch = aimPitch;
        }
        if (r === 'failed') {
          backToFight(state, ai);
        } else if (r === 'arrived') {
          ai.activity = 'cover';
          const [min, max] = ai.skill.coverTime ?? AI.coverTime;
          ai.timer = nextRange(state.rng, min, max);
          ai.exposed = 0;
        }
        break;
      }
      case 'cover':
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        ai.input.crouch = ai.coverLow;
        reloadIfLow(state, c, items, 1);
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
      case 'suppress':
        if (ai.seesTarget) backToFight(state, ai);
        else if (pinnedFlank(state, c, ai, world, nav)) break;
        else if (ai.timer <= 0 || !heldWeapon(c)) searchOrReturn(state, c, ai);
        else if (ai.vantage) {
          // Moving to where its rounds will reach, aimed at where it lost its target.
          const v = ai.vantage;
          const r = moveTo(state, c, ai, nav, v.x, v.y, v.z, AI.alertPace, true, 0.4);
          faceYaw = yawTo(c, ai.focusX, ai.focusZ);
          facePitch = Math.atan2(
            ai.focusY + MOVEMENT.standHeight * 0.6 - eyeHeight(c),
            Math.hypot(ai.focusX - c.x, ai.focusZ - c.z),
          );
          ai.input.aim = true;
          if (r !== 'moving') {
            ai.vantage = null;
            ai.blocked = 0;
            ai.hasGoal = false;
          }
        } else {
          const lands = suppress(state, c, ai, world, items);
          faceYaw = aimYaw;
          facePitch = aimPitch;
          ai.blocked = lands ? 0 : (ai.blocked ?? 0) + DT;
          if (ai.blocked >= TACTICS.repositionAfter && coversLeft > 0) {
            coversLeft--;
            ai.blocked = 0;
            if (findVantage(state, c, ai, world, nav)) ai.hasGoal = false;
          }
        }
        break;
      case 'flank': {
        if (ai.seesTarget) {
          backToFight(state, ai);
          break;
        }
        // Right onto the spot: a little off, round a corner, it may not see.
        const off = Math.hypot(ai.coverX - c.x, ai.coverZ - c.z);
        if (off > TACTICS.flankArrive) {
          const far = off > TACTICS.sprintFrom;
          const r = moveTo(
            state,
            c,
            ai,
            nav,
            ai.coverX,
            ai.coverY,
            ai.coverZ,
            AI.alertPace,
            !far,
            TACTICS.flankArrive * 0.75,
            1,
            flankAvoid(state, ai),
          );
          if (r === 'failed' || ai.timer <= 0) {
            searchOrReturn(state, c, ai);
            break;
          }
          if (r === 'moving') {
            // Running wide, then coming up on it aimed.
            if (far) {
              faceYaw = moveYaw;
              ai.input.sprint = true;
            } else {
              faceYaw = yawTo(c, ai.focusX, ai.focusZ);
              ai.input.aim = true;
            }
            break;
          }
          // There, or as close as it gets: watches from here.
          ai.coverX = c.x;
          ai.coverY = c.y;
          ai.coverZ = c.z;
          ai.timer = TACTICS.flankWatch;
        }
        faceYaw = yawTo(c, ai.focusX, ai.focusZ);
        const across = Math.hypot(ai.focusX - c.x, ai.focusZ - c.z);
        facePitch = Math.atan2(ai.focusY + 1.2 - eyeHeight(c), across);
        ai.input.aim = true;
        reloadIfLow(state, c, items, 1);
        if (ai.timer <= 0) searchOrReturn(state, c, ai);
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
        reloadIfLow(state, c, items, 1);
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
        if (ai.hunt !== undefined && (ai.hunt -= DT) <= 0) {
          calmDown(c, ai);
          break;
        }
        const r = moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.alertPace);
        faceYaw = moveYaw;
        if (r !== 'moving') {
          ai.activity = 'searchScan';
          ai.timer = AI.searchScan;
          ai.lookYaw = c.yaw;
        }
        break;
      }
      case 'searchScan': {
        faceYaw = lookAround(ai);
        // A squad hunting goes on checking spots until its hunt runs out.
        const hunting = ai.hunt !== undefined && (ai.hunt -= DT) > 0;
        if (ai.hunt !== undefined && !hunting) {
          calmDown(c, ai);
          break;
        }
        if (ai.timer > 0) break;
        if ((!hunting && ai.searchLeft-- <= 0) || !pickSearchSpot(state, c, ai, nav)) {
          calmDown(c, ai);
        } else {
          ai.activity = 'search';
          ai.hasGoal = false;
        }
        break;
      }
      case 'follow': {
        const leader = squadLeader(state, c);
        if (!leader || leader === c) {
          leadSquad(c, ai);
          break;
        }
        // The leader searching a loot spot, or leaving: it helps, or goes too (AI-4).
        if (joinLeader(state, c, ai, leader, nav)) break;
        // Where to stand, checked on its perception ticks (a few rays).
        if (!ai.legSet || (state.tick + c.id) % AI.perceiveEvery === 0)
          followSpot(state, c, ai, world, leader);
        const d = Math.hypot(ai.legX - c.x, ai.legZ - c.z);
        if (ai.hasGoal || d > SQUAD.slack) {
          // Faster the further behind, slowing as it gets there.
          const pace = Math.min(AI.alertPace, AI.patrolPace + SQUAD.hurry * d);
          const r = moveTo(
            state,
            c,
            ai,
            nav,
            ai.legX,
            ai.legY,
            ai.legZ,
            pace,
            false,
            SQUAD.arrive,
            ROUTES.greed,
          );
          if (r === 'moving') {
            faceYaw = moveYaw;
            break;
          }
          // As close as it gets (or no way there): here will do until the leader moves on,
          // rather than planning the same way again every tick.
          ai.hasGoal = false;
          ai.legX = c.x;
          ai.legY = c.y;
          ai.legZ = c.z;
        }
        // In place: watching its own side.
        faceYaw = ai.lookYaw;
        turn = AI.turnRate / 2;
        break;
      }
      case 'route': {
        const sq = squadState(state, ai.squad);
        if (!sq) {
          ai.activity = 'guard';
          break;
        }
        faceYaw = walkRoute(state, c, ai, world, nav, sq);
        break;
      }
      case 'loot':
        faceYaw = lootStep(state, c, ai, items, nav);
        break;
      case 'extract': {
        const sq = squadState(state, ai.squad);
        if (!sq) {
          calmDown(c, ai);
          break;
        }
        if (!ai.legSet) {
          const spot = extractSpot(state, world, sq);
          ai.legX = spot?.[0] ?? sq.exX;
          ai.legY = spot?.[1] ?? sq.exY;
          ai.legZ = spot?.[2] ?? sq.exZ;
          ai.legSet = true;
          ai.hasGoal = false;
          ai.lookYaw = c.yaw;
        }
        if (ai.hasGoal || !near(c, ai.legX, ai.legY, ai.legZ)) {
          const r = moveTo(
            state,
            c,
            ai,
            nav,
            ai.legX,
            ai.legY,
            ai.legZ,
            ROUTES.pace,
            false,
            0.4,
            ROUTES.greed,
          );
          if (r === 'moving') {
            faceYaw = moveYaw;
            sprintOpen(ai);
            break;
          }
          if (!inExtraction(state, c, sq)) {
            // Got only part way: the leader walks there as on its route (round by another
            // stop if need be), the rest follow.
            if (squadLeader(state, c) === c) {
              ai.activity = 'route';
              ai.legSet = false;
            } else calmDown(c, ai);
            break;
          }
          ai.legX = c.x;
          ai.legY = c.y;
          ai.legZ = c.z;
        }
        // Standing in it (squads.ts updateSquads counts it down), watching about.
        faceYaw = lookAround(ai);
        turn = AI.turnRate / 2;
        break;
      }
    }

  // On fire: it puts itself out, which stops it fighting meanwhile (sim/fire.ts), and it
  // steps out of any fire it's standing in, straight away from it.
  const input = ai.input;
  input.extinguish = !!c.burn && !c.extinguish;
  const fire = inFire(state, c);
  if (fire) {
    const dx = c.x - fire.x;
    const dz = c.z - fire.z;
    const d = Math.hypot(dx, dz);
    const a = d > 1e-3 ? 0 : nextFloat(state.rng) * Math.PI * 2;
    wishX = d > 1e-3 ? (dx / d) * AI.alertPace : Math.cos(a) * AI.alertPace;
    wishZ = d > 1e-3 ? (dz / d) * AI.alertPace : Math.sin(a) * AI.alertPace;
    ai.hasGoal = false;
  }
  if (ai.skill.erratic && !fire) quirks(state, ai);
  // Staggered by a heavy round (AI-8): no firing, sprinting or sliding, and slowed.
  if ((ai.stagger ?? 0) > 0) {
    input.fire = input.sprint = input.slide = false;
    wishX *= JUG.staggerPace;
    wishZ *= JUG.staggerPace;
  }
  if (ai.skill.smash && ai.awareness === 'alert' && (state.tick + c.id) % AI.perceiveEvery === 0)
    smashGlass(state, c, ai, world);
  input.yaw = turnToward(c.yaw, faceYaw, turn * DT);
  input.pitch = c.pitch + Math.max(-turn * DT, Math.min(turn * DT, facePitch - c.pitch));
  // The stick is relative to where it faces; moveTo left a world direction in wishX, Z.
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  input.moveX = cy * wishX - sy * wishZ;
  input.moveY = -(sy * wishX + cy * wishZ);
  wishX = wishZ = 0;
}

/**
 * An erratic enemy's quirks (AI rework session 2, scavs; design.md → AI → Scavs): now and
 * then, while walking about, it stops dead, crouch-walks or breaks into a short sprint;
 * while fighting it drops into a crouch. Changes this tick's wish and stance only, so
 * whatever it was doing carries on afterwards.
 */
function quirks(state: SimState, ai: AiState): void {
  const a = ai.activity;
  const fighting = a === 'engage';
  const walking = a === 'patrol' || a === 'investigate' || a === 'search' || a === 'loiter';
  if (ai.flee || (!walking && !fighting)) {
    ai.quirk = null;
    return;
  }
  const moving = wishX !== 0 || wishZ !== 0;
  const every = AI.quirkEvery / ai.skill.erratic!;
  if (ai.quirk) {
    ai.quirkTime = (ai.quirkTime ?? 0) - DT;
    // Fighting crouches only; a walking quirk ends when the walk does.
    if (ai.quirkTime <= 0 || (fighting && ai.quirk !== 'crouch') || (!fighting && !moving))
      ai.quirk = null;
  }
  if (!ai.quirk) {
    ai.quirkNext = (ai.quirkNext ?? every * nextRange(state.rng, 0.5, 1.5)) - DT;
    if (ai.quirkNext > 0 || (!moving && !fighting)) return;
    ai.quirkNext = every * nextRange(state.rng, 0.5, 1.5);
    const r = fighting ? 0.5 : nextFloat(state.rng);
    const [quirk, range] =
      r < 0.35
        ? (['stop', AI.quirkStop] as const)
        : r < 0.7
          ? (['crouch', AI.quirkCrouch] as const)
          : (['sprint', AI.quirkSprint] as const);
    ai.quirk = quirk;
    ai.quirkTime = nextRange(state.rng, range[0], range[1]);
  }
  if (ai.quirk === 'stop') {
    wishX = wishZ = 0;
    // Standing still on purpose isn't being stuck.
    ai.stuck = 0;
  } else if (ai.quirk === 'crouch') {
    ai.input.crouch = true;
  } else if (moving) {
    const d = Math.hypot(wishX, wishZ);
    wishX /= d;
    wishZ /= d;
    ai.input.sprint = true;
  }
}

// --------------------------------------------------------------------------- healing

// Where treating wants it to face.
let treatYaw = 0;

/**
 * Treating itself (skill.heals; design.md → AI → PMCs → Healing): keeps still, crouched,
 * while a med is in use, facing where its target was. Starts one on its perception ticks
 * when it needs one and carries it: calm, at once; fighting, only once its target has been
 * out of sight HEAL.unseen, first going to cover nearby (AI.coverRadius) if there is any,
 * else where it stands. Never while it sees its target: it fights, and firing stops the
 * med. Returns whether it's about it (what it was doing waits).
 */
function treating(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): boolean {
  const alert = ai.awareness === 'alert';
  if (alert && ai.seesTarget) return false;
  treatYaw = alert ? yawTo(c, ai.focusX, ai.focusZ) : c.yaw;
  if (c.using) {
    ai.input.crouch = true;
    ai.stuck = 0;
    return true;
  }
  if ((state.tick + c.id) % AI.perceiveEvery !== 0) return false;
  if (c.draw > 0 || c.extinguish || c.mode !== 'ground' || ai.flee) return false;
  if ((heldWeapon(c)?.reloading ?? 0) > 0) return false;
  if (alert && ai.unseen < HEAL.unseen) return false;
  const med = pickMed(c, items);
  if (!med) {
    ai.healCover = false;
    return false;
  }
  if (alert) {
    // On its way to cover: it treats itself there.
    if (ai.activity === 'takeCover') return false;
    // Jug never takes cover (skill.charge), to treat himself either: he does it where he is.
    if (!ai.healCover && ai.activity !== 'cover' && !ai.skill.charge) {
      ai.healCover = true;
      if (coversLeft > 0) {
        coversLeft--;
        const eye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
        if (
          findCover(
            state,
            c,
            ai,
            world,
            nav,
            c.x,
            c.y,
            c.z,
            ai.focusX,
            ai.focusY + eye,
            ai.focusZ,
            false,
            HEAL.coverSamples,
          )
        ) {
          ai.activity = 'takeCover';
          ai.hasGoal = false;
          ai.peekX = c.x;
          ai.peekY = c.y;
          ai.peekZ = c.z;
          return false;
        }
      }
    }
  }
  ai.input.use = med;
  ai.input.crouch = true;
  ai.hasGoal = false;
  return true;
}

/**
 * The med to use now, if it carries one in reach (pockets, then rig): a bandage while
 * bleeding, a splint for a broken limb, a medkit when below HEAL's shares. Never a surgery
 * kit. Null when nothing it carries is called for.
 */
function pickMed(c: Character, items: ItemDb): MedRef | null {
  const h = c.health;
  let bleeding = false;
  let broken = false;
  let low = totalHp(h) < TOTAL_HP * HEAL.hpShare;
  for (let z = 0; z < h.hp.length; z++) {
    if (h.bleeding[z]) bleeding = true;
    if (isLimb(z as Zone) && h.hp[z]! <= 0 && !h.splinted[z]) broken = true;
    if (h.hp[z]! > 0 && h.hp[z]! < HEALTH.maxHp[z]! * HEAL.zoneShare) low = true;
  }
  // A medkit only mends a zone with HP left (a broken limb is down to 0).
  if (low && zoneToTreat(h, 'heal') < 0) low = false;
  if (!bleeding && !broken && !low) return null;
  for (const effect of MED_ORDER) {
    if (effect === 'bandage' ? !bleeding : effect === 'splint' ? !broken : !low) continue;
    for (let g = 0; g < QUICK_GRIDS; g++) {
      const list = carriedGrid(c.gear, g)?.items;
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const def = items.get(list[i]!.item.item);
        if (def?.type === 'med' && def.effect === effect)
          return { grid: g, index: i, item: def.id };
      }
    }
  }
  return null;
}

/** What an AI treats, in order: no surgery kits (2026-11-08, the user's call). */
const MED_ORDER = ['bandage', 'splint', 'heal'] as const;

// -------------------------------------------------------------------------------- Jug

/** Starts hunting whoever hit it (AI-7, skill.relentless), from where they are now. */
function startHunt(ai: AiState, by: Character): void {
  ai.quarry = by.id;
  if (ai.trail) ai.trail.length = 0;
  else ai.trail = [];
  ai.trail.push(by.x, by.y, by.z);
}

/**
 * The hunt, on perception ticks (AI-7; design.md → AI → Jug): keeps the way its quarry goes
 * (starting afresh from where it is whenever it sees it), and is alert to it again whenever
 * it isn't fighting anyone else. Over once the quarry is dead, gone or peaceful.
 */
function track(state: SimState, c: Character, ai: AiState): void {
  const q = entityById(state, ai.quarry!);
  const t = (ai.trail ??= []);
  if (!q || q.health.dead || q.admin?.peaceful) {
    ai.quarry = 0;
    t.length = 0;
    return;
  }
  const n = t.length;
  if (ai.target === q.id && ai.seesTarget) {
    t.length = 0;
    t.push(q.x, q.y, q.z);
  } else if (
    q.mode === 'ground' &&
    (n === 0 ||
      Math.hypot(q.x - t[n - 3]!, q.z - t[n - 1]!) >= JUG.trailStep ||
      Math.abs(q.y - t[n - 2]!) > MOVEMENT.stepUp)
  ) {
    // The oldest dropped when it's full (shifted down in place: no allocation).
    if (n >= JUG.trailMax * 3) {
      t.copyWithin(0, 3);
      t.length -= 3;
    }
    t.push(q.x, q.y, q.z);
  }
  if (ai.awareness !== 'alert') alarm(ai, q, t[0]!, t[1]!, t[2]!);
}

/**
 * Out of sight of its quarry: on along the trail, dropping the points it has reached and
 * any older than one it can see (the newest stays, where to look once there), always
 * pushing.
 */
function followTrail(state: SimState, c: Character, ai: AiState, world: CollisionWorld): void {
  const t = ai.trail!;
  let drop = 0;
  if ((state.tick + c.id) % AI.perceiveEvery === 0) {
    const eye = eyeHeight(c);
    for (let i = t.length - 3, looks = 0; i > 0 && looks < JUG.trailLooks; i -= 3) {
      if (Math.hypot(t[i]! - c.x, t[i + 2]! - c.z) > JUG.trailSee) continue;
      looks++;
      if (clearLine(world, c.x, eye, c.z, t[i]!, t[i + 1]! + 1, t[i + 2]!)) {
        drop = i;
        break;
      }
    }
  }
  while (
    drop + 3 < t.length &&
    Math.hypot(t[drop]! - c.x, t[drop + 2]! - c.z) < JUG.trailReach &&
    Math.abs(t[drop + 1]! - c.y) < 1.5
  )
    drop += 3;
  if (drop > 0) {
    t.copyWithin(0, drop);
    t.length -= drop;
  }
  setFocus(ai, t[0]!, t[1]!, t[2]!);
  ai.push = true;
}

// Where quarryPoint found it after: its target seen, the newest of the trail, or the focus.
let quarryX = 0;
let quarryZ = 0;

/** Where it's after, in quarryX, quarryZ: what it sees, the hunt's newest point, or where it was. */
function quarryPoint(ai: AiState, target: Character, hunting: boolean): void {
  const t = ai.trail;
  if (ai.seesTarget) {
    quarryX = target.x;
    quarryZ = target.z;
  } else if (hunting && t && t.length >= 3) {
    quarryX = t[t.length - 3]!;
    quarryZ = t[t.length - 1]!;
  } else {
    quarryX = ai.focusX;
    quarryZ = ai.focusZ;
  }
}

/**
 * Jug's sprint-slide (AI-7; design.md → AI → Jug), after fight() has decided where it goes
 * (wishX, wishZ) and quarryPoint where it's after: going at it from JUG.slideRange away,
 * with clear floor on its own level ahead, it sprints for a tick, then slides (firing still,
 * as fight() decides). 'sprint' while it's getting up speed, 'slide' as it starts one.
 */
function slideIn(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): 'none' | 'sprint' | 'slide' {
  if (c.slide || c.mode !== 'ground' || state.tick < (ai.nextSlide ?? 0)) return 'none';
  const wish = Math.hypot(wishX, wishZ);
  if (wish < 0.5) return 'none';
  const qx = quarryX - c.x;
  const qz = quarryZ - c.z;
  const d = Math.hypot(qx, qz);
  if (d < JUG.slideRange[0] || d > JUG.slideRange[1]) return 'none';
  const dx = wishX / wish;
  const dz = wishZ / wish;
  // Headed at it, give or take a corner: within 50°.
  if ((dx * qx + dz * qz) / d < 0.64) return 'none';
  // Nothing in the way at the knees or chest, glass included, and floor at its own height
  // where it ends.
  const reach = JUG.slideClear;
  if (
    world.raycast(c.x, c.y + 0.5, c.z, dx, 0, dz, reach) !== Infinity ||
    world.raycast(c.x, c.y + 1, c.z, dx, 0, dz, reach) !== Infinity
  )
    return 'none';
  const ex = c.x + dx * reach;
  const ez = c.z + dz * reach;
  const n = nav.nearest(ex, c.y, ez);
  if (
    n < 0 ||
    Math.abs(nav.nodeY(n) - c.y) > MOVEMENT.stepUp ||
    Math.hypot(nav.nodeX(n) - ex, nav.nodeZ(n) - ez) > nav.cellSize
  )
    return 'none';
  if (Math.hypot(c.vx, c.vz) >= MOVEMENT.slideFrom) {
    ai.input.slide = true;
    ai.nextSlide = state.tick + Math.round(JUG.slideGap / DT);
    return 'slide';
  }
  // Up to a sprint first (sprinting is no firing nor aiming).
  ai.input.sprint = true;
  ai.input.fire = ai.input.aim = false;
  wishX = dx;
  wishZ = dz;
  return 'sprint';
}

/**
 * Suppression (AI-8; design.md → AI → Jug): its target out of sight behind cover it knows
 * it's still behind (within pinSlack of where it last saw it, not long ago), with its
 * rounds landing there: it holds the trigger down at that spot, every round of the drum,
 * while fight() walks it in. Leaves where to look in aimYaw, aimPitch. Returns whether it is.
 */
function pinDown(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  target: Character,
): boolean {
  if (ai.seesTarget || ai.seenX === undefined || ai.unseen > JUG.pinFresh) return false;
  const x = ai.seenX;
  const y = ai.seenY!;
  const z = ai.seenZ!;
  if (Math.hypot(target.x - x, target.z - z) > JUG.pinSlack || Math.abs(target.y - y) > 1.5)
    return false;
  const across = Math.hypot(x - c.x, z - c.z);
  const w = heldWeapon(c);
  if (!w || across < JUG.chargeClose || across > weaponDef(items, w.item).range) return false;
  const ty = y + MOVEMENT.standHeight * 0.6;
  if (!landsNear(world, c, x, ty, z)) return false;
  aimAt(state, c, ai, x, ty, z);
  ai.input.fire =
    w.mag > 0 &&
    w.reloading === 0 &&
    Math.abs(angleDiff(c.yaw, aimYaw)) < AI.fireCone * DEG &&
    clearOfAllies(state, c, target, x, ty, z);
  return true;
}

/** A hit of `hit` (after armor took its share) to a zone: staggered by a heavy round (AI-8). */
function staggered(ai: AiState, zone: number, hit: number): void {
  const k = HEALTH.multiplier[zone] ?? 1;
  if (hit / k < JUG.staggerRound) return;
  ai.aimError += JUG.staggerAim * DEG;
  ai.stagger = JUG.staggerTime;
  ai.burst = 0;
}

/**
 * Hurt by `by`, whom it can't see (AI-8; design.md → AI → Jug → Enraged): enough of that
 * in a short while and it's enraged at them.
 */
function hurtUnseen(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  by: Character,
  amount: number,
): void {
  if (state.tick < (ai.nextRage ?? 0) || sightRate(state, c, ai, by, world) > 0) return;
  if (ai.rageSince === undefined || state.tick - ai.rageSince > JUG.rageWindow / DT) {
    ai.rageSince = state.tick;
    ai.rageHurt = 0;
  }
  ai.rageHurt = (ai.rageHurt ?? 0) + amount;
  if (ai.rageHurt < JUG.rageDamage) return;
  ai.rage = { by: by.id, x: by.x, y: by.y, z: by.z, time: 0 };
  ai.rageHurt = 0;
  ai.nextRage = state.tick + Math.round(JUG.rageGap / DT);
  ai.toss = null;
  ai.hasGoal = false;
  // Firing blind: as far off as when it first sees someone.
  ai.aimError = Math.max(ai.aimError, ai.skill.aimError * DEG);
}

/**
 * One tick of being enraged: a smoke dropped at its feet first, then firing blind down the
 * line the hits came from, then a sprint at where they came from, through the smoke. Over
 * once it sees whoever hurt it (it fights them as usual), they're dead, or it gets there.
 * Leaves where to look in aimYaw, aimPitch. Returns whether it's still enraged.
 */
function raging(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): boolean {
  const r = ai.rage!;
  const by = entityById(state, r.by);
  if (by && !by.health.dead && !(ai.seesTarget && ai.target === r.by)) {
    if (r.time === 0) dropGrenade(state, c, world, items, 'smoke');
    r.time += DT;
    if (r.time <= JUG.rageFire) {
      const ty = r.y + MOVEMENT.standHeight * 0.6;
      aimAt(state, c, ai, r.x, ty, r.z);
      const w = heldWeapon(c);
      if (w) {
        reloadIfLow(state, c, items, 0);
        ai.input.fire =
          w.mag > 0 &&
          w.reloading === 0 &&
          Math.abs(angleDiff(c.yaw, aimYaw)) < AI.fireCone * DEG &&
          clearOfAllies(state, c, by, r.x, ty, r.z);
      }
      return true;
    }
    if (
      r.time <= JUG.rageFire + JUG.rageCharge &&
      moveTo(state, c, ai, nav, r.x, r.y, r.z, AI.alertPace) === 'moving'
    ) {
      ai.input.sprint = true;
      aimYaw = moveYaw;
      aimPitch = 0;
      return true;
    }
  }
  // Over: back to fighting, pushing on from there.
  ai.rage = null;
  if (ai.awareness === 'alert') {
    setFocus(ai, r.x, r.y, r.z);
    ai.push = true;
    ai.activity = 'engage';
  }
  ai.hasGoal = false;
  return false;
}

// Scratch for what smashGlass's rays hit.
const smashHit = createRayHit();

/**
 * Smashing glass (AI-8; design.md → AI → Jug): a whole pane within smashReach the way it's
 * going, or towards where it's after, at the knees or the chest, it breaks.
 */
function smashGlass(state: SimState, c: Character, ai: AiState, world: CollisionWorld): void {
  const wish = Math.hypot(wishX, wishZ);
  if (wish > 0.1) smashAlong(state, c, world, wishX / wish, wishZ / wish);
  const dx = ai.focusX - c.x;
  const dz = ai.focusZ - c.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.1) smashAlong(state, c, world, dx / d, dz / d);
}

function smashAlong(
  state: SimState,
  c: Character,
  world: CollisionWorld,
  dx: number,
  dz: number,
): void {
  for (const h of SMASH_HEIGHTS) {
    if (world.raycast(c.x, c.y + h, c.z, dx, 0, dz, JUG.smashReach, smashHit) === Infinity)
      continue;
    const pane = glassHit(world, smashHit);
    if (pane >= 0) breakGlass(state, world, pane, c.id);
  }
}

/** Knee and chest height: a railing's glass, and a window over a sill. */
const SMASH_HEIGHTS = [0.6, 1.4] as const;

/**
 * Grenades make Jug charge, not run (AI-8; design.md → AI → Jug), on its perception ticks:
 * a hostile's grenade it can see within baitRange, while it can't see its target, and it
 * sprints at where the grenade is (not at who threw it), alert to the thrower. Meanwhile
 * it keeps after the grenade as it bounces and rolls.
 */
function chargeGrenade(state: SimState, c: Character, ai: AiState, world: CollisionWorld): void {
  if (ai.awareness === 'alert' && ai.seesTarget) return;
  const eye = eyeHeight(c);
  for (const g of state.grenades) {
    if (g.id <= (ai.bait ?? 0) || g.remote) continue;
    const by = entityById(state, g.by);
    if (!by || by.health.dead || by.admin?.peaceful || !hostile(c, by)) continue;
    if (Math.hypot(g.x - c.x, g.y - c.y, g.z - c.z) > JUG.baitRange) continue;
    if (!clearLine(world, c.x, eye, c.z, g.x, g.y + 0.1, g.z)) continue;
    ai.bait = g.id;
    alarm(ai, by, g.x, g.y, g.z);
    // It knows of the grenade, not where the thrower is.
    ai.unseen = Math.max(ai.unseen, AI.intuition);
    ai.push = true;
    ai.rush = JUG.baitTime;
    ai.toss = null;
    if (ai.activity !== 'engage') {
      ai.activity = 'engage';
      ai.hasGoal = false;
    }
    return;
  }
  if ((ai.rush ?? 0) <= 0 || !ai.bait) return;
  for (const g of state.grenades) if (g.id === ai.bait) setFocus(ai, g.x, g.y, g.z);
}

// ----------------------------------------------------------------------------- squads

/**
 * PMC squads (AI rework session 3; design.md → AI → PMCs). Distances in meters, angles in
 * degrees; first guesses to tune in play.
 */
export const SQUAD = {
  /**
   * Each follower's place behind its leader, by its rank among the living followers:
   * meters back, meters to the side, and which way it watches from the leader's heading.
   * Ranks past the list stand further back in the middle.
   */
  formation: [
    [3, 2.5, 60],
    [3, -2.5, -60],
    [6, 0, 180],
  ] as const,
  /** A follower walks back to its place once this far off it... */
  slack: 2,
  /** ...and stops this close. */
  arrive: 1,
  /** Its pace is AI.patrolPace plus this for every meter it is off its place (up to AI.alertPace). */
  hurry: 0.1,
  /** Its place is worked out from where the leader will be this many seconds on. */
  lead: 0.6,
  /** The leader's way turning by more than this many degrees swaps the squad's sides. */
  reverse: 120,
  /** With no clear place in formation, it keeps this close to the leader. */
  close: 2.5,
  /** A place is no good more than this above or below the leader's feet. */
  rise: 0.6,
};

/** Puts an enemy in a squad at a place (0 leads); followers start following. */
export function joinSquad(c: Character, squad: number, slot: number): void {
  const ai = c.ai!;
  ai.squad = squad;
  ai.squadSlot = slot;
  calmDown(c, ai, false);
}

/** Its squad's leader: the living member in the lowest place. Null if it has no squad. */
export function squadLeader(state: SimState, c: Character): Character | null {
  const squad = c.ai?.squad;
  if (squad === undefined) return null;
  let best: Character | null = null;
  for (const e of state.entities) {
    if (!e.ai || e.ai.squad !== squad || e.health.dead) continue;
    if (!best || (e.ai.squadSlot ?? 0) < (best.ai!.squadSlot ?? 0)) best = e;
  }
  return best;
}

/** Its leader's gone and it's next: it leads from where it stands. */
function leadSquad(c: Character, ai: AiState): void {
  ai.squadSlot = 0;
  ai.homeX = c.x;
  ai.homeY = c.y;
  ai.homeZ = c.z;
  ai.homeYaw = c.yaw;
  calmDown(c, ai, false);
}

/** Its rank among the living followers, from 1. */
function followRank(state: SimState, c: Character, ai: AiState): number {
  const slot = ai.squadSlot ?? 0;
  let rank = 0;
  for (const e of state.entities)
    if (
      e !== c &&
      e.ai &&
      e.ai.squad === ai.squad &&
      !e.health.dead &&
      (e.ai.squadSlot ?? 0) < slot
    )
      rank++;
  return rank;
}

/**
 * Where a follower stands: its place in formation behind the leader (by the way the
 * leader walks, or faces while it stands), else straight behind it, else close by on its
 * own side. Kept while the leader stands still, so a guarding leader looking about
 * doesn't shuffle its squad. Sets leg* and the way it watches (lookYaw).
 */
function followSpot(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  leader: Character,
): void {
  const moving = Math.hypot(leader.vx, leader.vz) > 0.5;
  if (ai.legSet && !moving) return;
  const heading = moving
    ? Math.atan2(-leader.vx, -leader.vz)
    : leader.ai?.activity === 'guard'
      ? leader.ai.homeYaw
      : leader.yaw;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  // The leader turning back on itself: the squad keeps to its sides of the way rather
  // than crossing over (each follower's sides swap, so it stays where it is).
  if (
    ai.followYaw !== undefined &&
    Math.abs(angleDiff(heading, ai.followYaw)) > SQUAD.reverse * DEG
  )
    ai.followSide = -(ai.followSide ?? 1);
  ai.followYaw = heading;
  const flip = ai.followSide ?? 1;
  const rank = followRank(state, c, ai);
  const n = SQUAD.formation.length;
  const [back0, side0, watch] = SQUAD.formation[Math.min(rank, n) - 1] ?? SQUAD.formation[0];
  const back = back0 + 3 * Math.max(0, rank - n);
  const side = side0 * flip;
  ai.legSet = true;
  ai.lookYaw = heading + watch * flip * DEG;
  // Where the leader is about to be, so it keeps up rather than trailing.
  const lx = leader.x + leader.vx * SQUAD.lead;
  const lz = leader.z + leader.vz * SQUAD.lead;
  // Side is fz, −fx: to the right of the heading.
  if (
    standable(world, leader, lx - fx * back + fz * side, lz - fz * back - fx * side) ||
    standable(world, leader, lx - fx * back, lz - fz * back)
  ) {
    ai.legX = standX;
    ai.legY = standY;
    ai.legZ = standZ;
    return;
  }
  const dx = c.x - leader.x;
  const dz = c.z - leader.z;
  const d = Math.hypot(dx, dz);
  const k = d > SQUAD.close ? SQUAD.close / d : 1;
  ai.legX = leader.x + dx * k;
  ai.legY = leader.y;
  ai.legZ = leader.z + dz * k;
}

/**
 * Whether a follower can stand at (x, z) near the leader's height, in the clear and in a
 * straight line from it (not through a wall). Leaves the spot in standX, Y, Z if so.
 */
function standable(world: CollisionWorld, leader: Character, x: number, z: number): boolean {
  const ground = world.groundAt(x, z, MOVEMENT.radius, leader.y + 0.5);
  if (Math.abs(ground - leader.y) > SQUAD.rise) return false;
  if (
    world.overlaps(x, z, MOVEMENT.radius, ground + MOVEMENT.stepUp, ground + MOVEMENT.standHeight)
  )
    return false;
  if (!clearLine(world, leader.x, leader.y + 1, leader.z, x, ground + 1, z)) return false;
  // Not off a ledge onto lower ground on the way.
  if (
    Math.abs(
      world.groundAt((x + leader.x) / 2, (z + leader.z) / 2, MOVEMENT.radius, leader.y + 0.5) -
        leader.y,
    ) > SQUAD.rise
  )
    return false;
  standX = x;
  standY = ground;
  standZ = z;
  return true;
}
let standX = 0;
let standY = 0;
let standZ = 0;

/**
 * A follower wanting to check a noise tells its leader instead, who goes (unless it's
 * fighting or already checking something), and goes back to its place: the squad moves
 * as one. False if it leads or has no squad.
 */
function tellLeader(state: SimState, c: Character, ai: AiState): boolean {
  const leader = squadLeader(state, c);
  if (!leader || leader === c) return false;
  const l = leader.ai!;
  if (l.awareness !== 'alert' && !responding(l))
    suspect(leader, l, ai.focusX, ai.focusY, ai.focusZ, true, !!ai.cautious);
  calmDown(c, ai);
  return true;
}

/**
 * The whole squad knows where its target is at once (design.md → AI → PMCs → Seeing you):
 * while a member sees whoever it's fighting (or has just lost them), the rest are alert to
 * them too, and those already fighting them out of sight know where they are.
 */
function shareTarget(state: SimState, c: Character, ai: AiState): void {
  if (ai.awareness !== 'alert' || (!ai.seesTarget && ai.unseen >= AI.intuition)) return;
  const target = entityById(state, ai.target);
  if (!target || target.health.dead || target.admin?.peaceful) return;
  for (const e of state.entities) {
    const m = e.ai;
    if (!m || e === c || m.squad !== ai.squad || e.health.dead) continue;
    if (m.awareness !== 'alert') alarm(m, target, target.x, target.y, target.z);
    else if (m.target === ai.target && !m.seesTarget) setFocus(m, target.x, target.y, target.z);
  }
}

// The squad members fighting a target, by place (takePart).
const fighters: Character[] = [];
const bySlot = (a: Character, b: Character): number =>
  (a.ai!.squadSlot ?? 0) - (b.ai!.squadSlot ?? 0);

/**
 * Its target gone from the whole squad's sight (design.md → AI → PMCs → Fighting), each
 * member fighting it takes a part: the last half by place (rounded down) flank to a spot
 * that sees where it was from the side, the rest hold where they are and fire at its
 * cover. Alone, or with a mate still seeing it, it fights on as anyone would. A flanker
 * with no flanking spot pushes in as anyone would. Returns whether it took a part; false
 * too when it has to wait a tick for a cover search.
 */
function takePart(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): boolean {
  fighters.length = 0;
  for (const e of state.entities) {
    const m = e.ai;
    if (!m || m.squad !== ai.squad || e.health.dead) continue;
    if (m.awareness !== 'alert' || m.target !== ai.target) continue;
    // A mate can still see it: it fights on, told where it is (shareTarget).
    if (m.seesTarget) return false;
    fighters.push(e);
  }
  if (fighters.length < 2) {
    ai.planned = true;
    return false;
  }
  fighters.sort(bySlot);
  // Flanking only once its target is pinned (skill.pinFlank): all hold for now.
  const holders = ai.skill.pinFlank
    ? fighters.length
    : fighters.length - Math.floor(fighters.length / 2);
  const rank = fighters.indexOf(c);
  if (rank < holders) {
    ai.planned = true;
    ai.activity = 'suppress';
    ai.timer = nextRange(state.rng, TACTICS.suppressTime[0], TACTICS.suppressTime[1]);
    ai.burst = ai.pause = 0;
    ai.blocked = 0;
    ai.vantage = null;
    ai.hasGoal = false;
    ai.pinTry = 0;
    return true;
  }
  if (coversLeft <= 0) return false;
  coversLeft--;
  ai.planned = true;
  // Off the line from the holders (their middle) to where it was.
  let hx = 0;
  let hz = 0;
  for (let i = 0; i < holders; i++) {
    hx += fighters[i]!.x / holders;
    hz += fighters[i]!.z / holders;
  }
  if (!findFlank(state, c, ai, world, nav, hx, hz)) return false;
  ai.activity = 'flank';
  ai.timer = TACTICS.flankTime;
  ai.hasGoal = false;
  return true;
}

/**
 * A squad that flanks only when its target is pinned (skill.pinFlank, MT-12: the foreman's
 * crew holds their ground). Holding (suppress), a member other than the leader whose
 * target has been out of its sight pinFlank.after seconds within pinFlank.within meters of
 * where it was last known (its focus), with no mate flanking already, goes to a flanking
 * spot off the line from the others. Having found none it looks again a second later.
 * Returns whether it set off.
 */
function pinnedFlank(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): boolean {
  const pin = ai.skill.pinFlank;
  if (!pin || ai.squad === undefined || (ai.squadSlot ?? 0) === 0) return false;
  if ((ai.pinTry ?? 0) > 0) {
    ai.pinTry! -= DT;
    return false;
  }
  if (ai.unseen < pin.after || coversLeft <= 0) return false;
  const target = entityById(state, ai.target);
  if (!target || target.health.dead) return false;
  if (Math.hypot(target.x - ai.focusX, target.z - ai.focusZ) > pin.within) return false;
  let hx = 0;
  let hz = 0;
  let n = 0;
  for (const e of state.entities) {
    const m = e.ai;
    if (!m || e === c || m.squad !== ai.squad || e.health.dead) continue;
    if (m.activity === 'flank') return false;
    if (m.awareness !== 'alert' || m.target !== ai.target) continue;
    hx += e.x;
    hz += e.z;
    n++;
  }
  if (n === 0) return false;
  coversLeft--;
  if (!findFlank(state, c, ai, world, nav, hx / n, hz / n)) {
    ai.pinTry = 1;
    return false;
  }
  ai.activity = 'flank';
  ai.timer = TACTICS.flankTime;
  ai.hasGoal = false;
  return true;
}

/**
 * A spot c can walk to that sees where its target was (its focus) standing, from it and
 * flankMargin either side, flankRange from it, at least flankAngle off the line from (hx,
 * hz) to it, and not another's cover: the nearest of flankSamples tried, into coverX, Y,
 * Z. At most three rays per spot tried, and none for one further than the best so far.
 */
function findFlank(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
  hx: number,
  hz: number,
): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  if (here < 0) return false;
  const fx = ai.focusX;
  const fz = ai.focusZ;
  const fy = ai.focusY + 1.2;
  const from =
    Math.hypot(hx - fx, hz - fz) > 1
      ? Math.atan2(hz - fz, hx - fx)
      : Math.atan2(c.z - fz, c.x - fx);
  const minCos = Math.cos(TACTICS.flankAngle * DEG);
  const eye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  let best = Infinity;
  for (let i = 0; i < TACTICS.flankSamples; i++) {
    // 45°–135° to one side or the other of the holders' line.
    const off = nextRange(state.rng, TACTICS.flankAngle, 180 - TACTICS.flankAngle) * DEG;
    const a = from + (chance(state.rng, 0.5) ? off : -off);
    const r = nextRange(state.rng, TACTICS.flankRange[0], TACTICS.flankRange[1]);
    const n = nav.nearest(fx + Math.cos(a) * r, ai.focusY, fz + Math.sin(a) * r);
    if (n < 0 || nav.component[n] !== nav.component[here]) continue;
    const x = nav.nodeX(n);
    const y = nav.nodeY(n);
    const z = nav.nodeZ(n);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= best || d < 2 || taken(state, c, x, z)) continue;
    // Still far enough round once on the nav grid.
    const sx = x - fx;
    const sz = z - fz;
    const sd = Math.hypot(sx, sz);
    if (sd < TACTICS.flankRange[0] * 0.8) continue;
    if ((sx * Math.cos(from) + sz * Math.sin(from)) / sd > minCos) continue;
    // Seeing it from a little either side too, not just past a corner's edge.
    const mx = (-sz / sd) * TACTICS.flankMargin;
    const mz = (sx / sd) * TACTICS.flankMargin;
    if (
      !clearLine(world, x, y + eye, z, fx, fy, fz) ||
      !clearLine(world, x + mx, y + eye, z + mz, fx, fy, fz) ||
      !clearLine(world, x - mx, y + eye, z - mz, fx, fy, fz)
    )
      continue;
    best = d;
    ai.coverX = x;
    ai.coverY = y;
    ai.coverZ = z;
  }
  return best < Infinity;
}

/**
 * One tick of holding and firing at where its target went out of sight (its focus, kept
 * up to date by mates who see it): aimed, in short bursts with pauses, and only while its
 * rounds would land on the cover there rather than on a wall in front of it.
 */
function suppress(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
): boolean {
  const w = heldWeapon(c)!;
  const def = weaponDef(items, w.item);
  const tx = ai.focusX;
  const ty = ai.focusY + MOVEMENT.standHeight * 0.6;
  const tz = ai.focusZ;
  const across = Math.hypot(tx - c.x, tz - c.z);
  const settled = ai.skill.aimSettled * DEG;
  ai.aimError = settled + (ai.aimError - settled) * Math.exp(-DT / ai.skill.aimSettle);
  aimAt(state, c, ai, tx, ty, tz);
  ai.input.aim = across > AI.aimDownRange;
  reloadIfLow(state, c, items, 0.3);
  const ready =
    w.mag > 0 &&
    w.reloading === 0 &&
    across <= def.range &&
    Math.abs(angleDiff(c.yaw, aimYaw)) < AI.fireCone * DEG;
  const lands = landsNear(world, c, tx, ty, tz);
  if (ai.burst <= 0 && ai.pause <= 0 && ready && lands) {
    const rounds = Math.round(
      nextRange(state.rng, TACTICS.suppressBurst[0], TACTICS.suppressBurst[1]),
    );
    ai.burst = def.fireMode === 'semi' ? DT / 2 : ((rounds - 0.5) * 60) / def.rpm;
  }
  if (ai.burst > 0) {
    const target = entityById(state, ai.target);
    ai.input.fire = ready && (!target || clearOfAllies(state, c, target, tx, ty, tz));
    ai.burst -= DT;
    if (ai.burst <= 0)
      ai.pause = nextRange(state.rng, TACTICS.suppressPause[0], TACTICS.suppressPause[1]);
  } else {
    ai.pause -= DT;
  }
  return lands;
}

/**
 * A holder's better spot (2026-11-08): one c can walk to within vantageRadius, not too near
 * where it lost its target nor another's spot, from which a shot at that spot gets within
 * coverSlack of it, standing. The nearest of vantageSamples tried, into ai.vantage. One ray
 * per spot tried.
 */
function findVantage(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  if (here < 0) return false;
  const eye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  const ty = ai.focusY + MOVEMENT.standHeight * 0.6;
  let best = Infinity;
  for (let i = 0; i < TACTICS.vantageSamples; i++) {
    const r = nextRange(state.rng, 1.5, TACTICS.vantageRadius);
    const a = nextFloat(state.rng) * Math.PI * 2;
    const n = nav.nearest(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
    if (n < 0 || nav.component[n] !== nav.component[here]) continue;
    const x = nav.nodeX(n);
    const y = nav.nodeY(n);
    const z = nav.nodeZ(n);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= best || Math.hypot(x - ai.focusX, z - ai.focusZ) < TACTICS.vantageMin) continue;
    if (taken(state, c, x, z)) continue;
    if (!landsFrom(world, x, y + eye, z, ai.focusX, ty, ai.focusZ)) continue;
    best = d;
    if (ai.vantage) {
      ai.vantage.x = x;
      ai.vantage.y = y;
      ai.vantage.z = z;
    } else ai.vantage = { x, y, z };
  }
  return best < Infinity;
}

/** Whether a shot from c's eye at (x, y, z) gets at least within coverSlack of it. */
function landsNear(world: CollisionWorld, c: Character, x: number, y: number, z: number): boolean {
  return landsFrom(world, c.x, eyeHeight(c), c.z, x, y, z);
}

/** Whether a shot from (ox, oy, oz) at (x, y, z) gets at least within coverSlack of it. */
function landsFrom(
  world: CollisionWorld,
  ox: number,
  oy: number,
  oz: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const dx = x - ox;
  const dy = y - oy;
  const dz = z - oz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  const hit = world.raycast(ox, oy, oz, dx / d, dy / d, dz / d, d, undefined, true);
  return hit >= d - TACTICS.coverSlack;
}

/**
 * Whether to throw a grenade (AI-6; design.md → AI → PMCs → Fighting), on its perception
 * ticks while alert: out of sight of its target for a while but not long, holding the
 * angle or a way up, firing at its cover or in cover (not pushing, flanking, rushing or
 * running from a grenade), at least throwMin from where it was, it
 * now and then picks the first frag it carries, and an arc that lands it by where its
 * target was (throwArc). Only one AI grenade at a time near any spot (the area's token,
 * tokenTaken). Then it turns and throws (throwing).
 */
function considerThrow(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
): void {
  if (ai.seesTarget || ai.flee || ai.toss || (ai.rush ?? 0) > 0) return;
  if (state.tick < (ai.nextThrow ?? 0)) return;
  const a = ai.activity;
  if (a !== 'engage' && a !== 'suppress' && a !== 'hold' && a !== 'cover') return;
  // Pushing in to where it lost its target: it goes in shooting, not throwing.
  if (a === 'engage' && ai.push) return;
  if (ai.unseen < TACTICS.throwAfter || ai.unseen > TACTICS.throwFresh) return;
  if (c.draw > 0 || c.extinguish || (c.throwCooldown ?? 0) > 0 || c.mode !== 'ground') return;
  if ((heldWeapon(c)?.reloading ?? 0) > 0) return;
  const target = entityById(state, ai.target);
  if (!target || target.health.dead) return;
  const def = carriedFrag(c, items);
  if (!def) return;
  // Out of reach, a grenade is what it has (2026-11-08): it looks for an arc on every look
  // rather than now and then.
  if (ai.reachable && !chance(state.rng, TACTICS.throwRate * PERCEIVE_DT)) return;
  const x = ai.focusX;
  const y = ai.focusY;
  const z = ai.focusZ;
  if (Math.hypot(x - c.x, z - c.z) < TACTICS.throwMin) return;
  if (tokenTaken(state, items, x, z)) return;
  if (!throwArc(state, world, c, def, x, y, z)) {
    ai.nextThrow = state.tick + Math.round(TACTICS.retry / DT);
    return;
  }
  ai.toss = { item: def.id, x, y, z, yaw: arcYaw, pitch: arcPitch, time: TACTICS.throwTurn };
}

/** The first frag (a grenade that blasts) in reach, pockets then rig, or null. */
function carriedFrag(c: Character, items: ItemDb): GrenadeDef | null {
  for (let g = 0; g < QUICK_GRIDS; g++) {
    const list = carriedGrid(c.gear, g)?.items;
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const id = list[i]!.item.item;
      if (!throwable(items, id)) continue;
      const def = grenadeDef(items, id);
      if (grenadeEffect(def) === 'frag' && def.damage > 0) return def;
    }
  }
  return null;
}

/**
 * Whether the area's grenade token is taken (design.md → AI → Unreachable player): an AI's
 * blasting grenade is live within tokenRadius of (x, z), or an AI is turning to throw one
 * at a spot that close.
 */
function tokenTaken(state: SimState, items: ItemDb, x: number, z: number): boolean {
  const r = TACTICS.tokenRadius;
  for (const g of state.grenades) {
    if (Math.hypot(g.x - x, g.z - z) > r || grenadeDef(items, g.item).damage <= 0) continue;
    if (entityById(state, g.by)?.ai) return true;
  }
  for (const e of state.entities) {
    const t = e.ai?.toss;
    if (t && !e.health.dead && Math.hypot(t.x - x, t.z - z) <= r) return true;
  }
  return false;
}

// What throwArc found: the look to throw along (before the loft).
let arcYaw = 0;
let arcPitch = 0;
// Where predictThrow says a grenade ends up.
const landed = { x: 0, y: 0, z: 0 };
// Of the distance to the spot, how far each arc tried aims: at it, then short, since a
// grenade hops and rolls on after it lands.
const ARC_SHORT = [1, 0.9, 0.8, 0.7, 0.55] as const;

/**
 * A throw from c's eye that ends up, bounces and all (predictThrow), within throwSlack of
 * (x, y, z) (feet height) with a clear line from there to its middle, so the blast reaches
 * it: straight at it if that does, else lobbed over cover (if the ceiling allows), each
 * aimed at the spot and then short of it. Into arcYaw, arcPitch.
 */
function throwArc(
  state: SimState,
  world: CollisionWorld,
  c: Character,
  def: GrenadeDef,
  x: number,
  y: number,
  z: number,
): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return false;
  const h = y + 0.1 - eyeHeight(c);
  const v = def.throwSpeed;
  const g = GRENADE.gravity;
  const yaw = Math.atan2(-dx, -dz);
  const ty = y + MOVEMENT.standHeight * 0.5;
  for (let sign = -1; sign <= 1; sign += 2) {
    for (const k of ARC_SHORT) {
      // Launch angles reaching (kd, h) at speed v: tan θ = (v² ∓ √(v⁴ − g(g(kd)² + 2hv²))) / (g kd).
      const r = d * k;
      const disc = v ** 4 - g * (g * r * r + 2 * h * v * v);
      if (disc < 0) continue;
      const pitch = Math.atan((v * v + sign * Math.sqrt(disc)) / (g * r)) - GRENADE.loft;
      if (pitch > MOVEMENT.pitchLimit || pitch < -MOVEMENT.pitchLimit) continue;
      if (arcLands(state, world, c, def, yaw, pitch, x, y, z, ty)) return true;
    }
  }
  // The sums leave out the loft's lift and the hops after landing, so near the edge of its
  // reach (onto a roof, say) they can all miss when other pitches don't (2026-11-08): then
  // it tries pitches across the whole range.
  for (let pitch = ARC_SWEEP[0]; pitch <= ARC_SWEEP[1]; pitch += ARC_SWEEP[2])
    if (arcLands(state, world, c, def, yaw, pitch, x, y, z, ty)) return true;
  return false;
}

/** Pitches swept when the worked-out arcs miss: from, to, step (radians). */
const ARC_SWEEP = [-0.2, 1.3, 0.08] as const;

/**
 * Whether a throw along yaw, pitch ends up within throwSlack of (x, y, z) and level with it,
 * where its blast sees the spot's middle (ty). If so, into arcYaw, arcPitch.
 */
function arcLands(
  state: SimState,
  world: CollisionWorld,
  c: Character,
  def: GrenadeDef,
  yaw: number,
  pitch: number,
  x: number,
  y: number,
  z: number,
  ty: number,
): boolean {
  predictThrow(world, c, def, yaw, pitch, landed);
  if (Math.hypot(landed.x - x, landed.z - z) > TACTICS.throwSlack) return false;
  if (Math.abs(landed.y - y) > 1.5) return false;
  // Where it lands sees the spot (lifted off the surface, as a blast is).
  const ly = landed.y + GRENADE.lift;
  if (!clearLine(world, landed.x, ly, landed.z, x, ty, z, true)) return false;
  if (smokeBlocks(state.smokes, landed.x, ly, landed.z, x, ty, z)) return false;
  arcYaw = yaw;
  arcPitch = pitch;
  return true;
}

// Where throwing wants it to look.
let tossYaw = 0;
let tossPitch = 0;

/**
 * One tick of getting a grenade away: standing still (crouched behind low cover), it turns
 * to the throw's look (allowing for its recoil, which the throw adds) and lets go on the
 * tick its turn gets there. Seeing its
 * target again, not alert any more, or too long turning, it doesn't. Returns whether it's
 * still about it; the rest of what it was doing waits meanwhile.
 */
function throwing(state: SimState, c: Character, ai: AiState): boolean {
  const t = ai.toss!;
  t.time -= DT;
  if (t.time <= 0 || ai.seesTarget || ai.awareness !== 'alert') {
    ai.toss = null;
    return false;
  }
  tossYaw = t.yaw - c.recoilYaw;
  tossPitch = t.pitch - c.recoilPitch;
  // In the stance the arc was worked out from: crouched behind low cover stays down.
  ai.input.crouch = ai.activity === 'cover' && ai.coverLow;
  const step = AI.alertTurnRate * DT;
  if (
    Math.abs(angleDiff(c.yaw, tossYaw)) <= step &&
    Math.abs(c.pitch - tossPitch) <= step &&
    Math.hypot(c.vx, c.vz) < AI.stuckSpeed
  ) {
    ai.input.throw = true;
    ai.input.grenade = t.item;
    ai.toss = null;
    ai.nextThrow = state.tick + Math.round(TACTICS.throwGap / DT);
    ai.hasGoal = false;
  }
  return true;
}

/** Whether the squad's leader is at its current stop (arrived there, not yet moved on). */
function atStop(sq: SquadState): boolean {
  return sq.stop >= 0 && sq.visited[sq.visited.length - 1] === sq.stop;
}

/** The leader is done with its stop (or gives it up): on to the next. */
function endStop(state: SimState, ai: AiState): void {
  const sq = squadState(state, ai.squad);
  if (sq && atStop(sq)) sq.stop = -1;
  ai.activity = 'route';
  ai.loot = null;
  ai.legSet = false;
  ai.hasGoal = false;
}

/**
 * A squad's leader on its route (AI rework session 4): a body its squad killed nearby
 * first, then on to its stop (picking one when it needs to), or to its extraction once
 * it's leaving. Arriving, it searches a loot spot or watches a choke. Returns its heading.
 */
function walkRoute(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
  sq: SquadState,
): number {
  // Little time left: straight out, whatever it was doing.
  if (!sq.leaving && sq.extract && timeLeft(state) < ROUTES.leaveBy) {
    sq.leaving = true;
    ai.legSet = false;
  }
  if (!ai.legSet) {
    const body = pickBody(state, c, sq, nav);
    if (body) {
      ai.activity = 'loot';
      ai.loot = body;
      ai.timer = ROUTES.lootMax;
      ai.hasGoal = false;
      return c.yaw;
    }
    if (!sq.leaving && ai.reroute) {
      const n = nearestStop(state, sq, c, nav);
      if (n >= 0) sq.stop = n;
    }
    ai.reroute = false;
    // Time to go after this stop.
    if (!sq.leaving && sq.stop < 0 && sq.extract && sq.leaveTick >= 0 && state.tick >= sq.leaveTick)
      sq.leaving = true;
    // Out by an extraction it can walk into now: one behind a door still shut (a switch
    // nobody has used) won't do. With none, it stays in the raid and roams on.
    if (sq.leaving && !chooseExtraction(state, world, sq, c, nav)) {
      sq.leaving = false;
      sq.extract = null;
    }
    if (!sq.leaving && sq.stop < 0) {
      sq.stop = pickStop(state, sq, c, nav);
      if (sq.stop < 0) {
        // Nowhere to go: it stands and looks about for a while.
        ai.activity = 'wait';
        ai.timer = ROUTES.chokeWait[1];
        ai.lookYaw = c.yaw;
        return c.yaw;
      }
    }
    ai.hasGoal = false;
    ai.legSet = true;
    const detour = sq.leaving && ai.detour !== undefined ? state.pois![ai.detour] : undefined;
    if (detour) {
      ai.legX = detour.x;
      ai.legY = detour.y;
      ai.legZ = detour.z;
    } else if (sq.leaving) {
      ai.legX = sq.exX;
      ai.legY = sq.exY;
      ai.legZ = sq.exZ;
    } else {
      const p = state.pois![sq.stop]!;
      ai.legX = p.x;
      ai.legY = p.y;
      ai.legZ = p.z;
      // A spot within the stop's radius (a loot spot's searching starts from wherever).
      const r = p.kind === 'choke' ? p.radius : Math.min(p.radius, 2);
      if (r > 0 && randomSpotNear(state, c, nav, p.x, p.y, p.z, r)) {
        ai.legX = spotX;
        ai.legY = spotY;
        ai.legZ = spotZ;
      }
    }
  }
  const r = moveTo(
    state,
    c,
    ai,
    nav,
    ai.legX,
    ai.legY,
    ai.legZ,
    ROUTES.pace,
    false,
    AI.arrive,
    ROUTES.greed,
    bossAvoid(state),
  );
  if (r === 'moving') {
    if (sq.leaving) sprintOpen(ai);
    return moveYaw;
  }
  // The end of a path that got only part way (a long way round): on from here.
  const short = r === 'failed' || Math.hypot(ai.legX - c.x, ai.legZ - c.z) > ROUTES.partial;
  if (r === 'arrived' && short) {
    ai.legTries = (ai.legTries ?? 0) + 1;
    if (ai.legTries <= ROUTES.partialTries) return moveYaw;
  }
  ai.legTries = 0;
  ai.legSet = false;
  if (sq.leaving) {
    if (ai.detour !== undefined && !short) {
      // Round the way that wouldn't go: now for the extraction again.
      ai.detour = undefined;
      return c.yaw;
    }
    if (short) {
      // The way out keeps stopping short (too far to plan in one go, or a dead end): by
      // way of another stop, a few times, before it gives up and roams on.
      ai.detours = (ai.detours ?? 0) + 1;
      const via = ai.detours <= ROUTES.detours ? pickStop(state, sq, c, nav) : -1;
      if (via >= 0) {
        ai.detour = via;
        return c.yaw;
      }
      ai.detour = undefined;
      sq.leaving = false;
      sq.extract = null;
      return c.yaw;
    }
    ai.detours = 0;
    ai.activity = 'extract';
    return c.yaw;
  }
  sq.visited.push(sq.stop);
  if (r === 'failed') {
    sq.stop = -1;
    return c.yaw;
  }
  const p = state.pois![sq.stop]!;
  if (p.kind === 'loot') {
    ai.activity = 'loot';
    ai.loot = null;
    ai.timer = ROUTES.lootMax;
  } else {
    ai.activity = 'wait';
    ai.timer = nextRange(state.rng, ROUTES.chokeWait[0], ROUTES.chokeWait[1]);
    ai.lookYaw = c.yaw;
  }
  return c.yaw;
}

/** Whether any living squad mate of c is searching something. */
function squadLooting(state: SimState, c: Character): boolean {
  for (const e of state.entities)
    if (e !== c && !e.health.dead && e.ai?.squad === c.ai!.squad && e.ai!.activity === 'loot')
      return true;
  return false;
}

/**
 * A squad member searching (AI rework session 4): walks to a container or body, searches it
 * for a time by how much is in it, and takes what fits into its rig and backpack. The
 * leader goes on to the next thing at its loot spot (or a body), and once there's nothing
 * left waits for the rest (up to ROUTES.lootMax there) before moving on; the others go back
 * to following. Returns its heading.
 */
function lootStep(state: SimState, c: Character, ai: AiState, items: ItemDb, nav: NavGrid): number {
  const sq = squadState(state, ai.squad);
  if (!sq) {
    calmDown(c, ai);
    return c.yaw;
  }
  const leads = squadLeader(state, c) === c;
  if (!ai.loot) {
    const stop = atStop(sq) ? state.pois![sq.stop]! : null;
    ai.loot =
      (leads ? pickBody(state, c, sq, nav) : null) ??
      (stop?.kind === 'loot' ? pickContainer(state, c, sq, stop, nav) : null);
    if (!ai.loot) {
      if (!leads) {
        calmDown(c, ai);
      } else if (ai.timer > 0 && squadLooting(state, c)) {
        return lookAround(ai);
      } else {
        endStop(state, ai);
      }
      return c.yaw;
    }
    ai.hasGoal = false;
  }
  const t = ai.loot;
  if (t.search < 0) {
    if (!lootInReach(state, c, t)) {
      const r = moveTo(
        state,
        c,
        ai,
        nav,
        t.x,
        t.y,
        t.z,
        ROUTES.pace,
        false,
        AI.arrive,
        ROUTES.greed,
      );
      if (r === 'moving') return moveYaw;
      if (!lootInReach(state, c, t)) {
        // Can't get to it: give it up.
        doneWith(sq, t);
        ai.loot = null;
        return c.yaw;
      }
    }
    t.search = searchTime(state, t.key);
    ai.hasGoal = false;
  }
  t.search -= DT;
  if (t.search <= 0) {
    if (t.key.startsWith('c:')) searchContainer(state, c, t.key.slice(2));
    takeLoot(state, items, c, t.key);
    doneWith(sq, t);
    ai.loot = null;
  }
  return yawTo(c, t.x, t.z);
}

/** A container the squad has searched, or a body: not searched again. */
function doneWith(sq: SquadState, t: LootTarget): void {
  if (t.key.startsWith('c:')) sq.looted.push(t.key.slice(2));
  else {
    const i = sq.kills.indexOf(Number(t.key.slice(2)));
    if (i >= 0) sq.kills.splice(i, 1);
  }
}

/**
 * A follower whose leader is searching a loot spot searches a container there too, and one
 * whose leader is leaving goes into the extraction with it. True if it did either.
 */
function joinLeader(
  state: SimState,
  c: Character,
  ai: AiState,
  leader: Character,
  nav: NavGrid,
): boolean {
  const l = leader.ai!;
  if (l.activity !== 'loot' && l.activity !== 'extract') return false;
  const sq = squadState(state, ai.squad);
  if (!sq) return false;
  if (l.activity === 'extract') {
    // Only from close by: one left far behind follows on until it's caught up.
    if (Math.hypot(leader.x - c.x, leader.z - c.z) > ROUTES.joinExtract) return false;
    ai.activity = 'extract';
    ai.legSet = false;
    return true;
  }
  if ((state.tick + c.id) % AI.perceiveEvery !== 0 || !atStop(sq)) return false;
  const stop = state.pois![sq.stop]!;
  if (stop.kind !== 'loot') return false;
  const t = pickContainer(state, c, sq, stop, nav);
  if (!t) return false;
  ai.activity = 'loot';
  ai.loot = t;
  ai.hasGoal = false;
  return true;
}

/**
 * Gunfire heard far off (AI rework session 4): the squad's leader turns its route towards
 * it, to the nearest stop that way, without stopping to check. Its squad mates leave it
 * to the leader. Not while it's leaving, fighting or checking something.
 */
function headToward(
  state: SimState,
  c: Character,
  ai: AiState,
  x: number,
  z: number,
  nav: NavGrid,
): void {
  if (squadLeader(state, c) !== c) return;
  const sq = squadState(state, ai.squad);
  if (!sq || sq.leaving) return;
  if (ai.activity !== 'route' && ai.activity !== 'wait' && ai.activity !== 'loot') return;
  const i = stopToward(state, c, x, z, nav);
  if (i < 0 || i === sq.stop) return;
  if (atStop(sq) || ai.activity !== 'route') endStop(state, ai);
  sq.stop = i;
  ai.legSet = false;
  ai.hasGoal = false;
}

// ---------------------------------------------------------------------------- zombies

/** Zombie tuning (zombies mode). Distances in meters, times in seconds. */
const HUNT = {
  /** It picks its prey again this often. */
  repick: 1,
  /** It stops walking this close to its prey (center to center), and claws from... */
  stop: 0.8,
  /** ...this far beyond the prey's capsule, a little short of its claws' reach... */
  clawSlack: 0.25,
  /** ...when facing it within this many degrees, and this near its height. */
  clawCone: 35,
  clawHeight: 1.2,
  /** It turns to face its prey, not where its path goes, from this close. */
  faceFrom: 3,
  /** It's at its window this close to the outside spot. */
  atWindow: 0.5,
};

/**
 * A zombie's tick (sim/zombies.ts): no perceiving, hiding or shooting. Outside, it first
 * breaks in through its window (see breakIn). Then it always knows where the players are
 * and goes for the nearest it can walk to (else the nearest at all), picked again every so
 * often, by the shortest way, at a walk (zombies never get faster), and swings its claws
 * once it's close and facing them. Opens doors on the way like any enemy; a locked one (not
 * yet bought) cuts it off.
 */
function hunt(state: SimState, c: Character, ai: AiState, items: ItemDb, nav: NavGrid): void {
  const input = ai.input;
  const mind = ai.zombie!;
  const w = state.zombies?.windows[mind.window];
  if (w) {
    breakIn(state, c, ai, mind, w, items, nav);
    return;
  }
  // Climbing in: a path from where it started would lead back outside.
  if (c.mode === 'vault') {
    ai.hasGoal = false;
    return;
  }
  ai.timer -= DT;
  let prey = entityById(state, ai.target);
  if (ai.timer <= 0 || !prey || prey.health.dead || prey.ai) {
    ai.timer = HUNT.repick;
    prey = pickPrey(state, c, nav);
    ai.target = prey?.id ?? 0;
  }
  if (!prey) return;
  const dx = prey.x - c.x;
  const dz = prey.z - c.z;
  const d = Math.hypot(dx, dz);
  let faceYaw = yawTo(c, prey.x, prey.z);
  if (d > HUNT.stop) {
    const r = moveTo(state, c, ai, nav, prey.x, prey.y, prey.z, 1, false, HUNT.stop);
    if (r === 'failed' || r === 'arrived') {
      // No way there (or at the path's end): straight at it.
      wishX = dx / d;
      wishZ = dz / d;
      ai.hasGoal = false;
    } else if (d > HUNT.faceFrom) faceYaw = moveYaw;
  }
  const chest = eyeHeight(c) - (prey.y + prey.height * 0.6);
  const facePitch = -Math.atan2(chest, Math.max(d, 0.1));
  const claws = c.gear.knife ? items.get(c.gear.knife.item) : undefined;
  const reach = claws?.type === 'melee' ? claws.reach : 1.5;
  input.fire =
    d - MOVEMENT.radius < reach - HUNT.clawSlack &&
    Math.abs(prey.y - c.y) < HUNT.clawHeight &&
    Math.abs(angleDiff(c.yaw, faceYaw)) < HUNT.clawCone * DEG;

  const turn = AI.alertTurnRate * DT;
  input.yaw = turnToward(c.yaw, faceYaw, turn);
  input.pitch = c.pitch + Math.max(-turn, Math.min(turn, facePitch - c.pitch));
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  input.moveX = cy * wishX - sy * wishZ;
  input.moveY = -(sy * wishX + cy * wishZ);
  wishX = wishZ = 0;
}

/**
 * A zombie outside: it walks to its window's outside spot, then, facing in, tears off a
 * plank every tearTime, clawing instead whenever a player is in reach on the other side
 * (claws and shots pass a window). With no planks left it climbs through to the inside spot
 * and hunts from there.
 */
function breakIn(
  state: SimState,
  c: Character,
  ai: AiState,
  mind: ZombieMind,
  w: WindowState,
  items: ItemDb,
  nav: NavGrid,
): void {
  if (c.mode === 'vault') return;
  const input = ai.input;
  const out = side(w, -1);
  const d = Math.hypot(out.x - c.x, out.z - c.z);
  let faceYaw = w.yaw + Math.PI;
  let facePitch = 0;
  if (d > HUNT.atWindow) {
    const r = moveTo(state, c, ai, nav, out.x, c.y, out.z, 1, false, HUNT.atWindow * 0.8);
    if (r === 'failed') {
      wishX = (out.x - c.x) / d;
      wishZ = (out.z - c.z) / d;
      ai.hasGoal = false;
    }
    faceYaw = d > HUNT.faceFrom ? moveYaw : yawTo(c, out.x, out.z);
  } else {
    // At the window. A player in reach inside gets clawed through it.
    const claws = c.gear.knife ? items.get(c.gear.knife.item) : undefined;
    const reach = claws?.type === 'melee' ? claws.reach : 1.5;
    let prey: Character | undefined;
    let preyD = reach - HUNT.clawSlack + MOVEMENT.radius;
    for (const e of state.entities) {
      if (e.ai || e.health.dead || e.admin?.peaceful) continue;
      const pd = Math.hypot(e.x - c.x, e.z - c.z);
      if (pd < preyD && Math.abs(e.y - c.y) < HUNT.clawHeight) {
        preyD = pd;
        prey = e;
      }
    }
    const zombies = state.zombies!;
    if (prey) {
      faceYaw = yawTo(c, prey.x, prey.z);
      facePitch = -Math.atan2(eyeHeight(c) - (prey.y + prey.height * 0.6), Math.max(preyD, 0.1));
      input.fire = Math.abs(angleDiff(c.yaw, faceYaw)) < HUNT.clawCone * DEG;
    } else if (w.planks > 0) {
      w.tear += DT;
      if (w.tear >= zombies.rules.barricades.tearTime) {
        w.tear = 0;
        w.planks--;
        state.events.push({
          type: 'plank',
          by: c.id,
          window: zombies.windows.indexOf(w),
          added: false,
          points: 0,
        });
      }
    } else {
      // Over the sill and in.
      const into = side(w, 1);
      c.mode = 'vault';
      c.vaulting = {
        fromX: c.x,
        fromY: c.y,
        fromZ: c.z,
        toX: into.x,
        toY: c.y,
        toZ: into.z,
        top: w.y + 0.15,
        fromHeight: c.height,
        toHeight: c.height,
        t: 0,
      };
      mind.window = -1;
      ai.hasGoal = false;
      ai.timer = 0;
    }
  }
  const turn = AI.alertTurnRate * DT;
  input.yaw = turnToward(c.yaw, faceYaw, turn);
  input.pitch = c.pitch + Math.max(-turn, Math.min(turn, facePitch - c.pitch));
  const sy = Math.sin(input.yaw);
  const cy = Math.cos(input.yaw);
  input.moveX = cy * wishX - sy * wishZ;
  input.moveY = -(sy * wishX + cy * wishZ);
  wishX = wishZ = 0;
}

/** A window's inside (1) or outside (−1) standing spot. */
function side(w: WindowState, k: 1 | -1): { x: number; z: number } {
  const d = k * ZOMBIES.windowStand;
  return { x: w.x + Math.sin(w.yaw) * d, z: w.z + Math.cos(w.yaw) * d };
}

/** The nearest living player a zombie can walk to, else the nearest at all, or undefined. */
function pickPrey(state: SimState, c: Character, nav: NavGrid): Character | undefined {
  const here = nav.nearest(c.x, c.y, c.z);
  let best: Character | undefined;
  let bestD = Infinity;
  for (const e of state.entities) {
    if (e.ai || e.health.dead || e.admin?.peaceful) continue;
    const there = nav.nearest(e.x, e.y, e.z);
    const reachable = here >= 0 && there >= 0 && nav.component[here] === nav.component[there];
    // One it can't walk to counts as much further away.
    const d = Math.hypot(e.x - c.x, e.z - c.z) + (reachable ? 0 : 1e6);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// Where fleeGrenade wants it to face.
let fleeYaw = 0;
// A flee spot at least this far outside the blast radius counts as safe.
const FLEE_SAFE = 0.5;

/**
 * A grenade close enough to hurt it (not a flash or smoke, nor placed C4), with nothing
 * between it and its eye (it saw it, or heard it land): it sprints for a walkable spot
 * outside the blast that it can reach, the nearest to it, and turns to face the grenade
 * once there. Whatever it was doing waits, planning afresh once the grenade has gone off.
 * Returns whether it's running (or waiting out the blast); false too when there's nowhere
 * to run.
 */
function fleeGrenade(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  items: ItemDb,
  nav: NavGrid,
): boolean {
  // Jug charges at grenades rather than running (AI-8).
  if (ai.skill.charge) {
    ai.flee = null;
    if ((state.tick + c.id) % AI.perceiveEvery === 0) chargeGrenade(state, c, ai, world);
    return false;
  }
  const eye = eyeHeight(c);
  let found: Grenade | null = null;
  let radius = 0;
  for (const g of state.grenades) {
    // Only what would hurt it: not a flash or smoke, nor C4 it doesn't know is a bomb. Its
    // own and its allies' are run from too (AI-6), though they can't hurt it (health.ts
    // byAlly): it doesn't stand by a grenade.
    const def = grenadeDef(items, g.item);
    if (def.damage <= 0 || g.remote) continue;
    const r = def.radius;
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
  if (f0?.grenade !== found.id || Math.hypot(f0.x - found.x, f0.z - found.z) < radius + FLEE_SAFE) {
    if (!pickFleeSpot(state, c, ai, world, nav, found, radius) && f0?.grenade !== found.id)
      return false;
    ai.hasGoal = false;
  }
  const f = ai.flee!;
  const r = moveTo(state, c, ai, nav, f.x, f.y, f.z, AI.alertPace);
  fleeYaw = r === 'moving' ? moveYaw : yawTo(c, found.x, found.z);
  return true;
}

/**
 * The walkable spot outside a grenade's blast nearest c that c can walk to, one out of the
 * thrower's sight counting AI.fleeHidden nearer, into ai.flee.
 */
function pickFleeSpot(
  state: SimState,
  c: Character,
  ai: AiState,
  world: CollisionWorld,
  nav: NavGrid,
  g: Grenade,
  radius: number,
): boolean {
  const thrower = entityById(state, g.by);
  const hostileThrower = thrower && !thrower.health.dead && hostile(c, thrower) ? thrower : null;
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
    let d = Math.hypot(x - c.x, z - c.z);
    if (
      hostileThrower &&
      d - AI.fleeHidden < bestD &&
      !clearLine(
        world,
        hostileThrower.x,
        eyeHeight(hostileThrower),
        hostileThrower.z,
        x,
        nav.nodeY(node) + 1.2,
        z,
      )
    )
      d -= AI.fleeHidden;
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
  const center = nav.nearest(ai.legX, ai.legY, ai.legZ, GOAL_RISE);
  for (let tries = 0; tries < 8; tries++) {
    const r = radius * Math.sqrt(nextFloat(state.rng));
    const a = nextFloat(state.rng) * Math.PI * 2;
    const n = nav.nearest(ai.legX + Math.cos(a) * r, ai.legY, ai.legZ + Math.sin(a) * r, GOAL_RISE);
    if (n >= 0 && (center < 0 || nav.component[n] === nav.component[center])) {
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
  /** Only aims and fires: moving is the caller's (going to cover, 2026-11-08). */
  hold = false,
): void {
  const w = heldWeapon(c)!;
  const def = weaponDef(items, w.item);
  const input = ai.input;
  const sees = ai.seesTarget;
  // The middle of the body, or the head if that's all it can see over cover or round a
  // corner (leaning): of the target itself while seen, else where it was.
  let tx = ai.focusX;
  let ty = ai.focusY + MOVEMENT.standHeight * 0.6;
  let tz = ai.focusZ;
  let headOnly = false;
  if (sees) {
    const p = chestPoint;
    bodyPoint(target, target.height * AI.aimHeight, p);
    if (!clearLine(world, c.x, eyeHeight(c), c.z, p.x, p.y, p.z)) {
      bodyPoint(target, target.height - 0.15, p);
      headOnly = true;
    }
    tx = p.x;
    ty = p.y;
    tz = p.z;
  }
  const across = Math.hypot(tx - c.x, tz - c.z);

  let moving = hold;
  if (hold) {
    // Moving already.
  } else if (!sees) {
    if (ai.push && mayGo(ai, ai.focusX, ai.focusZ))
      moving =
        moveTo(state, c, ai, nav, ai.focusX, ai.focusY, ai.focusZ, AI.alertPace, true) === 'moving';
  } else if (
    // Jug walks right at you, firing (AI-7), and on round cover that shows only your head
    // rather than shooting into its edge (2026-11-08).
    ((ai.skill.charge && headOnly) ||
      across >
        (ai.skill.charge ? JUG.chargeClose : Math.min(def.range * AI.engageRange, AI.maxEngage))) &&
    // Holding its ground (skill.anchored, MT-12), only after a target on it.
    mayGo(ai, target.x, target.z)
  ) {
    moving =
      moveTo(state, c, ai, nav, target.x, target.y, target.z, AI.alertPace, true) === 'moving';
  } else if (!ai.skill.charge) {
    moving = sidestep(state, c, ai, nav);
  } else {
    // Close in with a clear shot, Jug stands and fires: sidestepping took him back behind
    // the cover he'd just come round (2026-11-08).
    ai.hasGoal = false;
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
  // Jug empties his drum before reloading (AI-8): volume of fire.
  reloadIfLow(state, c, items, sees || ai.skill.charge ? 0 : 0.5);

  const ready =
    sees &&
    ai.reaction <= 0 &&
    w.mag > 0 &&
    w.reloading === 0 &&
    across <= def.range &&
    Math.abs(angleDiff(c.yaw, aimYaw)) < AI.fireCone * DEG;
  const semi = def.fireMode === 'semi';
  if (ai.burst <= 0 && ai.pause <= 0 && ready) {
    const spray = ai.skill.spray && across <= ai.skill.spray.range ? ai.skill.spray : null;
    const [min, max] =
      spray?.burst ??
      ai.skill.burst ??
      (ai.skill.charge ? JUG.burst : across < AI.closeRange ? AI.closeBurst : AI.farBurst);
    // A semi-automatic's burst is one pull: the trigger held for a tick.
    // Held until the last round of the burst has gone: one round's time less than all of
    // them (its first goes at once), or a burst of n fired n + 1 (2026-11-08).
    ai.burst = semi ? DT / 2 : ((Math.round(nextRange(state.rng, min, max)) - 0.5) * 60) / def.rpm;
  }
  if (ai.burst > 0) {
    input.fire = ready && clearOfAllies(state, c, target, tx, ty, tz);
    ai.burst -= DT;
    if (ai.burst <= 0) {
      const spray = ai.skill.spray && across <= ai.skill.spray.range ? ai.skill.spray : null;
      const [min, max] = semi
        ? AI.semiPause
        : (spray?.pause ??
          ai.skill.burstPause ??
          (ai.skill.charge ? JUG.burstPause : AI.burstPause));
      // Slower, steadier shots further away (not Jug's, nor a spray's).
      ai.pause = nextRange(state.rng, min, max) * (ai.skill.charge || spray ? 1 : 1 + across / 40);
    }
  } else {
    ai.pause -= DT;
  }
}

/** Looks at a point, off by its aim error, wandering smoothly, and pulls against recoil. */
function aimAt(state: SimState, c: Character, ai: AiState, x: number, y: number, z: number): void {
  const t = state.tick * DT;
  const e = ai.aimError;
  aimYaw = yawTo(c, x, z) + e * Math.sin(t * 2.3 + ai.aimPhase) - c.recoilYaw * AI.recoilControl;
  aimPitch =
    Math.atan2(y - eyeHeight(c), Math.hypot(x - c.x, z - c.z)) +
    e * AI.aimVertical * Math.sin(t * 3.1 + ai.aimPhase * 1.7) -
    c.recoilPitch * AI.recoilControl;
}

/** Whether a shot at (x, y, z) would reach the target before any ally. */
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
  if (allyHit.id === target.id) return true;
  const hit = entityById(state, allyHit.id);
  return !hit?.ai || hostile(c, hit);
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
function reloadIfLow(state: SimState, c: Character, items: ItemDb, fraction: number): void {
  const w = heldWeapon(c);
  if (!w || w.reloading > 0 || !canReload(state, c, items, w)) return;
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
  samples: number = AI.coverSamples,
): boolean {
  const here = nav.nearest(c.x, c.y, c.z);
  if (here < 0) return false;
  const crouchedEye = MOVEMENT.crouchHeight - MOVEMENT.eyeBelowTop;
  const standingEye = MOVEMENT.standHeight - MOVEMENT.eyeBelowTop;
  let best = Infinity;
  for (let i = 0; i < samples; i++) {
    const r = nextRange(state.rng, 1.5, AI.coverRadius);
    const a = nextFloat(state.rng) * Math.PI * 2;
    let n = nav.nearest(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r);
    if (n < 0 || nav.component[n] !== nav.component[here]) continue;
    // In the threat's view, but its line there passes something solid on the way: the spot
    // just behind that instead (2026-11-08: random spots alone found the shadow of a 6 m
    // wall one time in 28, so enemies mostly fought in the open).
    if (
      hiddenFrom(world, tx, ty, tz, nav.nodeX(n), nav.nodeY(n) + crouchedEye, nav.nodeZ(n)) === 0
    ) {
      const px = nav.nodeX(n);
      const pz = nav.nodeZ(n);
      const dx = px - tx;
      const dy = nav.nodeY(n) + crouchedEye - ty;
      const dz = pz - tz;
      const full = Math.hypot(dx, dy, dz);
      const hit = world.raycast(
        tx,
        ty,
        tz,
        dx / full,
        dy / full,
        dz / full,
        full + 6,
        undefined,
        true,
      );
      if (hit === Infinity) continue;
      const k = (hit + AI.coverBehind) / full;
      n = nav.nearest(tx + dx * k, cy, tz + dz * k);
      if (n < 0 || nav.component[n] !== nav.component[here]) continue;
    }
    const x = nav.nodeX(n);
    const y = nav.nodeY(n);
    const z = nav.nodeZ(n);
    const d = Math.hypot(x - c.x, z - c.z);
    if (d >= best || d > AI.coverRadius + 1) continue;
    if (Math.hypot(x - tx, z - tz) < AI.coverMinThreat || taken(state, c, x, z)) continue;
    // Hidden a little either side of the spot too, as it stops near it, not on it.
    if (hiddenFrom(world, tx, ty, tz, x, y + crouchedEye, z) < 3) continue;
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

/**
 * How hidden a spot's eye at (x, ey, z) is from a threat's at (tx, ty, tz): 3 when the
 * spot and AI.coverMargin either side of it all are, else 0 (stopping at the first in view).
 */
function hiddenFrom(
  world: CollisionWorld,
  tx: number,
  ty: number,
  tz: number,
  x: number,
  ey: number,
  z: number,
): number {
  const td = Math.hypot(x - tx, z - tz);
  if (td < 1e-6) return 0;
  const sx = ((z - tz) / td) * AI.coverMargin;
  const sz = (-(x - tx) / td) * AI.coverMargin;
  if (clearLine(world, tx, ty, tz, x, ey, z)) return 0;
  if (clearLine(world, tx, ty, tz, x + sx, ey, z + sz)) return 0;
  if (clearLine(world, tx, ty, tz, x - sx, ey, z - sz)) return 0;
  return 3;
}

/** Whether another enemy is in or heading for cover at (x, z). */
function taken(state: SimState, c: Character, x: number, z: number): boolean {
  for (const e of state.entities) {
    const o = e.ai;
    if (e === c || !o || e.health.dead) continue;
    const a = o.activity;
    if (
      (a === 'takeCover' || a === 'cover' || a === 'hold' || a === 'flank') &&
      Math.hypot(o.coverX - x, o.coverZ - z) < 1.2
    )
      return true;
    if (a === 'suppress' && o.vantage && Math.hypot(o.vantage.x - x, o.vantage.z - z) < 1.2)
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
  greed = 1,
  shun: Avoid = avoidFire,
): 'moving' | 'arrived' | 'failed' {
  moveYaw = c.yaw;
  if (!ai.hasGoal || Math.hypot(ai.goalX - x, ai.goalY - y, ai.goalZ - z) > AI.replanDistance) {
    if (stepOff(state, c, ai, nav, pace, x, y, z)) return 'moving';
    if (plansLeft <= 0) return 'moving';
    // A goal that only moved on (a leader walking, a target running) keeps the time it has
    // been stuck: planning again every few ticks mustn't hide that it isn't getting
    // anywhere (AI rework session 4).
    const fresh = !ai.hasGoal;
    plansLeft--;
    avoidFire.spots = state.fires;
    const result = findPath(
      nav,
      nav.nearest(c.x, c.y, c.z),
      nav.nearest(x, y, z, GOAL_RISE),
      ai.path,
      shun,
      greed,
    );
    ai.fires = newestFire(state);
    ai.hasGoal = true;
    ai.goalX = x;
    ai.goalY = y;
    ai.goalZ = z;
    ai.pathIndex = ai.path.length > 3 ? 1 : 0;
    if (fresh) ai.stuck = 0;
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
  // Fire newer than the plan across the rest of the way: plan again, round it.
  if (fireAcross(state, c, ai)) ai.hasGoal = false;

  // Stuck against something (little ground covered in stuckTime, however fast it jitters):
  // plan again from here, and give up after a few tries.
  if (ai.stuck === 0 || ai.stuckX === undefined) {
    ai.stuckX = c.x;
    ai.stuckZ = c.z;
  }
  ai.stuck += DT;
  if (
    ai.stuck > AI.stuckTime &&
    Math.hypot(c.x - ai.stuckX, c.z - ai.stuckZ!) >= AI.stuckSpeed * AI.stuckTime
  )
    ai.stuck = 0;
  if (ai.stuck > AI.stuckTime) {
    ai.hasGoal = false;
    ai.stuck = 0;
    // Sidestep a moment, either way in turn: off a thin panel the nav grid can't see, or
    // out of a corner, rather than pressing into it again on the new path.
    ai.unstick = AI.unstickTime;
    ai.unstickSide = (c.id + ai.replans) % 2 ? 1 : -1;
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
  if ((ai.unstick ?? 0) > 0) {
    ai.unstick! -= DT;
    // Across the way it was going, and a little back.
    const side = ai.unstickSide ?? 1;
    wishX = ((-dz / d) * side - (dx / d) * 0.3) * pace;
    wishZ = ((dx / d) * side - (dz / d) * 0.3) * pace;
  }
  return 'moving';
}

/** Paths keep out of reach of fire on the map (sim/fire.ts); spots set before each plan. */
const avoidFire: Avoid = {
  spots: [],
  radius: FIRE.patchRadius + MOVEMENT.radius + 0.3,
  cost: FIRE.avoidCost,
};

/**
 * On an island of the nav grid (AI.island nodes or fewer) with its goal (if given) elsewhere: wishes
 * straight at the nearest node of a real area within AI.offReach, 0.3 m to AI.offDrop
 * below, and returns true. False if it isn't stranded, or there's nowhere to
 * step down to (it plans as usual).
 */
function stepOff(
  state: SimState,
  c: Character,
  ai: AiState,
  nav: NavGrid,
  pace: number,
  x?: number,
  y?: number,
  z?: number,
): boolean {
  if (c.mode !== 'ground' || state.tick < (ai.offAgain ?? 0)) return false;
  if (!stranded(c, nav, pace, x, y, z)) {
    ai.offFor = 0;
    return false;
  }
  // Not getting down (something in the way): it stops trying for a while.
  ai.offFor = (ai.offFor ?? 0) + DT;
  if (ai.offFor > AI.offGiveUp) {
    ai.offFor = 0;
    ai.offAgain = state.tick + Math.round(AI.offRetry / DT);
    return false;
  }
  return true;
}

/**
 * Whether c is stranded on an island of the nav grid with its goal (if given) elsewhere,
 * and if so the way down into wishX, wishZ, moveYaw (for stepOff).
 */
function stranded(
  c: Character,
  nav: NavGrid,
  pace: number,
  x?: number,
  y?: number,
  z?: number,
): boolean {
  // Where it really stands, a pocket too (nearest() would look past a small one).
  const from = nav.nearest(c.x, c.y, c.z, NAV.climb, true);
  if (from < 0) return false;
  const island = nav.component[from]!;
  // Up on something with no node of its own (too narrow for the grid) counts too: the
  // nearest node is the floor a step or more below its feet.
  const perched = c.y > nav.nodeY(from) + AI.perched;
  if (!perched && (nav.componentSizes[island] ?? Infinity) > AI.island) return false;
  if (x !== undefined) {
    const to = nav.nearest(x, y!, z!, GOAL_RISE);
    if (!perched && to >= 0 && nav.component[to] === island) return false;
  }
  let best = -1;
  let bestD = Infinity;
  for (const r of AI.offReach) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const n = nav.nearest(c.x + Math.cos(a) * r, c.y - 0.5, c.z + Math.sin(a) * r);
      if (n < 0 || (!perched && nav.component[n] === island)) continue;
      if ((nav.componentSizes[nav.component[n]!] ?? 0) <= AI.island) continue;
      // Down off it: a small room's floor is level with its surroundings, a tabletop isn't.
      if (nav.nodeY(n) < c.y - AI.offDrop || nav.nodeY(n) > c.y - 0.3) continue;
      const d = Math.hypot(nav.nodeX(n) - c.x, nav.nodeZ(n) - c.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
  }
  if (best < 0) return false;
  // Towards it, and on past it until it's off: its body is wider than the gap from the
  // edge to that node, so it would stand at the node still half on the top.
  let dx = nav.nodeX(best) - c.x;
  let dz = nav.nodeZ(best) - c.z;
  if (Math.hypot(dx, dz) < 0.6) {
    dx = nav.nodeX(best) - nav.nodeX(from);
    dz = nav.nodeZ(best) - nav.nodeZ(from);
  }
  const d = Math.max(1e-6, Math.hypot(dx, dz));
  wishX = (dx / d) * pace;
  wishZ = (dz / d) * pace;
  moveYaw = Math.atan2(-dx, -dz);
  return true;
}

/**
 * A flanker's way round (2026-11-08, an AI-5 loose end: its path could pass close to its
 * target): it keeps TACTICS.flankShun from where it last saw it, and from fire, set by
 * flankAvoid before each plan.
 */
const flankSpots: { x: number; y: number; z: number }[] = [];
const avoidFlank: Avoid = { spots: flankSpots, radius: 0, cost: TACTICS.flankShunCost };

function flankAvoid(state: SimState, ai: AiState): Avoid {
  // Reused objects: the target's spot first, then fire.
  const n = 1 + state.fires.length;
  while (flankSpots.length < n) flankSpots.push({ x: 0, y: 0, z: 0 });
  flankSpots.length = n;
  flankSpots[0]!.x = ai.focusX;
  flankSpots[0]!.y = ai.focusY;
  flankSpots[0]!.z = ai.focusZ;
  for (let i = 0; i < state.fires.length; i++) {
    const p = state.fires[i]!;
    const s = flankSpots[i + 1]!;
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
  }
  avoidFlank.radius = TACTICS.flankShun;
  return avoidFlank;
}

/**
 * A squad leader's way between stops early on (ROUTES.bossPathFor): round living bosses'
 * ground (their patrols); later, or with none about, just round fire.
 */
const bossSpots: { x: number; y: number; z: number }[] = [];
const avoidBoss: Avoid = { spots: bossSpots, radius: 0, cost: 0 };

function bossAvoid(state: SimState): Avoid {
  avoidFire.spots = state.fires;
  const start = state.waves?.start;
  if (start === undefined || state.tick - start > ROUTES.bossPathFor / DT) return avoidFire;
  bossSpots.length = 0;
  for (const e of state.entities) {
    const a = e.ai;
    if (!a || e.health.dead || a.faction !== 'boss') continue;
    if (a.patrol.length === 0) bossSpots.push({ x: a.homeX, y: a.homeY, z: a.homeZ });
    for (let i = 0; i < a.patrol.length; i += 3)
      bossSpots.push({ x: a.patrol[i]!, y: a.patrol[i + 1]!, z: a.patrol[i + 2]! });
  }
  if (!bossSpots.length) return avoidFire;
  // Fire too (kept at the bosses' wider berth).
  for (const p of state.fires) bossSpots.push(p);
  avoidBoss.radius = ROUTES.bossPathRadius;
  avoidBoss.cost = ROUTES.bossPathCost;
  return avoidBoss;
}

/** The newest fire on the map's id, or 0. */
function newestFire(state: SimState): number {
  let id = 0;
  for (const p of state.fires) if (p.id > id) id = p.id;
  return id;
}

/**
 * Whether fire lit since ai's path was planned or last checked lies across the rest of
 * it, from where c is. Marks it all checked either way, so each is looked at once.
 */
function fireAcross(state: SimState, c: Character, ai: AiState): boolean {
  const known = ai.fires ?? 0;
  const newest = newestFire(state);
  if (newest <= known) return false;
  ai.fires = newest;
  const r2 = avoidFire.radius * avoidFire.radius;
  for (const p of state.fires) {
    if (p.id <= known || p.y < c.y - 0.5 || p.y > c.y + 2.2) continue;
    let ax = c.x;
    let az = c.z;
    for (let i = ai.pathIndex * 3; i < ai.path.length; i += 3) {
      const bx = ai.path[i]!;
      const bz = ai.path[i + 2]!;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t =
        len2 > 1e-12 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.z - az) * dz) / len2)) : 0;
      const ex = ax + dx * t - p.x;
      const ez = az + dz * t - p.z;
      if (ex * ex + ez * ez < r2) return true;
      ax = bx;
      az = bz;
    }
  }
  return false;
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

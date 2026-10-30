import { createRng, type Rng } from '../rng';
import type { AiState } from './ai';
import type { CollisionWorld } from '../world/collision-world';
import { createGear, type Gear, type Hand } from './gear';
import type { DoorEvent, DoorState } from './doors';
import type { GroundItem } from './ground';
import { createHealth, type DamageEvent, type DeathEvent, type Health } from './health';
import type { InventoryAction, InventoryEvent, LootContainer } from './looting';
import type { MedRef, MedUse } from './meds';
import type { SwingEvent } from './melee';
import { MOVEMENT } from './movement';
import type { InvestigateEvent, LeaveEvent, LeftRaid, RaidState } from './raid';
import type { ShotEvent } from './weapons';

export type EntityId = number;

export type MoveMode = 'ground' | 'air' | 'ladder';

/** A player or AI body: a vertical capsule standing at (x, y, z). */
export interface Character {
  id: EntityId;
  kind: 'character';
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Look direction. yaw 0 faces −z; pitch is positive looking up. */
  yaw: number;
  pitch: number;
  mode: MoveMode;
  /** Capsule height; eases between crouching and standing over a few ticks. */
  height: number;
  /** Index into the world's ladders while climbing, otherwise -1. */
  ladder: number;
  /** The jump button last tick, so holding it jumps once. */
  jumpHeld: boolean;
  /** How fast it hit the ground if it landed this tick (m/s), otherwise 0. For fall damage. */
  landingSpeed: number;
  health: Health;
  /** Everything it carries and wears. The gun in its hands is heldWeapon(c). */
  gear: Gear;
  /** How far into aiming down the sights: 0 at the hip, 1 fully aimed. */
  aim: number;
  /** Seconds left taking out what's in its hands; it can't fire, swing or aim until 0. */
  draw: number;
  /** Seconds until the knife can swing again. */
  swing: number;
  /** The med it's using, or null. */
  using: MedUse | null;
  /** Seconds it has stood in an extraction point; 0 when not in one. */
  extracting: number;
  /** Recoil's kick to the view in radians, added to yaw and pitch; it settles back to 0. */
  recoilPitch: number;
  recoilYaw: number;
  /** An enemy's mind; null for players. */
  ai: AiState | null;
  /** Admin cheats for testing (dev server only); missing for everyone else. */
  admin?: AdminCheats;
}

/** Testing aids an admin can turn on for their player (2026-10-30, the user's call). */
export interface AdminCheats {
  /** Takes no damage, never bleeds and can't die. */
  infiniteHealth: boolean;
  /** Firing uses no rounds, and a reload fills the gun without taking any. */
  infiniteAmmo: boolean;
  /** Enemies never notice it: not by sight, sound or being shot. */
  peaceful: boolean;
}

/** Only characters so far. Loot containers and ground items have their own lists. */
export type Entity = Character;

/** Things that happened during the last tick, for effects and the HUD. */
export type SimEvent =
  | ShotEvent
  | SwingEvent
  | DamageEvent
  | DeathEvent
  | InventoryEvent
  | LeaveEvent
  | DoorEvent
  | InvestigateEvent;

/**
 * Everything that changes during a raid. Plain JSON-safe data: no classes, maps or typed
 * arrays, so it can be saved, sent over the network and restored. The static map lives
 * in a CollisionWorld, not here.
 */
export interface SimState {
  tick: number;
  rng: Rng;
  nextId: EntityId;
  entities: Entity[];
  /** The raid's desks, cabinets and crates. Dead bodies are looted through their gear. */
  loot: LootContainer[];
  /** Items lying loose: rolled at loot spawns, dropped, or with nowhere else to go. */
  ground: GroundItem[];
  /** Each of the world's doors, by index; filled in by the first step (see syncDoors). */
  doors: DoorState[];
  /** The timer and extraction points; null outside a raid (tests, the perf scene). */
  raid: RaidState | null;
  /** Players who have left the raid alive, with what they carried. */
  left: LeftRaid[];
  /** What happened during the last tick; cleared at the start of each. */
  events: SimEvent[];
}

/**
 * One player's controls for one tick. Look is absolute (the client owns the camera), and
 * crouch is the wanted stance: hold vs. toggle is the client's setting, not the sim's.
 */
export interface PlayerInput {
  /** Move stick, −1..1 each; moveY is forward. Longer than 1 is clamped. */
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  /** The trigger, held. */
  fire: boolean;
  /** Aiming down the sights, held (toggling is the client's setting). */
  aim: boolean;
  /** Start a reload: a press, true for one tick. */
  reload: boolean;
  /**
   * With reload: the round to load, of the gun's calibre (the reload button's picker).
   * Another than the one loaded swaps them. Left out, see reloadRound.
   */
  ammo?: string | null;
  /** Inventory actions to apply at the start of the tick, in order. */
  inventory?: readonly InventoryAction[];
  /** Take out a gun slot or the knife: a press. */
  draw?: Hand | null;
  /** Start using a carried med (a press), or stop using one. */
  use?: MedRef | 'cancel' | null;
  /** Open, close or unlock a door, by its index in world.doors: a press. */
  door?: number | null;
  /** Investigate the quest marker in reach (session 14b): a press. */
  investigate?: boolean;
}

/**
 * Inputs for one tick by entity. Enemies use their own (AiState.input) unless given one
 * here; anyone else with no input stands still.
 */
export type TickInputs = Readonly<Partial<Record<EntityId, PlayerInput>>>;

export function createState(seed: number): SimState {
  return {
    tick: 0,
    rng: createRng(seed),
    nextId: 1,
    entities: [],
    loot: [],
    ground: [],
    doors: [],
    raid: null,
    left: [],
    events: [],
  };
}

/**
 * Adds a standing character on the highest surface at (x, z), or below y if given, with
 * nothing but pockets (and a vault: players have one, enemies don't).
 */
export function spawnCharacter(
  state: SimState,
  world: CollisionWorld,
  x: number,
  z: number,
  yaw = 0,
  y = Infinity,
  vault = true,
): Character {
  const c: Character = {
    id: state.nextId++,
    kind: 'character',
    x,
    y: world.groundAt(x, z, MOVEMENT.radius, y),
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    mode: 'ground',
    height: MOVEMENT.standHeight,
    ladder: -1,
    jumpHeld: false,
    landingSpeed: 0,
    health: createHealth(),
    gear: createGear(vault),
    aim: 0,
    draw: 0,
    swing: 0,
    using: null,
    extracting: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    ai: null,
  };
  state.entities.push(c);
  return c;
}

export function entityById(state: SimState, id: EntityId): Entity | undefined {
  for (const e of state.entities) if (e.id === id) return e;
  return undefined;
}

export function eyeHeight(c: Character): number {
  return c.y + c.height - MOVEMENT.eyeBelowTop;
}

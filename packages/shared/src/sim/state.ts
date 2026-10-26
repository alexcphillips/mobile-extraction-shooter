import { createRng, type Rng } from '../rng';
import type { AiState } from './ai';
import type { CollisionWorld } from '../world/collision-world';
import {
  createHealth,
  type ArmourState,
  type DamageEvent,
  type DeathEvent,
  type Health,
} from './health';
import { MOVEMENT } from './movement';
import type { ShotEvent, WeaponState } from './weapons';

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
  helmet: ArmourState | null;
  bodyArmour: ArmourState | null;
  weapon: WeaponState | null;
  /** How far into aiming down the sights: 0 at the hip, 1 fully aimed. */
  aim: number;
  /** Recoil's kick to the view in radians, added to yaw and pitch; it settles back to 0. */
  recoilPitch: number;
  recoilYaw: number;
  /** An enemy's mind; null for players. */
  ai: AiState | null;
}

/** Only characters so far; items, loot and projectiles join this union later. */
export type Entity = Character;

/** Things that happened during the last tick, for effects and the HUD. */
export type SimEvent = ShotEvent | DamageEvent | DeathEvent;

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
}

/**
 * Inputs for one tick by entity. Enemies use their own (AiState.input) unless given one
 * here; anyone else with no input stands still.
 */
export type TickInputs = Readonly<Partial<Record<EntityId, PlayerInput>>>;

export function createState(seed: number): SimState {
  return { tick: 0, rng: createRng(seed), nextId: 1, entities: [], events: [] };
}

/** Adds a standing character on the highest surface at (x, z), or below y if given. */
export function spawnCharacter(
  state: SimState,
  world: CollisionWorld,
  x: number,
  z: number,
  yaw = 0,
  y = Infinity,
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
    helmet: null,
    bodyArmour: null,
    weapon: null,
    aim: 0,
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

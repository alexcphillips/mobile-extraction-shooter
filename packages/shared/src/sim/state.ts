import { createRng, type Rng } from '../rng';
import type { CollisionWorld } from '../world/collision-world';
import { MOVEMENT } from './movement';

export type EntityId = number;

export type MoveMode = 'ground' | 'air' | 'ladder';

/** A player or (later) AI body: a vertical capsule standing at (x, y, z). */
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
}

/** Only characters so far; items, loot and projectiles join this union later. */
export type Entity = Character;

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
}

/** Inputs for one tick by entity. Characters with no input stand still. */
export type TickInputs = Readonly<Partial<Record<EntityId, PlayerInput>>>;

export function createState(seed: number): SimState {
  return { tick: 0, rng: createRng(seed), nextId: 1, entities: [] };
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
  };
  state.entities.push(c);
  return c;
}

export function eyeHeight(c: Character): number {
  return c.y + c.height - MOVEMENT.eyeBelowTop;
}

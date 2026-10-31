import { meleeDef, type ItemDb } from '../content/items';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { shootCharacter } from './health';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import {
  entityById,
  eyeHeight,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';

const DEG = Math.PI / 180;

/** Knife tuning; its damage, reach and pace are in its item file. */
export const MELEE = {
  /**
   * A swing hits anything within this angle of the crosshair, up, down, left or right, so
   * it doesn't need a pixel-perfect aim on a phone.
   */
  fan: 10 * DEG,
} as const;

/** The directions a swing tries, in order (the crosshair first), as multiples of MELEE.fan. */
const FAN = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** A knife swing this tick, hit or miss. Silent: enemies only notice being hit. */
export interface SwingEvent {
  type: 'swing';
  by: EntityId;
  /** What it hit: nothing, the map, or a character (target). */
  hit: 'none' | 'world' | 'character';
  target: EntityId;
  /** Where it landed, or the end of its reach. */
  x: number;
  y: number;
  z: number;
}

// Scratch, so a swing allocates nothing but its event.
const worldHit = createRayHit();
const charHit = createCharacterHit();

/**
 * One tick of the knife: with it in hand and drawn, the trigger swings, as often as its
 * swing time allows. A swing lands at once on the first body part within reach along the
 * look (with recoil), or near it (MELEE.fan), and hurts like a shot. Not on a ladder, nor
 * while putting yourself out.
 */
export function updateMelee(
  state: SimState,
  c: Character,
  input: PlayerInput | undefined,
  world: CollisionWorld,
  items: ItemDb,
): void {
  if (c.swing > 0) c.swing = Math.max(0, c.swing - TICK_SECONDS);
  const knife = c.gear.hand === 'knife' ? c.gear.knife : null;
  if (
    !knife ||
    !input?.fire ||
    c.draw > 0 ||
    c.swing > 0 ||
    c.extinguish ||
    c.mode === 'ladder' ||
    c.mode === 'vault'
  )
    return;
  const def = meleeDef(items, knife.item);
  c.swing = def.swingTime;

  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;
  const yaw0 = c.yaw + c.recoilYaw;
  const pitch0 = c.pitch + c.recoilPitch;
  let hit: SwingEvent['hit'] = 'none';
  let d = def.reach;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  for (let i = 0; i < FAN.length; i++) {
    const yaw = yaw0 + FAN[i]![0] * MELEE.fan;
    const pitch = pitch0 + FAN[i]![1] * MELEE.fan;
    const cp = Math.cos(pitch);
    const rx = -Math.sin(yaw) * cp;
    const ry = Math.sin(pitch);
    const rz = -Math.cos(yaw) * cp;
    const wall = world.raycast(ox, oy, oz, rx, ry, rz, def.reach, worldHit);
    const reach = Math.min(wall, def.reach);
    const body = raycastCharacters(state, ox, oy, oz, rx, ry, rz, reach, c.id, charHit);
    if (i === 0 || body < Infinity) {
      dx = rx;
      dy = ry;
      dz = rz;
      d = Math.min(body, reach);
      hit = body < Infinity ? 'character' : wall < Infinity ? 'world' : 'none';
    }
    if (body < Infinity) break;
  }
  if (hit === 'character') {
    const target = entityById(state, charHit.id);
    if (target) shootCharacter(state, items, target, charHit.zone, def, c.id, 'melee');
  }
  state.events.push({
    type: 'swing',
    by: c.id,
    hit,
    target: hit === 'character' ? charHit.id : 0,
    x: ox + dx * d,
    y: oy + dy * d,
    z: oz + dz * d,
  });
}

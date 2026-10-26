import {
  ATTACHMENT_SLOTS,
  ammoDef,
  attachmentDef,
  fits,
  weaponDef,
  type AttachmentSlot,
  type ItemDb,
  type WeaponDef,
} from '../content/items';
import { nextFloat } from '../rng';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { HEALTH, brokenArms, shootCharacter } from './health';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import {
  entityById,
  eyeHeight,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';

const DT = TICK_SECONDS;
const DEG = Math.PI / 180;
/** Recoil never pushes the view up further than this, in radians. */
const MAX_RECOIL = 20 * DEG;

/** A carried gun. Reserve is the ammo carried for it until session 9's inventory. */
export interface WeaponState {
  item: string;
  /** Rounds in the gun. */
  mag: number;
  /** Spare rounds that reloading takes from. */
  reserve: number;
  /** Seconds until it can fire again; dips below 0 while the trigger is held, to keep the rate exact. */
  cooldown: number;
  /** Seconds left of a reload, or 0. */
  reloading: number;
  /** The trigger last tick, so semi-automatic guns fire once per pull. */
  triggerHeld: boolean;
  /** The attachment item in each slot, or null. */
  attachments: Record<AttachmentSlot, string | null>;
}

/** A gun's stats with its attachments' changes applied. */
export interface WeaponStats {
  magazine: number;
  reloadTime: number;
  aimTime: number;
  hipSpread: number;
  aimSpread: number;
  recoilUp: number;
  recoilSide: number;
  loudness: number;
}

export function createWeaponStats(): WeaponStats {
  return {
    magazine: 0,
    reloadTime: 0,
    aimTime: 0,
    hipSpread: 0,
    aimSpread: 0,
    recoilUp: 0,
    recoilSide: 0,
    loudness: 0,
  };
}

/** Works out a gun's stats with its attachments into out, allocating nothing. */
export function weaponStats(items: ItemDb, w: WeaponState, out: WeaponStats): WeaponStats {
  const def = weaponDef(items, w.item);
  out.magazine = def.magazine;
  out.reloadTime = def.reloadTime;
  out.aimTime = def.aimTime;
  out.hipSpread = def.hipSpread;
  out.aimSpread = def.aimSpread;
  out.recoilUp = def.recoil.up;
  out.recoilSide = def.recoil.side;
  out.loudness = def.loudness;
  for (const slot of ATTACHMENT_SLOTS) {
    const id = w.attachments[slot];
    const m = id === null ? undefined : attachmentDef(items, id).mods;
    if (!m) continue;
    out.magazine += m.magazine ?? 0;
    out.reloadTime *= m.reloadTime ?? 1;
    out.aimTime *= m.aimTime ?? 1;
    out.hipSpread *= m.spread ?? 1;
    out.aimSpread *= m.spread ?? 1;
    out.recoilUp *= m.recoil ?? 1;
    out.recoilSide *= m.recoil ?? 1;
    out.loudness *= m.loudness ?? 1;
  }
  return out;
}

/** A shot fired this tick, from the shooter's eye to where it stopped. */
export interface ShotEvent {
  type: 'shot';
  by: EntityId;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  /** What it hit: nothing (range ran out), the map, or a character (target). */
  hit: 'none' | 'world' | 'character';
  target: EntityId;
  /** How far away it can be heard, in metres (suppressors shrink it). */
  loudness: number;
}

// Scratch for working out stats, so a tick allocates nothing.
const stats = createWeaponStats();

/** Gives a character a gun with its attachments, a full magazine and some spare rounds. */
export function giveWeapon(
  c: Character,
  items: ItemDb,
  id: string,
  reserve: number,
  attachments: readonly string[] = [],
): void {
  const w: WeaponState = {
    item: id,
    mag: 0,
    reserve,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { optic: null, muzzle: null, magazine: null },
  };
  for (const a of attachments) attach(w, items, a);
  w.mag = weaponStats(items, w, stats).magazine;
  c.weapon = w;
}

/**
 * Puts an attachment on a gun, replacing whatever was in its slot. Throws if it doesn't
 * fit, so check with fits() first.
 */
export function attach(w: WeaponState, items: ItemDb, id: string): void {
  const a = attachmentDef(items, id);
  if (!fits(weaponDef(items, w.item), a)) throw new Error(`"${id}" doesn't fit "${w.item}"`);
  w.attachments[a.slot] = id;
  if (a.slot === 'magazine') magazineChanged(w, items);
}

/** Takes the attachment out of a slot, returning its item id (or null if it was empty). */
export function detach(w: WeaponState, items: ItemDb, slot: AttachmentSlot): string | null {
  const id = w.attachments[slot];
  w.attachments[slot] = null;
  if (slot === 'magazine') magazineChanged(w, items);
  return id;
}

/** Rounds that no longer fit go back to the spare ammo, and a reload in progress stops. */
function magazineChanged(w: WeaponState, items: ItemDb): void {
  const capacity = weaponStats(items, w, stats).magazine;
  if (w.mag > capacity) {
    w.reserve += w.mag - capacity;
    w.mag = capacity;
  }
  w.reloading = 0;
}

/** Spread and aim time are worse with broken arms. */
function armScale(c: Character, perArm: number): number {
  return perArm ** brokenArms(c.health);
}

/**
 * One tick of a character's gun: aiming in and out, recoil settling, reloading and
 * firing. Firing is blocked on a ladder and while reloading; pulling the trigger on an
 * empty gun starts a reload.
 */
export function updateWeapon(
  state: SimState,
  c: Character,
  input: PlayerInput | undefined,
  world: CollisionWorld,
  items: ItemDb,
): void {
  const w = c.weapon;
  if (!w) {
    c.aim = 0;
    return;
  }
  const def = weaponDef(items, w.item);
  const s = weaponStats(items, w, stats);
  const free = c.mode !== 'ladder';

  const aimStep = DT / (s.aimTime * armScale(c, HEALTH.brokenArmAimTime));
  const aiming = !!input?.aim && free;
  c.aim = Math.max(0, Math.min(1, c.aim + (aiming ? aimStep : -aimStep)));

  const settle = def.recoil.recovery * DEG * DT;
  c.recoilPitch = towardZero(c.recoilPitch, settle);
  c.recoilYaw = towardZero(c.recoilYaw, settle);

  if (w.reloading > 0) {
    w.reloading -= DT;
    if (w.reloading <= 0) {
      w.reloading = 0;
      const rounds = Math.min(s.magazine - w.mag, w.reserve);
      w.mag += rounds;
      w.reserve -= rounds;
    }
  } else if (input?.reload) {
    startReload(w, s);
  }

  const trigger = !!input?.fire && free;
  const pulled = trigger && !w.triggerHeld;
  w.triggerHeld = trigger;
  if (trigger && w.reloading === 0) {
    if (w.mag === 0) {
      startReload(w, s);
    } else if (def.fireMode === 'auto' || pulled) {
      // The epsilon stops rounding from delaying a shot by a tick.
      while (w.cooldown <= 1e-9 && w.mag > 0) {
        fire(state, c, def, s, w, world, items);
        w.cooldown += 60 / def.rpm;
        if (def.fireMode === 'semi') break;
      }
    }
  }
  // While the trigger is held a little overshoot carries over, so the rate stays exact.
  w.cooldown = Math.max(w.cooldown - DT, trigger ? -DT : 0);
}

function startReload(w: WeaponState, s: WeaponStats): void {
  if (w.mag < s.magazine && w.reserve > 0) w.reloading = s.reloadTime;
}

function towardZero(v: number, step: number): number {
  return v > 0 ? Math.max(0, v - step) : Math.min(0, v + step);
}

// Scratch, so firing allocates nothing but its event.
const worldHit = createRayHit();
const charHit = createCharacterHit();

function fire(
  state: SimState,
  c: Character,
  def: WeaponDef,
  s: WeaponStats,
  w: WeaponState,
  world: CollisionWorld,
  items: ItemDb,
): void {
  w.mag--;
  // A random point in a cone around where the view (with recoil) points.
  const spread =
    (s.hipSpread + (s.aimSpread - s.hipSpread) * c.aim) * DEG * armScale(c, HEALTH.brokenArmSpread);
  const off = spread * Math.sqrt(nextFloat(state.rng));
  const around = nextFloat(state.rng) * Math.PI * 2;
  const yaw = c.yaw + c.recoilYaw + off * Math.cos(around);
  const pitch = c.pitch + c.recoilPitch + off * Math.sin(around);
  const cp = Math.cos(pitch);
  const dx = -Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * cp;
  const ox = c.x;
  const oy = eyeHeight(c);
  const oz = c.z;

  const wd = world.raycast(ox, oy, oz, dx, dy, dz, def.range, worldHit);
  const cd = raycastCharacters(
    state,
    ox,
    oy,
    oz,
    dx,
    dy,
    dz,
    Math.min(wd, def.range),
    c.id,
    charHit,
  );
  const d = Math.min(wd, cd, def.range);
  let hit: ShotEvent['hit'] = 'none';
  if (cd < Infinity) {
    hit = 'character';
    const target = entityById(state, charHit.id);
    if (target) shootCharacter(state, items, target, charHit.zone, ammoDef(items, def.ammo), c.id);
  } else if (wd < Infinity) {
    hit = 'world';
  }
  state.events.push({
    type: 'shot',
    by: c.id,
    fromX: ox,
    fromY: oy,
    fromZ: oz,
    toX: ox + dx * d,
    toY: oy + dy * d,
    toZ: oz + dz * d,
    hit,
    target: hit === 'character' ? charHit.id : 0,
    loudness: s.loudness,
  });

  c.recoilPitch = Math.min(MAX_RECOIL, c.recoilPitch + s.recoilUp * DEG);
  c.recoilYaw += s.recoilSide * DEG * (nextFloat(state.rng) * 2 - 1);
}

import {
  ATTACHMENT_SLOTS,
  attachmentDef,
  calibreOf,
  fits,
  roundCalibre,
  roundOf,
  weaponDef,
  type AmmoDef,
  type AttachmentSlot,
  type ItemDb,
  type WeaponDef,
} from '../content/items';
import type { Item } from '../inventory/grid';
import { nextFloat } from '../rng';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { HEALTH, brokenArms, shootCharacter } from './health';
import { CARRIED_GRIDS, carriedAmmo, carriedGrid, equip, heldWeapon, stow, takeAmmo } from './gear';
import { dropItem } from './ground';
import { launchGrenade } from './grenades';
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
/** How fast recoil settles with no gun in hand (switched to the knife mid-burst), in radians per second. */
const UNARMED_RECOVERY = 15 * DEG;

/**
 * A gun, in a gear slot or in a grid. Reloading takes rounds from the ammo carried (see
 * gear.ts), of the round loaded (Item.loaded) or another of its calibre. The timers only
 * matter while it's in someone's hands.
 */
export interface WeaponState extends Item {
  /** Rounds in the gun. */
  mag: number;
  /** The round the reload in progress loads; another than the one loaded swaps them. */
  reloadWith?: string;
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
  /**
   * Which pellet of the round (shotgun shells fire several, one event each); 0 for the
   * first and for ordinary rounds. Sounds and muzzle flashes go with pellet 0 only.
   */
  pellet: number;
  /**
   * A grenade launcher's shot: the grenade's id (it flies as state.grenades), and the
   * shot goes nowhere (to is from, hit none). 0 for bullets.
   */
  grenade: number;
}

// Scratch for working out stats, so a tick allocates nothing.
const stats = createWeaponStats();

/** A new gun with its attachments and a full magazine of ammo (its own round if not given). */
export function createWeapon(
  items: ItemDb,
  id: string,
  attachments: readonly string[] = [],
  ammo?: string,
): WeaponState {
  const w: WeaponState = {
    item: id,
    count: 1,
    mag: 0,
    cooldown: 0,
    reloading: 0,
    triggerHeld: false,
    attachments: { optic: null, muzzle: null, magazine: null },
  };
  if (ammo !== undefined && ammo !== weaponDef(items, id).ammo) w.loaded = ammo;
  for (const a of attachments) attach(w, items, a);
  w.mag = weaponStats(items, w, stats).magazine;
  return w;
}

/** The round in a gun (or that its next reload keeps to): Item.loaded, else its own. */
export function loadedAmmo(items: ItemDb, gun: Item): string {
  return gun.loaded ?? weaponDef(items, gun.item).ammo;
}

/**
 * What a reload of w would load, or null with nothing to load: the round asked for, if
 * carried and of its calibre; else the one loaded, if any is carried; else the highest
 * level of its calibre carried. Infinite ammo loads what's asked for or what's loaded.
 */
export function reloadRound(
  c: Character,
  items: ItemDb,
  w: WeaponState,
  want?: string | null,
): string | null {
  const def = weaponDef(items, w.item);
  const calibre = calibreOf(items, def);
  const loaded = loadedAmmo(items, w);
  if (want) {
    const a = roundOf(items, want);
    const ok = !!a && roundCalibre(a) === calibre;
    if (ok && (freeAmmo(c, def) || carriedAmmo(c, want) > 0)) return want;
  }
  if (freeAmmo(c, def) || carriedAmmo(c, loaded) > 0) return loaded;
  let best: string | null = null;
  let bestLevel = 0;
  for (let i = 0; i < CARRIED_GRIDS; i++) {
    const grid = carriedGrid(c.gear, i);
    if (!grid) continue;
    for (const g of grid.items) {
      const a = roundOf(items, g.item.item);
      if (a && roundCalibre(a) === calibre && a.level > bestLevel) {
        best = a.id;
        bestLevel = a.level;
      }
    }
  }
  return best;
}

/**
 * Gives a character a new gun (see createWeapon) and takes it out, ready at once: a
 * pistol in the sidearm slot, anything else in the first primary. Replaces whatever was
 * there.
 */
export function giveWeapon(
  c: Character,
  items: ItemDb,
  id: string,
  attachments: readonly string[] = [],
  ammo?: string,
): WeaponState {
  const w = createWeapon(items, id, attachments, ammo);
  const slot = weaponDef(items, id).hold === 'pistol' ? 'sidearm' : 'primary1';
  equip(c, items, slot, w);
  c.gear.hand = slot;
  c.draw = 0;
  return w;
}

/**
 * Puts an attachment on a gun, replacing whatever was in its slot. Throws if it doesn't
 * fit, so check with fits() first. Returns the rounds that no longer fit (a smaller
 * magazine), which the caller should put somewhere.
 */
export function attach(w: WeaponState, items: ItemDb, id: string): number {
  const a = attachmentDef(items, id);
  if (!fits(weaponDef(items, w.item), a)) throw new Error(`"${id}" doesn't fit "${w.item}"`);
  w.attachments[a.slot] = id;
  return a.slot === 'magazine' ? magazineChanged(w, items) : 0;
}

/**
 * Takes the attachment out of a slot (read it from w.attachments first). Returns the
 * rounds that no longer fit, which the caller should put somewhere.
 */
export function detach(w: WeaponState, items: ItemDb, slot: AttachmentSlot): number {
  w.attachments[slot] = null;
  return slot === 'magazine' ? magazineChanged(w, items) : 0;
}

/** Rounds that no longer fit come out, and a reload in progress stops. */
function magazineChanged(w: WeaponState, items: ItemDb): number {
  const capacity = weaponStats(items, w, stats).magazine;
  const out = Math.max(0, w.mag - capacity);
  w.mag -= out;
  w.reloading = 0;
  return out;
}

/** Spread and aim time are worse with broken arms. */
function armScale(c: Character, perArm: number): number {
  return perArm ** brokenArms(c.health);
}

/**
 * One tick of a character's gun: aiming in and out, recoil settling, reloading and
 * firing. Firing is blocked on a ladder, while drawing and while reloading; pulling the
 * trigger on an empty gun starts a reload. Using a med keeps the gun lowered.
 */
export function updateWeapon(
  state: SimState,
  c: Character,
  input: PlayerInput | undefined,
  world: CollisionWorld,
  items: ItemDb,
): void {
  const w = heldWeapon(c);
  if (!w) {
    c.aim = 0;
    c.recoilPitch = towardZero(c.recoilPitch, UNARMED_RECOVERY * DT);
    c.recoilYaw = towardZero(c.recoilYaw, UNARMED_RECOVERY * DT);
    return;
  }
  const def = weaponDef(items, w.item);
  const s = weaponStats(items, w, stats);
  // Not on a ladder or vaulting, and not until it's drawn.
  const free = c.mode !== 'ladder' && c.mode !== 'vault' && c.draw === 0;

  const aimStep = DT / (s.aimTime * armScale(c, HEALTH.brokenArmAimTime));
  // Using a med lowers the gun.
  const aiming = !!input?.aim && free && !c.using;
  c.aim = Math.max(0, Math.min(1, c.aim + (aiming ? aimStep : -aimStep)));

  const settle = def.recoil.recovery * DEG * DT;
  c.recoilPitch = towardZero(c.recoilPitch, settle);
  c.recoilYaw = towardZero(c.recoilYaw, settle);

  if (w.reloading > 0) {
    w.reloading -= DT;
    if (w.reloading <= 0) finishReload(state, c, w, s, world, items);
  } else if (input?.reload && free) {
    startReload(c, items, w, s, input.ammo);
  }

  const trigger = !!input?.fire && free;
  const pulled = trigger && !w.triggerHeld;
  w.triggerHeld = trigger;
  if (trigger && w.reloading === 0) {
    if (w.mag === 0) {
      startReload(c, items, w, s);
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

/** Firing and reloading take no rounds: the infinite ammo cheat, or an admin spawner gun. */
const freeAmmo = (c: Character, def: WeaponDef): boolean =>
  !!c.admin?.infiniteAmmo || def.spawns !== undefined;

/** Starts a reload, unless there's nothing to load or it's full of the same round. */
function startReload(
  c: Character,
  items: ItemDb,
  w: WeaponState,
  s: WeaponStats,
  want?: string | null,
): void {
  const round = reloadRound(c, items, w, want);
  if (round === null) return;
  const swap = round !== loadedAmmo(items, w) && w.mag > 0;
  if (w.mag < s.magazine || swap) {
    w.reloading = s.reloadTime;
    w.reloadWith = round;
  }
}

/**
 * Loads the reload's round. Another round than the one loaded swaps them: the new rounds
 * are taken first, then the old ones go into what's carried, or at its feet with no room.
 */
function finishReload(
  state: SimState,
  c: Character,
  w: WeaponState,
  s: WeaponStats,
  world: CollisionWorld,
  items: ItemDb,
): void {
  w.reloading = 0;
  const round = w.reloadWith ?? loadedAmmo(items, w);
  delete w.reloadWith;
  const infinite = freeAmmo(c, weaponDef(items, w.item));
  if (round === loadedAmmo(items, w)) {
    w.mag += infinite ? s.magazine - w.mag : takeAmmo(c, round, s.magazine - w.mag);
    return;
  }
  const taken = infinite ? s.magazine : takeAmmo(c, round, s.magazine);
  if (taken === 0) return;
  const old = loadedAmmo(items, w);
  const out = w.mag;
  w.mag = taken;
  if (round === weaponDef(items, w.item).ammo) delete w.loaded;
  else w.loaded = round;
  if (out > 0 && !infinite) {
    const rounds = { item: old, count: out };
    if (stow(c, items, rounds) > 0) dropItem(state, c, rounds, world);
  }
}

function towardZero(v: number, step: number): number {
  return v > 0 ? Math.max(0, v - step) : Math.min(0, v + step);
}

/** How far short of where an admin spawner's shot stopped its enemy spawns, in metres. */
const SPAWN_BACK_OFF = 0.6;

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
  if (!freeAmmo(c, def)) w.mag--;
  // A random point in a cone around where the view (with recoil) points.
  const spread =
    (s.hipSpread + (s.aimSpread - s.hipSpread) * c.aim) * DEG * armScale(c, HEALTH.brokenArmSpread);
  const off = spread * Math.sqrt(nextFloat(state.rng));
  const around = nextFloat(state.rng) * Math.PI * 2;
  const yaw = c.yaw + c.recoilYaw + off * Math.cos(around);
  const pitch = c.pitch + c.recoilPitch + off * Math.sin(around);
  const ammo = roundOf(items, loadedAmmo(items, w))!;
  if (ammo.type === 'grenade') {
    // A launcher: the grenade flies from here as a thrown one does, only faster, and with
    // an impact fuse if the launcher arms it.
    const speed = def.launchSpeed ?? ammo.throwSpeed;
    const g = launchGrenade(state, c, world, ammo, yaw, pitch, speed, def.armDistance);
    state.events.push({
      type: 'shot',
      by: c.id,
      fromX: g.x,
      fromY: g.y,
      fromZ: g.z,
      toX: g.x,
      toY: g.y,
      toZ: g.z,
      hit: 'none',
      target: 0,
      loudness: s.loudness,
      pellet: 0,
      grenade: g.id,
    });
  } else if (!ammo.pellets) {
    castShot(state, c, yaw, pitch, def, s, ammo, world, items, 0);
  } else {
    const pelletSpread = (ammo.pelletSpread ?? 0) * DEG;
    for (let i = 0; i < ammo.pellets; i++) {
      // Each pellet strays from the shot's line in a cone of its own.
      const stray = pelletSpread * Math.sqrt(nextFloat(state.rng));
      const dir = nextFloat(state.rng) * Math.PI * 2;
      const py = yaw + stray * Math.cos(dir);
      castShot(state, c, py, pitch + stray * Math.sin(dir), def, s, ammo, world, items, i);
    }
  }

  c.recoilPitch = Math.min(MAX_RECOIL, c.recoilPitch + s.recoilUp * DEG);
  c.recoilYaw += s.recoilSide * DEG * (nextFloat(state.rng) * 2 - 1);
}

/** One bullet or pellet from the shooter's eye along yaw and pitch: hits and its event. */
function castShot(
  state: SimState,
  c: Character,
  yaw: number,
  pitch: number,
  def: WeaponDef,
  s: WeaponStats,
  ammo: AmmoDef,
  world: CollisionWorld,
  items: ItemDb,
  pellet: number,
): void {
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
    // An admin spawner's shots do no harm.
    if (target && !def.spawns) shootCharacter(state, items, target, charHit.zone, ammo, c.id);
  } else if (wd < Infinity) {
    hit = 'world';
  }
  if (def.spawns && hit !== 'none' && pellet === 0) {
    // Back from the wall or body it hit, so the new enemy stands clear of it, facing back.
    const back = Math.max(0, d - SPAWN_BACK_OFF);
    state.events.push({
      type: 'spawnRequest',
      by: c.id,
      enemy: def.spawns,
      x: ox + dx * back,
      y: oy + dy * back,
      z: oz + dz * back,
      yaw: Math.atan2(dx, dz),
    });
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
    pellet,
    grenade: 0,
  });
}

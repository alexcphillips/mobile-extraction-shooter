import {
  ATTACHMENT_SLOTS,
  ERGO,
  aimTimeAt,
  attachmentDef,
  caliberOf,
  ergonomicsOf,
  fits,
  isMagazine,
  magazineFed,
  roundCaliber,
  roundOf,
  stockFolds,
  swayAt,
  weaponDef,
  type AmmoDef,
  type AttachmentSlot,
  type ItemDb,
  type WeaponDef,
} from '../content/items';
import { addItem, removeAt, type Grid, type Item } from '../inventory/grid';
import { nextFloat } from '../rng';
import { TICK_SECONDS } from '../tick';
import { createRayHit, type CollisionWorld } from '../world/collision-world';
import { HEALTH, badlyHurt, brokenArms, shootCharacter } from './health';
import {
  CARRIED_GRIDS,
  QUICK_GRIDS,
  carriedAmmo,
  carriedGrid,
  equip,
  heldWeapon,
  stow,
  takeAmmo,
} from './gear';
import { dropItem } from './ground';
import { cameOffGun } from './raid';
import { GLASS, breakGlass, glassHit } from './glass';
import { createCharacterHit, raycastCharacters } from './hit-zones';
import { RECOIL, kickRecoil, settleRecoil } from './recoil';
import { STAMINA, staminaBreath } from './stamina';
import {
  entityById,
  eyeHeight,
  eyeX,
  eyeZ,
  type Character,
  type EntityId,
  type PlayerInput,
  type SimState,
} from './state';

const DT = TICK_SECONDS;
const DEG = Math.PI / 180;
/** How far a gun sways standing still, aimed, in radians. */
const SWAY_YAW = 0.35 * DEG;
const SWAY_PITCH = 0.25 * DEG;
/** Sway at walking speed and up, as a multiple of standing still. */
const SWAY_MOVING = 2;
const SWAY_WALK_SPEED = 3;
/** Sway per broken arm, added to 1. */
const SWAY_BROKEN_ARM = 2;
/** Low stamina (PS-1): under STAMINA.breathFrom, sway grows to this added to 1 when empty. */
const SWAY_TIRED = 0.8;
/**
 * Badly hurt (PS-1, HEALTH.badlyHurt): a faint, fast tremor on top of the sway, in radians.
 * It's the hands, so held breath doesn't steady it. Two frequencies (rad/s) so it never
 * settles into a rhythm; the tick (30 Hz) samples it a few times a shake, which reads as jitter.
 */
const TREMOR_YAW = 0.07 * DEG;
const TREMOR_PITCH = 0.05 * DEG;
const TREMOR_FREQ_A = 31;
const TREMOR_FREQ_B = 47;
/**
 * The furthest a gun lags behind turning, in radians. Cut from 1.5° and 1° on 2026-11-11 for
 * mouse and thumb alike (the user's call: tracking a strafing target missed two in three).
 */
const MAX_LAG_YAW = 0.4 * DEG;
const MAX_LAG_PITCH = 0.25 * DEG;
/** How long the lag takes to settle, as a share of the gun's aim time: heavy guns lag longer. */
const LAG_PER_AIM_TIME = 0.2;
/** The aim time used with nothing in hand. */
const UNARMED_AIM_TIME = 0.3;
/**
 * Breath (BW-1, 2026-11-12): aiming in holds it, which steadies a still player's sway until it
 * runs out; then a short exhale wobble and today's sway while it slowly refills, holding again
 * when the gun comes back up. The breath button (BW-2) lets it go and holds it again by hand.
 * First guesses.
 */
export const BREATH = {
  /** How long a full breath holds, in seconds (4 to 8 on 2026-11-12, the user's call). */
  hold: 8,
  /** Seconds from empty to full while not aimed. */
  refill: 3,
  /** Seconds from empty to full while aimed and breathing (the user's call, 2026-11-12). */
  aimedRefill: 12,
  /** Idle sway while held, as a share of normal. */
  steady: 0.25,
  /** Seconds for the sway to settle when held, and to come back when let go. */
  ease: 0.3,
  /** The wobble when it runs out: how long, and the extra sway at its peak. */
  exhale: 0.7,
  exhaleWobble: 0.6,
  /** Faster than this (m/s) and holding your breath spends it without steadying the gun. */
  stillSpeed: 0.5,
} as const;

/**
 * A gun, in a gear slot or in a grid. Reloading takes rounds from the ammo carried (see
 * gear.ts), of the round loaded (Item.loaded) or another of its caliber. The timers only
 * matter while it's in someone's hands.
 */
export interface WeaponState extends Item {
  /** Rounds in the gun. */
  mag: number;
  /** The round the reload in progress loads; another than the one loaded swaps them. */
  reloadWith?: string;
  /**
   * The reload in progress was started by hand from the inventory (looting.ts's loadGun),
   * so it takes from the backpack too, not only pockets and rig (QUICK_GRIDS).
   */
  reloadByHand?: true;
  /** Seconds until it can fire again; dips below 0 while the trigger is held, to keep the rate exact. */
  cooldown: number;
  /** Seconds left of a reload, or 0. */
  reloading: number;
  /** The trigger last tick, so semi-automatic guns fire once per pull. */
  triggerHeld: boolean;
  /**
   * The reload in progress is a fast one (MG-1, a double-tap): quicker, and the magazine
   * taken out is dropped on the ground.
   */
  reloadQuick?: true;
  /**
   * An enemy's reload of loose rounds into the magazine in its gun (MG-3): it had no
   * loaded magazine in reach (RELOAD.aiLoosePerRound).
   */
  reloadLoose?: true;
  /** The attachment item in each slot, or null. */
  attachments: Record<AttachmentSlot, string | null>;
}

/** A gun's stats with its attachments' changes applied. */
export interface WeaponStats {
  magazine: number;
  reloadTime: number;
  /** Handling with its attachments' points (ERGO): sets aim time and aimed sway. */
  ergonomics: number;
  aimTime: number;
  hipSpread: number;
  aimSpread: number;
  recoilUp: number;
  recoilSide: number;
  recoilSnap: number;
  /** Which way up kicks, in degrees off straight up (+ right). */
  recoilAngle: number;
  /** The round past which a burst stops climbing; 0 never. */
  recoilStableAfter: number;
  /** The gun's recoil recovery with its attachments' recovery. */
  recoilRecovery: number;
  loudness: number;
}

export function createWeaponStats(): WeaponStats {
  return {
    magazine: 0,
    reloadTime: 0,
    ergonomics: 0,
    aimTime: 0,
    hipSpread: 0,
    aimSpread: 0,
    recoilUp: 0,
    recoilSide: 0,
    recoilSnap: 0,
    recoilAngle: 0,
    recoilStableAfter: 0,
    recoilRecovery: 0,
    loudness: 0,
  };
}

/** Rounds a magazine holds by its id, or 0 for none or a part that holds none. */
function capacityOf(items: ItemDb, id: string | null): number {
  if (id === null) return 0;
  const def = attachmentDef(items, id);
  return isMagazine(def) ? def.capacity : 0;
}

/** Works out a gun's stats with its attachments into out, allocating nothing. */
export function weaponStats(items: ItemDb, w: WeaponState, out: WeaponStats): WeaponStats {
  const def = weaponDef(items, w.item);
  // A magazine-fed gun holds what its magazine does, nothing without one (MG-1).
  out.magazine = magazineFed(def) ? capacityOf(items, w.attachments.magazine) : def.magazine;
  out.reloadTime = def.reloadTime;
  out.ergonomics = ergonomicsOf(items, w);
  out.aimTime = aimTimeAt(out.ergonomics);
  out.hipSpread = def.hipSpread;
  out.aimSpread = def.aimSpread;
  out.recoilUp = def.recoil.up;
  out.recoilSide = def.recoil.side;
  out.recoilSnap = def.recoil.snap;
  out.recoilAngle = def.recoil.angle ?? 0;
  out.recoilStableAfter = def.recoil.stableAfter ?? 0;
  out.recoilRecovery = def.recoil.recovery;
  out.loudness = def.loudness;
  for (const slot of ATTACHMENT_SLOTS) {
    const id = w.attachments[slot];
    // A folded stock counts as not there (WF-1).
    if (slot === 'stock' && w.folded) continue;
    const m = id === null ? undefined : attachmentDef(items, id).mods;
    if (!m) continue;
    out.magazine += m.magazine ?? 0;
    out.reloadTime *= m.reloadTime ?? 1;
    out.aimTime *= m.aimTime ?? 1;
    out.hipSpread *= (m.spread ?? 1) * (m.hipSpread ?? 1);
    out.aimSpread *= m.spread ?? 1;
    out.recoilUp *= (m.recoil ?? 1) * (m.recoilUp ?? 1);
    out.recoilSide *= (m.recoil ?? 1) * (m.recoilSide ?? 1);
    out.recoilRecovery *= m.recovery ?? 1;
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
  /** How far away it can be heard, in meters (suppressors shrink it). */
  loudness: number;
  /**
   * Which pellet of the round (shotgun shells fire several, one event each); 0 for the
   * first and for ordinary rounds. Sounds and muzzle flashes go with pellet 0 only.
   */
  pellet: number;
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
    attachments: { optic: null, muzzle: null, magazine: null, laser: null, stock: null },
  };
  const def = weaponDef(items, id);
  if (ammo !== undefined && ammo !== def.ammo) w.loaded = ammo;
  // What it comes with (its own stock), then what was asked for over it.
  for (const a of Object.values(def.defaults ?? {})) attach(w, items, a);
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
 * in reach (pockets and rig: QUICK_GRIDS) and of its caliber; else the one loaded, if any
 * is in reach; else the highest level of its caliber in reach. Infinite ammo loads what's asked for or what's loaded.
 */
export function reloadRound(
  c: Character,
  items: ItemDb,
  w: WeaponState,
  want?: string | null,
): string | null {
  const def = weaponDef(items, w.item);
  const caliber = caliberOf(items, def);
  const loaded = loadedAmmo(items, w);
  if (want) {
    const a = roundOf(items, want);
    const ok = !!a && roundCaliber(a) === caliber;
    if (ok && (freeAmmo(c, def) || carriedAmmo(c, want) > 0)) return want;
  }
  if (freeAmmo(c, def) || carriedAmmo(c, loaded) > 0) return loaded;
  let best: string | null = null;
  let bestLevel = 0;
  for (let i = 0; i < QUICK_GRIDS; i++) {
    const grid = carriedGrid(c.gear, i);
    if (!grid) continue;
    for (const g of grid.items) {
      const a = roundOf(items, g.item.item);
      if (a && roundCaliber(a) === caliber && a.level > bestLevel) {
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
  if (slot === 'stock') delete w.folded;
  return slot === 'magazine' ? magazineChanged(w, items) : 0;
}

/**
 * Folds or unfolds a gun's stock (WF-1), if it has one that folds; returns whether it
 * changed. Doesn't check grid room: the inventory action does (looting.ts).
 */
export function setFolded(w: Item, items: ItemDb, folded: boolean): boolean {
  if (!stockFolds(items, w) || !!w.folded === folded) return false;
  if (folded) w.folded = true;
  else delete w.folded;
  return true;
}

/** Rounds that no longer fit come out, and a reload in progress stops. */
function magazineChanged(w: WeaponState, items: ItemDb): number {
  const capacity = weaponStats(items, w, stats).magazine;
  const out = Math.max(0, w.mag - capacity);
  w.mag -= out;
  w.reloading = 0;
  return out;
}

/**
 * Takes the part out of a gun's slot, as a loose item (MG-1): a magazine with the rounds
 * in it, the gun left with none; anything else bare, with the rounds the gun hands back
 * (a tube extension off). The caller puts both somewhere.
 */
export function partOut(
  w: WeaponState,
  items: ItemDb,
  slot: AttachmentSlot,
): { part: Item; rounds: number } {
  const id = w.attachments[slot];
  if (id === null) throw new Error(`nothing in the ${slot} slot`);
  const part: Item = { item: id, count: 1 };
  if (!isMagazine(attachmentDef(items, id))) return { part, rounds: detach(w, items, slot) };
  if (w.mag > 0) {
    part.mag = w.mag;
    part.loaded = loadedAmmo(items, w);
  }
  w.attachments.magazine = null;
  w.mag = 0;
  w.reloading = 0;
  delete w.loaded;
  return { part, rounds: 0 };
}

/**
 * Puts a loose part on a gun: a magazine with its rounds into an empty magazine slot
 * (MG-1), anything else as attach does. Returns the rounds that no longer fit.
 */
export function partIn(w: WeaponState, items: ItemDb, part: Item): number {
  const def = attachmentDef(items, part.item);
  if (!isMagazine(def)) return attach(w, items, def.id);
  if (!fits(weaponDef(items, w.item), def)) throw new Error(`"${def.id}" doesn't fit "${w.item}"`);
  w.attachments.magazine = def.id;
  w.mag = part.mag ?? 0;
  w.reloading = 0;
  if (part.loaded && part.loaded !== weaponDef(items, w.item).ammo) w.loaded = part.loaded;
  else delete w.loaded;
  return 0;
}

/**
 * Whether c's reloads of a gun take magazine items (MG-1): a magazine-fed gun without
 * free ammo. Enemies too since
 * MG-3; with no loaded magazine in reach they load loose rounds into the one in the gun
 * (reloadLoose).
 */
export function usesMagazines(state: SimState, c: Character, def: WeaponDef): boolean {
  return magazineFed(def) && !freeAmmo(c, def);
}

/**
 * Whether a reload of w would load anything (the AI asks before reloading): a magazine in
 * reach with more rounds than the one in; for an enemy with none, loose rounds of its
 * caliber; without magazines, reloadRound's.
 */
export function canReload(state: SimState, c: Character, items: ItemDb, w: WeaponState): boolean {
  const def = weaponDef(items, w.item);
  if (!usesMagazines(state, c, def)) return reloadRound(c, items, w) !== null;
  if (findMagazine(c, items, def, QUICK_GRIDS, loadedAmmo(items, w))) {
    const best = foundGrid!.items[foundIndex]!.item;
    if (w.attachments.magazine === null || worthSwap(c, items, w, best)) return true;
  }
  return looseReload(c, items, w);
}

/**
 * Whether a reload should swap w's magazine for `best`: it has more rounds; and for an
 * enemy (MG-4), it's full or w is under half, so it doesn't swap for a round or two and
 * spread its rounds thin over its magazines.
 */
function worthSwap(c: Character, items: ItemDb, w: WeaponState, best: Item): boolean {
  const def = attachmentDef(items, best.item);
  const cap = def.capacity ?? 0;
  const n = magRounds(c, best, cap, loadedAmmo(items, w));
  if (n <= w.mag) return false;
  if (!c.ai) return true;
  return n >= cap || w.mag < weaponStats(items, w, looseStats).magazine / 2;
}

/**
 * An enemy with no fuller magazine in reach, but loose rounds and a magazine in its gun
 * with room: it loads them into that one (MG-3), as reloads did before magazines.
 */
function looseReload(c: Character, items: ItemDb, w: WeaponState): boolean {
  if (!c.ai || w.attachments.magazine === null) return false;
  if (w.mag >= weaponStats(items, w, looseStats).magazine) return false;
  const round = reloadRound(c, items, w);
  // One round type in a magazine: another only into an empty one.
  return round !== null && (w.mag === 0 || round === loadedAmmo(items, w));
}
const looseStats = createWeaponStats();

// The magazine findMagazine found, so a search allocates nothing.
let foundGrid: Grid | null = null;
let foundIndex = -1;

/**
 * The rounds a magazine counts for in a reload: its own; for an enemy (MG-4, the user's
 * call), topped up to full from its loose rounds of the magazine's round (an empty one's,
 * `round`: the gun's), since its reload fills the magazine it loads (finishReload).
 */
function magRounds(c: Character, m: Item, capacity: number, round: string): number {
  const n = m.mag ?? 0;
  if (!c.ai || n >= capacity) return n;
  return Math.min(capacity, n + carriedAmmo(c, n > 0 && m.loaded ? m.loaded : round));
}

/**
 * The fullest loaded magazine for a gun in c's first `grids` carried grids (pockets, then
 * rig, ...), of the round asked for if any is; sets foundGrid and foundIndex. The first
 * found wins a tie, so pockets before rig. Fullness is magRounds' (`round`: the gun's).
 */
function findMagazine(
  c: Character,
  items: ItemDb,
  gun: WeaponDef,
  grids: number,
  round: string,
  want?: string | null,
): boolean {
  foundGrid = null;
  foundIndex = -1;
  let best = 0;
  let bestWanted = false;
  for (let i = 0; i < grids; i++) {
    const grid = carriedGrid(c.gear, i);
    if (!grid) continue;
    for (let j = 0; j < grid.items.length; j++) {
      const m = grid.items[j]!.item;
      if ((m.mag ?? 0) === 0 && !c.ai) continue;
      const def = items.get(m.item);
      if (!def || !isMagazine(def) || !fits(gun, def)) continue;
      const n = magRounds(c, m, def.capacity, round);
      if (n === 0) continue;
      const wanted = !!want && m.loaded === want;
      if ((bestWanted && !wanted) || (wanted === bestWanted && n <= best)) continue;
      best = n;
      bestWanted = wanted;
      foundGrid = grid;
      foundIndex = j;
    }
  }
  return foundGrid !== null;
}

/**
 * Rounds in reach for the gun's next reload, for the HUD: in the magazines that fit it
 * (pockets and rig) when c reloads with magazines, else loose rounds of the one loaded.
 */
export function spareRounds(state: SimState, c: Character, items: ItemDb, w: WeaponState): number {
  const def = weaponDef(items, w.item);
  if (!usesMagazines(state, c, def)) return carriedAmmo(c, loadedAmmo(items, w));
  let n = 0;
  for (let i = 0; i < QUICK_GRIDS; i++) {
    const grid = carriedGrid(c.gear, i);
    if (!grid) continue;
    for (const g of grid.items) {
      const m = items.get(g.item.item);
      if (m && isMagazine(m) && fits(def, m)) n += g.item.mag ?? 0;
    }
  }
  return n;
}

/** How a fast reload goes (MG-1): its share of the reload time. */
export const RELOAD = {
  quick: 0.7,
  /**
   * Extra seconds a round when an enemy with no loaded magazine loads loose rounds into
   * the one in its gun (MG-3). 0: as quick as a reload was before magazines. PACKING's
   * 0.45 would make it pack them as a player must.
   */
  aiLoosePerRound: 0,
};

/** Spread and aim time are worse with broken arms. */
function armScale(c: Character, perArm: number): number {
  return perArm ** brokenArms(c.health);
}

/**
 * A player's gun off the view this tick: the sim's, so shots and co-op hosts agree. Sway
 * comes from the tick rather than the random numbers, and enemies have none. `aiming` is
 * whether they're aiming in, which holds their breath. The gun's ergonomics scale its idle
 * sway (ERGO); the lag when turning follows its aim time.
 */
function updateSway(
  state: SimState,
  c: Character,
  aimTime: number,
  ergonomics: number,
  aiming: boolean,
  breathe = false,
): void {
  if (c.ai) return;
  const breath = updateBreath(c, aiming, breathe);
  const lookYaw = c.lookYaw ?? c.yaw;
  let turn = c.yaw - lookYaw;
  turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
  const tilt = c.pitch - (c.lookPitch ?? c.pitch);
  c.lookYaw = c.yaw;
  c.lookPitch = c.pitch;
  const keep = Math.exp(-DT / (aimTime * LAG_PER_AIM_TIME));
  const lagYaw = ((c.lagYaw ?? 0) - turn) * keep;
  const lagPitch = ((c.lagPitch ?? 0) - tilt) * keep;
  c.lagYaw = Math.max(-MAX_LAG_YAW, Math.min(MAX_LAG_YAW, lagYaw));
  c.lagPitch = Math.max(-MAX_LAG_PITCH, Math.min(MAX_LAG_PITCH, lagPitch));
  const t = state.tick * DT;
  const moving = Math.min(1, Math.hypot(c.vx, c.vz) / SWAY_WALK_SPEED);
  // Feeling hurt (PS-1): broken arms, low stamina and being badly hurt. Painkillers
  // (planned, not built) will hide the arms and the tremor while they last.
  const tired = Math.max(0, 1 - (c.stamina ?? 1) / STAMINA.breathFrom);
  const shake =
    (1 + brokenArms(c.health) * SWAY_BROKEN_ARM) *
    (1 + tired * SWAY_TIRED) *
    (1 + (SWAY_MOVING - 1) * moving) *
    swayAt(ergonomics) *
    breath;
  let tremorYaw = 0;
  let tremorPitch = 0;
  if (badlyHurt(c.health)) {
    tremorYaw = (Math.sin(t * TREMOR_FREQ_A) + Math.sin(t * TREMOR_FREQ_B)) * 0.5 * TREMOR_YAW;
    tremorPitch =
      (Math.sin(t * TREMOR_FREQ_B + 1) + Math.sin(t * TREMOR_FREQ_A * 1.3)) * 0.5 * TREMOR_PITCH;
  }
  c.swayYaw = c.aim * (c.lagYaw + Math.sin(t * 1.3) * SWAY_YAW * shake + tremorYaw);
  c.swayPitch = c.aim * (c.lagPitch + Math.sin(t * 2.1) * SWAY_PITCH * shake + tremorPitch);
}

/**
 * A player's breath this tick, returned as a scale on idle sway: under 1 while held and still,
 * over 1 in the wobble when it runs out. It's spent while aiming in, moving or not. Once out,
 * it refills slowly while still aimed and stays out, full or not, until the breath button
 * (`breathe`) holds it again; the button also lets a held breath go, with no wobble. With the
 * gun down it refills faster, but tapping aim off and on still gives back only a little.
 */
function updateBreath(c: Character, aiming: boolean, breathe: boolean): number {
  let breath = c.breath ?? BREATH.hold;
  let exhale = Math.max(0, (c.exhale ?? 0) - DT);
  let out = !!c.breathOut;
  // Low stamina (BW-4) spends it faster and refills it slower.
  const lungs = staminaBreath(c);
  if (aiming && breathe && breath > 0) out = !out;
  if (!aiming) {
    out = false;
    breath = Math.min(BREATH.hold, breath + (DT * BREATH.hold * lungs) / BREATH.refill);
  } else if (out) {
    breath = Math.min(BREATH.hold, breath + (DT * BREATH.hold * lungs) / BREATH.aimedRefill);
  } else {
    breath = Math.max(0, breath - DT / lungs);
    if (breath === 0) {
      out = true;
      exhale = BREATH.exhale;
    }
  }
  const still = Math.hypot(c.vx, c.vz) < BREATH.stillSpeed;
  const toward = aiming && !out && still ? 1 : 0;
  const step = DT / BREATH.ease;
  const held = c.steady ?? 0;
  const steady = toward > held ? Math.min(toward, held + step) : Math.max(toward, held - step);
  c.breath = breath;
  if (out) c.breathOut = true;
  else delete c.breathOut;
  c.exhale = exhale;
  c.steady = steady;
  const ease = steady * steady * (3 - 2 * steady);
  const wobble = BREATH.exhaleWobble * Math.sin((Math.PI * exhale) / BREATH.exhale);
  return (1 - (1 - BREATH.steady) * ease) * (1 + wobble);
}

/**
 * One tick of a character's gun: aiming in and out, reloading, firing and recoil settling
 * (after firing, so an enemy's pull against its recoil, set last tick, is exact). Firing is blocked on a ladder, while drawing, reloading and putting yourself out
 * (which blocks aiming and reloading too); pulling the trigger on an empty gun starts a
 * reload. Using a med keeps the gun lowered.
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
    updateSway(state, c, UNARMED_AIM_TIME, ERGO.swayAt, false);
    settleRecoil(c, RECOIL.unarmedSnap, RECOIL.unarmedRecovery, false);
    return;
  }
  const def = weaponDef(items, w.item);
  const s = weaponStats(items, w, stats);
  const kick = RECOIL.scale * (input?.thumb ? RECOIL.thumb : 1);
  s.recoilUp *= kick;
  s.recoilSide *= kick;
  // Not on a ladder or vaulting, nor until it's drawn.
  const free = c.mode !== 'ladder' && c.mode !== 'vault' && c.draw === 0;

  // Broken arms and worn gear (GZ-1, players only) slow aiming in.
  const aimStep =
    DT / (s.aimTime * armScale(c, HEALTH.brokenArmAimTime) * (c.burden?.aimTime ?? 1));
  // Using a med lowers the gun.
  const aiming = !!input?.aim && free && !c.using;
  c.aim = Math.max(0, Math.min(1, c.aim + (aiming ? aimStep : -aimStep)));
  updateSway(state, c, s.aimTime, s.ergonomics, aiming, !!input?.breathe);

  const quick = !!input?.quickReload && usesMagazines(state, c, def);
  if (w.reloading > 0) {
    // A double-tap during a reload makes it a fast one: what's left of it is cut short.
    if (quick && !w.reloadQuick) {
      w.reloadQuick = true;
      w.reloading = Math.max(DT, w.reloading - s.reloadTime * (1 - RELOAD.quick));
    }
    w.reloading -= DT;
    if (w.reloading <= 0) finishReload(state, c, w, s, world, items);
  } else if ((input?.reload || quick) && free) {
    startReload(state, c, items, w, s, input?.ammo, quick);
  }

  const trigger = !!input?.fire && free;
  const pulled = trigger && !w.triggerHeld;
  w.triggerHeld = trigger;
  if (trigger && w.reloading === 0) {
    if (w.mag === 0) {
      startReload(state, c, items, w, s);
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
  settleRecoil(c, s.recoilSnap, s.recoilRecovery, trigger);
}

/**
 * Firing and reloading take no rounds: the infinite ammo cheat or an admin spawner gun.
 */
const freeAmmo = (c: Character, def: WeaponDef): boolean =>
  !!c.admin?.infiniteAmmo || def.spawns !== undefined;

/**
 * Starts a reload, unless there's nothing to load or it's full of the same round. With
 * magazines (usesMagazines), unless no magazine in reach has more rounds than the one in
 * (any will do with none in); quick is a fast reload.
 */
function startReload(
  state: SimState,
  c: Character,
  items: ItemDb,
  w: WeaponState,
  s: WeaponStats,
  want?: string | null,
  quick = false,
): void {
  const def = weaponDef(items, w.item);
  if (usesMagazines(state, c, def)) {
    const found = findMagazine(c, items, def, QUICK_GRIDS, loadedAmmo(items, w), want);
    const best = found ? foundGrid!.items[foundIndex]!.item : null;
    const better =
      !!best && (worthSwap(c, items, w, best) || (!!want && best.loaded !== loadedAmmo(items, w)));
    if (!(w.attachments.magazine === null ? found : better)) {
      // An enemy loads loose rounds into the magazine in its gun instead, at a reload's
      // time (plus RELOAD.aiLoosePerRound a round, 0 for now: MG-3 measured that scavs,
      // most without a rig to carry magazines, reloaded in 15 s rather than 2.5).
      if (!looseReload(c, items, w)) return;
      const round = reloadRound(c, items, w)!;
      const n = Math.min(s.magazine - w.mag, carriedAmmo(c, round));
      w.reloading = s.reloadTime + n * RELOAD.aiLoosePerRound;
      w.reloadWith = round;
      w.reloadLoose = true;
      delete w.reloadQuick;
      delete w.reloadByHand;
      return;
    }
    delete w.reloadLoose;
    w.reloading = s.reloadTime * (quick ? RELOAD.quick : 1);
    if (quick) w.reloadQuick = true;
    else delete w.reloadQuick;
    if (want) w.reloadWith = want;
    else delete w.reloadWith;
    delete w.reloadByHand;
    return;
  }
  const round = reloadRound(c, items, w, want);
  if (round === null) return;
  const swap = round !== loadedAmmo(items, w) && w.mag > 0;
  if (w.mag < s.magazine || swap) {
    w.reloading = s.reloadTime;
    w.reloadWith = round;
    delete w.reloadByHand;
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
  const want = w.reloadWith;
  const round = want ?? loadedAmmo(items, w);
  const grids = w.reloadByHand ? CARRIED_GRIDS : QUICK_GRIDS;
  const quick = !!w.reloadQuick;
  delete w.reloadWith;
  delete w.reloadByHand;
  delete w.reloadQuick;
  const loose = !!w.reloadLoose;
  delete w.reloadLoose;
  const def = weaponDef(items, w.item);
  if (usesMagazines(state, c, def) && !loose) {
    // The fullest magazine in reach now (things may have moved since it started).
    const gunRound = loadedAmmo(items, w);
    if (!findMagazine(c, items, def, QUICK_GRIDS, gunRound, want)) return;
    const mag = foundGrid!.items[foundIndex]!.item;
    removeAt(foundGrid!, foundIndex);
    if (c.ai) {
      // An enemy's fills up as it goes in (MG-4): from its loose rounds of its round.
      const round = (mag.mag ?? 0) > 0 && mag.loaded ? mag.loaded : gunRound;
      const cap = attachmentDef(items, mag.item).capacity ?? 0;
      const n = takeAmmo(c, round, cap - (mag.mag ?? 0));
      if (n > 0) {
        mag.mag = (mag.mag ?? 0) + n;
        mag.loaded = round;
      }
    }
    const old = w.attachments.magazine !== null ? partOut(w, items, 'magazine').part : null;
    partIn(w, items, mag);
    if (!old) return;
    cameOffGun(c, old);
    // Back into pockets or rig; a fast reload, or no room, drops it.
    let left = old.count;
    for (let i = 0; i < QUICK_GRIDS && left > 0 && !quick; i++) {
      const grid = carriedGrid(c.gear, i);
      if (grid) left = addItem(items, grid, old);
    }
    if (left > 0) dropItem(state, c, old, world);
    return;
  }
  const infinite = freeAmmo(c, def);
  if (round === loadedAmmo(items, w)) {
    w.mag += infinite ? s.magazine - w.mag : takeAmmo(c, round, s.magazine - w.mag, grids);
    return;
  }
  const taken = infinite ? s.magazine : takeAmmo(c, round, s.magazine, grids);
  if (taken === 0) return;
  const old = loadedAmmo(items, w);
  const out = w.mag;
  w.mag = taken;
  if (round === weaponDef(items, w.item).ammo) delete w.loaded;
  else w.loaded = round;
  if (out > 0 && !infinite) {
    const rounds = cameOffGun(c, { item: old, count: out });
    if (stow(c, items, rounds) > 0) dropItem(state, c, rounds, world);
  }
}

/** How far short of where an admin spawner's shot stopped its enemy spawns, in meters. */
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
  // A random point in a cone around where the gun (view, recoil and sway) points.
  const spread =
    (s.hipSpread + (s.aimSpread - s.hipSpread) * c.aim) * DEG * armScale(c, HEALTH.brokenArmSpread);
  const off = spread * Math.sqrt(nextFloat(state.rng));
  const around = nextFloat(state.rng) * Math.PI * 2;
  const yaw = c.yaw + c.recoilYaw + (c.swayYaw ?? 0) + off * Math.cos(around);
  const pitch = c.pitch + c.recoilPitch + (c.swayPitch ?? 0) + off * Math.sin(around);
  const ammo = roundOf(items, loadedAmmo(items, w))!;
  if (!ammo.pellets) {
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

  kickRecoil(state, c, s.recoilUp, s.recoilSide, s.recoilAngle, s.recoilStableAfter);
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
  const ox = eyeX(c);
  const oy = eyeHeight(c);
  const oz = eyeZ(c);

  let wd = world.raycast(ox, oy, oz, dx, dy, dz, def.range, worldHit);
  // Glass in the way breaks and the shot goes on, unless it hits someone before it.
  for (let n = 0; n < GLASS.maxPerShot; n++) {
    const pane = glassHit(world, worldHit);
    if (pane < 0) break;
    if (raycastCharacters(state, ox, oy, oz, dx, dy, dz, wd, c.id, charHit) < Infinity) break;
    breakGlass(state, world, pane, c.id);
    wd = world.raycast(ox, oy, oz, dx, dy, dz, def.range, worldHit);
  }
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
    if (target && !def.spawns) {
      shootCharacter(
        state,
        items,
        target,
        charHit.zone,
        ammo,
        c.id,
        'shot',
        c.x,
        c.z,
        charHit.face,
      );
    }
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
  });
}

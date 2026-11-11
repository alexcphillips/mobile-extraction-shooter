import { TICK_RATE, ZONE_NAMES, type DamageEvent } from '@mes/shared';

/**
 * What hurt you in a raid, for the results screen after a death: one row per enemy and
 * weapon (shot or knife), plus falls, bleeding and burning (one row per whoever lit you).
 * Plain JSON, so it's saved with the raid for resuming.
 */
export interface DamageSource {
  /** `${entity}:shot`, `${entity}:melee`, `${entity}:fire`, 'fall' or 'bleeding'. */
  key: string;
  /** What to call it: the enemy type ("Jug"), "Fall" or "Bleeding". */
  name: string;
  cause: DamageEvent['cause'] | 'bleed' | 'fire';
  hits: number;
  /** HP lost, spillover to the chest included. */
  damage: number;
  /** What armour took. */
  absorbed: number;
  /** Zones hit, by name, in the order first hit. */
  zones: string[];
  /** The source of the hit that killed you. */
  killed: boolean;
}

export type DamageLog = DamageSource[];

function sourceFor(log: DamageLog, key: string, name: string, cause: DamageSource['cause']) {
  let s = log.find((x) => x.key === key);
  if (!s) {
    s = { key, name, cause, hits: 0, damage: 0, absorbed: 0, zones: [], killed: false };
    log.push(s);
  }
  return s;
}

/** Records a hit you took; name is the shooter's (unused for a fall). Returns its key. */
export function logHit(log: DamageLog, e: DamageEvent, name: string): string {
  const key = e.cause === 'fall' ? 'fall' : `${e.by}:${e.cause}`;
  const s = sourceFor(log, key, e.cause === 'fall' ? 'Fall' : name, e.cause);
  // A blast hurts every zone at once, head first: one hit, not six.
  if (e.cause !== 'explosion' || e.zone === 0) s.hits++;
  s.damage += e.amount;
  s.absorbed += e.absorbed;
  const zone = ZONE_NAMES[e.zone]!;
  if (!s.zones.includes(zone)) s.zones.push(zone);
  return key;
}

/** Adds HP lost to bleeding. */
export function logBleed(log: DamageLog, amount: number): void {
  if (amount > 0) sourceFor(log, 'bleeding', 'Bleeding', 'bleed').damage += amount;
}

/** The key of burning lit by someone (fire has no damage events: it's HP lost a tick). */
export const fireKey = (by: number): string => `${by}:fire`;

/**
 * Adds HP lost to burning lit by someone (name: "Scav", or the player's own), and with
 * lit, being set alight once more.
 */
export function logBurn(log: DamageLog, by: number, name: string, amount: number, lit = false) {
  const s = sourceFor(log, fireKey(by), name, 'fire');
  if (lit) s.hits++;
  if (amount > 0) s.damage += amount;
}

/** Marks what killed you. */
export function logKiller(log: DamageLog, key: string): void {
  for (const s of log) s.killed = s.key === key;
}

/** One line for a source: "Jug shot you 4 times for 142 (head, chest) · armour took 30". */
export function describeSource(s: DamageSource): string {
  const hp = Math.round(s.damage);
  if (s.cause === 'bleed') return `Bleeding took ${hp}`;
  const times = s.hits === 1 ? 'once' : `${s.hits} times`;
  if (s.cause === 'fire') return `${s.name} set you alight ${times} · burning took ${hp}`;
  const verb =
    s.cause === 'melee'
      ? 'stabbed you'
      : s.cause === 'fall'
        ? 'hurt you'
        : s.cause === 'explosion'
          ? 'blew you up'
          : 'shot you';
  const what = s.cause === 'fall' ? `A fall ${verb}` : `${s.name} ${verb}`;
  const armour = s.absorbed >= 1 ? ` · armour took ${Math.round(s.absorbed)}` : '';
  return `${what} ${times} for ${hp} (${s.zones.join(', ')})${armour}`;
}

/**
 * One hit, or one tick's hits (a shotgun's pellets, a blast's zones), between you and an
 * enemy, either way: the results screen lists the fight with whoever killed you, hit by
 * hit (2026-11-10). Plain JSON, saved with the raid like DamageLog.
 */
export interface FightHit {
  tick: number;
  /** The enemy's entity. */
  other: number;
  /** You hit them (else they hit you). */
  dealt: boolean;
  cause: DamageEvent['cause'];
  /** Zones hit, by name, in order. */
  zones: string[];
  hits: number;
  damage: number;
  absorbed: number;
  /** Their hit that killed you. */
  killing?: true;
  /** Metres between shooter and target, when it landed (2026-11-11). */
  distance?: number;
  /** The shooter's gun (or knife) and the round, item ids, when known (2026-11-11). */
  weapon?: string;
  ammo?: string;
}

/** What logFight can't see in a DamageEvent: how far, and with what. */
export interface FightInfo {
  distance?: number;
  weapon?: string;
  ammo?: string;
}

export type FightLog = FightHit[];

/** Enough for any one fight; the oldest go first. */
const FIGHT_CAP = 500;

/** Records a hit between you and someone else; falls and your own grenade aren't a fight. */
export function logFight(
  log: FightLog,
  e: DamageEvent,
  you: number,
  tick: number,
  info?: FightInfo,
): void {
  const dealt = e.by === you;
  if (dealt === (e.target === you) || e.by === 0) return;
  // A hit doing nothing (a body already dead, a tutorial dummy) isn't part of it.
  if (e.amount <= 0 && e.absorbed <= 0) return;
  const other = dealt ? e.target : e.by;
  const last = log[log.length - 1];
  const zone = ZONE_NAMES[e.zone]!;
  if (
    last &&
    last.tick === tick &&
    last.other === other &&
    last.dealt === dealt &&
    last.cause === e.cause
  ) {
    if (e.cause !== 'explosion') last.hits++;
    last.damage += e.amount;
    last.absorbed += e.absorbed;
    if (!last.zones.includes(zone)) last.zones.push(zone);
    return;
  }
  log.push({
    tick,
    other,
    dealt,
    cause: e.cause,
    zones: [zone],
    hits: 1,
    damage: e.amount,
    absorbed: e.absorbed,
    ...info,
  });
  if (log.length > FIGHT_CAP) log.shift();
}

/** Marks their latest hit on you as the one that killed you. */
export function logKillingHit(log: FightLog, other: number): void {
  for (let i = log.length - 1; i >= 0; i--) {
    const h = log[i]!;
    if (h.other === other && !h.dealt) {
      h.killing = true;
      return;
    }
  }
}

/** The fight with one enemy, newest hit first. */
export const fightWith = (log: FightLog, other: number): FightHit[] =>
  log.filter((h) => h.other === other).reverse();

/** Hits more than 30 s apart are separate fights. */
export const COMBAT_GAP_TICKS = 30 * TICK_RATE;

/**
 * The latest fight, with everyone in it, newest hit first (2026-11-11): back from the last
 * hit while each is within COMBAT_GAP_TICKS of the one after it.
 */
export function lastCombat(log: FightLog, gap = COMBAT_GAP_TICKS): FightHit[] {
  const out: FightHit[] = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const h = log[i]!;
    const next = out[out.length - 1];
    if (next && next.tick - h.tick > gap) break;
    out.push(h);
  }
  return out;
}

/** One row: "You shot Scav · head, chest ×2 · 48 · armour took 12". */
export function describeFightHit(h: FightHit, name: string): string {
  const verb = h.cause === 'melee' ? 'stabbed' : h.cause === 'explosion' ? 'blew up' : 'shot';
  const who = h.dealt ? `You ${verb} ${name}` : `${name} ${verb} you`;
  const times = h.hits > 1 ? ` ×${h.hits}` : '';
  const armour = h.absorbed >= 1 ? ` · armour took ${Math.round(h.absorbed)}` : '';
  return `${who} · ${h.zones.join(', ')}${times} · ${Math.round(h.damage)}${armour}`;
}

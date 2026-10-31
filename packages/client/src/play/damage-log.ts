import { ZONE_NAMES, type DamageEvent } from '@mes/shared';

/**
 * What hurt you in a raid, for the results screen after a death: one row per enemy and
 * weapon (shot or knife), plus falls and bleeding. Plain JSON, so it's saved with the
 * raid for resuming.
 */
export interface DamageSource {
  /** `${entity}:shot`, `${entity}:melee`, 'fall' or 'bleeding'. */
  key: string;
  /** What to call it: the enemy type ("Yard boss"), "Fall" or "Bleeding". */
  name: string;
  cause: DamageEvent['cause'] | 'bleed';
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

/** Marks what killed you. */
export function logKiller(log: DamageLog, key: string): void {
  for (const s of log) s.killed = s.key === key;
}

/** One line for a source: "Yard boss shot you 4 times for 142 (head, chest) · armour took 30". */
export function describeSource(s: DamageSource): string {
  const hp = Math.round(s.damage);
  if (s.cause === 'bleed') return `Bleeding took ${hp}`;
  const times = s.hits === 1 ? 'once' : `${s.hits} times`;
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

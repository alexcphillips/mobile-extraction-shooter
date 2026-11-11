import type { CompiledMap, CompiledMarker } from '../content/compile';
import { chance, nextIntIn, type Rng } from '../rng';

/*
 * Which spawn markers are used this raid, rolled once at raid start with the raid's RNG.
 * Loot and enemy spawns share the rules: of the markers sharing a `oneOf` name only one,
 * picked at random, is used, and each used one then rolls its `chance` (1 if left out).
 */

type Rolled = { type: string; id: string; oneOf?: string; unit?: string };

/** What a group picks a marker by: its placed prefab's path if that copy is in a group. */
export const unitOf = (m: { id: string; unit?: string | undefined }): string => m.unit ?? m.id;

/**
 * The units (unitOf) of the markers of a type picked from their `oneOf` groups: `pick`
 * of each (counts, by name; one if not named), or all of them if there are fewer. A
 * placed prefab in a group is one unit, however many spots it holds. Names are map-wide
 * and per type: a loot spawn's group never takes in an enemy spawn.
 */
export function oneOfPicks(
  rng: Rng,
  markers: readonly CompiledMarker[],
  type: 'lootSpawn' | 'enemySpawn',
  counts?: Readonly<Record<string, { pick: number }>>,
): Set<string> {
  const groups = new Map<string, Set<string>>();
  for (const m of markers as readonly Rolled[]) {
    if (m.type !== type || m.oneOf === undefined) continue;
    const units = groups.get(m.oneOf);
    if (units) units.add(unitOf(m));
    else groups.set(m.oneOf, new Set([unitOf(m)]));
  }
  const picked = new Set<string>();
  for (const [name, set] of groups) {
    const units = [...set];
    const pick = Math.min(counts?.[name]?.pick ?? 1, units.length);
    // A partial shuffle: the first `pick` are a random choice (one draw for a pick of one).
    for (let i = 0; i < pick; i++) {
      const j = nextIntIn(rng, i, units.length - 1);
      [units[i], units[j]] = [units[j]!, units[i]!];
      picked.add(units[i]!);
    }
  }
  return picked;
}

type EnemySpawn = Extract<CompiledMarker, { type: 'enemySpawn' }>;

/** The enemy spawns that put an enemy in this raid, in map order. */
export function rollEnemySpawns(rng: Rng, map: CompiledMap): EnemySpawn[] {
  const picked = oneOfPicks(rng, map.markers, 'enemySpawn');
  const out: EnemySpawn[] = [];
  for (const m of map.markers) {
    if (m.type !== 'enemySpawn') continue;
    if (m.oneOf !== undefined && !picked.has(m.id)) continue;
    if (chance(rng, m.chance ?? 1)) out.push(m);
  }
  return out;
}

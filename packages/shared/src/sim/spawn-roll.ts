import type { CompiledMap, CompiledMarker } from '../content/compile';
import { chance, nextIntIn, type Rng } from '../rng';

/*
 * Which spawn markers are used this raid, rolled once at raid start with the raid's RNG.
 * Loot and enemy spawns share the rules: of the markers sharing a `oneOf` name only one,
 * picked at random, is used, and each used one then rolls its `chance` (1 if left out).
 */

type Rolled = { type: string; id: string; oneOf?: string };

/**
 * The ids of the markers of a type picked from their `oneOf` groups. Names are map-wide
 * and per type: a loot spawn's group never takes in an enemy spawn.
 */
export function oneOfPicks(
  rng: Rng,
  markers: readonly CompiledMarker[],
  type: 'lootSpawn' | 'enemySpawn',
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const m of markers as readonly Rolled[]) {
    if (m.type !== type || m.oneOf === undefined) continue;
    const ids = groups.get(m.oneOf);
    if (ids) ids.push(m.id);
    else groups.set(m.oneOf, [m.id]);
  }
  const picked = new Set<string>();
  for (const ids of groups.values()) picked.add(ids[nextIntIn(rng, 0, ids.length - 1)]!);
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

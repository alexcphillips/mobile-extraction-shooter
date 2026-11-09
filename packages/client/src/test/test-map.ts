import { MAP_FORMAT, compileMap, loadContent, type CompiledMap } from '@mes/shared';
import raw from './test-map.json';

/*
 * A small map for tests only (2026-11-09, the user's call): 32 m of flat ground with a
 * player spawn, an extraction, a bit of cover, and a walled room with a door, a crate, a
 * quest marker and a scav. It isn't in content/maps, so it's never a raid, never in the
 * map editor, and no test has to compile Northpoint just to stand somewhere. It uses no
 * prefabs. Migrated on load like any map, so a format change only needs its migration.
 */
export function loadTestMap(): CompiledMap {
  return compileMap(loadContent(MAP_FORMAT, structuredClone(raw), 'test/test-map.json'), new Map());
}

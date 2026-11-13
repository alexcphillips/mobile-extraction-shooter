// The kit's tests' sim (MK-6, 2026-11-12): a small map from a few nodes, compiled with the
// real prefabs into the game's collision world and nav grid, a character walked through it,
// and whether the AI can get from one place to another. The level-design.md way of checking
// ("verify movement in the sim instead of reasoning about it"), kept for the kit's pieces.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { importTs, readContent, SHARED } from './import-ts.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
export const lib = await importTs([SHARED]);

let prefabs;
function loadPrefabs() {
  if (!prefabs) {
    const files = {};
    for (const f of readdirSync(resolve(ROOT, 'content/prefabs')))
      if (f.endsWith('.json')) files[`content/prefabs/${f}`] = readContent(`prefabs/${f}`);
    prefabs = lib.loadById(lib.PREFAB_FORMAT, files);
  }
  return prefabs;
}

/** Flat ground at y over [-size, size] in x and z, 2 m cells. */
export function flatTerrain(y = 0, size = 40) {
  const n = size; // cells per side (2 m each)
  return {
    origin: [-size, -size],
    cellSize: 2,
    heights: Array.from({ length: n + 1 }, () => Array(n + 1).fill(y)),
    color: '#7a7a4c',
  };
}

/**
 * Compiles a map of these nodes (validated as a map file) into the sim's world and nav.
 * @returns {{ map: any, world: any, nav: any }}
 */
export function build(nodes, terrain = flatTerrain()) {
  const raw = {
    formatVersion: lib.MAP_FORMAT_VERSION,
    id: 'kit-test',
    name: 'Kit test',
    environment: { sky: '#a9b2b6', fogNear: 45, fogFar: 120 },
    terrain,
    nodes: structuredClone(nodes),
    zones: [],
  };
  const map = lib.loadById(lib.MAP_FORMAT, { 'content/maps/kit-test.json': raw }).get('kit-test');
  const compiled = lib.compileMap(map, loadPrefabs());
  const world = new lib.CollisionWorld(compiled.world);
  return { map: compiled, world, nav: new lib.NavGrid(world) };
}

/**
 * Whether the AI's nav joins the surfaces nearest two points ([x, y, z] each). Small closed
 * places count as they are (nearest() would otherwise look past one to a bigger area).
 */
export function joined(nav, a, b) {
  const na = nav.nearest(...a, lib.NAV.climb, true);
  const nb = nav.nearest(...b, lib.NAV.climb, true);
  if (na < 0 || nb < 0) return false;
  return nav.component[na] === nav.component[nb];
}

const TICK = 1 / lib.TICK_RATE;

/**
 * A character walked (or sprinted) from `from` toward each point in turn, steering at it
 * every tick; stops at each within 0.5 m, or gives up after `seconds`. Returns where it
 * ended, the highest it got, and whether it reached the last point.
 */
export function walk(world, from, to, { sprint = false, seconds = 30 } = {}) {
  const state = lib.createState(1);
  const c = lib.spawnCharacter(state, world, from[0], from[2], 0, from[1] + 0.5);
  const goals = Array.isArray(to[0]) ? to : [to];
  let g = 0;
  let top = c.y;
  for (let t = 0; t < seconds / TICK && g < goals.length; t++) {
    const [gx, , gz] = goals[g];
    const dx = gx - c.x;
    const dz = gz - c.z;
    if (Math.hypot(dx, dz) < 0.5) {
      g++;
      continue;
    }
    const yaw = Math.atan2(-dx, -dz);
    lib.step(state, world, new Map(), {
      [c.id]: {
        moveX: 0,
        moveY: 1,
        yaw,
        pitch: 0,
        sprint,
        crouch: false,
        jump: false,
        fire: false,
        aim: false,
        reload: false,
      },
    });
    top = Math.max(top, c.y);
  }
  return { x: c.x, y: c.y, z: c.z, top, reached: g >= goals.length };
}

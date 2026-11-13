// Scratch: compile District with the real compiler and nav, time it, and ask the nav which
// places join the test spawn. Not a test (yet): DS-2's check, kept for DS-3 to grow.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { lib, joined, walk } from './mapkit/sim.mjs';
import { readContent } from './mapkit/import-ts.mjs';
import { frame } from './mapkit/frame.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const files = {};
for (const f of readdirSync(resolve(ROOT, 'content/prefabs')))
  if (f.endsWith('.json')) files[`content/prefabs/${f}`] = readContent(`prefabs/${f}`);
const prefabs = lib.loadById(lib.PREFAB_FORMAT, files);
const raw = readContent('maps/district.json');
let t = performance.now();
const map = lib.loadById(lib.MAP_FORMAT, { 'content/maps/district.json': raw }).get('district');
const compiled = lib.compileMap(map, prefabs);
const tCompile = performance.now() - t;
t = performance.now();
const world = new lib.CollisionWorld(compiled.world);
const nav = new lib.NavGrid(world);
const tNav = performance.now() - t;
console.log(
  `compile ${tCompile.toFixed(0)} ms, world+nav ${tNav.toFixed(0)} ms, boxes ${compiled.world.boxes.length}`,
);

const layout = lib.loadLayout(readContent('layouts/district.json'), 'layout');
const A = (id) => layout.areas.find((a) => a.id === id);
/** The ground as the game grades it (the map's own terrain since RD-1, not the layout's). */
const ground = new lib.HeightGrid(compiled.world.terrain);
/** An area's floor as gen-district.mjs sets it: its y, or the highest ground under it. */
const floorY = (a, k = 0) => {
  let hi = -Infinity;
  const f = frame(a);
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++)
      hi = Math.max(hi, ground.heightAt(...f.toWorld(a.w * (i / 8 - 0.5), a.d * (j / 8 - 0.5))));
  return Math.round((a.y ?? hi) * 100) / 100 + k * a.floorHeight;
};
/** A point inside an area at local (lx, lz) on floor k. */
const P = (id, lx = 0, lz = 0, k = 0) => {
  const a = A(id);
  const [x, z] = frame(a).toWorld(lx, lz);
  return [x, floorY(a, k) + 0.1, z];
};
const spawn = raw.nodes.find((n) => n.name === 'Spawns').nodes[0].pos;
const places = {
  'mall ground floor': P('mall-main', 0, -20),
  'mall upper floor': P('mall-main', 0, -25, 1),
  'mall roof terrace': P('mall-main', 10, 10, 2),
  'dept upper floor': P('mall-dept', 10, -15, 1),
  'cinema upper': P('mall-cinema', 5, -5, 1),
  'plaza level (promenade)': (() => {
    const z = layout.zones.find((q) => q.id === 'promenade').points;
    const [x, zz] = [z.reduce((a, p) => a + p[0], 0) / 4, z.reduce((a, p) => a + p[1], 0) / 4];
    return [x, ground.heightAt(x, zz) + 0.1, zz];
  })(),
  'garage deck 1': P('garage', 0, 15, 0),
  'garage deck 2 (bridge)': P('garage', 0, 15, 1),
  'garage top deck': P('garage', 0, 15, 3),
  'bank upper': P('plaza-bank', 3, 0, 1),
  'hotel floor 3': P('hotel-main', 5, 0, 2),
  'office block 1': P('cons-block', -10, 0, 0),
  'office block 2': P('cons-block', -10, 0, 1),
  'office block 3': P('cons-block', -10, 0, 2),
  'office block top': P('cons-block', -10, 0, 3),
  warehouse: P('svc-warehouse', 0, 0),
  'furniture upper': P('furn-store', 10, 0, 1),
  'station hall upper': P('rail-hall', 5, 0, 1),
  'platform 2 (island)': P('rail-island', 20, 0),
  'platform 1': P('rail-platform', 20, 0),
  'footbridge deck': P('rail-footbridge', 0, 0),
  'tracks (by the train)': (() => {
    const p = P('rail-train', 0, 14, 0);
    return [p[0], ground.heightAt(p[0], p[2]) + 0.1, p[2]];
  })(),
  'goods shed': P('rail-goods', 0, 0),
  grocery: P('strip-grocery', 0, 0),
  'gas station shop': P('gas-kiosk', 0, 0),
  'aid tent': P('outpost-tent', 0, 0),
};
const rows = [];
for (const [name, p] of Object.entries(places))
  rows.push({
    place: name,
    at: p.map((v) => Math.round(v * 10) / 10).join(', '),
    joined: joined(nav, spawn, p),
  });
console.table(rows);
if (process.argv.includes('--walk')) {
  const w = walk(world, spawn, places['mall ground floor'], { seconds: 120 });
  console.log('walk to the mall', w.reached, w);
}

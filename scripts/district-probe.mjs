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
const floorY = (a, k = 0) => (a.y ?? lib.heightAt(layout, a.x, a.z)) + k * a.floorHeight;
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
    return [x, 15.6, zz];
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
  'tracks (cut floor)': P('rail-train', 0, 14, 0).map((v, i) => (i === 1 ? 8.1 : v)),
  'goods shed': P('rail-goods', 0, 0),
  grocery: P('strip-grocery', 0, 0),
  'gas station shop': P('gas-kiosk', 0, 0),
  'aid tent': P('outpost-tent', 0, 0),
};
// The culvert's floor and the drain's middle, from the map's own nodes.
const find = (name) => {
  const stack = [...raw.nodes];
  while (stack.length) {
    const n = stack.pop();
    if (n.name === name) return n;
    if (n.nodes) stack.push(...n.nodes);
  }
};
const drainMid = find('drain-24');
places['storm drain'] = [drainMid.pos[0], drainMid.pos[1] + 0.1, drainMid.pos[2]];
for (const n of ['drain-2', 'drain-pit']) {
  const d = find(n);
  places[n] = [d.pos[0], d.pos[1] + 0.1, d.pos[2]];
}
places['culvert floor'] = (() => {
  const d = find('drain-1');
  return [302.5, d.pos[1] + 0.1, 253];
})();
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
if (process.argv.includes('--drain')) {
  const out = [];
  for (let k = 1; ; k++) {
    const d = find(`drain-${k}`);
    if (!d) break;
    const p = [d.pos[0], d.pos[1] + 0.1, d.pos[2]];
    const n = nav.nearest(...p, lib.NAV.climb, true);
    out.push(`${k}:${joined(nav, spawn, p) ? 'y' : 'n'}${n < 0 ? '?' : ''}@${d.pos[1]}`);
  }
  console.log(out.join(' '));
}

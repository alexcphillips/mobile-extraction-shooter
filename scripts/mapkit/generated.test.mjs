import { readFileSync } from 'node:fs';
import { mapSchema } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { merge, report } from './generated.mjs';

const box = (x, extra = {}) => ({ type: 'box', pos: [x, 0, 0], size: [1, 1, 1], ...extra });
const group = (name, nodes, extra = {}) => ({ type: 'group', name, ...extra, nodes });

/** A tiny generated map: two areas, one holding a building. */
const script = (v = {}) => ({
  formatVersion: 4,
  id: 't',
  name: 'T',
  terrain: { heights: v.heights ?? [0, 0] },
  nodes: [
    group('West', [box(v.west ?? 1), group('Shed', [box(v.shed ?? 2)])]),
    group('East', [box(3)]),
    ...(v.extra ?? []),
  ],
});
const by = 'scripts/gen-t.mjs';
const first = () => merge(null, script(), { by }).map;
const status = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.status]));
const find = (nodes, key) => {
  for (const n of nodes) {
    if (n.type !== 'group') continue;
    if (n.gen === key) return n;
    const inside = find(n.nodes, key);
    if (inside) return inside;
  }
  return undefined;
};

describe('generated maps (MK-2)', () => {
  it('keys groups by name path and records their hashes', () => {
    const m = first();
    expect(m.nodes.map((n) => n.gen)).toEqual(['west', 'east']);
    expect(find(m.nodes, 'west/shed')).toBeTruthy();
    expect(Object.keys(m.generated.groups)).toEqual(['west', 'west/shed', 'east']);
    expect(Object.keys(m.generated.fields)).toEqual(['name', 'terrain']);
    expect(Object.keys(m.nodes[0])).toEqual(['type', 'name', 'gen', 'nodes']);
  });

  it('a re-run with nothing changed writes the same map', () => {
    const m = first();
    const again = merge(m, script(), { by });
    expect(again.map).toEqual(m);
    expect(report(again.rows)).toBe('5 unchanged');
  });

  it("replaces the script's groups, keeps the ones edited by hand", () => {
    const m = first();
    find(m.nodes, 'east').nodes[0].pos = [9, 0, 0]; // moved by hand
    const { map, rows } = merge(m, script({ west: 5 }), { by });
    expect(status(rows)).toMatchObject({ west: 'updated', 'west/shed': 'same', east: 'kept' });
    expect(find(map.nodes, 'west').nodes[0].pos).toEqual([5, 0, 0]);
    expect(find(map.nodes, 'east').nodes[0].pos).toEqual([9, 0, 0]);
    // Still the user's next time, even with nothing new from the script.
    expect(status(merge(map, script({ west: 5 }), { by }).rows).east).toBe('kept');
  });

  it('a group inside counts as its own: editing it leaves its parent to the script', () => {
    const m = first();
    find(m.nodes, 'west/shed').pos = [0, 0, 4];
    const { map, rows } = merge(m, script({ west: 5, shed: 7 }), { by });
    expect(status(rows)).toMatchObject({ west: 'updated', 'west/shed': 'kept' });
    expect(rows.find((r) => r.key === 'west/shed').note).toMatch(/changed too/);
    const shed = find(map.nodes, 'west/shed');
    expect(shed.pos).toEqual([0, 0, 4]);
    expect(shed.nodes[0].pos).toEqual([2, 0, 0]);
  });

  it("keeps the user's own nodes, and a group they added to is theirs", () => {
    const m = first();
    m.nodes.push(group('My test', [box(50)]));
    find(m.nodes, 'east').nodes.push(box(60));
    const { map, rows } = merge(m, script(), { by });
    expect(status(rows).east).toBe('kept');
    expect(map.nodes.map((n) => n.name)).toEqual(['West', 'East', 'My test']);
    expect(find(map.nodes, 'east').nodes).toHaveLength(2);
  });

  it("doesn't put back a group deleted by hand, and removes what the script dropped", () => {
    const m = merge(null, script({ extra: [group('North', [box(4)])] }), { by }).map;
    m.nodes = m.nodes.filter((n) => n.gen !== 'east');
    const { map, rows } = merge(m, script(), { by });
    expect(status(rows)).toMatchObject({ east: 'deleted', north: 'removed' });
    expect(map.nodes.map((n) => n.gen)).toEqual(['west']);
    expect(status(merge(map, script(), { by }).rows).east).toBe('deleted');
    // Reclaimed, it comes back.
    expect(merge(map, script(), { by, reclaim: ['east'] }).map.nodes.map((n) => n.gen)).toEqual([
      'west',
      'east',
    ]);
  });

  it('keeps a group the script dropped if it was edited by hand', () => {
    const m = merge(null, script({ extra: [group('North', [box(4)])] }), { by }).map;
    find(m.nodes, 'north').nodes.push(box(8));
    const { map, rows } = merge(m, script(), { by });
    expect(rows.find((r) => r.key === 'north')).toMatchObject({ status: 'kept' });
    expect(find(map.nodes, 'north')).toBeTruthy();
  });

  it('adds new groups next to their neighbor, also inside a group the user owns', () => {
    const m = first();
    find(m.nodes, 'west').nodes.push(box(70)); // west is now the user's
    const fresh = script();
    fresh.nodes.splice(1, 0, group('Middle', [box(10)]));
    fresh.nodes[0].nodes.push(group('Barn', [box(11)]));
    const { map, rows } = merge(m, fresh, { by });
    expect(status(rows)).toMatchObject({ west: 'kept', middle: 'new', 'west/barn': 'new' });
    expect(map.nodes.map((n) => n.gen)).toEqual(['west', 'middle', 'east']);
    expect(find(map.nodes, 'west').nodes.map((n) => n.gen ?? n.pos[0])).toEqual([
      1,
      'west/shed',
      'west/barn',
      70,
    ]);
  });

  it('reclaims a group and what it holds', () => {
    const m = first();
    find(m.nodes, 'west').nodes.push(box(70));
    find(m.nodes, 'west/shed').pos = [0, 0, 4];
    const { map, rows } = merge(m, script(), { by, reclaim: ['west'] });
    expect(status(rows)).toMatchObject({ west: 'updated', 'west/shed': 'updated' });
    expect(map).toEqual(first());
  });

  it('keeps fields edited by hand (the terrain sculpted)', () => {
    const m = first();
    m.terrain.heights = [0, 1];
    m.water = { level: 0 }; // the user's own field
    const { map, rows } = merge(m, script({ heights: [2, 2] }), { by });
    expect(status(rows)).toMatchObject({ terrain: 'kept', name: 'same' });
    expect(map.terrain.heights).toEqual([0, 1]);
    expect(map.water).toEqual({ level: 0 });
  });

  it("a copied group's key is the copy's only once: the second one is the user's", () => {
    const m = first();
    m.nodes.push(structuredClone(m.nodes[1]));
    const { map } = merge(m, script(), { by });
    expect(map.nodes.map((n) => n.gen)).toEqual(['west', 'east', undefined]);
  });

  it('takes over a map from before records: what matches is the script’s, the rest kept', () => {
    const old = structuredClone(script());
    old.nodes[1].nodes[0].pos = [9, 0, 0];
    old.nodes.push(group('Test (test placement)', [box(80)]));
    const { map, rows } = merge(old, script(), { by });
    expect(status(rows)).toMatchObject({ west: 'same', 'west/shed': 'same', east: 'kept' });
    expect(map.nodes.map((n) => n.name)).toEqual(['West', 'East', 'Test (test placement)']);
    expect(map.generated.groups.east).toBe(first().generated.groups.east);
  });

  it("Silver Creek's map, taken over, still passes the map schema", () => {
    const file = new URL('../../content/maps/silver-creek.json', import.meta.url);
    const sc = JSON.parse(readFileSync(file, 'utf8'));
    const fresh = structuredClone(sc);
    delete fresh.generated;
    const strip = (ns) => ns.forEach((n) => n.type === 'group' && (delete n.gen, strip(n.nodes)));
    strip(fresh.nodes);
    const { map, rows } = merge(sc, fresh, { by });
    expect(rows.every((r) => r.status === 'same')).toBe(true);
    expect(mapSchema.safeParse(map).success).toBe(true);
  });
});

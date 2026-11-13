// The prefab catalog's measures (MK-5, 2026-11-12), on real prefabs whose numbers are
// settled in docs/props.md.
import { describe, expect, it } from 'vitest';
import { catalog, heightClass, loadPrefabs, measurePrefab, search } from './catalog.mjs';

const prefabs = await loadPrefabs();

describe('measurePrefab', () => {
  it('measures the traffic cone: 0.7 m high, one solid, waist cover', async () => {
    const m = await measurePrefab('traffic-cone', prefabs);
    // A null size would mean TriangleBuilder's corners moved (catalog.mjs reads them).
    expect(m.size).not.toBeNull();
    expect(m.size[1]).toBeCloseTo(0.7, 2);
    expect(m.solids).toBe(1);
    expect(m.height).toBe('waist');
    expect(m.triangles).toBeGreaterThan(0);
  });

  it('counts doors, and loot containers in nested pieces', async () => {
    const d = await measurePrefab('double-door', prefabs);
    expect(d.doors).toBe(2);
    expect(d.size[0]).toBeCloseTo(3.74, 1);
    const f = await measurePrefab('filing-cabinet', prefabs);
    expect(f.containerCount).toBe(2);
  });

  it('calls a prefab with no collision drawn', async () => {
    expect((await measurePrefab('hanging-sign', prefabs)).height).toBe('drawn');
  });
});

describe('heightClass', () => {
  it('splits at prone, crouched and standing eye height', () => {
    expect([0.5, 0.6, 1.59, 1.6, 2.9, 3, null].map(heightClass)).toEqual([
      'low',
      'waist',
      'waist',
      'eye',
      'eye',
      'tall',
      'drawn',
    ]);
  });
});

describe('catalog', () => {
  const place = (prefab, x = 0) => ({
    type: 'prefab',
    prefab,
    pos: [x, 0, 0],
    yaw: 0,
    pitch: 0,
    roll: 0,
  });
  const maps = new Map([
    [
      'a',
      { nodes: [place('table-and-chairs'), { type: 'group', nodes: [place('wooden-chair', 3)] }] },
    ],
  ]);

  it('counts copies per map, nested and grouped ones included', async () => {
    const rows = await catalog(prefabs, maps);
    const chair = rows.find((r) => r.id === 'wooden-chair');
    const inner = prefabs.get('table-and-chairs').nodes.filter((n) => n.prefab === 'wooden-chair');
    expect(chair.uses.a).toBe(inner.length + 1);
    expect(chair.heldBy).toContain('table-and-chairs');
    expect(rows.find((r) => r.id === 'table-and-chairs').uses.a).toBe(1);
  });

  it('finds recolors, searched looks and tags', async () => {
    const rows = await catalog(prefabs, maps);
    const red = rows.find((r) => r.id === 'hazard-barrel-red');
    expect([red.variantOf, red.variantKind]).toEqual(['hazard-barrel', 'recolor']);
    expect(rows.find((r) => r.id === 'duffle-bag-open').lookOf).toBe('duffle-bag');
    expect(search(rows, ['industrial', 'barrel']).map((r) => r.id)).toContain('steel-barrel');
  });
});

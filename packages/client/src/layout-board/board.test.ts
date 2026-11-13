import { LAYOUT_FORMAT, loadById, rectCorners, type LayoutDef, layoutSchema } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { resized } from './board';
import { layoutSvg } from './sketch';

const files = import.meta.glob<unknown>('../../../../content/layouts/*.json', {
  eager: true,
  import: 'default',
});

const sample: LayoutDef = layoutSchema.parse({
  formatVersion: 1,
  id: 'sample',
  bounds: { x0: 0, z0: 0, x1: 120, z1: 80 },
  slope: { low: [60, 80], lowY: 0, high: [60, 0], highY: 8 },
  pois: { mall: { name: 'The mall', color: '#c0392b' } },
  pads: [{ id: 'terrace', x: 60, z: 20, w: 40, d: 20, y: 8, edge: 'wall' }],
  areas: [
    {
      id: 'court',
      name: 'Court <&>',
      poi: 'mall',
      x: 60,
      z: 40,
      w: 30,
      d: 20,
      yaw: 15,
      floors: 2,
      entrances: [{ side: 'front' }, { side: 'back', floor: 1 }],
    },
  ],
  roads: [
    {
      id: 'ring',
      points: [
        [0, 70],
        [120, 70],
      ],
    },
  ],
  landmarks: [{ id: 'crane', x: 100, z: 15, w: 4, d: 4, height: 45 }],
  zones: [
    {
      id: 'jam',
      points: [
        [5, 60],
        [40, 60],
        [40, 78],
        [5, 78],
      ],
    },
  ],
});

describe('layout board (MK-3)', () => {
  it('every layout file loads', () => {
    const layouts = loadById(LAYOUT_FORMAT, files);
    expect(layouts.size).toBe(Object.keys(files).length);
    expect(layouts.has('district')).toBe(true);
  });

  it('draws every kind of piece, tagged for picking, with text escaped', () => {
    const svg = layoutSvg(sample, { rings: { x: 60, z: 40 }, selected: 'court' });
    for (const [kind, id] of [
      ['pads', 'terrace'],
      ['areas', 'court'],
      ['roads', 'ring'],
      ['landmarks', 'crane'],
      ['zones', 'jam'],
    ])
      expect(svg).toContain(`data-kind="${kind}" data-id="${id}"`);
    expect(svg).toContain('Court &lt;&amp;&gt;');
    expect(svg).not.toContain('Court <&>');
    expect(svg.match(/class="entrance[ "]/g)).toHaveLength(2);
    expect(svg.match(/class="ring (walk|sprint)"/g)).toHaveLength(6);
    expect(svg).toContain('area full selected');
    expect(svg).toContain('The mall');
  });

  it('resizing by a corner keeps the opposite corner where it was, turned or not', () => {
    for (const yaw of [0, 30, -120]) {
      const r = { x: 10, z: 10, w: 8, d: 4, yaw };
      // Drag the back-right corner (2) out; the front-left (0) stays.
      const fixed = rectCorners(r)[0]!;
      const next = {
        ...r,
        ...(resized(r, 2, [40, 40], 0.001) as { x: number; z: number; w: number; d: number }),
      };
      const after = rectCorners(next)[0]!;
      expect(after[0]).toBeCloseTo(fixed[0], 2);
      expect(after[1]).toBeCloseTo(fixed[1], 2);
      expect(next.w).toBeGreaterThan(1);
    }
  });
});

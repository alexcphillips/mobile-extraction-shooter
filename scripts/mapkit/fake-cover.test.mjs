// The fake-cover scan (scripts/map-fake-cover.mjs, 2026-11-17) on a small map: what it
// flags, what it lets pass, and the kept-on-purpose list.
import { describe, expect, it } from 'vitest';
import { scanMap } from '../map-fake-cover.mjs';
import { box, drawn, group } from './nodes.mjs';
import { flatTerrain, lib } from './sim.mjs';

const raw = (nodes) => ({
  formatVersion: lib.MAP_FORMAT_VERSION,
  id: 'fake-test',
  name: 'Fake cover test',
  environment: { sky: '#a9b2b6', fogNear: 45, fogFar: 120 },
  terrain: flatTerrain(),
  nodes,
  zones: [],
});
const log = (id, extra = {}) => ({
  type: 'cylinder',
  id,
  pos: [0, -2.7, 0],
  radius: 0.3,
  height: 6,
  pitch: 90,
  color: '#7a5a3a',
  collide: false,
  ...extra,
});
const ids = (scan) => scan.rows.map((r) => r.id).sort();

describe('fake-cover scan', () => {
  it('flags drawn blocks, beams and logs a player would take for cover', () => {
    const scan = scanMap(
      raw([
        drawn(0, 0, 1, 1, 0, 1.2, '#888888', { id: 'crate' }),
        { ...log('lying-log'), pos: [5, -2.7, 5] },
        {
          type: 'box',
          id: 'beam',
          pos: [-5, 0.5, 5],
          size: [0.4, 0.4, 4],
          pitch: 20,
          color: '#888888',
          collide: false,
        },
      ]),
      'fake-test',
      {},
    );
    expect(ids(scan)).toEqual(['beam', 'crate', 'lying-log']);
    expect(scan.rows.find((r) => r.id === 'crate').kind).toBe('block');
  });

  it('passes solids, thin detail, things up high and drawn skins over a solid', () => {
    const scan = scanMap(
      raw([
        box(0, 0, 1, 1, 0, 1.2, '#888888', { id: 'solid-crate' }),
        drawn(3, 0, 3.05, 1, 0, 1.2, '#888888', { id: 'thin-rail' }),
        drawn(6, 0, 7, 1, 3.0, 4.0, '#888888', { id: 'sign-up-high' }),
        box(9, 0, 10, 1, 0, 1.2, '#888888', { id: 'hidden', invisible: true, stopsShots: true }),
        drawn(8.95, -0.05, 10.05, 1.05, 0, 1.25, '#888888', { id: 'skin-over-hidden' }),
      ]),
      'fake-test',
      {},
    );
    expect(ids(scan)).toEqual([]);
  });

  it('reports shapes kept drawn on purpose apart, with the reason', () => {
    const scan = scanMap(
      raw([drawn(0, 0, 1, 1, 0, 1.2, '#888888', { id: 'kept-crate' })]),
      'fake-test',
      {
        'kept-crate': 'a test',
      },
    );
    expect(scan.rows).toEqual([]);
    expect(scan.kept.map((r) => [r.id, r.reason])).toEqual([['kept-crate', 'a test']]);
  });

  it('places shapes in a turned group where they stand', () => {
    const scan = scanMap(
      raw([
        group('turned', [drawn(1.5, -0.5, 2.5, 0.5, 0, 1.2, '#888888', { id: 'c' })], {
          pos: [10, 0, 0],
          yaw: 90,
        }),
      ]),
      'fake-test',
      {},
    );
    const [r] = scan.rows;
    // local (2, 0) turned 90°: +x goes to −z
    expect(r.x).toBeCloseTo(10, 1);
    expect(r.z).toBeCloseTo(-2, 1);
  });
});

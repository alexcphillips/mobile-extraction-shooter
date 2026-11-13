// The map kit's pieces, each checked once in the sim (MK-6, 2026-11-12): the real compiler,
// collision world and nav grid, a character walked through, and whether the AI's nav
// joins the places a piece is meant to join (and only those).
import { describe, expect, it } from 'vitest';
import { buildingKit } from './building.mjs';
import { fenceRun } from './fence.mjs';
import { frame } from './frame.mjs';
import { layoutGround } from './ground.mjs';
import { box } from './nodes.mjs';
import { roadStrip } from './road.mjs';
import { rampRun, runDownFrom, runLength, stairRun } from './runs.mjs';
import { readFileSync } from 'node:fs';
import { build, joined, lib, walk } from './sim.mjs';

const C = {
  glass: '#9cc4d0',
  'timber-dark': '#5e4632',
  'dark-concrete': '#6f6d68',
  floorboards: '#7a6450',
  trim: '#e0dccf',
  plaster: '#cfc6b0',
  timber: '#8a6a48',
  roof: '#4a4440',
  siding: '#a8a090',
};

describe('frame', () => {
  it('places a turned group where toWorld says', () => {
    const f = frame({ x: 10, z: -5, yaw: -140 }, 2);
    const { map } = build([f.group('Piece', [box(3, 1, 5, 2, 0, 1, '#888888', { id: 'b' })])]);
    const [wx, wz] = f.toWorld(4, 1.5);
    const b = map.world.boxes.find((q) => Math.abs(q.x - wx) < 0.01 && Math.abs(q.z - wz) < 0.01);
    expect(b).toBeDefined();
    expect(b.y).toBeCloseTo(2.5, 2);
    const [lx, lz] = f.toLocal(wx, wz);
    expect([lx, lz].map((n) => Math.round(n * 100) / 100)).toEqual([4, 1.5]);
  });
});

describe('building shell', () => {
  const kit = buildingKit({ C });
  const shellAt = (ops) => {
    const f = frame({ x: 0, z: 0, yaw: 30 });
    return build([f.group('House', kit.shell('h', { color: C.siding, ops }).nodes)]);
  };
  it('a door joins inside and outside; a closed shell is cut off', () => {
    const open = shellAt({ front: [kit.door(0)] });
    const f = frame({ x: 0, z: 0, yaw: 30 });
    const inside = [...f.toWorld(0, 0)];
    const out = [...f.toWorld(0, 8)];
    const a = [inside[0], 0.35, inside[1]];
    const b = [out[0], 0, out[1]];
    expect(joined(open.nav, a, b)).toBe(true);
    expect(walk(open.world, b, a).reached).toBe(true);
    const shut = shellAt({});
    expect(joined(shut.nav, a, b)).toBe(false);
  });
});

describe('fence run', () => {
  // A 9 m square of picket fence; the south side's middle panel is a gap or not.
  const square = (gaps) =>
    build([
      ...fenceRun('n', [-4.5, -4.5], [4.5, -4.5]),
      ...fenceRun('s', [-4.5, 4.5], [4.5, 4.5], { gaps, broken: null }),
      ...fenceRun('w', [-4.5, -4.5], [-4.5, 4.5]),
      ...fenceRun('e', [4.5, -4.5], [4.5, 4.5]),
    ]);
  it('a gap is a way through for the AI and a walker; a panel is not', () => {
    const open = square([1]);
    expect(joined(open.nav, [0, 0, 0], [0, 0, 10])).toBe(true);
    expect(walk(open.world, [0, 0, 10], [0, 0, 0]).reached).toBe(true);
    expect(joined(square([]).nav, [0, 0, 0], [0, 0, 10])).toBe(false);
  });
});

describe('stair and ramp runs', () => {
  // A deck the run climbs onto (these runs climb south), its near edge at the run's top.
  const withDeck = (run, y) => {
    const { x, z } = run.top;
    return [run.node, box(x - 3, z, x + 3, z + 6, 0, y, '#888888')];
  };
  const check = (run, deckAt) => {
    const { world, nav } = build(withDeck(run, run.top.y));
    const foot = [run.node.pos[0], 0, run.node.pos[2]];
    const top = [deckAt(run.top)[0], run.top.y, deckAt(run.top)[1]];
    expect(joined(nav, foot, top)).toBe(true);
    const w = walk(world, foot, top);
    expect(w.reached).toBe(true);
    expect(w.y).toBeCloseTo(run.top.y, 1);
  };
  it('straight stairs in two flights: walked up, joined in the nav', () => {
    const run = stairRun({ id: 's', x: 0, z: -8, y: 0, yaw: 0, rise: 5, color: '#888888' });
    expect(run.node.nodes.filter((n) => n.type === 'stairs')).toHaveLength(2);
    check(run, (t) => [t.x, t.z + 2]);
  });
  it('a switchback turned 40°: walked up, joined in the nav', () => {
    const o = { id: 'sb', x: 3, z: 2, y: 0, yaw: 40, rise: 5, turn: 'left', color: '#888888' };
    const run = stairRun(o);
    expect(run.top.yaw).toBe(220);
    // The top comes back over the foot's line, one lane left: a deck there, past it.
    const f = frame(o);
    const lane = -(1.6 + 0.2);
    const deck = f.group('Deck', [box(lane - 0.8, -3, lane + 0.8, 0, 0, 5, '#888888')]);
    const { world, nav } = build([run.node, deck]);
    const onDeck = [...f.toWorld(lane, -2)];
    const top = [onDeck[0], 5, onDeck[1]];
    const foot = [...f.toWorld(0, -2)];
    expect(joined(nav, [foot[0], 0, foot[1]], top)).toBe(true);
    // Up the first flight, across the landing, back up the second, onto the deck.
    const first = run.node.nodes[0];
    const way = [
      [0, first.pos[2] + first.size[2] / 2 + 0.7],
      [lane, first.pos[2] + first.size[2] / 2 + 0.7],
      [lane, -2],
    ].map(([lx, lz]) => {
      const [x, z] = f.toWorld(lx, lz);
      return [x, 0, z];
    });
    const w = walk(
      world,
      [foot[0], 0, foot[1]],
      [[...f.toWorld(0, 0.3)].flatMap((v, i) => (i ? [0, v] : [v])), ...way],
    );
    expect(w.reached).toBe(true);
    expect(w.y).toBeCloseTo(5, 1);
  });
  it('a 1:8 ramp: walked up, joined in the nav', () => {
    const run = rampRun({ id: 'r', x: 0, z: -14, y: 0, yaw: 0, rise: 3, color: '#888888' });
    expect(runLength('ramp', { id: 'r', rise: 3, color: '#888888' }).length).toBe(24);
    check(run, (t) => [t.x, t.z + 2]);
  });
  it('refuses anything steeper than 45°', () => {
    expect(() =>
      stairRun({ id: 'x', x: 0, z: 0, y: 0, yaw: 0, rise: 3, going: 0.9, color: '#888888' }),
    ).toThrow(/45°/);
  });
});

describe('layout ground', () => {
  const layout = {
    bounds: { x0: 0, z0: 0, x1: 80, z1: 80 },
    slope: { low: [0, 80], lowY: 0, high: [0, 0], highY: 4 },
    pads: [
      { id: 'terrace', x: 40, z: 30, w: 20, d: 14, yaw: -140, y: 7, edge: 'wall' },
      { id: 'gentle', x: 15, z: 65, w: 10, d: 10, y: 3, edge: 'bank', blend: 6 },
      { id: 'harsh', x: 65, z: 65, w: 8, d: 8, y: 6, edge: 'bank', blend: 4 },
    ],
    roads: [
      {
        id: 'lane',
        width: 8,
        points: [
          [5, 75],
          [5, 45],
          [30, 60],
          [75, 50],
        ],
      },
    ],
  };
  const g = layoutGround(layout);
  const terrain = g.node('#7a7a4c');

  it('a wall pad is a sheer step: no way up for the AI, a drop for a walker', () => {
    const { world, nav } = build(g.retainingWalls(), terrain);
    const [ox, oz] = frame(layout.pads[0]).toWorld(0, 7 + 6);
    const below = [ox, g.groundAt(ox, oz), oz];
    expect(g.groundAt(40, 30)).toBe(7);
    expect(joined(nav, [40, 7, 30], below)).toBe(false);
    const w = walk(world, [40, 7, 30], below, { seconds: 8 });
    expect(w.y).toBeLessThan(5);
  });

  it('stairs laid down from the terrace edge join it to the ground below', () => {
    // Down the front face (local −z): the run climbs +z toward the pad, arriving at its edge.
    const f = frame(layout.pads[0]);
    const run = runDownFrom('stairs', {
      id: 'st',
      top: f.toWorld(0, -7),
      topY: 7,
      yaw: -140,
      groundAt: g.groundAt,
      color: '#888888',
    });
    expect(run.node.nodes.filter((n) => n.type === 'stairs').length).toBeGreaterThan(1);
    const [fx, , fz] = run.node.pos;
    expect(run.node.pos[1]).toBeCloseTo(g.groundAt(fx, fz), 1);
    const { world, nav } = build([...g.retainingWalls(), run.node], terrain);
    const foot = [fx, run.node.pos[1], fz];
    expect(joined(nav, [40, 7, 30], foot)).toBe(true);
    expect(walk(world, foot, [40, 7, 30]).reached).toBe(true);
  });

  it('flags banks steeper than 45° and passes gentle ones', () => {
    const by = Object.fromEntries(g.steep().map((e) => [e.by, e]));
    expect(by.harsh?.steepest).toBeGreaterThan(1);
    expect(by.gentle).toBeUndefined();
  });

  it('grades a road level across, and the strip on it is walked along', () => {
    // Across the north-south stretch at z 70: grid corners 3 m either side of the middle.
    expect(g.groundAt(2, 70)).toBe(g.groundAt(8, 70));
    const grades = g.roadGrades();
    expect(grades[0].id).toBe('lane');
    expect(grades[0].grade).toBeLessThan(0.2);
    // A flat road (no steepest stretch) still reports.
    const flat = layoutGround({
      bounds: { x0: 0, z0: 0, x1: 20, z1: 20 },
      pads: [],
      roads: [
        {
          id: 'f',
          width: 6,
          points: [
            [2, 10],
            [18, 10],
          ],
        },
      ],
    });
    expect(flat.roadGrades()[0]).toMatchObject({ id: 'f', grade: 0, at: [2, 10] });
    const strip = roadStrip('lane', layout.roads[0].points, 8, {
      groundAt: g.groundAt,
      color: '#58585a',
    });
    expect(strip.every((n) => n.collide === false)).toBe(true);
    const { world } = build(strip, terrain);
    const w = walk(
      world,
      [5, g.groundAt(5, 75), 75],
      [
        [5, 0, 45],
        [30, 0, 60],
      ],
      { sprint: true },
    );
    expect(w.reached).toBe(true);
  });

  it('with maxGrade a road keeps to it, cuts through a wall pad, and is driven up', () => {
    // DS-2: a yard 4 m up behind a retaining wall, a road running into it head-on.
    const yard = {
      bounds: { x0: 0, z0: 0, x1: 80, z1: 80 },
      pads: [{ id: 'yard', x: 40, z: 25, w: 30, d: 20, yaw: 0, y: 4, edge: 'wall', blend: 6 }],
      roads: [
        {
          id: 'in',
          width: 6,
          points: [
            [40, 78],
            [40, 25],
          ],
        },
      ],
    };
    const shut = layoutGround(yard);
    expect(shut.roadGrades()[0].grade).toBeGreaterThan(0.5);
    const g = layoutGround(yard, { maxGrade: 0.1 });
    expect(g.roadGrades()[0].grade).toBeLessThanOrEqual(0.11);
    const { world, nav } = build(g.retainingWalls(), g.node('#7a7a4c'));
    const top = [40, 4, 25];
    expect(joined(nav, [40, 0, 75], top)).toBe(true);
    const w = walk(world, [40, 0, 75], top, { sprint: true });
    expect(w.reached).toBe(true);
    // Beside the road the wall still stands: no way up there.
    expect(joined(nav, [25, 0, 45], [25, 4, 30])).toBe(true); // both ends join round by the road
    expect(walk(world, [28, 0, 40], [28, 4, 30], { seconds: 6 }).reached).toBe(false);
  });
});

describe('layout ground and the shared layout', () => {
  it("matches layouts.ts's heightAt on District everywhere outside the wall bands", () => {
    const layout = lib.loadLayout(
      JSON.parse(
        readFileSync(new URL('../../content/layouts/district.json', import.meta.url), 'utf8'),
      ),
      'district',
    );
    const g = layoutGround(layout);
    let checked = 0;
    for (let x = layout.bounds.x0; x <= layout.bounds.x1; x += 3)
      for (let z = layout.bounds.z0; z <= layout.bounds.z1; z += 3) {
        if (g.inWallBand(x, z)) continue;
        expect(g.padHeight(x, z)).toBeCloseTo(lib.heightAt(layout, x, z), 6);
        checked++;
      }
    expect(checked).toBeGreaterThan(15000);
  });
});

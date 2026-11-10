import { describe, expect, it } from 'vitest';
import { spawnCharacter, createState } from '../sim/state';
import { CollisionWorld } from '../world/collision-world';
import { compileMap, compileNodes, type PrefabLookup } from './compile';
import { loadContent } from './format';
import {
  MAP_FORMAT,
  MAP_FORMAT_VERSION,
  type MapFile,
  type MapNode,
  type PrefabFile,
} from './schema';

function map(nodes: MapNode[], colours?: Record<string, string>): MapFile {
  const row = Array<number>(11).fill(0);
  return {
    formatVersion: 4,
    id: 'test',
    name: 'Test',
    environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
    terrain: {
      origin: [-20, -20],
      cellSize: 4,
      heights: Array.from({ length: 11 }, () => row),
      colour: '#6b8f4e',
    },
    ...(colours && { colours }),
    nodes,
    zones: [],
  };
}

function prefabs(...list: PrefabFile[]): PrefabLookup {
  return new Map(list.map((p) => [p.id, p]));
}

const crate: PrefabFile = {
  formatVersion: 3,
  id: 'crate',
  colours: { wood: '#8a5a33' },
  nodes: [{ type: 'box', pos: [1, 0, 0], size: [1, 1, 1], colour: 'wood' }],
};

describe('compileMap', () => {
  it('makes foliage sight-only (MT-3): drawn, not solid, but the AI cannot see through it', () => {
    const tree: PrefabFile = {
      formatVersion: 3,
      id: 'tree',
      instanced: true,
      colours: { leaves: '#2f5d3a' },
      nodes: [
        {
          type: 'cylinder',
          pos: [0, 0, 0],
          radius: 1.6,
          radiusTop: 0,
          height: 4,
          colour: 'leaves',
          collide: false,
          foliage: true,
        },
      ],
    };
    const bush: MapNode = {
      type: 'box',
      pos: [5, 0, 0],
      size: [2, 1.6, 1],
      colour: '#2f5d3a',
      foliage: true,
    };
    const m = compileMap(
      map([{ type: 'prefab', prefab: 'tree', pos: [0, 0, 0], yaw: 30 }, bush]),
      prefabs(tree),
    );
    expect(m.world.boxes).toHaveLength(0);
    // The cone hides by two stacked boxes, wider below; the box by itself.
    const [low, high, box] = m.world.foliage!;
    expect(low).toMatchObject({ y: 1, hy: 1 });
    expect(low!.hx).toBeCloseTo(0.96);
    expect(high).toMatchObject({ y: 3, hy: 1 });
    expect(high!.hx).toBeCloseTo(0.32);
    expect(box).toEqual({ x: 5, y: 0.8, z: 0, hx: 1, hy: 0.8, hz: 0.5, yaw: 0 });
    const w = new CollisionWorld(m.world);
    expect(w.overlaps(0, 0, 0.3, 0.5, 1.5)).toBe(false);
    expect(w.raycast(-5, 1.5, 0, 1, 0, 0, 20)).toBe(Infinity);
    expect(w.foliageWithin(-5, 1.5, 0, 1, 0, 0, 20)).toBe(true);
    expect(w.foliageWithin(-5, 1.5, 3, 1, 0, 0, 20)).toBe(false);
    expect(() => compileMap(map([{ ...bush, collide: true }]), prefabs())).toThrow(
      "foliage can't collide",
    );
  });

  it('makes an invisible box a blocker: not drawn, solid to movement, not to rays', () => {
    const edge: MapNode = {
      type: 'box',
      pos: [0, 0, 0],
      size: [0.2, 10, 8],
      colour: '#ff0000',
      invisible: true,
    };
    const m = compileMap(map([edge]), prefabs());
    expect(m.shapes).toHaveLength(0);
    expect(m.world.boxes).toHaveLength(0);
    expect(m.world.blockers).toEqual([{ x: 0, y: 5, z: 0, hx: 0.1, hy: 5, hz: 4, yaw: 0 }]);
    const w = new CollisionWorld(m.world);
    expect(w.overlaps(0.2, 0, 0.3, 8, 9)).toBe(true);
    expect(w.raycast(-5, 1, 0, 1, 0, 0, 20)).toBe(Infinity);
    // The editor draws it see-through, from compileNodes.
    expect(compileNodes([edge], prefabs()).invisible).toHaveLength(1);
    expect(() => compileMap(map([{ ...edge, pitch: 10 }]), prefabs())).toThrow(/can't tilt/);
    expect(() => compileMap(map([{ ...edge, collide: false }]), prefabs())).toThrow(/collide/);
  });

  it('builds the terrain grid and centres boxes above their base', () => {
    const m = compileMap(
      map([{ type: 'box', pos: [1, 2, 3], size: [2, 4, 6], yaw: 90, colour: '#ff0000' }]),
      prefabs(),
    );
    expect(m.world.terrain).toMatchObject({ minX: -20, minZ: -20, cols: 10, rows: 10 });
    expect(m.world.terrain.heights).toHaveLength(121);
    expect(m.world.boxes).toHaveLength(1);
    const b = m.world.boxes[0]!;
    expect([b.x, b.y, b.z, b.hx, b.hy, b.hz]).toEqual([1, 4, 3, 1, 2, 3]);
    expect(b.yaw).toBeCloseTo(Math.PI / 2);
    expect(m.shapes[0]).toMatchObject({ kind: 'box', y: 4, colour: 0xff0000 });
  });

  it('places prefab nodes in the placement frame', () => {
    const m = compileMap(
      map([{ type: 'prefab', prefab: 'crate', pos: [10, 1, 0], yaw: 90 }]),
      prefabs(crate),
    );
    const b = m.world.boxes[0]!;
    // Local +x turns to −z at yaw 90°.
    expect(b.x).toBeCloseTo(10);
    expect(b.z).toBeCloseTo(-1);
    expect(b.y).toBeCloseTo(1.5);
    expect(b.yaw).toBeCloseTo(Math.PI / 2);
    expect(m.shapes[0]!.colour).toBe(0x8a5a33);
  });

  it('resolves colour slots through placements', () => {
    const m = compileMap(
      map(
        [
          { type: 'prefab', prefab: 'crate', pos: [0, 0, 0], colours: { wood: '#123456' } },
          { type: 'prefab', prefab: 'crate', pos: [0, 0, 5], colours: { wood: 'team' } },
        ],
        { team: '#abcdef' },
      ),
      prefabs(crate),
    );
    expect(m.shapes.map((s) => s.colour)).toEqual([0x123456, 0xabcdef]);
  });

  describe('searched looks', () => {
    const box = (colour: string, z = 0): MapNode => ({
      type: 'box',
      pos: [0, 0.5, z],
      size: [1, 1, 1],
      colour,
    });
    const drawer: MapNode = {
      type: 'group',
      pos: [0, 0, 0],
      loot: { container: 'drawer', searched: 'open' },
      nodes: [box('#111111')],
    };
    const file = (id: string, nodes: MapNode[], more: Partial<PrefabFile> = {}): PrefabFile => ({
      formatVersion: 3,
      id,
      name: id,
      nodes,
      ...more,
    });
    const open = file('open', [{ ...box('slot', 1), collide: false } as MapNode], {
      colours: { slot: '#222222' },
    });
    const place: MapNode = { type: 'prefab', id: 'c', prefab: 'cab', pos: [5, 0, 0], yaw: 90 };

    it('keeps the closed look in shapes and adds no collision', () => {
      const m = compileMap(map([place]), prefabs(file('cab', [drawer]), open));
      expect(m.shapes).toHaveLength(1);
      expect(m.world.boxes).toHaveLength(1);
      expect(m.searchedLooks).toHaveLength(1);
      const look = m.searchedLooks[0]!;
      expect(look.id).toBe(m.markers[0]!.id);
      expect(look.closed).toEqual(m.shapes);
      // The look stands in the placement's frame: 1 m along z, turned 90°, is +x.
      expect(look.searched[0]!.x).toBeCloseTo(6);
      expect(look.searched[0]!.colour).toBe(0x222222);
    });

    it('flattens an instanced prefab holding one', () => {
      const m = compileMap(
        map([place, { ...place, id: 'd', pos: [0, 0, 5] } as MapNode]),
        prefabs(file('cab', [drawer], { instanced: true }), open),
      );
      expect(m.instanced).toHaveLength(0);
      expect(m.searchedLooks.map((l) => l.id)).toHaveLength(2);
      expect(new Set(m.searchedLooks.map((l) => l.id)).size).toBe(2);
    });

    it('flattens an instanced prefab that is the container itself', () => {
      const node: MapNode = {
        type: 'prefab',
        prefab: 'cab',
        pos: [0, 0, 0],
        loot: { container: 'drawer', searched: 'open' },
      };
      const m = compileMap(
        map([node]),
        prefabs(file('cab', [box('#111111')], { instanced: true }), open),
      );
      expect(m.instanced).toHaveLength(0);
      expect(m.searchedLooks[0]!.closed).toHaveLength(1);
    });

    it('reports a searched look that does not exist', () => {
      expect(() => compileMap(map([place]), prefabs(file('cab', [drawer])))).toThrow(
        /no prefab "open" for its searched look/,
      );
    });

    it('leaves the editor closed look alone', () => {
      const out = compileNodes([place], prefabs(file('cab', [drawer]), open));
      expect(out.shapes).toHaveLength(1);
    });
  });

  it('reports unknown prefabs, slots and prefabs that contain themselves', () => {
    const place = (fields: Partial<MapNode>): MapNode =>
      ({ type: 'prefab', prefab: 'crate', pos: [0, 0, 0], ...fields }) as MapNode;
    expect(() => compileMap(map([place({ prefab: 'nope' })]), prefabs(crate))).toThrow(
      /#0: unknown prefab "nope"/,
    );
    expect(() =>
      compileMap(
        map([place({ colours: { paint: '#000000' } } as Partial<MapNode>)]),
        prefabs(crate),
      ),
    ).toThrow(/no colour slot "paint"/);
    expect(() =>
      compileMap(map([place({ colours: { wood: 'team' } } as Partial<MapNode>)]), prefabs(crate)),
    ).toThrow(/unknown colour slot "team"/);
    const a: PrefabFile = {
      formatVersion: 3,
      id: 'a',
      nodes: [{ type: 'prefab', prefab: 'b', pos: [0, 0, 0] }],
    };
    const b: PrefabFile = {
      ...a,
      id: 'b',
      nodes: [{ type: 'prefab', prefab: 'a', pos: [0, 0, 0] }],
    };
    expect(() => compileMap(map([place({ prefab: 'a' })]), prefabs(a, b))).toThrow(
      /contains itself \(a > b > a\)/,
    );
  });

  it('groups instanced prefabs by colours but still collides with every copy', () => {
    const tree = { ...crate, id: 'tree', instanced: true };
    const at = (x: number, colours?: Record<string, string>): MapNode => ({
      type: 'prefab',
      prefab: 'tree',
      pos: [x, 0, 0],
      ...(colours && { colours }),
    });
    const m = compileMap(map([at(0), at(5), at(10, { wood: '#000000' })]), prefabs(tree));
    expect(m.shapes).toHaveLength(0);
    expect(m.world.boxes).toHaveLength(3);
    expect(m.instanced).toHaveLength(2);
    const [plain, dark] = m.instanced;
    expect(plain!.placements.map((p) => p.x)).toEqual([0, 5]);
    // Shapes are in the prefab's own frame.
    expect(plain!.shapes[0]).toMatchObject({ x: 1, y: 0.5, z: 0, colour: 0x8a5a33 });
    expect(dark!.shapes[0]!.colour).toBe(0);
  });

  it('collects landmarks again for their silhouette: nodes, groups and prefabs', () => {
    const tower: PrefabFile = { ...crate, id: 'tower', instanced: true, landmark: true };
    const lookout: MapNode = {
      type: 'cylinder',
      pos: [0, 0, 0],
      radius: 1,
      height: 10,
      colour: '#ffffff',
      landmark: true,
    };
    const group: MapNode = {
      type: 'group',
      pos: [5, 0, 0],
      landmark: true,
      nodes: [
        { type: 'box', pos: [0, 0, 0], size: [2, 2, 2], colour: '#ffffff' },
        // Marked inside a marked group: not doubled.
        { type: 'box', pos: [0, 2, 0], size: [1, 1, 1], colour: '#ffffff', landmark: true },
      ],
    };
    const tree: MapNode = { type: 'prefab', prefab: 'tower', pos: [10, 0, 0] };
    const plain: MapNode = { type: 'box', pos: [0, 0, 9], size: [1, 1, 1], colour: '#ffffff' };
    const m = compileMap(map([lookout, group, tree, plain]), prefabs(tower));
    expect(m.landmarks.map((s) => s.kind)).toEqual(['cylinder', 'box', 'box', 'box']);
    // In world space, the instanced prefab's copy flattened.
    expect(m.landmarks[1]).toMatchObject({ x: 5, y: 1 });
    expect(m.landmarks[3]).toMatchObject({ x: 11, y: 0.5, z: 0 });
    // Still drawn and solid as usual.
    expect(m.shapes).toHaveLength(4);
    expect(m.instanced).toHaveLength(1);
    expect(m.world.boxes).toHaveLength(5);
    expect(compileMap(map([plain]), prefabs()).landmarks).toEqual([]);
  });

  it("compiles bodies of water: the map's own over everything first, then nodes", () => {
    const pond: MapNode = {
      type: 'group',
      pos: [5, 0, 0],
      yaw: 90,
      nodes: [{ type: 'water', pos: [2, 1.5, 0], size: [8, 4], colour: '#336699' }],
    };
    const m = compileMap(
      { ...map([pond]), water: { level: 0.2, colour: '#112233', opacity: 0.5 } },
      prefabs(),
    );
    expect(m.water).toHaveLength(2);
    expect(m.water[0]).toMatchObject({ x: 0, z: 0, hx: 20, hz: 20, level: 0.2, opacity: 0.5 });
    const w = m.water[1]!;
    // Turned with its group: local +x is world −z.
    expect(w).toMatchObject({ hx: 4, hz: 2, level: 1.5, colour: 0x336699, opacity: 0.7 });
    expect(w.x).toBeCloseTo(5);
    expect(w.z).toBeCloseTo(-2);
    expect(w.yaw).toBeCloseTo(Math.PI / 2);
    expect(m.world.water).toBe(m.water);
    const tilted: MapNode = { ...pond, pitch: 10 } as MapNode;
    expect(() => compileMap(map([tilted]), prefabs())).toThrow(/water can't be in/);
  });

  it('gives markers and doors path ids in world space', () => {
    const house: PrefabFile = {
      formatVersion: 3,
      id: 'house',
      nodes: [
        {
          type: 'lootContainer',
          id: 'desk',
          pos: [0, 0, 2],
          container: 'desk',
          lootTable: 'office',
        },
        { type: 'door', pos: [0, 0, 3], size: [1, 2], colour: '#ffffff', key: 'house-key' },
      ],
    };
    const m = compileMap(
      map([
        { type: 'playerSpawn', pos: [1, 0, 1] },
        { type: 'prefab', id: 'farm', prefab: 'house', pos: [10, 0, 0], yaw: 180 },
      ]),
      prefabs(house),
    );
    expect(m.markers.map((k) => k.id)).toEqual(['#0', 'farm/desk']);
    const desk = m.markers[1]!;
    expect(desk.type).toBe('lootContainer');
    expect(desk.x).toBeCloseTo(10);
    expect(desk.z).toBeCloseTo(-2);
    expect(desk.yaw).toBeCloseTo(Math.PI);
    expect(desk).toMatchObject({ container: 'desk', lootTable: 'office' });
    expect(desk).not.toHaveProperty('pos');
    expect(m.doors[0]).toMatchObject({
      id: 'farm/#1',
      key: 'house-key',
      hinge: 'left',
      open: false,
    });
    expect(m.doors[0]!.z).toBeCloseTo(-3);
  });

  it('collides tilted solids as their upright bounding box', () => {
    // A 4 m log tipped over onto its side: 4 m along x, 1 m high.
    const m = compileMap(
      map([{ type: 'box', pos: [0, 0, 0], size: [1, 4, 1], roll: 90, colour: '#ffffff' }]),
      prefabs(),
    );
    const b = m.world.boxes[0]!;
    expect(b.hx).toBeCloseTo(2);
    expect(b.hy).toBeCloseTo(0.5);
    expect(b.hz).toBeCloseTo(0.5);
    // It turns about its centre, 2 m above pos.
    expect(b.x).toBeCloseTo(0);
    expect(b.y).toBeCloseTo(2);
  });

  it('collides a tilted box as a slab with a sloped top and underside', () => {
    const m = compileMap(
      map([{ type: 'box', pos: [0, 0, 0], size: [2, 0.2, 8], pitch: -30, colour: '#ffffff' }]),
      prefabs(),
    );
    const b = m.world.boxes[0]!;
    expect(b.slope!.topX).toBeCloseTo(0);
    // Positive pitch tips the top towards +z, so −30° rises towards +z.
    expect(b.slope!.topZ).toBeCloseTo(Math.tan((30 * Math.PI) / 180));
    expect(b.slope!.underZ).toBeCloseTo(b.slope!.topZ);
    expect(b.slope!.top - b.slope!.under).toBeCloseTo(0.2 / Math.cos((30 * Math.PI) / 180));
    expect(b.hz).toBeCloseTo(
      4 * Math.cos((30 * Math.PI) / 180) + 0.1 * Math.sin((30 * Math.PI) / 180),
    );
  });

  it('takes what a tilted prefab or group holds with it, about its pos', () => {
    const plank: MapNode = { type: 'box', pos: [0, 0, 2], size: [1, 0.2, 2], colour: '#ffffff' };
    const lib = prefabs({ formatVersion: 3, id: 'plank', nodes: [plank] });
    const placed: MapNode[] = [
      { type: 'group', pos: [5, 1, 0], pitch: -90, nodes: [plank] },
      { type: 'prefab', prefab: 'plank', pos: [5, 1, 0], pitch: -90 },
    ];
    for (const tilted of placed) {
      const m = compileMap(map([tilted]), lib);
      const s = m.shapes[0]!;
      // 2 m along +z and 0.1 m up becomes 2 m up and 0.1 m back along −z.
      expect(s.x).toBeCloseTo(5);
      expect(s.y).toBeCloseTo(3);
      expect(s.z).toBeCloseTo(-0.1);
      expect(s.pitch).toBeCloseTo((-90 * Math.PI) / 180);
    }
  });

  it('composes yaw and a tilted group with a tilted child', () => {
    const m = compileMap(
      map([
        {
          type: 'group',
          pos: [0, 0, 0],
          yaw: 90,
          pitch: -20,
          nodes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], pitch: -10, colour: '#ffffff' }],
        },
      ]),
      prefabs(),
    );
    const s = m.shapes[0]!;
    expect(s.yaw).toBeCloseTo(Math.PI / 2);
    expect(s.pitch).toBeCloseTo((-30 * Math.PI) / 180);
    expect(s.roll).toBeCloseTo(0);
  });

  it('fixes doors shut in something tilted and refuses ladders', () => {
    const door: MapNode = { type: 'door', pos: [0, 0, 0], size: [1, 2], colour: '#ffffff' };
    const m = compileMap(
      map([{ type: 'group', pos: [0, 0, 0], pitch: 20, nodes: [door] }]),
      prefabs(),
    );
    expect(m.doors).toEqual([]);
    expect(m.world.boxes).toHaveLength(1);
    const ladder: MapNode = { type: 'ladder', pos: [0, 0, 0], height: 2, colour: '#ffffff' };
    expect(() =>
      compileMap(map([{ type: 'group', pos: [0, 0, 0], roll: 5, nodes: [ladder] }]), prefabs()),
    ).toThrow(/ladders can't be/);
  });

  it('tilts a ramp in a group as a sloped solid, not a yaw-only ramp', () => {
    const m = compileMap(
      map([
        {
          type: 'group',
          pos: [0, 0, 0],
          pitch: -10,
          nodes: [{ type: 'ramp', pos: [0, 0, 0], size: [2, 1, 4], colour: '#ffffff' }],
        },
      ]),
      prefabs(),
    );
    expect(m.world.ramps).toEqual([]);
    const { slope } = m.world.boxes[0]!;
    // 1 in 4 plus 10°.
    expect(slope!.topZ).toBeCloseTo(Math.tan(Math.atan(0.25) + (10 * Math.PI) / 180));
    expect(slope!.underZ).toBeCloseTo(Math.tan((10 * Math.PI) / 180));
  });

  it('turns stairs and ladders into ramps and ladders, and skips decoration', () => {
    const m = compileMap(
      map([
        { type: 'stairs', pos: [0, 0, 0], size: [2, 3, 6], colour: '#ffffff' },
        { type: 'ladder', pos: [5, 1, 0], height: 3, colour: '#ffffff' },
        { type: 'box', pos: [9, 0, 0], size: [1, 1, 1], colour: '#ffffff', collide: false },
      ]),
      prefabs(),
    );
    expect(m.world.ramps).toEqual([
      { x: 0, z: 0, hx: 1, hz: 3, yaw: 0, bottom: 0, low: 0, high: 3 },
    ]);
    expect(m.world.ladders).toEqual([{ x: 5, z: 0, yaw: 0, halfWidth: 0.3, bottom: 1, top: 4 }]);
    expect(m.world.boxes).toHaveLength(0);
    // 12 steps, 2 rails and 9 rungs, and the decorative box.
    expect(m.shapes).toHaveLength(12 + 2 + 9 + 1);
  });

  it('produces a world the simulation can stand on', () => {
    const m = compileMap(
      map([{ type: 'prefab', prefab: 'crate', pos: [-1, 0, 0] }]),
      prefabs(crate),
    );
    const world = new CollisionWorld(m.world);
    expect(spawnCharacter(createState(1), world, 0, 0).y).toBeCloseTo(1);
  });

  it('places patrols and points enemy spawns at the one beside them', () => {
    const camp: PrefabFile = {
      formatVersion: 3,
      id: 'camp',
      nodes: [
        {
          type: 'patrol',
          id: 'round',
          points: [[1, 0, 0], { pos: [0, 0, 2], radius: 2 }, { pos: [0, 0, 4], wait: 0 }],
          repeatFrom: 1,
          loop: false,
        },
        { type: 'enemySpawn', id: 'guard', pos: [0, 0, 0], enemy: 'scav', patrol: 'round' },
      ],
    };
    const m = compileMap(
      map([{ type: 'prefab', id: 'camp-a', prefab: 'camp', pos: [10, 1, 0], yaw: 90 }]),
      prefabs(camp),
    );
    expect(m.patrols).toHaveLength(1);
    const p = m.patrols[0]!;
    expect(p).toMatchObject({ id: 'camp-a/round', loop: false, repeatFrom: 1 });
    // Local +x turns to −z at yaw 90°, and +z to +x.
    expect(p.points[0]!.x).toBeCloseTo(10);
    expect(p.points[0]!.y).toBe(1);
    expect(p.points[0]!.z).toBeCloseTo(-1);
    expect(p.points[1]!.x).toBeCloseTo(12);
    // A plain position is walked through; a stop waits 3 s unless it says otherwise.
    expect(p.points.map((q) => [q.wait, q.radius])).toEqual([
      [0, 0],
      [3, 2],
      [0, 0],
    ]);
    expect(m.markers[0]).toMatchObject({
      type: 'enemySpawn',
      id: 'camp-a/guard',
      patrol: 'camp-a/round',
    });
  });

  it('needs at least two points to repeat', () => {
    const patrol = {
      type: 'patrol',
      id: 'p',
      points: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      repeatFrom: 2,
    };
    expect(() => loadContent(MAP_FORMAT, { ...map([]), nodes: [patrol] }, 'test.json')).toThrow(
      /repeatFrom/,
    );
  });

  it('places map labels as markers in world space and keeps the floors (2026-11-09)', () => {
    const file = loadContent(
      MAP_FORMAT,
      {
        ...map([
          {
            type: 'group',
            pos: [10, 6, 0],
            nodes: [{ type: 'mapLabel', id: 'tech', pos: [1, 0, 2], text: 'Tech store' }],
          },
          { type: 'mapLabel', pos: [0, 0, 0], text: 'Warehouse', size: 'area' },
        ]),
        floors: [
          { name: 'Ground', y: 0 },
          { name: 'Upper', y: 6 },
        ],
      },
      'test.json',
    );
    const compiled = compileMap(file, prefabs());
    const labels = compiled.markers.filter((m) => m.type === 'mapLabel');
    expect(labels).toMatchObject([
      { text: 'Tech store', x: 11, y: 6, z: 2 },
      { text: 'Warehouse', size: 'area', x: 0, y: 0, z: 0 },
    ]);
    expect(compiled.floors).toEqual([
      { name: 'Ground', y: 0 },
      { name: 'Upper', y: 6 },
    ]);
  });

  it('wants floors lowest first and labels with words', () => {
    const floors = [
      { name: 'Upper', y: 6 },
      { name: 'Ground', y: 0 },
    ];
    expect(() => loadContent(MAP_FORMAT, { ...map([]), floors }, 'test.json')).toThrow(
      /lowest first/,
    );
    const nodes = [{ type: 'mapLabel', pos: [0, 0, 0], text: '' }];
    expect(() => loadContent(MAP_FORMAT, { ...map([]), nodes }, 'test.json')).toThrow();
  });

  it("rejects a spawn whose patrol isn't beside it", () => {
    expect(() =>
      compileMap(
        map([{ type: 'enemySpawn', pos: [0, 0, 0], enemy: 'scav', patrol: 'nowhere' }]),
        prefabs(),
      ),
    ).toThrow(/no patrol "nowhere"/);
  });

  it('moves and turns what a group holds, without adding to its ids', () => {
    const m = compileMap(
      map([
        { type: 'playerSpawn', pos: [0, 0, 0] },
        {
          type: 'group',
          name: 'Yard',
          pos: [10, 1, 0],
          yaw: 90,
          nodes: [
            { type: 'box', pos: [1, 0, 0], size: [1, 1, 1], colour: '#ffffff' },
            { type: 'questMarker', id: 'radio', pos: [0, 0, 2] },
            {
              type: 'group',
              pos: [0, 0, 0],
              nodes: [
                { type: 'playerSpawn', pos: [0, 0, 0] },
                { type: 'prefab', id: 'shed', prefab: 'crate', pos: [0, 0, 0], yaw: 90 },
              ],
            },
          ],
        },
      ]),
      prefabs({
        ...crate,
        nodes: [
          ...crate.nodes,
          { type: 'lootSpawn', id: 'top', pos: [0, 1, 0], lootTable: 'household' },
        ],
      }),
    );
    expect(m.markers.map((k) => k.id)).toEqual(['#0', 'radio', '#1.2.0', 'shed/top']);
    const radio = m.markers[1]!;
    // Local +z turns to +x at yaw 90°.
    expect([radio.x, radio.y, radio.z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([12, 1, 0]);
    expect(radio.yaw).toBeCloseTo(Math.PI / 2);
    const box = m.world.boxes[0]!;
    expect([box.x, box.z].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([10, -1]);
    // The prefab turns by both: its +x box ends up at +x.
    const shed = m.world.boxes[1]!;
    expect(shed.x).toBeCloseTo(9);
    expect(shed.yaw).toBeCloseTo(Math.PI);
  });

  it('keeps ids unique across groups', () => {
    const nodes: MapNode[] = [
      { type: 'questMarker', id: 'radio', pos: [0, 0, 0] },
      {
        type: 'group',
        pos: [0, 0, 0],
        nodes: [{ type: 'questMarker', id: 'radio', pos: [1, 0, 0] }],
      },
    ];
    expect(() => loadContent(MAP_FORMAT, { ...map([]), nodes }, 'test.json')).toThrow(
      /nodes\.1\.nodes\.0\.id.*duplicate id "radio"|duplicate id "radio"/,
    );
  });

  it('makes a group a loot container of its solids, measured in its own yaw', () => {
    const m = compileMap(
      map([
        { type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff' },
        {
          type: 'group',
          pos: [10, 0, 0],
          yaw: 90,
          loot: { container: 'desk', lootTable: 'household' },
          nodes: [
            // A desk 2 m wide (x) and 1 m deep: a top and a leg, off the group's middle.
            { type: 'box', pos: [1, 0.7, 0], size: [2, 0.1, 1], colour: '#ffffff' },
            { type: 'box', pos: [0.1, 0, 0], size: [0.2, 0.7, 0.2], colour: '#ffffff' },
            { type: 'box', pos: [5, 0, 0], size: [1, 1, 1], colour: '#ffffff', collide: false },
          ],
        },
      ]),
      prefabs(),
    );
    const desk = m.markers.find((k) => k.type === 'lootContainer')!;
    expect(desk).toMatchObject({ id: '#1', container: 'desk', lootTable: 'household', y: 0 });
    expect(desk.solids).toEqual([1, 2]);
    expect(desk.hx).toBeCloseTo(1);
    expect(desk.hz).toBeCloseTo(0.5);
    expect(desk.yaw).toBeCloseTo(Math.PI / 2);
    // Its middle is local (1, 0), which turns to −z at yaw 90°.
    expect(desk.x).toBeCloseTo(10);
    expect(desk.z).toBeCloseTo(-1);
  });

  it('rejects a loot container with nothing to aim at, or one inside another', () => {
    const loot = { container: 'desk', lootTable: 'household' };
    const ghost: MapNode = {
      type: 'box',
      pos: [0, 0, 0],
      size: [1, 1, 1],
      colour: '#ffffff',
      collide: false,
      loot,
    };
    expect(() => compileMap(map([ghost]), prefabs())).toThrow(/needs something that collides/);
    const nested: MapNode = {
      type: 'group',
      pos: [0, 0, 0],
      loot,
      nodes: [
        { type: 'box', id: 'drawer', pos: [0, 0, 0], size: [1, 1, 1], colour: '#fff000', loot },
      ],
    };
    expect(() => compileMap(map([nested]), prefabs())).toThrow(/can't hold another \(drawer\)/);
  });

  it('loads format 2 maps unchanged', () => {
    const m = loadContent(MAP_FORMAT, { ...map([]), formatVersion: 2 }, 'test.json');
    expect(m.formatVersion).toBe(MAP_FORMAT_VERSION);
  });

  it('turns format 3’s circle extraction markers into extraction zones, groups and all', () => {
    const old = {
      ...map([
        {
          type: 'extraction',
          id: 'dock',
          pos: [10, 0, 0],
          name: 'Dock',
          radius: 2,
        } as unknown as MapNode,
        {
          type: 'group',
          pos: [0, 5, 0],
          yaw: 90,
          nodes: [
            { type: 'extraction', id: 'roof', pos: [4, 0, 0], name: 'Roof', radius: 1 },
          ] as unknown as MapNode[],
        },
      ]),
      formatVersion: 3,
    };
    const m = loadContent(MAP_FORMAT, old, 'test.json');
    expect(m.formatVersion).toBe(MAP_FORMAT_VERSION);
    // The markers are gone; the group stays, empty.
    expect(m.nodes).toEqual([{ type: 'group', pos: [0, 5, 0], yaw: 90, nodes: [] }]);
    const [dock, roof] = m.zones;
    expect(dock).toMatchObject({ id: 'dock', name: 'Dock', extraction: { y: 0 } });
    expect(dock!.points).toHaveLength(8);
    expect(dock!.points[0]).toEqual([12, 0]);
    // In the group turned 90°: (4, 0) lands at (0, -4), on the group's floor 5 m up.
    expect(roof).toMatchObject({ id: 'roof', extraction: { y: 5 } });
    expect(roof!.points[0]![0]).toBeCloseTo(1);
    expect(roof!.points[0]![1]).toBeCloseTo(-4);
  });
});

describe('concrete bases', () => {
  const shed: PrefabFile = {
    formatVersion: 3,
    id: 'shed',
    colours: { base: '#777777' },
    building: { size: [4, 2], centre: [1, 0], colour: 'base' },
    nodes: [{ type: 'box', pos: [1, 0, 0], size: [4, 0.2, 2], colour: '#ffffff' }],
  };
  /** Ground falling 1 m every 4 m along +x, through 0 at x = 0. */
  const slope = (): MapFile => {
    const m = map([]);
    m.terrain.heights = m.terrain.heights.map(() =>
      Array.from({ length: 11 }, (_, i) => -(i * 4 - 20) / 4),
    );
    return m;
  };

  it('fills under a building down into the lowest ground under its footprint', () => {
    const m = slope();
    m.nodes = [{ type: 'prefab', id: 'shed', prefab: 'shed', pos: [0, 1, 0] }];
    const c = compileMap(m, prefabs(shed));
    expect(c.buildings).toEqual([
      expect.objectContaining({ id: 'shed', prefab: 'shed', x: 1, y: 1, z: 0, hx: 2, hz: 1 }),
    ]);
    // The footprint runs from x = −1 (ground 0.25) to x = 3 (ground −0.75).
    const base = c.shapes.find((s) => s.colour === 0x777777)!;
    expect(base).toMatchObject({ kind: 'box', x: 1, z: 0, hx: 2, hz: 1 });
    if (base.kind !== 'box') throw new Error();
    expect(base.y + base.hy).toBeCloseTo(1);
    expect(base.y - base.hy).toBeCloseTo(-0.75 - 0.3);
    expect(c.world.boxes).toContainEqual(expect.objectContaining({ x: 1, hy: base.hy }));
  });

  it('turns with the building and leaves none where the ground is all above the floor', () => {
    const m = slope();
    m.nodes = [
      { type: 'prefab', prefab: 'shed', pos: [0, 1, 0], yaw: 90 },
      { type: 'prefab', prefab: 'shed', pos: [-10, 0, 0] },
    ];
    const c = compileMap(m, prefabs(shed));
    // Turned 90°, the footprint's middle is at z = −1 and it spans x −1 to 1.
    expect(c.buildings[0]).toMatchObject({ z: -1 });
    expect(c.buildings[0]!.x).toBeCloseTo(0);
    const bases = c.shapes.filter((s) => s.colour === 0x777777);
    expect(bases).toHaveLength(1);
    if (bases[0]!.kind !== 'box') throw new Error();
    expect(bases[0]!.y - bases[0]!.hy).toBeCloseTo(-0.25 - 0.3);
  });

  it('leaves bases out of compileNodes, which has no terrain', () => {
    const out = compileNodes([{ type: 'prefab', prefab: 'shed', pos: [0, 5, 0] }], prefabs(shed));
    expect(out.shapes).toHaveLength(1);
    expect(out.buildings).toHaveLength(1);
  });
});

describe('compileNodes', () => {
  it("compiles nodes on their own with the scope's colours, instanced prefabs flattened", () => {
    const out = compileNodes(
      [
        { type: 'prefab', prefab: 'tree', pos: [5, 0, 0] },
        { type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: 'concrete' },
        { type: 'questMarker', id: 'dock', pos: [0, 0, 0] },
      ],
      prefabs({ ...crate, id: 'tree', instanced: true }),
      { concrete: '#b5b0a6' },
    );
    expect(out.shapes.map((s) => [s.x, s.colour])).toEqual([
      [6, 0x8a5a33],
      [0, 0xb5b0a6],
    ]);
    expect(out.markers).toHaveLength(1);
  });

  it('builds a wall node from its openings: the wall between, sills, lintels and glass', () => {
    const wall: MapNode = {
      type: 'wall',
      pos: [2, 0, 3],
      yaw: 90,
      size: [6, 2.5, 0.2],
      colour: '#ffffff',
      openings: [
        { along: 1.5, width: 1, bottom: 0.9, top: 2, glass: '#a8d4e0' },
        { along: -1.5, width: 1, bottom: 0, top: 2.5 },
      ],
    };
    const out = compileNodes([wall], new Map());
    // Left end, nothing under or over the full-height gap, the middle, sill, lintel, right end.
    expect(out.boxes).toHaveLength(5);
    // Its length runs along local x, turned 90° to world −z.
    const sill = out.boxes.find((b) => b.hy === 0.45)!;
    expect(sill.x).toBeCloseTo(2);
    expect(sill.z).toBeCloseTo(1.5);
    expect(sill).toMatchObject({ hx: 0.5, hz: 0.1 });
    expect(out.glass).toHaveLength(1);
    expect(out.glass[0]!.y).toBeCloseTo(0.9);
    expect(out.glass[0]!.z).toBeCloseTo(1.5);
    expect(out.glass[0]).toMatchObject({ width: 1, thickness: 0.02, colour: 0xa8d4e0 });
    expect(out.glass[0]!.height).toBeCloseTo(1.1);

    const overlapping = {
      ...wall,
      openings: [...wall.openings, { along: 1, width: 1, bottom: 0.9, top: 2 }],
    };
    expect(() => compileNodes([overlapping], new Map())).toThrow('overlap');
    const past = { ...wall, openings: [{ along: 2.8, width: 1, bottom: 0.9, top: 2 }] };
    expect(() => compileNodes([past], new Map())).toThrow('past the end');
  });
});

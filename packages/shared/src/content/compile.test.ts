import { describe, expect, it } from 'vitest';
import { spawnCharacter, createState } from '../sim/state';
import { CollisionWorld } from '../world/collision-world';
import { compileMap, compileNodes, type PrefabLookup } from './compile';
import { loadContent } from './format';
import { MAP_FORMAT, type MapFile, type MapNode, type PrefabFile } from './schema';

function map(nodes: MapNode[], colours?: Record<string, string>): MapFile {
  const row = Array<number>(11).fill(0);
  return {
    formatVersion: 3,
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

  it('loads format 2 maps unchanged', () => {
    const m = loadContent(MAP_FORMAT, { ...map([]), formatVersion: 2 }, 'test.json');
    expect(m.formatVersion).toBe(3);
  });
});

describe('compileNodes', () => {
  it("compiles nodes on their own with the scope's colours, instanced prefabs flattened", () => {
    const out = compileNodes(
      [
        { type: 'prefab', prefab: 'tree', pos: [5, 0, 0] },
        { type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: 'concrete' },
        { type: 'extraction', pos: [0, 0, 0], name: 'Dock', radius: 3 },
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
});

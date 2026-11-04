import {
  CollisionWorld,
  compileMap,
  createState,
  loadContent,
  MAP_FORMAT,
  PREFAB_FORMAT,
  placeLootContainers,
  spawnCharacter,
  step,
  type ItemDb,
  type LootContainerDef,
  type MapFile,
  type PlayerInput,
  type SimState,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import cabinet from '../../../../content/prefabs/filing-cabinet.json';
import bottomOpen from '../../../../content/prefabs/filing-cabinet-bottom-drawer-open.json';
import topOpen from '../../../../content/prefabs/filing-cabinet-top-drawer-open.json';
import { buildMap, updateSearchedLooks } from './map';

const row = Array<number>(11).fill(0);
const file = loadContent(
  MAP_FORMAT,
  {
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
    nodes: [{ type: 'prefab', id: 'cabinet', prefab: 'filing-cabinet', pos: [0, 0, 0] }],
    zones: [],
  } satisfies MapFile,
  'test.json',
);
const prefabs = new Map(
  [cabinet, topOpen, bottomOpen].map((p) => {
    const prefab = loadContent(PREFAB_FORMAT, p, `prefabs/${p.id}.json`);
    return [prefab.id, prefab];
  }),
);
const map = compileMap(file, prefabs);
const world = new CollisionWorld(map.world);
const kinds = new Map<string, LootContainerDef>([
  ['filing-drawer', { formatVersion: 1, id: 'filing-drawer', name: 'Drawer', grid: [3, 2] }],
]);
const [top, bottom] = map.searchedLooks.map((l) => l.id) as [string, string];

const input = (search: string | null): PlayerInput => ({
  moveX: 0,
  moveY: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  aim: false,
  reload: false,
  search,
});

function setup() {
  const sim = createState(1);
  placeLootContainers(sim, map, kinds);
  const c = spawnCharacter(sim, world, 0, 1.5);
  return { sim, c };
}

/** Which of the two drawers' open looks a freshly built or updated view shows. */
function showing(sim: SimState) {
  const view = buildMap(map);
  updateSearchedLooks(view, sim.loot);
  return map.searchedLooks.map(({ id }) => {
    const look = view.looks.get(id)!;
    expect(look.closed.visible).toBe(!look.searched.visible);
    return look.searched.visible;
  });
}

const searched = (sim: SimState) => sim.loot.map((l) => !!l.searched);

describe('searched looks on a filing cabinet', () => {
  it.each([
    ['bottom then top', () => [bottom, top]],
    ['top then bottom', () => [top, bottom]],
  ])('adds up, %s, and survives saving and restoring', (_, order) => {
    const { sim, c } = setup();
    const [first, second] = order();
    step(sim, world, {} as ItemDb, { [c.id]: input(first!) });
    const one = sim.loot.map((l) => l.id === first);
    expect(searched(sim)).toEqual(one);
    expect(showing(sim)).toEqual(one);

    step(sim, world, {} as ItemDb, { [c.id]: input(second!) });
    expect(searched(sim)).toEqual([true, true]);
    expect(showing(sim)).toEqual([true, true]);

    const restored = JSON.parse(JSON.stringify(sim)) as SimState;
    expect(searched(restored)).toEqual([true, true]);
    expect(showing(restored)).toEqual([true, true]);
  });

  it('starts closed, also for a raid saved before the flag', () => {
    const { sim } = setup();
    expect(JSON.stringify(sim.loot)).not.toContain('searched');
    expect(showing(sim)).toEqual([false, false]);
  });

  it('keeps both looks out of the merge but the closed one in map.shapes', () => {
    for (const l of map.searchedLooks) {
      expect(l.closed.length).toBeGreaterThan(0);
      expect(l.searched.length).toBeGreaterThan(0);
      expect(l.closed.every((s) => map.shapes.includes(s))).toBe(true);
      expect(l.searched.some((s) => map.shapes.includes(s))).toBe(false);
    }
  });
});

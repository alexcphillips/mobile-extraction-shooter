import {
  CollisionWorld,
  compileMap,
  createState,
  eyeHeight,
  loadContent,
  MAP_FORMAT,
  PREFAB_FORMAT,
  placeLootContainers,
  spawnCharacter,
  type Character,
  type LootContainerDef,
  type MapFile,
  type SimState,
} from '@mes/shared';
import { describe, expect, it } from 'vitest';
import cabinet from '../../../../content/prefabs/filing-cabinet.json';
import bottomOpen from '../../../../content/prefabs/filing-cabinet-bottom-drawer-open.json';
import topOpen from '../../../../content/prefabs/filing-cabinet-top-drawer-open.json';
import { lootableInReach } from './loot';

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
const [, bottom] = map.searchedLooks.map((l) => l.id) as [string, string];

function setup(): { sim: SimState; c: Character } {
  const sim = createState(1);
  placeLootContainers(sim, map, kinds);
  // In front of the cabinet, which faces +z; yaw 0 looks along −z.
  return { sim, c: spawnCharacter(sim, world, 0, 0.9) };
}

/** Looks down into where the bottom drawer sits when pulled out: the ray ends on the floor, clear of the closed solids. */
function lookIntoBottomDrawer(sim: SimState, c: Character) {
  const pitch = Math.atan2(0.1 - eyeHeight(c), 0.9 - 0.5);
  return lootableInReach(sim, world, map.searchedLooks, c, 0, pitch);
}

describe('aiming at a searched look', () => {
  it('finds nothing where a closed drawer has no solid', () => {
    const { sim, c } = setup();
    expect(lookIntoBottomDrawer(sim, c)).toBeNull();
  });

  it('finds the drawer pulled out once it is searched', () => {
    const { sim, c } = setup();
    sim.loot.find((l) => l.id === bottom)!.searched = true;
    const found = lookIntoBottomDrawer(sim, c);
    expect(found?.kind === 'container' && found.c.id).toBe(bottom);
  });
});

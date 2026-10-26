import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { LOOT_CONTAINER_FORMAT_VERSION, type LootContainerDef } from '../content/loot-containers';
import { addItem, countOf, createGrid, placeAt } from '../inventory/grid';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip, heldWeapon, type ContainerState } from './gear';
import { dealDamage, HEAD } from './health';
import {
  applyInventory,
  placeLootContainers,
  type InventoryAction,
  type LootContainer,
  type Owner,
} from './looting';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

const self: Owner = { kind: 'self' };

/** A player with a backpack, a dead enemy 1 m away carrying a rifle, and a crate. */
function setup() {
  const state = createState(1);
  const c = spawnCharacter(state, world, 0, 0);
  equip(c, items, 'backpack', createItem(items, 'backpack'));
  const enemy = spawnEnemy(state, world, 1, 0, 0, 0, {});
  equip(enemy, items, 'primary1', createItem(items, 'rifle'));
  dealDamage(state, enemy, HEAD, 1000, 0);
  const crate: LootContainer = {
    id: 'crate',
    def: 'crate',
    x: 0,
    y: 0,
    z: 1,
    grid: createGrid(4, 3, true),
  };
  state.loot.push(crate);
  const body: Owner = { kind: 'body', id: enemy.id };
  const box: Owner = { kind: 'container', id: 'crate' };
  const act = (a: InventoryAction): boolean => applyInventory(state, c, items, a);
  return { state, c, enemy, crate, body, box, act };
}

describe('looting', () => {
  it('double-tapping a gun on a body puts it in an empty gun slot, then in the backpack', () => {
    const { c, enemy, body, act } = setup();
    expect(
      act({ type: 'quick', from: { owner: body, slot: 'primary1', item: 'rifle' }, to: self }),
    ).toBe(true);
    expect(enemy.gear.primary1).toBeNull();
    expect(heldWeapon(c)?.item).toBe('rifle');
    // A pistol goes in the sidearm slot first; a second rifle in primary 2, a third in the pack.
    equip(enemy, items, 'sidearm', createItem(items, 'pistol'));
    act({ type: 'quick', from: { owner: body, slot: 'sidearm', item: 'pistol' }, to: self });
    expect(c.gear.sidearm?.item).toBe('pistol');
    for (let i = 0; i < 2; i++) {
      equip(enemy, items, 'primary1', createItem(items, 'rifle'));
      act({ type: 'quick', from: { owner: body, slot: 'primary1', item: 'rifle' }, to: self });
    }
    expect(c.gear.primary2?.item).toBe('rifle');
    expect(countOf(c.gear.backpack!.grid, 'rifle')).toBe(1);
  });

  it('only reaches dead bodies and containers within reach', () => {
    const { state, c, enemy, crate, body, box, act } = setup();
    const take: InventoryAction = {
      type: 'quick',
      from: { owner: body, slot: 'primary1', item: 'rifle' },
      to: self,
    };
    enemy.health.dead = false;
    expect(act(take)).toBe(false);
    enemy.health.dead = true;
    enemy.x = 3;
    expect(act(take)).toBe(false);
    enemy.x = 1;
    // Can't loot yourself as a body.
    expect(
      act({
        type: 'quick',
        from: { owner: { kind: 'body', id: c.id }, grid: 'pockets', index: 0, item: 'x' },
        to: self,
      }),
    ).toBe(false);
    addItem(items, crate.grid, { item: 'watch', count: 1 });
    crate.y = 2.5;
    expect(
      act({ type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'watch' }, to: self }),
    ).toBe(false);
    crate.y = 0;
    expect(
      act({ type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'watch' }, to: self }),
    ).toBe(true);
    // The dead can't loot.
    c.health.dead = true;
    expect(act(take)).toBe(false);
    expect(state.loot[0]!.grid.items).toHaveLength(0);
  });

  it('refuses an action whose item has moved since it was sent', () => {
    const { crate, box, act } = setup();
    addItem(items, crate.grid, { item: 'watch', count: 1 });
    expect(
      act({
        type: 'quick',
        from: { owner: box, grid: 'loot', index: 0, item: 'bandage' },
        to: self,
      }),
    ).toBe(false);
    expect(act({ type: 'rotate', at: { owner: box, grid: 'loot', index: 1, item: 'watch' } })).toBe(
      false,
    );
  });

  it('double-tapping a stack into what you carry leaves what does not fit', () => {
    const { c, crate, box, act } = setup();
    // Pockets (4×1) and a 4×4 backpack hold 8 stacks of 100 with nothing else in them.
    for (let i = 0; i < 4; i++) addItem(items, c.gear.backpack!.grid, createItem(items, 'helmet'));
    // The backpack is full of helmets, so only the pockets are left: 4 stacks of 100.
    addItem(items, crate.grid, { item: 'round', count: 100 });
    for (let i = 0; i < 4; i++) {
      expect(
        act({
          type: 'quick',
          from: { owner: box, grid: 'loot', index: 0, item: 'round' },
          to: self,
        }),
      ).toBe(true);
      crate.grid.items.length = 0;
      addItem(items, crate.grid, { item: 'round', count: 100 });
    }
    expect(countOf(c.gear.pockets, 'round')).toBe(400);
    expect(
      act({ type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'round' }, to: self }),
    ).toBe(false);
    expect(crate.grid.items[0]!.item.count).toBe(100);
    // Topping up a partial stack moves only what fits.
    c.gear.pockets.items[3]!.item.count = 70;
    expect(
      act({ type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'round' }, to: self }),
    ).toBe(true);
    expect(crate.grid.items[0]!.item.count).toBe(70);
    // And back into the crate.
    expect(
      act({
        type: 'quick',
        from: { owner: self, grid: 'pockets', index: 0, item: 'round' },
        to: box,
      }),
    ).toBe(true);
    expect(countOf(crate.grid, 'round')).toBe(170);
  });

  it('drags between grids and gear slots, swapping with what is there', () => {
    const { c, crate, box, body, enemy, act } = setup();
    equip(c, items, 'helmet', createItem(items, 'helmet'));
    c.gear.helmet!.durability = 5;
    placeAt(items, crate.grid, createItem(items, 'helmet'), 2, 0, false);
    // The crate's helmet on your helmet slot: your worn one goes where it was.
    expect(
      act({
        type: 'move',
        from: { owner: box, grid: 'loot', index: 0, item: 'helmet' },
        to: { owner: self, slot: 'helmet' },
      }),
    ).toBe(true);
    expect(c.gear.helmet!.durability).toBe(30);
    expect(crate.grid.items).toMatchObject([{ x: 2, y: 0, item: { durability: 5 } }]);
    // A helmet doesn't fit a gun slot.
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'helmet', item: 'helmet' },
        to: { owner: self, slot: 'primary1' },
      }),
    ).toBe(false);
    // Slot to slot across owners: your rifle and the body's swap.
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const mine = c.gear.primary1;
    const theirs = enemy.gear.primary1;
    expect(
      act({
        type: 'move',
        from: { owner: body, slot: 'primary1', item: 'rifle' },
        to: { owner: self, slot: 'primary1' },
      }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(theirs);
    expect(enemy.gear.primary1).toBe(mine);
    // From a slot to a grid spot, and back.
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'primary1', item: 'rifle' },
        to: { owner: box, grid: 'loot', x: 0, y: 0, rotated: false },
      }),
    ).toBe(false);
    crate.grid.items.length = 0;
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'primary1', item: 'rifle' },
        to: { owner: box, grid: 'loot', x: 0, y: 0, rotated: false },
      }),
    ).toBe(true);
    expect(c.gear.primary1).toBeNull();
    expect(
      act({
        type: 'move',
        from: { owner: box, grid: 'loot', index: 0, item: 'rifle' },
        to: { owner: self, slot: 'primary2' },
      }),
    ).toBe(true);
    expect(c.gear.primary2).toBe(theirs);
  });

  it('keeps containers out of containers, except loot containers', () => {
    const { c, crate, box, act } = setup();
    const pack = c.gear.backpack as ContainerState;
    addItem(items, pack.grid, { item: 'watch', count: 1 });
    const to = (owner: Owner, grid: 'pockets' | 'loot') => ({
      owner,
      grid,
      x: 0,
      y: 0,
      rotated: false,
    });
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'backpack', item: 'backpack' },
        to: to(self, 'pockets'),
      }),
    ).toBe(false);
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'backpack', item: 'backpack' },
        to: to(box, 'loot'),
      }),
    ).toBe(true);
    // It went with what's in it.
    expect(crate.grid.items[0]!.item).toBe(pack);
    expect(countOf(pack.grid, 'watch')).toBe(1);
    // Double-tapped back, it goes on your back.
    expect(
      act({
        type: 'quick',
        from: { owner: box, grid: 'loot', index: 0, item: 'backpack' },
        to: self,
      }),
    ).toBe(true);
    expect(c.gear.backpack).toBe(pack);
  });

  it('applies actions sent with the input at the start of the tick', () => {
    const { state, c, crate, box } = setup();
    addItem(items, crate.grid, { item: 'watch', count: 1 });
    const input: PlayerInput = {
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
      inventory: [
        { type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'watch' }, to: self },
        { type: 'rotate', at: { owner: self, grid: 'pockets', index: 0, item: 'watch' } },
      ],
    };
    step(state, world, items, { [c.id]: input });
    expect(countOf(c.gear.pockets, 'watch')).toBe(1);
    expect(state.events.filter((e) => e.type === 'inventory')).toEqual([
      { type: 'inventory', by: c.id, ok: true },
      // A 1×1 item can't turn.
      { type: 'inventory', by: c.id, ok: false },
    ]);
    // Containers are plain data and survive a JSON round trip.
    const copy = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(copy.loot).toEqual(state.loot);
  });

  it('places an empty container at every loot container marker', () => {
    const state = createState(1);
    const map = {
      markers: [
        {
          type: 'lootContainer',
          id: 'house/desk',
          x: 1,
          y: 0.2,
          z: 2,
          yaw: 0,
          container: 'desk',
          lootTable: 'household',
        },
        { type: 'playerSpawn', id: 'spawn', x: 0, y: 0, z: 0, yaw: 0 },
      ],
    } as unknown as CompiledMap;
    const defs = new Map<string, LootContainerDef>([
      [
        'desk',
        {
          formatVersion: LOOT_CONTAINER_FORMAT_VERSION,
          id: 'desk',
          name: 'Desk',
          grid: [4, 3],
        },
      ],
    ]);
    placeLootContainers(state, map, defs);
    expect(state.loot).toEqual([
      {
        id: 'house/desk',
        def: 'desk',
        x: 1,
        y: 0.2,
        z: 2,
        grid: { w: 4, h: 3, containers: true, items: [] },
      },
    ]);
    expect(() => placeLootContainers(state, map, new Map())).toThrow(/no kind "desk"/);
  });
});

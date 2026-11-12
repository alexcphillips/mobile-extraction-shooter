import { describe, expect, it } from 'vitest';
import type { CompiledMap } from '../content/compile';
import { LOOT_CONTAINER_FORMAT_VERSION, type LootContainerDef } from '../content/loot-containers';
import { addItem, countOf, createGrid, placeAt } from '../inventory/grid';
import { ITEM_FORMAT_VERSION, type ItemDef } from '../content/items';
import { CollisionWorld } from '../world/collision-world';
import { spawnEnemy } from './ai';
import { createItem } from './create-item';
import { equip, heldWeapon, unequip, type ContainerState } from './gear';
import type { WeaponState } from './weapons';
import { dealDamage, HEAD } from './health';
import {
  applyInventory,
  canReach,
  gridOf,
  lootInSight,
  placeLootContainers,
  type InventoryAction,
  type LootContainer,
  type Owner,
  BODY_RADIUS,
  LOOT_REACH,
  bodyInReach,
} from './looting';
import { gearItems, markBrought, settleFound } from './raid';
import { createState, spawnCharacter, type PlayerInput } from './state';
import { step } from './step';
import { TEST_ITEMS as items } from './test-items';
import { TICK_RATE } from '../tick';

const world = new CollisionWorld({
  terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
  boxes: [],
  ramps: [],
  ladders: [],
});

const self: Owner = { kind: 'self' };

const stand: PlayerInput = {
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
};

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

describe('searching a container', () => {
  const press = (search: string): PlayerInput => ({ ...stand, search });

  it('marks it searched, once, by the input, and lasts through a save', () => {
    const { state, c, crate } = setup();
    expect(crate.searched).toBeUndefined();
    step(state, world, items, { [c.id]: press('crate') });
    expect(crate.searched).toBe(true);
    expect(state.events).toContainEqual({ type: 'search', by: c.id, container: 'crate' });
    step(state, world, items, { [c.id]: press('crate') });
    expect(state.events.some((e) => e.type === 'search')).toBe(false);
    const copy = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(copy.loot[0]!.searched).toBe(true);
  });

  it('ignores a press out of reach, on an unknown id, or from the dead', () => {
    const { state, c, crate } = setup();
    crate.z = LOOT_REACH + 2;
    step(state, world, items, { [c.id]: press('crate') });
    step(state, world, items, { [c.id]: press('nope') });
    expect(crate.searched).toBeUndefined();
    expect(state.events.some((e) => e.type === 'search')).toBe(false);
    crate.z = 1;
    c.health.dead = true;
    step(state, world, items, { [c.id]: press('crate') });
    expect(crate.searched).toBeUndefined();
  });
});

describe('found in raid', () => {
  const rifle = { owner: { kind: 'self' }, slot: 'primary1', item: 'rifle' } as const;
  const loot = (item: string) =>
    ({ owner: { kind: 'container', id: 'crate' }, grid: 'loot', index: 0, item }) as const;

  it('settles what came from the raid as found, and what you brought as not', () => {
    const { c, crate, act } = setup();
    c.gear.backpack!.grid!.items.length = 0;
    addItem(items, c.gear.backpack!.grid!, { item: 'watch', count: 1 });
    markBrought(c);
    addItem(items, crate.grid, createItem(items, 'bandage'));
    act({ type: 'quick', from: loot('bandage'), to: self });
    const gear = JSON.parse(JSON.stringify(c.gear)) as typeof c.gear;
    settleFound(gear);
    const kept = gearItems(gear);
    expect(kept.find((i) => i.item === 'bandage')?.found).toBe(true);
    expect(kept.find((i) => i.item === 'watch')?.found).toBeUndefined();
    expect(kept.every((i) => !i.brought)).toBe(true);
  });

  it('stays brought through a drop and pick up', () => {
    const { c, box, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    markBrought(c);
    act({ type: 'quick', from: rifle, to: box });
    act({ type: 'quick', from: loot('rifle'), to: self });
    expect(c.gear.primary1?.brought).toBe(true);
  });

  it('never stacks found with brought, but a split keeps its mark', () => {
    const { c, crate, act } = setup();
    const bag = c.gear.backpack!.grid!;
    addItem(items, bag, { item: 'round', count: 10 });
    markBrought(c);
    addItem(items, crate.grid, { item: 'round', count: 30 });
    act({ type: 'quick', from: loot('round'), to: self, count: 10 });
    const rounds = gearItems(c.gear).filter((i) => i.item === 'round');
    expect(rounds.map((i) => [i.count, !!i.brought]).sort()).toEqual([
      [10, false],
      [10, true],
    ]);
    expect(crate.grid.items[0]?.item.count).toBe(20);
    expect(crate.grid.items[0]?.item.brought).toBeUndefined();
  });

  it('a found item taken back in is found again, even if lost and refound', () => {
    const { c } = setup();
    addItem(items, c.gear.backpack!.grid!, { item: 'watch', count: 1, found: true });
    markBrought(c);
    const gear = JSON.parse(JSON.stringify(c.gear)) as typeof c.gear;
    settleFound(gear);
    expect(gearItems(gear).find((i) => i.item === 'watch')?.found).toBe(true);
  });

  it('a run-through brings nothing new out found, but keeps what was (2026-11-11)', () => {
    const { c, crate, act } = setup();
    addItem(items, c.gear.backpack!.grid!, { item: 'watch', count: 1, found: true });
    markBrought(c);
    addItem(items, crate.grid, createItem(items, 'bandage'));
    act({ type: 'quick', from: loot('bandage'), to: self });
    const gear = JSON.parse(JSON.stringify(c.gear)) as typeof c.gear;
    settleFound(gear, true);
    const kept = gearItems(gear);
    expect(kept.find((i) => i.item === 'bandage')?.found).toBeUndefined();
    expect(kept.find((i) => i.item === 'watch')?.found).toBe(true);
  });

  it('rounds and parts off a gun are not found, in a raid', () => {
    const { c, enemy, body, act } = setup();
    markBrought(c);
    const mag = enemy.gear.primary1!.mag!;
    act({ type: 'unload', gun: { owner: body, slot: 'primary1', item: 'rifle' } });
    const rounds = gearItems(c.gear).find((i) => i.item === 'round')!;
    expect(rounds.count).toBe(mag);
    expect(rounds.brought).toBe(true);
  });
});

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
    // A second pistol never goes in a primary slot, even an empty one: it's carried.
    unequip(c, 'primary2');
    equip(enemy, items, 'sidearm', createItem(items, 'pistol'));
    act({ type: 'quick', from: { owner: body, slot: 'sidearm', item: 'pistol' }, to: self });
    expect(enemy.gear.sidearm).toBeNull();
    expect(c.gear.primary2).toBeNull();
    // In the backpack: a 2×1 doesn't go in the pockets' 1×1 slots.
    expect(countOf(c.gear.backpack!.grid, 'pistol')).toBe(1);
  });

  it('double-tapping loot into full pockets, rig and backpack puts it in the vault', () => {
    const { c, crate, box, act } = setup();
    unequip(c, 'backpack');
    c.gear.pockets = createGrid(1, 1);
    addItem(items, c.gear.pockets, { item: 'watch', count: 1 });
    addItem(items, crate.grid, { item: 'watch', count: 1 });
    const take: InventoryAction = {
      type: 'quick',
      from: { owner: box, grid: 'loot', index: 0, item: 'watch' },
      to: self,
    };
    expect(act(take)).toBe(true);
    expect(countOf(c.gear.vault!, 'watch')).toBe(1);
    expect(crate.grid.items).toHaveLength(0);
  });

  it('reaches a body as far as it lies from its feet', () => {
    const { c, enemy } = setup();
    enemy.x = 3;
    expect(bodyInReach(c, enemy)).toBe(true);
    enemy.x = LOOT_REACH + BODY_RADIUS + 0.1;
    expect(bodyInReach(c, enemy)).toBe(false);
    enemy.x = 1;
    enemy.y = LOOT_REACH + 0.1;
    expect(bodyInReach(c, enemy)).toBe(false);
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
    // A body reaches LOOT_REACH + BODY_RADIUS (3.2 m) from its feet, as far as the prompt shows.
    enemy.x = 4;
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

  it('sees loot over a counter but not through a wall', () => {
    const { c } = setup();
    const walled = new CollisionWorld({
      terrain: { minX: -8, minZ: -8, cellSize: 4, cols: 4, rows: 4, heights: Array(25).fill(0) },
      boxes: [
        // A wall 1 m to the right, and a waist-high counter 1 m ahead.
        { x: 1, y: 1.3, z: 0, hx: 0.05, hy: 1.3, hz: 3, yaw: 0 },
        { x: 0, y: 0.45, z: -1.2, hx: 1, hy: 0.45, hz: 0.3, yaw: 0 },
      ],
      ramps: [],
      ladders: [],
    });
    expect(lootInSight(walled, c, 1.5, 0.5, 0)).toBe(false);
    expect(lootInSight(walled, c, 0.5, 0.5, 0)).toBe(true);
    // On the counter's top: the hit just short of it is what it rests on.
    expect(lootInSight(walled, c, 0, 0.9, -1.2)).toBe(true);
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
    // No vault, which would take what's left (tested above).
    c.gear.vault = null;
    // Pockets (five 1×1) and a 4×4 backpack hold 9 stacks of 100 with nothing else in them.
    for (let i = 0; i < 4; i++) addItem(items, c.gear.backpack!.grid, createItem(items, 'helmet'));
    // The backpack is full of helmets, so only the pockets are left: 5 stacks of 100.
    addItem(items, crate.grid, { item: 'round', count: 100 });
    for (let i = 0; i < 5; i++) {
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
    expect(countOf(c.gear.pockets, 'round')).toBe(500);
    expect(
      act({ type: 'quick', from: { owner: box, grid: 'loot', index: 0, item: 'round' }, to: self }),
    ).toBe(false);
    expect(crate.grid.items[0]!.item.count).toBe(100);
    // Topping up a partial stack moves only what fits.
    c.gear.pockets.items[4]!.item.count = 70;
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

  it('splits a stack in place, and moves part of one by double-tap', () => {
    const { state, c, crate, box, act } = setup();
    const vault = c.gear.vault!;
    addItem(items, vault, { item: 'round', count: 100 });
    const at = { owner: self, grid: 'vault', index: 0, item: 'round' } as const;
    // Not none, all, a fraction, or more than there are.
    for (const count of [0, 100, 2.5, 101]) expect(act({ type: 'split', at, count })).toBe(false);
    expect(act({ type: 'split', at, count: 25 })).toBe(true);
    expect(vault.items.map((g) => g.item.count)).toEqual([75, 25]);
    // A full grid has no room for the new stack.
    while (addItem(items, vault, createItem(items, 'watch')) === 0);
    expect(act({ type: 'split', at, count: 5 })).toBe(false);
    // Half of what's left in the vault into what you carry: the rest stays.
    expect(act({ type: 'quick', from: at, to: self, count: 37 })).toBe(true);
    expect(vault.items[0]!.item.count).toBe(38);
    expect(countOf(c.gear.pockets, 'round')).toBe(37);
    // Into a container, and onto the ground.
    expect(act({ type: 'quick', from: at, to: box, count: 8 })).toBe(true);
    expect(countOf(crate.grid, 'round')).toBe(8);
    expect(act({ type: 'quick', from: at, to: { kind: 'ground' }, count: 10 })).toBe(true);
    expect(state.ground.map((g) => g.item.count)).toEqual([10]);
    expect(vault.items[0]!.item.count).toBe(20);
    expect(act({ type: 'quick', from: at, to: self, count: 21 })).toBe(false);
  });

  it('swaps a gun onto your gun, yours into your backpack, each with its own rounds', () => {
    const { c, crate, box, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const mine = c.gear.primary1!;
    mine.mag = 10;
    const theirs = createItem(items, 'rifle') as WeaponState;
    theirs.mag = 30;
    placeAt(items, crate.grid, theirs, 0, 0, false);
    const onto = { owner: self, slot: 'primary1' } as const;
    expect(
      act({ type: 'move', from: { owner: box, grid: 'loot', index: 0, item: 'rifle' }, to: onto }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(theirs);
    expect(theirs.mag).toBe(30);
    expect(c.gear.backpack!.grid.items.map((g) => g.item)).toEqual([mine]);
    expect(mine.mag).toBe(10);
    expect(crate.grid.items).toEqual([]);

    // From the backpack: the room it leaves takes the other.
    expect(
      act({
        type: 'move',
        from: { owner: self, grid: 'backpack', index: 0, item: 'rifle' },
        to: onto,
      }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(mine);
    expect(c.gear.backpack!.grid.items.map((g) => g.item)).toEqual([theirs]);

    // No room in what you carry: it goes where the new one was, as before.
    unequip(c, 'backpack');
    placeAt(items, crate.grid, theirs, 0, 0, false);
    c.gear.backpack = null;
    expect(
      act({ type: 'move', from: { owner: box, grid: 'loot', index: 0, item: 'rifle' }, to: onto }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(theirs);
    expect(crate.grid.items.map((g) => g.item)).toEqual([mine]);
  });

  it('swaps an empty bag onto a full one, moving what was in it', () => {
    const { state, c, crate, box, act } = setup();
    const worn = c.gear.backpack!;
    placeAt(items, worn.grid, createItem(items, 'watch'), 3, 3, false);
    placeAt(items, worn.grid, createItem(items, 'cash', 40), 0, 0, false);
    const fresh = createItem(items, 'backpack');
    placeAt(items, crate.grid, fresh, 0, 0, false);
    const onto = { owner: self, slot: 'backpack' } as const;
    const from = { owner: box, grid: 'loot', index: 0, item: 'backpack' } as const;
    expect(act({ type: 'move', from, to: onto })).toBe(true);
    expect(c.gear.backpack).toBe(fresh);
    // Where they were.
    expect(fresh.grid!.items).toMatchObject([
      { x: 3, y: 3, item: { item: 'watch' } },
      { x: 0, y: 0, item: { item: 'cash', count: 40 } },
    ]);
    expect(crate.grid.items[0]!.item).toBe(worn);
    expect(worn.grid.items).toEqual([]);

    // A smaller bag takes what fits, auto-placed; in a raid the rest is dropped at your
    // feet (2026-11-11), leaving the old one empty.
    const small = createItem(items, 'backpack');
    small.grid = createGrid(1, 1);
    crate.grid.items.length = 0;
    placeAt(items, crate.grid, small, 0, 0, false);
    expect(act({ type: 'move', from, to: onto })).toBe(true);
    expect(small.grid.items).toMatchObject([{ x: 0, y: 0, item: { item: 'cash' } }]);
    expect(fresh.grid!.items).toEqual([]);
    expect(state.ground.map((g) => g.item.item)).toContain('watch');

    // A bag with things in it swaps on its own.
    placeAt(items, fresh.grid!, createItem(items, 'watch'), 0, 0, false);
    expect(act({ type: 'move', from, to: onto })).toBe(true);
    expect(c.gear.backpack).toBe(fresh);
    expect(fresh.grid!.items.map((g) => g.item.item)).toEqual(['watch']);
    expect(small.grid.items.map((g) => g.item.item)).toEqual(['cash']);
  });

  it('nests full rigs and backpacks in a backpack, opening at any depth (2026-11-11)', () => {
    const { state, c, crate, box, act } = setup();
    const rig = createItem(items, 'rig');
    placeAt(items, rig.grid!, createItem(items, 'bandage'), 0, 0, false);
    equip(c, items, 'rig', rig);
    const worn = c.gear.backpack!;
    // Room for a backpack beside the rig.
    worn.grid = createGrid(8, 8);
    worn.grid.bags = true;
    const pack = { owner: self, grid: 'backpack', x: 0, y: 0, rotated: false } as const;
    // The worn rig, meds and all, dragged into the backpack.
    expect(act({ type: 'move', from: { owner: self, slot: 'rig', item: 'rig' }, to: pack })).toBe(
      true,
    );
    expect(c.gear.rig).toBeNull();
    expect(worn.grid!.items[0]!.item).toBe(rig);
    expect(rig.grid!.items.map((g) => g.item.item)).toEqual(['bandage']);

    // A full backpack from the crate goes in too.
    const mid = createItem(items, 'backpack');
    placeAt(items, mid.grid!, createItem(items, 'watch'), 0, 0, false);
    placeAt(items, crate.grid, mid, 0, 0, false);
    const fromCrate = { owner: box, grid: 'loot', index: 0, item: 'backpack' } as const;
    expect(act({ type: 'quick', from: fromCrate, to: self })).toBe(true);
    const at = worn.grid!.items.findIndex((g) => g.item === mid);
    expect(at).toBeGreaterThan(-1);

    // It opens where it lies: the rig dragged into it, then a double-tap into it.
    const inMid = { index: at, item: 'backpack' } as const;
    const rigRef = { owner: self, grid: 'backpack', index: 0, item: 'rig' } as const;
    expect(
      act({
        type: 'move',
        from: rigRef,
        to: { owner: self, grid: 'backpack', inside: inMid, x: 0, y: 1, rotated: false },
      }),
    ).toBe(true);
    expect(mid.grid!.items.map((g) => g.item.item)).toEqual(['watch', 'rig']);
    // A bag in a bag in a bag: the rig inside it opens too.
    // (The rig left index 0, so the backpack moved down one.)
    const now = { index: worn.grid.items.findIndex((g) => g.item === mid), item: 'backpack' };
    const deep = { ...now, inside: { index: 1, item: 'rig' } };
    const deepRef = { owner: self, grid: 'backpack', inside: deep } as const;
    expect(gridOf(state, c, deepRef)).toBe(rig.grid);
    // A double-tap into the open one goes there, not into a gear slot.
    placeAt(items, crate.grid, createItem(items, 'bandage'), 0, 0, false);
    const bandage = { owner: box, grid: 'loot', index: 0, item: 'bandage' } as const;
    expect(act({ type: 'quick', from: bandage, to: self, grid: 'backpack', inside: deep })).toBe(
      true,
    );
    expect(rig.grid!.items.map((g) => g.item.item)).toEqual(['bandage', 'bandage']);
  });

  it('never puts a bag inside itself (2026-11-11)', () => {
    const { c, act } = setup();
    const worn = c.gear.backpack!;
    const inner = createItem(items, 'backpack');
    placeAt(items, worn.grid!, inner, 0, 0, false);
    // The worn backpack into the bag lying in it.
    const inInner = {
      owner: self,
      grid: 'backpack',
      inside: { index: 0, item: 'backpack' },
    } as const;
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'backpack', item: 'backpack' },
        to: { ...inInner, x: 0, y: 0, rotated: false },
      }),
    ).toBe(false);
    // Nor swapped onto its own slot from inside it, empty or full.
    const onto = { owner: self, slot: 'backpack' } as const;
    const from = { owner: self, grid: 'backpack', index: 0, item: 'backpack' } as const;
    placeAt(items, worn.grid!, createItem(items, 'watch'), 4, 0, false);
    expect(act({ type: 'move', from, to: onto })).toBe(false);
    placeAt(items, inner.grid!, createItem(items, 'watch'), 0, 0, false);
    expect(act({ type: 'move', from, to: onto })).toBe(false);
    expect(c.gear.backpack).toBe(worn);
  });

  it('puts things back on a body: a double-tap into an empty slot, drags swapping', () => {
    const { c, enemy, body, act } = setup();
    // Its rifle taken into your hands, then double-tapped back: onto its empty slot, not
    // its pockets, which have no room for a rifle.
    const theirs = enemy.gear.primary1!;
    const onMe = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    expect(
      act({ type: 'quick', from: { owner: body, slot: 'primary1', item: 'rifle' }, to: self }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(theirs);
    expect(act({ type: 'quick', from: onMe, to: body })).toBe(true);
    expect(enemy.gear.primary1).toBe(theirs);
    expect(c.gear.primary1).toBeNull();
    // A helmet from your backpack goes on its head.
    addItem(items, c.gear.backpack!.grid, createItem(items, 'helmet'));
    expect(
      act({
        type: 'quick',
        from: { owner: self, grid: 'backpack', index: 0, item: 'helmet' },
        to: body,
      }),
    ).toBe(true);
    expect(enemy.gear.helmet?.item).toBe('helmet');

    // Your rifle dragged onto its rifle, from your hands: they swap slots.
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const mine = c.gear.primary1!;
    const onIt = { owner: body, slot: 'primary1' } as const;
    expect(act({ type: 'move', from: onMe, to: onIt })).toBe(true);
    expect(enemy.gear.primary1).toBe(mine);
    expect(c.gear.primary1).toBe(theirs);
    // From your backpack: its rifle goes where yours was.
    unequip(c, 'primary1');
    placeAt(items, c.gear.backpack!.grid, theirs, 0, 1, false);
    expect(
      act({
        type: 'move',
        from: { owner: self, grid: 'backpack', index: 0, item: 'rifle' },
        to: onIt,
      }),
    ).toBe(true);
    expect(enemy.gear.primary1).toBe(theirs);
    expect(c.gear.backpack!.grid.items.map((g) => g.item)).toEqual([mine]);
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

  it('puts attachments on a gun and takes them off, swapping with what was there', () => {
    const { c, enemy, body, act } = setup();
    const pack = c.gear.backpack!.grid;
    const rifle = enemy.gear.primary1 as WeaponState;
    const gun = { owner: body, slot: 'primary1', item: 'rifle' } as const;
    placeAt(items, pack, createItem(items, 'scope'), 1, 2, false);
    // From your backpack onto the body's rifle.
    expect(
      act({
        type: 'attach',
        gun,
        from: { owner: self, grid: 'backpack', index: 0, item: 'scope' },
      }),
    ).toBe(true);
    expect(rifle.attachments.optic).toBe('scope');
    expect(pack.items).toEqual([]);
    // A second scope swaps with it: the first goes where the second was.
    placeAt(items, pack, createItem(items, 'scope'), 2, 3, false);
    expect(
      act({
        type: 'attach',
        gun,
        from: { owner: self, grid: 'backpack', index: 0, item: 'scope' },
      }),
    ).toBe(true);
    expect(pack.items).toMatchObject([{ x: 2, y: 3, item: { item: 'scope' } }]);
    // Off to a spot, then into what you carry; a part the gun no longer has is refused.
    const off = { type: 'detach', gun, slot: 'optic', part: 'scope' } as const;
    expect(act({ ...off, to: { owner: self, grid: 'backpack', x: 3, y: 3, rotated: false } })).toBe(
      false,
    );
    expect(act({ ...off, to: { owner: self, grid: 'backpack', x: 0, y: 0, rotated: true } })).toBe(
      true,
    );
    expect(pack.items[1]).toMatchObject({ x: 0, y: 0, rotated: true, item: { item: 'scope' } });
    expect(rifle.attachments.optic).toBeNull();
    expect(act({ ...off, to: null })).toBe(false);
    act({ type: 'attach', gun, from: { owner: self, grid: 'backpack', index: 1, item: 'scope' } });
    expect(act({ ...off, to: null })).toBe(true);
    // Into the backpack, beside the one already there: a 2×1 doesn't go in the pockets'
    // 1×1 slots.
    expect(countOf(c.gear.pockets, 'scope')).toBe(0);
    expect(countOf(pack, 'scope')).toBe(2);
  });

  it('moves an attachment from one gun to another, swapping when it can', () => {
    const { state, c, enemy, body, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    equip(c, items, 'sidearm', createItem(items, 'pistol'));
    const mine = c.gear.primary1 as WeaponState;
    const pistol = c.gear.sidearm as WeaponState;
    const theirs = enemy.gear.primary1 as WeaponState;
    const myRifle = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    const theirRifle = { owner: body, slot: 'primary1', item: 'rifle' } as const;
    theirs.attachments.optic = 'scope';
    const scope = { gun: theirRifle, slot: 'optic', part: 'scope' } as const;
    // Onto an empty slot.
    expect(act({ type: 'attach', gun: myRifle, from: scope })).toBe(true);
    expect(mine.attachments.optic).toBe('scope');
    expect(theirs.attachments.optic).toBeNull();
    // Stale now, and never onto the gun it's on.
    expect(act({ type: 'attach', gun: myRifle, from: scope })).toBe(false);
    expect(act({ type: 'attach', gun: myRifle, from: { ...scope, gun: myRifle } })).toBe(false);
    // A real swap: your brake for their suppressor. Then the pistol's suppressor onto
    // their rifle: the brake doesn't fit a pistol, so it goes in your pockets.
    const more = new Map<string, ItemDef>(items);
    more.set('brake', {
      formatVersion: ITEM_FORMAT_VERSION,
      id: 'brake',
      name: 'Brake',
      size: [1, 1],
      value: 100,
      rarity: 'common',
      type: 'attachment',
      slot: 'muzzle',
      weapons: ['rifle'],
      model: { parts: items.get('suppressor')!.model.parts, muzzle: [0, 0, -0.05] },
    });
    const actMore = (a: InventoryAction) => applyInventory(state, c, more, a);
    mine.attachments.muzzle = 'brake';
    theirs.attachments.muzzle = 'suppressor';
    expect(
      actMore({
        type: 'attach',
        gun: theirRifle,
        from: { gun: myRifle, slot: 'muzzle', part: 'brake' },
      }),
    ).toBe(true);
    expect([mine.attachments.muzzle, theirs.attachments.muzzle]).toEqual(['suppressor', 'brake']);
    pistol.attachments.muzzle = 'suppressor';
    expect(
      actMore({
        type: 'attach',
        gun: theirRifle,
        from: {
          gun: { owner: self, slot: 'sidearm', item: 'pistol' },
          slot: 'muzzle',
          part: 'suppressor',
        },
      }),
    ).toBe(true);
    expect([pistol.attachments.muzzle, theirs.attachments.muzzle]).toEqual([null, 'suppressor']);
    expect(countOf(c.gear.pockets, 'brake')).toBe(1);
  });

  it('moves a magazine between guns, stowing what the old one held or dropping it', () => {
    const { state, c, enemy, body, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const mine = c.gear.primary1 as WeaponState;
    const theirs = enemy.gear.primary1 as WeaponState;
    theirs.attachments.magazine = 'big-mag';
    theirs.mag = 50;
    mine.mag = 30;
    const from = {
      gun: { owner: body, slot: 'primary1', item: 'rifle' },
      slot: 'magazine',
      part: 'big-mag',
    } as const;
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    // Their 20 extra rounds have nowhere to go with everything full: they're dropped.
    const full = [c.gear.pockets, c.gear.backpack!.grid];
    for (const g of full) while (addItem(items, g, { item: 'watch', count: 1 }) === 0);
    expect(act({ type: 'attach', gun, from })).toBe(true);
    expect([theirs.mag, mine.mag, mine.attachments.magazine]).toEqual([30, 30, 'big-mag']);
    expect(state.ground).toMatchObject([{ item: { item: 'round', count: 20 } }]);
    // And back, with room this time.
    state.ground.length = 0;
    mine.mag = 50;
    c.gear.backpack!.grid.items.length = 0;
    expect(
      act({ type: 'attach', gun: from.gun, from: { gun, slot: 'magazine', part: 'big-mag' } }),
    ).toBe(true);
    expect(countOf(c.gear.backpack!.grid, 'round')).toBe(20);
    expect(state.ground).toEqual([]);
  });

  it('refuses attachments that do not fit, and things that are not attachments', () => {
    const { c, act } = setup();
    equip(c, items, 'sidearm', createItem(items, 'pistol'));
    const pack = c.gear.backpack!.grid;
    addItem(items, pack, createItem(items, 'big-mag'));
    addItem(items, pack, { item: 'watch', count: 1 });
    const gun = { owner: self, slot: 'sidearm', item: 'pistol' } as const;
    expect(
      act({
        type: 'attach',
        gun,
        from: { owner: self, grid: 'backpack', index: 0, item: 'big-mag' },
      }),
    ).toBe(false);
    expect(
      act({
        type: 'attach',
        gun,
        from: { owner: self, grid: 'backpack', index: 1, item: 'watch' },
      }),
    ).toBe(false);
    expect(pack.items).toHaveLength(2);
  });

  it('stows the rounds a smaller magazine hands back, or drops them with no room', () => {
    const { state, c, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const rifle = c.gear.primary1 as WeaponState;
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    // From the backpack: a 1×2 doesn't go in the pockets' 1×1 slots.
    addItem(items, c.gear.backpack!.grid, createItem(items, 'big-mag'));
    act({
      type: 'attach',
      gun,
      from: { owner: self, grid: 'backpack', index: 0, item: 'big-mag' },
    });
    rifle.mag = 50;
    // Everything carried is full: the 20 rounds are dropped at your feet.
    const fill = (grid: typeof c.gear.pockets) => {
      while (addItem(items, grid, { item: 'watch', count: 1 }) === 0);
    };
    fill(c.gear.pockets);
    fill(c.gear.backpack!.grid);
    const off = { type: 'detach', gun, slot: 'magazine', part: 'big-mag' } as const;
    const crate = { owner: { kind: 'container', id: 'crate' }, grid: 'loot' } as const;
    rifle.reloading = 1;
    expect(act({ ...off, to: { ...crate, x: 0, y: 0, rotated: false } })).toBe(true);
    expect(rifle.attachments.magazine).toBeNull();
    expect(rifle.mag).toBe(30);
    expect(rifle.reloading).toBe(0);
    expect(c.gear.pockets.items.every((g) => g.item.item === 'watch')).toBe(true);
    expect(state.ground).toHaveLength(1);
    const [g] = state.ground;
    expect(g!.item).toEqual({ item: 'round', count: 20 });
    expect(Math.hypot(g!.x - c.x, g!.z - c.z)).toBeLessThanOrEqual(0.3);
    // Taken off into what you carry with no room: the part is dropped too.
    act({
      type: 'attach',
      gun,
      from: { owner: crate.owner, grid: 'loot', index: 0, item: 'big-mag' },
    });
    expect(act({ ...off, to: null })).toBe(true);
    expect(state.ground.map((g) => g.item.item)).toEqual(['round', 'big-mag']);
  });

  it('strips a gun into the backpack, then the rig, then the ground', () => {
    const { state, c, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const rifle = c.gear.primary1 as WeaponState;
    Object.assign(rifle.attachments, { optic: 'scope', muzzle: 'suppressor', magazine: 'big-mag' });
    rifle.mag = 50;
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    expect(act({ type: 'strip', gun })).toBe(true);
    expect(rifle.attachments).toMatchObject({
      optic: null,
      muzzle: null,
      magazine: null,
      laser: null,
    });
    expect(rifle.mag).toBe(0);
    const pack = c.gear.backpack!.grid;
    for (const id of ['scope', 'suppressor', 'big-mag']) expect(countOf(pack, id)).toBe(1);
    expect(countOf(pack, 'round')).toBe(50);
    expect(countOf(c.gear.pockets, 'round')).toBe(0);
    // Nothing left to take off.
    expect(act({ type: 'strip', gun })).toBe(false);
    // No backpack or rig: at your feet.
    rifle.attachments.optic = 'scope';
    rifle.mag = 10;
    c.gear.backpack = null;
    c.gear.rig = null;
    expect(act({ type: 'strip', gun })).toBe(true);
    expect(state.ground.map((g) => g.item.item).sort()).toEqual(['round', 'scope']);
  });

  it("unloads a gun's rounds into what you carry, and a body's gun into yours", () => {
    const { state, c, enemy, body, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const rifle = c.gear.primary1 as WeaponState;
    rifle.reloading = 1;
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    expect(act({ type: 'unload', gun })).toBe(true);
    expect(rifle.mag).toBe(0);
    expect(rifle.reloading).toBe(0);
    expect(countOf(c.gear.pockets, 'round')).toBe(30);
    // Empty: nothing to do.
    expect(act({ type: 'unload', gun })).toBe(false);
    // A dead body's gun, in reach: its rounds come to you.
    expect(act({ type: 'unload', gun: { owner: body, slot: 'primary1', item: 'rifle' } })).toBe(
      true,
    );
    expect((enemy.gear.primary1 as WeaponState).mag).toBe(0);
    expect(countOf(c.gear.pockets, 'round') + countOf(c.gear.backpack!.grid, 'round')).toBe(60);
    expect(state.ground).toEqual([]);
  });

  it('loads a gun from rounds dropped on it: tops it up, or swaps the rounds out', () => {
    const { state, c, enemy, body, act } = setup();
    equip(c, items, 'primary2', createItem(items, 'rifle'));
    const rifle = c.gear.primary2 as WeaponState;
    rifle.mag = 10;
    addItem(items, c.gear.pockets, createItem(items, 'round', 5));
    addItem(items, c.gear.pockets, createItem(items, 'ap-round', 40));
    addItem(items, c.gear.pockets, createItem(items, 'shell', 10));
    const gun = { owner: self, slot: 'primary2', item: 'rifle' } as const;
    const at = (index: number, item: string) =>
      ({ owner: self, grid: 'pockets', index, item }) as const;
    // Not a round it fires.
    expect(act({ type: 'load', gun, from: at(2, 'shell') })).toBe(false);
    // More of the same tops it up, using up the stack.
    expect(act({ type: 'load', gun, from: at(0, 'round') })).toBe(true);
    expect(rifle.mag).toBe(15);
    expect(countOf(c.gear.pockets, 'round')).toBe(0);
    // Another round swaps: the 15 old ones go into what's carried. Not the gun in hand,
    // so it's at once.
    expect(act({ type: 'load', gun, from: at(0, 'ap-round') })).toBe(true);
    expect(rifle).toMatchObject({ mag: 30, loaded: 'ap-round', reloading: 0 });
    expect(countOf(c.gear.pockets, 'ap-round')).toBe(10);
    expect(countOf(c.gear.pockets, 'round')).toBe(15);
    // Full of it already: nothing to do.
    const ap = c.gear.pockets.items.findIndex((g) => g.item.item === 'ap-round');
    expect(act({ type: 'load', gun, from: at(ap, 'ap-round') })).toBe(false);
    // A body's gun, from your rounds.
    (enemy.gear.primary1 as WeaponState).mag = 0;
    const theirs = { owner: body, slot: 'primary1', item: 'rifle' } as const;
    expect(act({ type: 'load', gun: theirs, from: at(ap, 'ap-round') })).toBe(true);
    expect(enemy.gear.primary1).toMatchObject({ mag: 10, loaded: 'ap-round' });
    expect(state.ground).toEqual([]);
  });

  it('reloads the gun in hand with rounds dropped on it, taking the reload time', () => {
    const { state, c, box, crate, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    c.draw = 0;
    const rifle = c.gear.primary1 as WeaponState;
    addItem(items, crate.grid, createItem(items, 'ap-round', 40));
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    // Rounds it doesn't carry can't go in the gun in hand: a reload takes what's carried.
    const fromCrate = { owner: box, grid: 'loot', index: 0, item: 'ap-round' } as const;
    expect(act({ type: 'load', gun, from: fromCrate })).toBe(false);
    addItem(items, c.gear.pockets, createItem(items, 'ap-round', 40));
    const from = { owner: self, grid: 'pockets', index: 0, item: 'ap-round' } as const;
    expect(act({ type: 'load', gun, from })).toBe(true);
    expect(rifle).toMatchObject({ mag: 30, reloading: 2, reloadWith: 'ap-round' });
    expect(act({ type: 'load', gun, from })).toBe(false);
    for (let i = 0; i < 2.1 * TICK_RATE; i++) step(state, world, items, {});
    expect(rifle).toMatchObject({ mag: 30, loaded: 'ap-round', reloading: 0 });
    expect(countOf(c.gear.pockets, 'ap-round')).toBe(10);
  });

  it('reloads the gun in hand from the backpack by hand, which R does not reach', () => {
    const { state, c, act } = setup();
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    equip(c, items, 'backpack', createItem(items, 'backpack'));
    c.draw = 0;
    const rifle = c.gear.primary1 as WeaponState;
    rifle.mag = 0;
    addItem(items, c.gear.backpack!.grid, createItem(items, 'round', 40));
    const gun = { owner: self, slot: 'primary1', item: 'rifle' } as const;
    const from = { owner: self, grid: 'backpack', index: 0, item: 'round' } as const;
    expect(act({ type: 'load', gun, from })).toBe(true);
    expect(rifle).toMatchObject({ reloading: 2, reloadWith: 'round', reloadByHand: true });
    for (let i = 0; i < 2.1 * TICK_RATE; i++) step(state, world, items, {});
    expect(rifle.mag).toBe(30);
    expect(rifle.reloadByHand).toBeUndefined();
    expect(countOf(c.gear.backpack!.grid, 'round')).toBe(10);
  });

  it('drops items at your feet and picks them up again, within reach', () => {
    const { state, c, crate, act } = setup();
    addItem(items, c.gear.pockets, createItem(items, 'bandage'));
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    const ground = { kind: 'ground' } as const;
    // Dropped by double-tap and by drag.
    expect(
      act({
        type: 'quick',
        from: { owner: self, grid: 'pockets', index: 0, item: 'bandage' },
        to: ground,
      }),
    ).toBe(true);
    expect(
      act({
        type: 'move',
        from: { owner: self, slot: 'primary1', item: 'rifle' },
        to: { owner: ground },
      }),
    ).toBe(true);
    expect(c.gear.pockets.items).toEqual([]);
    expect(heldWeapon(c)).toBeNull();
    expect(state.ground.map((g) => g.item.item)).toEqual(['bandage', 'rifle']);
    // Not back onto the ground, and not from out of reach.
    const rifle = { owner: ground, ground: 1, item: 'rifle' } as const;
    expect(act({ type: 'quick', from: rifle, to: ground })).toBe(false);
    c.x = 5;
    expect(act({ type: 'quick', from: rifle, to: self })).toBe(false);
    c.x = 0;
    // Picked up: a gun into an empty gun slot, the rest into what you carry.
    expect(act({ type: 'quick', from: rifle, to: self })).toBe(true);
    expect(heldWeapon(c)?.item).toBe('rifle');
    expect(
      act({
        type: 'move',
        from: { owner: ground, ground: 0, item: 'bandage' },
        to: { owner: { kind: 'container', id: 'crate' }, grid: 'loot', x: 1, y: 1, rotated: false },
      }),
    ).toBe(true);
    expect(crate.grid.items).toMatchObject([{ x: 1, y: 1, item: { item: 'bandage' } }]);
    expect(state.ground).toEqual([]);
  });

  it('drops in front, onto the surface below, when the world is given', () => {
    const { state, c } = setup();
    addItem(items, c.gear.pockets, createItem(items, 'bandage'));
    c.y = 3;
    const from = { owner: self, grid: 'pockets', index: 0, item: 'bandage' } as const;
    applyInventory(state, c, items, { type: 'quick', from, to: { kind: 'ground' } }, world);
    const g = state.ground[0]!;
    expect(g.y).toBe(0);
    // In front (yaw 0 faces −z), where you can see it.
    expect(g.z).toBeLessThan(-0.4);
    expect(Math.abs(g.x)).toBeLessThanOrEqual(0.15);
  });

  it('swaps a gear slot with an item on the ground, and leaves a partial stack there', () => {
    const { state, c, act } = setup();
    const ground = { kind: 'ground' } as const;
    equip(c, items, 'primary1', createItem(items, 'rifle'));
    state.ground.push({ item: createItem(items, 'rifle'), x: 0.5, y: 0, z: 0, yaw: 0 });
    const mine = c.gear.primary1;
    const theirs = state.ground[0]!.item;
    expect(
      act({
        type: 'move',
        from: { owner: ground, ground: 0, item: 'rifle' },
        to: { owner: self, slot: 'primary1' },
      }),
    ).toBe(true);
    expect(c.gear.primary1).toBe(theirs);
    expect(state.ground[0]).toMatchObject({ x: 0.5, item: mine });
    // A stack too big for what you carry (and no vault): the rest stays on the ground.
    state.ground.length = 0;
    c.gear.vault = null;
    const fill = (grid: typeof c.gear.pockets) => {
      while (addItem(items, grid, { item: 'watch', count: 1 }) === 0);
    };
    fill(c.gear.pockets);
    fill(c.gear.backpack!.grid);
    c.gear.backpack!.grid.items.pop();
    state.ground.push({ item: createItem(items, 'round', 150), x: 0, y: 0, z: 0, yaw: 0 });
    expect(
      act({ type: 'quick', from: { owner: ground, ground: 0, item: 'round' }, to: self }),
    ).toBe(true);
    expect(countOf(c.gear.backpack!.grid, 'round')).toBe(100);
    expect(state.ground[0]!.item.count).toBe(50);
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

  it('reaches a container made of geometry from its footprint, not its middle', () => {
    const state = createState(1);
    const p = spawnCharacter(state, world, 0, 0);
    const map = {
      markers: [
        {
          type: 'lootContainer',
          id: 'counter',
          x: 0,
          y: 0,
          z: 0,
          // Turned 90°: 6 m long along z, 1 m across x.
          yaw: Math.PI / 2,
          container: 'desk',
          lootTable: 'household',
          solids: [0],
          hx: 3,
          hz: 0.5,
        },
      ],
    } as unknown as CompiledMap;
    const desk: LootContainerDef = {
      formatVersion: LOOT_CONTAINER_FORMAT_VERSION,
      id: 'desk',
      name: 'Desk',
      grid: [4, 3],
    };
    placeLootContainers(state, map, new Map([['desk', desk]]));
    expect(state.loot[0]!.shape).toEqual({ solids: [0], hx: 3, hz: 0.5, yaw: Math.PI / 2 });
    const owner: Owner = { kind: 'container', id: 'counter' };
    const at = (x: number, z: number): boolean => {
      p.x = x;
      p.z = z;
      return canReach(state, p, owner);
    };
    // By its end, 4 m from its middle; and 2 m off its side.
    expect(at(0, 4.5)).toBe(true);
    expect(at(2.5, 0)).toBe(true);
    expect(at(2.6, 0)).toBe(false);
    expect(at(0, 5.1)).toBe(false);
  });
});

describe("a dead enemy's gun", () => {
  /** A setup with the body's rifle at these rounds, and its quick-take action. */
  function looted(mag: number, parts: Partial<WeaponState> = {}) {
    const s = setup();
    Object.assign(s.enemy.gear.primary1 as WeaponState, { mag, ...parts });
    const action: InventoryAction = {
      type: 'quick',
      from: { owner: s.body, slot: 'primary1', item: 'rifle' },
      to: self,
    };
    return { ...s, action, tick: () => step(s.state, world, items, {}) };
  }

  /** The rifle wherever the quick move put it. */
  function rifleOf(c: ReturnType<typeof setup>['c']): WeaponState {
    return gearItems(c.gear).find((i) => i.item === 'rifle') as WeaponState;
  }

  it('keeps the rounds it had when it died, on the body and once looted', () => {
    const { c, enemy, act, action, tick } = looted(5);
    for (let i = 0; i < TICK_RATE * 3; i++) tick();
    expect((enemy.gear.primary1 as WeaponState).mag).toBe(5);
    expect(act(action)).toBe(true);
    expect(rifleOf(c).mag).toBe(5);
  });

  it('keeps an empty magazine empty, and the kind of round in it', () => {
    expect(rifleOfLooted(0).mag).toBe(0);
    const ap = rifleOfLooted(5, { loaded: 'ap-round' });
    expect([ap.mag, ap.loaded]).toEqual([5, 'ap-round']);
  });

  function rifleOfLooted(mag: number, parts: Partial<WeaponState> = {}) {
    const { c, act, action } = looted(mag, parts);
    act(action);
    return rifleOf(c);
  }

  it('never finishes a reload it died during, on the body or in your hands', () => {
    const { c, enemy, act, action, tick } = looted(5, { reloading: 0.5 });
    addItem(items, enemy.gear.pockets, createItem(items, 'round', 30));
    addItem(items, c.gear.pockets, createItem(items, 'round', 30));
    for (let i = 0; i < TICK_RATE * 3; i++) tick();
    expect((enemy.gear.primary1 as WeaponState).mag).toBe(5);
    act(action);
    for (let i = 0; i < TICK_RATE * 3; i++) tick();
    expect(rifleOf(c).mag).toBe(5);
    expect(rifleOf(c).reloading).toBe(0);
  });
});

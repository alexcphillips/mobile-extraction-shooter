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
  placeLootContainers,
  type InventoryAction,
  type LootContainer,
  type Owner,
} from './looting';
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
    // A second pistol never goes in a primary slot, even an empty one: it's carried.
    unequip(c, 'primary2');
    equip(enemy, items, 'sidearm', createItem(items, 'pistol'));
    act({ type: 'quick', from: { owner: body, slot: 'sidearm', item: 'pistol' }, to: self });
    expect(enemy.gear.sidearm).toBeNull();
    expect(c.gear.primary2).toBeNull();
    expect(countOf(c.gear.pockets, 'pistol')).toBe(1);
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
    // No vault, which would take what's left (tested above).
    c.gear.vault = null;
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
    expect(countOf(c.gear.pockets, 'scope')).toBe(1);
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
    addItem(items, c.gear.pockets, createItem(items, 'big-mag'));
    act({ type: 'attach', gun, from: { owner: self, grid: 'pockets', index: 0, item: 'big-mag' } });
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
});

import { describe, expect, it } from 'vitest';
import {
  ENEMY_FORMAT,
  LOADOUT_FORMAT,
  LOADOUT_FORMAT_VERSION,
  checkEnemies,
  type EnemyDef,
  type LoadoutDef,
} from '../content/enemies';
import { loadContent } from '../content/format';
import { createRng } from '../rng';
import { CollisionWorld } from '../world/collision-world';
import { carriedAmmo, heldWeapon } from './gear';
import { equipLoadout } from './loadout';
import { createState, spawnCharacter, type Character } from './state';
import { TEST_ITEMS } from './test-items';

function loadout(parts: Partial<LoadoutDef> = {}): LoadoutDef {
  return {
    formatVersion: LOADOUT_FORMAT_VERSION,
    id: 'kit',
    weapons: [{ weight: 1, item: 'rifle', spare: [10, 20] }],
    ...parts,
  };
}

function character(): Character {
  const world = new CollisionWorld({
    terrain: { minX: -4, minZ: -4, cellSize: 4, cols: 2, rows: 2, heights: Array(9).fill(0) },
    boxes: [],
    ramps: [],
    ladders: [],
  });
  return spawnCharacter(createState(1), world, 0, 0);
}

describe('loadouts', () => {
  it('picks each part by weight', () => {
    const kit = loadout({
      weapons: [
        { weight: 3, item: 'rifle', spare: [0, 0] },
        { weight: 1, item: 'pistol', spare: [0, 0] },
      ],
      helmets: [
        { weight: 1, item: null },
        { weight: 1, item: 'helmet' },
      ],
    });
    const rng = createRng(3);
    const c = character();
    let rifles = 0;
    let helmets = 0;
    for (let i = 0; i < 2000; i++) {
      equipLoadout(c, TEST_ITEMS, kit, rng);
      if (heldWeapon(c)!.item === 'rifle') rifles++;
      if (c.gear.helmet) helmets++;
      expect(c.gear.bodyArmour).toBeNull();
    }
    expect(rifles / 2000).toBeCloseTo(0.75, 1);
    expect(helmets / 2000).toBeCloseTo(0.5, 1);
  });

  it('rolls spare rounds, attachments by chance, and armour condition', () => {
    const kit = loadout({
      weapons: [
        {
          weight: 1,
          item: 'rifle',
          spare: [10, 20],
          attachments: [
            { item: 'big-mag' },
            { item: 'scope', chance: 0 },
            { item: 'suppressor', chance: 0.5 },
          ],
        },
      ],
      bodyArmour: [{ weight: 1, item: 'vest', condition: [0.5, 0.6] }],
    });
    const rng = createRng(5);
    const c = character();
    let suppressed = 0;
    for (let i = 0; i < 400; i++) {
      equipLoadout(c, TEST_ITEMS, kit, rng);
      const w = heldWeapon(c)!;
      expect(carriedAmmo(c, 'round')).toBeGreaterThanOrEqual(10);
      expect(carriedAmmo(c, 'round')).toBeLessThanOrEqual(20);
      expect(w.attachments.magazine).toBe('big-mag');
      expect(w.attachments.optic).toBeNull();
      // A full magazine, with the big mag's extra rounds.
      expect(w.mag).toBeGreaterThan(30);
      if (w.attachments.muzzle) suppressed++;
      const full = 50;
      expect(c.gear.bodyArmour!.durability).toBeGreaterThanOrEqual(full * 0.5 - 1e-9);
      expect(c.gear.bodyArmour!.durability).toBeLessThanOrEqual(full * 0.6 + 1e-9);
    }
    expect(suppressed / 400).toBeCloseTo(0.5, 1);
  });

  it('checks references between enemies, loadouts and items', () => {
    const enemy = (kit: string): EnemyDef =>
      loadContent(
        ENEMY_FORMAT,
        {
          formatVersion: 1,
          id: 'grunt',
          name: 'Grunt',
          loadout: kit,
          skill: { reaction: 1, aimError: 5, aimSettled: 1, aimSettle: 1, holdChance: 0.5 },
        },
        'grunt',
      );
    const ok = new Map([['kit', loadout()]]);
    expect(() => checkEnemies(new Map([['grunt', enemy('kit')]]), ok, TEST_ITEMS)).not.toThrow();
    expect(() => checkEnemies(new Map([['grunt', enemy('nope')]]), ok, TEST_ITEMS)).toThrow(
      /no loadout "nope"/,
    );
    const bad = (parts: Partial<LoadoutDef>): (() => void) => {
      return () => checkEnemies(new Map(), new Map([['kit', loadout(parts)]]), TEST_ITEMS);
    };
    expect(bad({ weapons: [{ weight: 1, item: 'helmet', spare: [0, 0] }] })).toThrow(/not weapon/);
    expect(
      bad({
        weapons: [{ weight: 1, item: 'pistol', spare: [0, 0], attachments: [{ item: 'big-mag' }] }],
      }),
    ).toThrow(/doesn't fit/);
    expect(
      bad({
        weapons: [
          { weight: 1, item: 'rifle', spare: [0, 0], ammo: [{ weight: 1, item: 'shell' }] },
        ],
      }),
    ).toThrow(/doesn't fire "shell"/);
    expect(bad({ helmets: [{ weight: 1, item: 'vest' }] })).toThrow(/not helmet armour/);
    expect(bad({ rigs: [{ weight: 1, item: 'backpack' }] })).toThrow(/not a rig/);
    expect(bad({ backpacks: [{ weight: 1, item: 'watch' }] })).toThrow(/not a backpack/);
  });

  it('puts a pistol in the sidearm slot, wears a rig and backpack, and stows the spare rounds', () => {
    const kit = loadout({
      weapons: [{ weight: 1, item: 'pistol', spare: [250, 250] }],
      rigs: [{ weight: 1, item: 'rig' }],
      backpacks: [{ weight: 1, item: 'backpack' }],
    });
    const c = character();
    equipLoadout(c, TEST_ITEMS, kit, createRng(1));
    expect(c.gear.hand).toBe('sidearm');
    expect(c.gear.sidearm?.item).toBe('pistol');
    expect(c.gear.primary1).toBeNull();
    expect(c.gear.rig?.item).toBe('rig');
    expect(c.gear.backpack?.grid.w).toBe(4);
    // Stacks of 100: pockets take all 250, in three cells.
    expect(carriedAmmo(c, 'round')).toBe(250);
    expect(c.gear.pockets.items.map((g) => g.item.count)).toEqual([100, 100, 50]);
    // Rolling again starts over rather than piling on, and keeps the vault.
    c.gear.vault!.items.push({ x: 0, y: 0, rotated: false, item: { item: 'watch', count: 1 } });
    equipLoadout(c, TEST_ITEMS, kit, createRng(1));
    expect(carriedAmmo(c, 'round')).toBe(250);
    expect(c.gear.vault!.items).toHaveLength(1);
  });

  it('loads the gun with a round picked by weight, and carries spares of it', () => {
    const kit = loadout({
      weapons: [
        {
          weight: 1,
          item: 'rifle',
          spare: [10, 10],
          ammo: [
            { weight: 1, item: 'round' },
            { weight: 1, item: 'ap-round' },
          ],
        },
      ],
    });
    const rng = createRng(5);
    const c = character();
    let ap = 0;
    for (let i = 0; i < 400; i++) {
      equipLoadout(c, TEST_ITEMS, kit, rng);
      const loaded = heldWeapon(c)!.loaded ?? 'round';
      expect(carriedAmmo(c, loaded)).toBe(10);
      if (loaded === 'ap-round') ap++;
    }
    expect(ap / 400).toBeCloseTo(0.5, 1);
  });

  it('rejects a backwards range or a condition above 1', () => {
    const raw = (parts: Record<string, unknown>) => ({ ...loadout(), ...parts });
    expect(() =>
      loadContent(
        LOADOUT_FORMAT,
        raw({ weapons: [{ weight: 1, item: 'rifle', spare: [20, 10] }] }),
        'kit',
      ),
    ).toThrow(/min must not be above max/);
    expect(() =>
      loadContent(
        LOADOUT_FORMAT,
        raw({ helmets: [{ weight: 1, item: 'helmet', condition: [0.5, 1.5] }] }),
        'kit',
      ),
    ).toThrow();
  });
});

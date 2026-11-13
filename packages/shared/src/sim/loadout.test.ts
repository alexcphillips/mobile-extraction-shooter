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
      expect(c.gear.bodyArmor).toBeNull();
    }
    expect(rifles / 2000).toBeCloseTo(0.75, 1);
    expect(helmets / 2000).toBeCloseTo(0.5, 1);
  });

  it('rolls spare rounds, attachments by chance, and armor condition', () => {
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
      bodyArmor: [{ weight: 1, item: 'vest', condition: [0.5, 0.6] }],
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
      expect(c.gear.bodyArmor!.durability).toBeGreaterThanOrEqual(full * 0.5 - 1e-9);
      expect(c.gear.bodyArmor!.durability).toBeLessThanOrEqual(full * 0.6 + 1e-9);
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
    expect(bad({ helmets: [{ weight: 1, item: 'vest' }] })).toThrow(/not helmet armor/);
    expect(bad({ rigs: [{ weight: 1, item: 'backpack' }] })).toThrow(/not a rig/);
    expect(bad({ backpacks: [{ weight: 1, item: 'watch' }] })).toThrow(/not a backpack/);
    expect(bad({ grenades: [{ weight: 1, item: 'rifle' }] })).toThrow(/not a grenade to throw/);
    expect(
      bad({
        grenades: [
          { weight: 1, item: null },
          { weight: 1, item: 'grenade' },
        ],
      }),
    ).not.toThrow();
  });

  it('rolls grenades by weight and count, stowed first so they go in the pockets (AI-6)', () => {
    const kit = loadout({
      weapons: [{ weight: 1, item: 'rifle', spare: [200, 200] }],
      grenades: [
        { weight: 1, item: null },
        { weight: 3, item: 'grenade', count: [1, 2] },
      ],
    });
    const rng = createRng(5);
    const c = character();
    const counts = [0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      equipLoadout(c, TEST_ITEMS, kit, rng);
      const pockets = c.gear.pockets.items.filter((gi) => gi.item.item === 'grenade').length;
      counts[pockets]!++;
    }
    expect(counts[0]! / 2000).toBeCloseTo(0.25, 1);
    expect(counts[1]! / 2000).toBeCloseTo(0.375, 1);
    expect(counts[2]! / 2000).toBeCloseTo(0.375, 1);
  });

  it('rolls each group of meds by weight and count, in reach before the spare rounds', () => {
    const kit = loadout({
      weapons: [{ weight: 1, item: 'rifle', spare: [300, 300] }],
      rigs: [{ weight: 1, item: 'rig' }],
      meds: [
        [
          { weight: 6, item: 'medkit', count: [1, 1] },
          { weight: 2, item: 'medkit', count: [2, 2] },
          { weight: 2, item: null },
        ],
        [
          { weight: 5, item: 'bandage', count: [1, 1] },
          { weight: 3, item: 'bandage', count: [2, 2] },
          { weight: 2, item: null },
        ],
      ],
    });
    const rng = createRng(6);
    const c = character();
    const medkits = [0, 0, 0];
    const bandages = [0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      equipLoadout(c, TEST_ITEMS, kit, rng);
      // Pockets and rig only: where they can be used from.
      const reach = [...c.gear.pockets.items, ...(c.gear.rig?.grid?.items ?? [])];
      medkits[reach.filter((g) => g.item.item === 'medkit').length]!++;
      bandages[reach.filter((g) => g.item.item === 'bandage').length]!++;
    }
    expect(medkits.map((n) => n / 2000)).toEqual([
      expect.closeTo(0.2, 1),
      expect.closeTo(0.6, 1),
      expect.closeTo(0.2, 1),
    ]);
    expect(bandages.map((n) => n / 2000)).toEqual([
      expect.closeTo(0.2, 1),
      expect.closeTo(0.5, 1),
      expect.closeTo(0.3, 1),
    ]);
    expect(() =>
      checkEnemies(
        new Map(),
        new Map([['kit', loadout({ meds: [[{ weight: 1, item: 'rifle' }]] })]]),
        TEST_ITEMS,
      ),
    ).toThrow(/not a med/);
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

describe('spare magazines (MG-3)', () => {
  const rig = { rigs: [{ weight: 1, item: 'rig' }] };

  it('a magazine-fed gun gets 3 full spares, or 4 with rounds for 5; the rest stay loose', () => {
    const count = (c: Character) => {
      const mags = [...c.gear.pockets.items, ...c.gear.rig!.grid.items].filter(
        (g) => g.item.item === 'smg-mag',
      );
      return {
        mags: mags.length,
        full: mags.every((g) => g.item.mag === 20),
        loose: carriedAmmo(c, 'round'),
      };
    };
    const few = character();
    equipLoadout(
      few,
      TEST_ITEMS,
      loadout({ ...rig, weapons: [{ weight: 1, item: 'smg', spare: [70, 70] }] }),
      createRng(1),
    );
    expect(count(few)).toEqual({ mags: 3, full: true, loose: 10 });
    const many = character();
    equipLoadout(
      many,
      TEST_ITEMS,
      loadout({ ...rig, weapons: [{ weight: 1, item: 'smg', spare: [110, 110] }] }),
      createRng(1),
    );
    expect(count(many)).toEqual({ mags: 4, full: true, loose: 30 });
  });

  it('none for other guns, nor with magazines off (zombies mode)', () => {
    const c = character();
    equipLoadout(
      c,
      TEST_ITEMS,
      loadout({ ...rig, weapons: [{ weight: 1, item: 'smg', spare: [70, 70] }] }),
      createRng(1),
      false,
    );
    expect(carriedAmmo(c, 'round')).toBe(70);
    const r = character();
    equipLoadout(
      r,
      TEST_ITEMS,
      loadout({ ...rig, weapons: [{ weight: 1, item: 'rifle', spare: [70, 70] }] }),
      createRng(1),
    );
    expect(carriedAmmo(r, 'round')).toBe(70);
  });
});

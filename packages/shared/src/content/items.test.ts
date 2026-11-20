import { describe, expect, it } from 'vitest';
import { ContentError, loadContent } from './format';
import {
  ITEM_FORMAT,
  ITEM_FORMAT_VERSION,
  checkItems,
  defaultSounds,
  fits,
  pointsFor,
  pointsForScale,
  statAt,
  weaponDef,
  type CurvedStat,
  type ItemDef,
  type WeaponDef,
} from './items';

const pointsRound = (stat: CurvedStat, v: number) => Math.round(pointsFor(stat, v));
import { modelShapes, type WeaponModel } from './models';
import { placeholderModel } from './placeholder-models';

/** An item with the default sounds and placeholder model for its kind. */
const m = <T extends object>(raw: T) => {
  const sounds = defaultSounds(raw);
  return {
    ...raw,
    rarity: 'common',
    ...(sounds && { sounds }),
    model: placeholderModel(raw as Record<string, unknown>),
  };
};

const ammo = m({
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'round',
  name: 'Round',
  type: 'ammo',
  size: [1, 1],
  value: 100,
  weight: 1,
  stack: 60,
  caliber: 'round',
  level: 3,
  damage: 40,
  armorDamage: 10,
  bleedChance: 0.2,
});
const gun = m({
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'gun',
  name: 'Gun',
  type: 'weapon',
  size: [4, 2],
  value: 100,
  weight: 1,
  ammo: 'round',
  fireMode: 'auto',
  rpm: 600,
  magazine: 30,
  reloadTime: 2,
  stats: {
    recoilUp: 50,
    recoilSide: 50,
    stability: 50,
    handling: 67,
    hipFire: 26,
    accuracy: 30,
    range: 59,
    loudness: 74,
  },
  slots: ['optic', 'magazine'],
  recoil: { snap: 40, recovery: 12 },
});

/** The gun as format 12 had it, before points. */
const { stats: _stats, ...gunBase } = gun;
const gunV12 = {
  ...gunBase,
  formatVersion: 12,
  ergonomics: 67,
  range: 150,
  loudness: 150,
  hipSpread: 3,
  aimSpread: 0.5,
  recoil: { up: 0.8, side: 0.3, snap: 40, recovery: 12 },
};

const dot = { type: 'dot', x: 0, y: 0, r: 1 };
const scope = m({
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'scope',
  name: 'Scope',
  type: 'attachment',
  size: [2, 1],
  value: 100,
  weight: 1,
  slot: 'optic',
  optic: { zoom: 4, reticle: { color: '#000000', shapes: [dot] } },
});
const mag = m({
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'mag',
  name: 'Mag',
  type: 'attachment',
  size: [1, 2],
  value: 100,
  weight: 1,
  slot: 'magazine',
  weapons: ['gun'],
  mods: { magazine: 10 },
});

function db(...raws: object[]): Map<string, ItemDef> {
  return new Map(
    raws.map((raw) => {
      const def = loadContent(ITEM_FORMAT, raw, 'x.json');
      return [def.id, def];
    }),
  );
}

describe('items', () => {
  it('loads each type and rejects bad fields', () => {
    expect(loadContent(ITEM_FORMAT, gun, 'gun.json').type).toBe('weapon');
    expect(() => loadContent(ITEM_FORMAT, { ...ammo, bleedChance: 2 }, 'a.json')).toThrow(
      ContentError,
    );
    expect(() => loadContent(ITEM_FORMAT, { ...ammo, typo: 1 }, 'a.json')).toThrow(ContentError);
    expect(() => loadContent(ITEM_FORMAT, { ...gun, type: 'grenade' }, 'g.json')).toThrow(
      ContentError,
    );
  });

  it("holds a loot item's value to its rarity's band, but not cash", () => {
    const loot = {
      formatVersion: ITEM_FORMAT_VERSION,
      id: 'gem',
      name: 'Gem',
      type: 'loot',
      size: [1, 1],
      weight: 0.1,
    };
    const item = (rarity: string, value: number, extra = {}) =>
      db({ ...m({ ...loot, value, ...extra }), rarity });
    expect(() => checkItems(item('rare', 4000))).not.toThrow();
    expect(() => checkItems(item('rare', 12000))).not.toThrow();
    expect(() => checkItems(item('rare', 3999))).toThrow(/rare loot item is worth 4000–12000/);
    expect(() => checkItems(item('common', 2000))).toThrow(/not 2000/);
    expect(() => checkItems(item('common', 1, { stack: 500, money: true }))).not.toThrow();
  });

  it('checks that weapons name a real ammo item', () => {
    const items = db(gun, ammo);
    expect(() => checkItems(items)).not.toThrow();
    items.delete('round');
    expect(() => checkItems(items)).toThrow(/ammo "round"/);
    expect(() => weaponDef(items, 'round')).toThrow(/no item/);
  });

  it('upgrades format 1 weapons with a default loudness', () => {
    const { loudness: _, slots: __, size: ___, ...old } = gunV12;
    const def = loadContent(ITEM_FORMAT, { ...old, formatVersion: 1 }, 'gun.json');
    const loudness = pointsRound('loudness', 150);
    expect(def).toMatchObject({ stats: { loudness }, formatVersion: ITEM_FORMAT_VERSION });
    expect(def.type === 'weapon' && def.slots).toBe(undefined);
  });

  it('upgrades format 2 items with a grid size by type, and ammo with a stack', () => {
    const v2 = (raw: object, drop: string[]) =>
      loadContent(
        ITEM_FORMAT,
        Object.fromEntries(
          Object.entries({ ...raw, formatVersion: 2 }).filter(([k]) => !drop.includes(k)),
        ),
        'x.json',
      );
    expect(v2(gun, ['size']).size).toEqual([4, 2]);
    expect(v2({ ...gun, hold: 'pistol' }, ['size']).size).toEqual([2, 1]);
    expect(v2(ammo, ['size', 'stack'])).toMatchObject({ size: [1, 1], stack: 60 });
    expect(v2(mag, ['size']).size).toEqual([1, 1]);
    const helmet = {
      id: 'h',
      name: 'H',
      type: 'armor',
      slot: 'helmet',
      absorb: 0.5,
      durability: 9,
    };
    expect(v2(helmet, []).size).toEqual([2, 2]);
    expect(v2({ ...helmet, slot: 'body' }, []).size).toEqual([3, 3]);
  });

  it('upgrades format 3 knives with their stats', () => {
    const v3 = (raw: object) => loadContent(ITEM_FORMAT, { ...raw, formatVersion: 3 }, 'x.json');
    const knife = { id: 'k', name: 'K', type: 'melee', size: [1, 2] };
    expect(v3(knife)).toMatchObject({ damage: 40, reach: 1.5, swingTime: 0.5 });
  });

  it("upgrades format 11 guns to ergonomics, and attachments' ergonomics to recovery", () => {
    const { ergonomics: _, ...rest } = gunV12;
    const old = { ...rest, formatVersion: 11, aimTime: 0.25, drawTime: 0.8 };
    const def = loadContent(ITEM_FORMAT, old, 'g.json');
    expect(def).toMatchObject({ stats: { handling: 67 } });
    expect(def).not.toHaveProperty('aimTime');
    expect(def).not.toHaveProperty('drawTime');
  });

  it("upgrades format 12 guns' stats and attachments' mods to points", () => {
    const def = loadContent(ITEM_FORMAT, gunV12, 'g.json') as WeaponDef;
    expect(def.stats).toEqual({
      recoilUp: pointsRound('recoilUp', 0.8),
      recoilSide: pointsRound('recoilSide', 0.3),
      stability: 50,
      handling: 67,
      hipFire: pointsRound('hipFire', 3),
      accuracy: pointsRound('accuracy', 0.5),
      range: pointsRound('range', 150),
      loudness: pointsRound('loudness', 150),
    });
    expect(def.recoil).toEqual({ snap: 40, recovery: 12 });
    // Values come back within half a point of what they were.
    const close = (stat: CurvedStat, was: number) =>
      expect(Math.abs(statAt(stat, def.stats[stat]) / was - 1)).toBeLessThan(0.025);
    close('recoilUp', 0.8);
    close('hipFire', 3);
    close('range', 150);
    const stock = {
      ...mag,
      id: 'st',
      slot: 'stock',
      stock: { length: 1 },
      formatVersion: 12,
      mods: {
        recoil: 0.8,
        recoilUp: 0.9,
        spread: 0.85,
        recovery: 1.2,
        ergonomics: -3,
        aimTime: 1.1,
      },
    };
    expect(loadContent(ITEM_FORMAT, stock, 's.json')).toMatchObject({
      mods: {
        recoilUp: Math.round(pointsForScale('recoilUp', 0.72)),
        recoilSide: Math.round(pointsForScale('recoilSide', 0.8)),
        hipFire: Math.round(pointsForScale('hipFire', 0.85)),
        accuracy: Math.round(pointsForScale('accuracy', 0.85)),
        handling: -3,
        aimTime: 1.1,
      },
    });
    expect(loadContent(ITEM_FORMAT, stock, 's.json').type === 'attachment').toBe(true);
    const mods = (loadContent(ITEM_FORMAT, stock, 's.json') as { mods: object }).mods;
    expect(mods).not.toHaveProperty('recovery');
  });

  it('upgrades format 4 items with a value by type, and repair kits with a use time', () => {
    const v4 = (raw: object) => {
      const { value: _, ...old } = raw as { value?: number };
      return loadContent(ITEM_FORMAT, { ...old, formatVersion: 4 }, 'x.json');
    };
    expect(v4(gun).value).toBe(10_000);
    expect(v4(ammo).value).toBe(30);
    const kit = { id: 'k', name: 'K', type: 'repair', size: [2, 1], points: 50 };
    expect(v4(kit)).toMatchObject({ value: 10_000, useTime: 8 });
    expect(v4({ id: 'q', name: 'Q', type: 'quest', size: [1, 1] }).value).toBe(0);
  });

  it('upgrades format 8 rounds, armor and knives with levels', () => {
    const v8 = (raw: object, drop: string[]) =>
      loadContent(
        ITEM_FORMAT,
        Object.fromEntries(
          Object.entries({ ...raw, formatVersion: 8 }).filter(([k]) => !drop.includes(k)),
        ),
        'x.json',
      );
    expect(v8({ ...ammo, armorDamage: 1.5 }, ['caliber', 'level'])).toMatchObject({
      caliber: 'round',
      level: 1,
      armorDamage: 15,
    });
    const helmet = {
      id: 'h',
      name: 'H',
      type: 'armor',
      size: [2, 2],
      value: 1,
      weight: 1,
      rarity: 'common',
    };
    const old = { ...helmet, slot: 'helmet', absorb: 0.6, durability: 9, model: { parts: [] } };
    const up = v8({ ...old, model: placeholderModel(old) }, []);
    expect(up).toMatchObject({ level: 4 });
    expect(up).not.toHaveProperty('absorb');
  });

  it('refuses levels outside 1 to 6', () => {
    expect(() => loadContent(ITEM_FORMAT, { ...ammo, level: 7 }, 'a.json')).toThrow(ContentError);
    expect(() => loadContent(ITEM_FORMAT, { ...ammo, level: 0 }, 'a.json')).toThrow(ContentError);
  });

  it('loads the other types, and checks meds have hp only for heal', () => {
    const base = {
      formatVersion: ITEM_FORMAT_VERSION,
      id: 'x',
      name: 'X',
      size: [1, 1],
      value: 10,
      weight: 1,
    };
    const ok = [
      { ...base, type: 'med', effect: 'bandage', useTime: 2 },
      { ...base, type: 'med', effect: 'splint', useTime: 2, uses: 3 },
      { ...base, type: 'med', effect: 'heal', useTime: 3, hp: 200 },
      { ...base, type: 'container', slot: 'backpack', grid: [4, 5] },
      {
        ...base,
        type: 'melee',
        damage: 40,
        level: 1,
        armorDamage: 5,
        bleedChance: 0.3,
        swingTime: 0.5,
        reach: 1.5,
        drawTime: 0.3,
      },
      { ...base, type: 'key' },
      { ...base, type: 'quest' },
      { ...base, type: 'loot', stack: 500 },
      { ...base, type: 'repair', points: 100, useTime: 5 },
      { ...base, type: 'loot', stack: 500, money: true },
    ];
    for (const raw of ok) expect(() => loadContent(ITEM_FORMAT, m(raw), 'x.json')).not.toThrow();
    const bad = [
      { ...base, type: 'med', effect: 'heal', useTime: 3 },
      { ...base, type: 'med', effect: 'bandage', useTime: 2, hp: 50 },
      { ...base, type: 'med', effect: 'heal', useTime: 3, hp: 50, uses: 2 },
      { ...base, type: 'container', slot: 'pocket', grid: [1, 1] },
      { ...base, type: 'loot', stack: 1 },
      { ...base, type: 'key', size: [0, 1] },
      { ...base, type: 'quest', value: -1 },
      { ...base, type: 'quest', value: 2.5 },
      { ...base, type: 'repair', points: 100 },
    ];
    for (const raw of bad)
      expect(() => loadContent(ITEM_FORMAT, m(raw), 'x.json')).toThrow(ContentError);
  });

  it('loads attachments; only optics have an optic section', () => {
    expect(loadContent(ITEM_FORMAT, scope, 's.json').type).toBe('attachment');
    const { optic: _, ...blind } = scope;
    expect(() => loadContent(ITEM_FORMAT, blind, 's.json')).toThrow(/optic/);
    expect(() => loadContent(ITEM_FORMAT, { ...mag, optic: scope.optic }, 'm.json')).toThrow(
      /optic/,
    );
    const badShape = { ...scope.optic.reticle, shapes: [{ ...dot, type: 'star' }] };
    expect(() =>
      loadContent(ITEM_FORMAT, { ...scope, optic: { zoom: 4, reticle: badShape } }, 's.json'),
    ).toThrow(ContentError);
    expect(() => loadContent(ITEM_FORMAT, { ...gun, slots: ['optic', 'optic'] }, 'g.json')).toThrow(
      /twice/,
    );
  });

  it('checks that attachments name guns with their slot', () => {
    expect(() => checkItems(db(gun, ammo, mag, scope))).not.toThrow();
    expect(() => checkItems(db(ammo, mag))).toThrow(/"gun" in weapons/);
    expect(() => checkItems(db(m({ ...gun, slots: ['optic'] }), ammo, mag))).toThrow(
      /no magazine slot/,
    );
  });

  describe('platforms (AT-1)', () => {
    const other = m({ ...ammo, id: 'other', caliber: 'other' });
    const on = (id: string, platform?: string, extra: object = {}) =>
      m({ ...gun, id, ...(platform && { platform }), ...extra });
    const sight = (extra: object) => m({ ...scope, id: 'p', ...extra });
    /** The guns a part fits, of these, once checkItems passes them (if asked). */
    const fitted = (guns: object[], part: object, check = true) => {
      const items = db(ammo, other, ...guns, part);
      if (check) checkItems(items);
      const def = items.get('p')!;
      return [...items.values()]
        .filter((g) => g.type === 'weapon' && def.type === 'attachment' && fits(items, g, def))
        .map((g) => g.id);
    };
    const guns = [on('a', 'ar'), on('b', 'ar'), on('d')];

    it('fits guns on a listed platform, and listed guns beside them', () => {
      expect(fitted(guns, sight({ platforms: ['ar'] }))).toEqual(['a', 'b']);
      expect(fitted(guns, sight({ platforms: ['ar'], weapons: ['d'] }))).toEqual(['a', 'b', 'd']);
    });

    it('fits a magazine only to magazine-fed platform guns of its caliber', () => {
      const fed = { feed: 'magazine' };
      const mags = [
        on('a', 'ar', fed),
        on('c', 'ar', { ...fed, ammo: 'other' }),
        on('t', 'ar'), // loose rounds: no magazine goes in
      ];
      const { mods: _, weapons: _w, ...rest } = mag;
      const box = m({ ...rest, id: 'p', capacity: 30, caliber: 'round', platforms: ['ar'] });
      expect(fitted(mags, box, false)).toEqual(['a']);
    });

    it('refuses a platform no gun is on, or one it fits none of', () => {
      expect(() => fitted(guns, sight({ platforms: ['ak'] }))).toThrow(
        /no gun is on platform "ak"/,
      );
      const bare = [on('a', 'ar', { slots: ['magazine'] }), on('d')];
      expect(() => fitted(bare, sight({ platforms: ['ar'] }))).toThrow(
        /fits no gun on platform "ar"/,
      );
    });

    it('refuses a gun listed that fits by its platform already', () => {
      expect(() => fitted(guns, sight({ platforms: ['ar'], weapons: ['a'] }))).toThrow(
        /fits by its platform too/,
      );
    });

    it('fits guns of a listed class beside listed platforms and guns (AT-3)', () => {
      const kinds = [
        on('a', 'ar', { class: 'assault' }),
        on('s', 'ar', { class: 'shotgun' }),
        on('d', undefined, { class: 'pistol' }),
      ];
      expect(fitted(kinds, sight({ classes: ['assault'] }))).toEqual(['a']);
      expect(fitted(kinds, sight({ classes: ['assault', 'pistol'] }))).toEqual(['a', 'd']);
      expect(fitted(kinds, sight({ classes: ['shotgun'], weapons: ['d'] }))).toEqual(['s', 'd']);
      expect(() => fitted(kinds, sight({ classes: ['pistol'], weapons: ['d'] }))).toThrow(
        /fits by its class too/,
      );
      expect(() => fitted(kinds, sight({ classes: ['sniper'] }))).toThrow(/fits no sniper gun/);
    });

    it('needs a magazine to list guns or platforms', () => {
      const { mods: _, weapons: _w, ...rest } = mag;
      const box = m({ ...rest, id: 'p', capacity: 30, caliber: 'round' });
      expect(() => loadContent(ITEM_FORMAT, box, 'x.json')).toThrow(/weapons or platforms/);
    });
  });

  it('upgrades format 5 items with the placeholder model of their kind', () => {
    const v5 = (raw: object) => {
      const { model: _, ...old } = raw as { model?: unknown };
      return loadContent(ITEM_FORMAT, { ...old, formatVersion: 5 }, 'x.json');
    };
    const rifle = v5(gun);
    if (rifle.type !== 'weapon') throw new Error('not a weapon');
    // Only the mounts of its slots, and no part hidden by a slot it lacks.
    expect(Object.keys(rifle.model.mounts ?? {}).sort()).toEqual(['magazine', 'optic']);
    expect(rifle.model.parts.every((p) => p.hiddenBy !== 'muzzle')).toBe(true);
    const pistol = v5({ ...gun, hold: 'pistol', size: [2, 1] });
    expect(pistol.type === 'weapon' && pistol.model.grip).toEqual([0, -0.055, 0.005]);
    const red = v5({ ...scope, optic: { ...scope.optic, zoom: 1 } });
    expect(red.type === 'attachment' && red.model.sight).toEqual([0, 0.045, -0.09]);
    // Anything never drawn before is a box the size of its grid, as it was on the ground.
    expect(v5({ ...ammo, size: [2, 1] }).model.parts).toEqual([
      { type: 'box', pos: [0, 0, 0], size: [0.28, 0.07, 0.14], color: '#9a8238' },
    ]);
  });

  it('upgrades format 6 items with the sounds of their kind', () => {
    const v6 = (raw: object) => {
      const { sounds: _, ...old } = raw as { sounds?: unknown };
      return loadContent(ITEM_FORMAT, { ...old, formatVersion: 6 }, 'x.json');
    };
    expect(v6(gun)).toMatchObject({
      sounds: { shot: 'rifle-shot', suppressed: 'rifle-shot-suppressed', reload: 'rifle-reload' },
    });
    expect(v6({ ...gun, hold: 'pistol' })).toMatchObject({ sounds: { shot: 'pistol-shot' } });
    const base = {
      formatVersion: ITEM_FORMAT_VERSION,
      id: 'x',
      name: 'X',
      size: [1, 1],
      value: 10,
      weight: 1,
    };
    const splint = m({ ...base, type: 'med', effect: 'splint', useTime: 2 });
    expect(v6(splint)).toMatchObject({ sounds: { use: 'bandage-use' } });
    const medkit = m({ ...base, type: 'med', effect: 'heal', useTime: 2, hp: 50 });
    expect(v6(medkit)).toMatchObject({ sounds: { use: 'med-use' } });
    expect('sounds' in v6(ammo)).toBe(false);
    // Format 7 needs them.
    const { sounds: _, ...silent } = gun;
    expect(() => loadContent(ITEM_FORMAT, silent, 'g.json')).toThrow(/sounds/);
  });

  it('upgrades format 7 items to common, and checks rarities', () => {
    const { rarity: _, ...old } = gun;
    expect(loadContent(ITEM_FORMAT, { ...old, formatVersion: 7 }, 'g.json')).toMatchObject({
      rarity: 'common',
    });
    expect(loadContent(ITEM_FORMAT, { ...gun, rarity: 'epic' }, 'g.json').rarity).toBe('epic');
    expect(() => loadContent(ITEM_FORMAT, old, 'g.json')).toThrow(/rarity/);
    expect(() => loadContent(ITEM_FORMAT, { ...gun, rarity: 'shiny' }, 'g.json')).toThrow(/rarity/);
  });

  it('checks models have the points their kind needs', () => {
    const model = gun.model as WeaponModel;
    const { magazine: _, ...noMag } = model.mounts!;
    expect(() =>
      loadContent(ITEM_FORMAT, { ...gun, model: { ...model, mounts: noMag } }, 'g.json'),
    ).toThrow(/needs a magazine mount/);
    const muzzle = { ...model.mounts, muzzle: [0, 0, -0.5] };
    expect(() =>
      loadContent(ITEM_FORMAT, { ...gun, model: { ...model, mounts: muzzle } }, 'g.json'),
    ).toThrow(/no muzzle slot/);
    const hidden = [...model.parts, { ...model.parts[0]!, hiddenBy: 'muzzle' }];
    expect(() =>
      loadContent(ITEM_FORMAT, { ...gun, model: { ...model, parts: hidden } }, 'g.json'),
    ).toThrow(/hidden by muzzle/);
    const { sight: __, ...blind } = scope.model as { sight?: unknown };
    expect(() => loadContent(ITEM_FORMAT, { ...scope, model: blind }, 's.json')).toThrow(
      /sight point/,
    );
    expect(() =>
      loadContent(ITEM_FORMAT, { ...mag, model: { ...mag.model, muzzle: [0, 0, 0] } }, 'm.json'),
    ).toThrow(/muzzle point/);
    expect(() => loadContent(ITEM_FORMAT, { ...ammo, model: { parts: [] } }, 'a.json')).toThrow(
      ContentError,
    );
  });

  it('turns parts into shapes, moved onto a mount, without the hidden ones', () => {
    const model = gun.model as WeaponModel;
    const all = modelShapes(model);
    expect(all).toHaveLength(model.parts.length);
    const optic = (slot: string) => slot === 'optic';
    const fitted = modelShapes(model, [], [0, 1, 0], optic);
    expect(fitted).toHaveLength(model.parts.length - 1);
    expect(fitted[0]).toMatchObject({ kind: 'box', y: model.parts[0]!.pos[1] + 1, hx: 0.03 });
    const [tube] = modelShapes(scope.model).filter((s) => s.kind === 'cylinder');
    expect(tube).toMatchObject({ pitch: Math.PI / 2, hy: 0.1, radiusTop: 0.016, sides: 8 });
  });
});

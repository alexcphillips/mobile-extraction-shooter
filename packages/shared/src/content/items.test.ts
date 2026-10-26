import { describe, expect, it } from 'vitest';
import { ContentError, loadContent } from './format';
import { ITEM_FORMAT, ITEM_FORMAT_VERSION, checkItems, weaponDef, type ItemDef } from './items';

const ammo = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'round',
  name: 'Round',
  type: 'ammo',
  size: [1, 1],
  stack: 60,
  damage: 40,
  bleedChance: 0.2,
};
const gun = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'gun',
  name: 'Gun',
  type: 'weapon',
  size: [4, 2],
  ammo: 'round',
  fireMode: 'auto',
  rpm: 600,
  magazine: 30,
  reloadTime: 2,
  aimTime: 0.25,
  range: 150,
  loudness: 150,
  slots: ['optic', 'magazine'],
  hipSpread: 3,
  aimSpread: 0.5,
  recoil: { up: 0.8, side: 0.3, recovery: 12 },
};

const dot = { type: 'dot', x: 0, y: 0, r: 1 };
const scope = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'scope',
  name: 'Scope',
  type: 'attachment',
  size: [2, 1],
  slot: 'optic',
  optic: { zoom: 4, reticle: { colour: '#000000', shapes: [dot] } },
};
const mag = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'mag',
  name: 'Mag',
  type: 'attachment',
  size: [1, 2],
  slot: 'magazine',
  weapons: ['gun'],
  mods: { magazine: 10 },
};

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

  it('checks that weapons name a real ammo item', () => {
    const items = db(gun, ammo);
    expect(() => checkItems(items)).not.toThrow();
    items.delete('round');
    expect(() => checkItems(items)).toThrow(/ammo "round"/);
    expect(() => weaponDef(items, 'round')).toThrow(/no item/);
  });

  it('upgrades format 1 weapons with a default loudness', () => {
    const { loudness: _, slots: __, size: ___, ...old } = gun;
    const def = loadContent(ITEM_FORMAT, { ...old, formatVersion: 1 }, 'gun.json');
    expect(def).toMatchObject({ loudness: 150, formatVersion: ITEM_FORMAT_VERSION });
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
      type: 'armour',
      slot: 'helmet',
      absorb: 0.5,
      durability: 9,
    };
    expect(v2(helmet, []).size).toEqual([2, 2]);
    expect(v2({ ...helmet, slot: 'body' }, []).size).toEqual([3, 3]);
  });

  it('loads the other types, and checks meds have hp only for heal', () => {
    const base = { formatVersion: ITEM_FORMAT_VERSION, id: 'x', name: 'X', size: [1, 1] };
    const ok = [
      { ...base, type: 'med', effect: 'bandage', useTime: 2 },
      { ...base, type: 'med', effect: 'splint', useTime: 2, uses: 3 },
      { ...base, type: 'med', effect: 'heal', useTime: 3, hp: 200 },
      { ...base, type: 'container', slot: 'backpack', grid: [4, 5] },
      { ...base, type: 'melee' },
      { ...base, type: 'key' },
      { ...base, type: 'quest' },
      { ...base, type: 'loot', stack: 500 },
      { ...base, type: 'repair', points: 100 },
    ];
    for (const raw of ok) expect(() => loadContent(ITEM_FORMAT, raw, 'x.json')).not.toThrow();
    const bad = [
      { ...base, type: 'med', effect: 'heal', useTime: 3 },
      { ...base, type: 'med', effect: 'bandage', useTime: 2, hp: 50 },
      { ...base, type: 'med', effect: 'heal', useTime: 3, hp: 50, uses: 2 },
      { ...base, type: 'container', slot: 'pocket', grid: [1, 1] },
      { ...base, type: 'loot', stack: 1 },
      { ...base, type: 'key', size: [0, 1] },
    ];
    for (const raw of bad)
      expect(() => loadContent(ITEM_FORMAT, raw, 'x.json')).toThrow(ContentError);
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
    expect(() => checkItems(db({ ...gun, slots: ['optic'] }, ammo, mag))).toThrow(
      /no magazine slot/,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { ContentError, loadContent } from './format';
import { ITEM_FORMAT, ITEM_FORMAT_VERSION, checkItems, weaponDef, type ItemDef } from './items';

const ammo = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'round',
  name: 'Round',
  type: 'ammo',
  damage: 40,
  bleedChance: 0.2,
};
const gun = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'gun',
  name: 'Gun',
  type: 'weapon',
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
  slot: 'optic',
  optic: { zoom: 4, reticle: { colour: '#000000', shapes: [dot] } },
};
const mag = {
  formatVersion: ITEM_FORMAT_VERSION,
  id: 'mag',
  name: 'Mag',
  type: 'attachment',
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
    const { loudness: _, slots: __, ...old } = gun;
    const def = loadContent(ITEM_FORMAT, { ...old, formatVersion: 1 }, 'gun.json');
    expect(def).toMatchObject({ loudness: 150, formatVersion: ITEM_FORMAT_VERSION });
    expect(def.type === 'weapon' && def.slots).toBe(undefined);
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

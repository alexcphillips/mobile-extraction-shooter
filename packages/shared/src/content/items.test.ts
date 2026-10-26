import { describe, expect, it } from 'vitest';
import { ContentError, loadContent } from './format';
import { ITEM_FORMAT, checkItems, weaponDef, type ItemDef } from './items';

const ammo = {
  formatVersion: 1,
  id: 'round',
  name: 'Round',
  type: 'ammo',
  damage: 40,
  bleedChance: 0.2,
};
const gun = {
  formatVersion: 1,
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
  hipSpread: 3,
  aimSpread: 0.5,
  recoil: { up: 0.8, side: 0.3, recovery: 12 },
};

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
    const items = new Map<string, ItemDef>(
      [gun, ammo].map((raw) => {
        const def = loadContent(ITEM_FORMAT, raw, 'x.json');
        return [def.id, def];
      }),
    );
    expect(() => checkItems(items)).not.toThrow();
    items.delete('round');
    expect(() => checkItems(items)).toThrow(/ammo "round"/);
    expect(() => weaponDef(items, 'round')).toThrow(/no item/);
  });
});

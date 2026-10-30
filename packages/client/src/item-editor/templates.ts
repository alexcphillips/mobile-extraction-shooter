import { defaultSounds, ITEM_FORMAT_VERSION, placeholderModel, type ItemDef } from '@mes/shared';

export type ItemType = ItemDef['type'];

/** The item types in the order the editor lists them. */
export const ITEM_TYPES: readonly ItemType[] = [
  'weapon',
  'ammo',
  'attachment',
  'armour',
  'container',
  'med',
  'melee',
  'key',
  'quest',
  'loot',
  'repair',
];

/**
 * A new item of a type with middling stats to start from (session 18), keys in the order
 * the hand-written files use, then its kind's default sounds and placeholder model. A weapon fires
 * `ammo` (the first ammo item, say).
 */
export function blankItem(type: ItemType, id: string, name: string, ammo = ''): ItemDef {
  const doc = blankStats(type, id, name, ammo);
  const sounds = defaultSounds(doc);
  // Common to start with, after the value as the hand-written files have it.
  const stats = Object.entries(doc).flatMap(([k, v]) =>
    k === 'value' ? [[k, v] as const, ['rarity', 'common'] as const] : [[k, v] as const],
  );
  return {
    ...Object.fromEntries(stats),
    ...(sounds && { sounds }),
    model: placeholderModel(doc),
  } as ItemDef;
}

function blankStats(type: ItemType, id: string, name: string, ammo: string) {
  const common = { formatVersion: ITEM_FORMAT_VERSION as typeof ITEM_FORMAT_VERSION, id, name };
  switch (type) {
    case 'weapon':
      return {
        ...common,
        type,
        size: [4, 2],
        value: 10_000,
        ammo,
        hold: 'rifle',
        fireMode: 'auto',
        rpm: 600,
        magazine: 30,
        reloadTime: 2.4,
        aimTime: 0.3,
        drawTime: 0.8,
        range: 150,
        loudness: 150,
        slots: ['optic', 'muzzle', 'magazine'],
        hipSpread: 3,
        aimSpread: 0.5,
        recoil: { up: 1, side: 0.4, recovery: 14 },
      };
    case 'ammo':
      return {
        ...common,
        type,
        size: [1, 1],
        value: 30,
        stack: 60,
        calibre: 'new',
        level: 1,
        damage: 35,
        armourDamage: 10,
        bleedChance: 0.2,
      };
    case 'attachment':
      return { ...common, type, size: [1, 1], value: 5_000, slot: 'muzzle', mods: { recoil: 0.9 } };
    case 'armour':
      return {
        ...common,
        type,
        size: [3, 3],
        value: 10_000,
        slot: 'body',
        level: 1,
        durability: 60,
      };
    case 'container':
      return { ...common, type, size: [3, 3], value: 5_000, slot: 'backpack', grid: [4, 4] };
    case 'med':
      return { ...common, type, size: [1, 1], value: 1_000, effect: 'bandage', useTime: 2 };
    case 'melee':
      return {
        ...common,
        type,
        size: [1, 2],
        value: 500,
        damage: 40,
        level: 1,
        armourDamage: 5,
        bleedChance: 0.3,
        swingTime: 0.5,
        reach: 1.5,
        drawTime: 0.3,
      };
    case 'key':
      return { ...common, type, size: [1, 1], value: 2_000 };
    case 'quest':
      return { ...common, type, size: [1, 1], value: 0 };
    case 'loot':
      return { ...common, type, size: [1, 1], value: 1_000 };
    case 'repair':
      return { ...common, type, size: [2, 1], value: 10_000, points: 50, useTime: 8 };
  }
}

/** A new optic section, for an attachment moved to the optic slot: a red dot. */
export const BLANK_OPTIC = {
  zoom: 1,
  reticle: { colour: '#ff3b30', shapes: [{ type: 'dot' as const, x: 0, y: 0, r: 0.8 }] },
};

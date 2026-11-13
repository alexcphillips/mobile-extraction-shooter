import {
  defaultSounds,
  ITEM_FORMAT_VERSION,
  placeholderModel,
  weightGuess,
  type ItemDef,
  type ItemModel,
} from '@mes/shared';

export type ItemType = ItemDef['type'];

/**
 * What the editor lists, picks and makes items as (2026-11-11, the user's call): the item
 * types, with containers split into rigs, armored rigs and backpacks (a container is then
 * only a vault). A kind is the editor's alone: the file still says `container` and its slot.
 */
export type ItemKind =
  Exclude<ItemType, 'container'> | 'rig' | 'armored rig' | 'backpack' | 'container';

/** The kinds in the order the editor lists them. */
export const ITEM_KINDS: readonly ItemKind[] = [
  'weapon',
  'ammo',
  'attachment',
  'armor',
  'rig',
  'armored rig',
  'backpack',
  'container',
  'med',
  'melee',
  'grenade',
  'key',
  'quest',
  'loot',
  'repair',
  'headset',
  'visor',
  'nightVision',
  'plate',
];

/** An item's kind: a container by its slot and armor, anything else by its type. */
export function kindOf(def: { type: string; slot?: unknown; armor?: unknown }): ItemKind {
  if (def.type !== 'container') return def.type as ItemKind;
  if (def.slot === 'rig') return def.armor ? 'armored rig' : 'rig';
  return def.slot === 'backpack' ? 'backpack' : 'container';
}

/**
 * A new rig's model, armored or not (2026-11-11, the user's call): the armored chest rig's,
 * worn on the chest, so a new rig isn't a backpack on the back.
 */
const RIG_MODEL: ItemModel = {
  parts: [
    { type: 'box', pos: [0, 1.22, -0.14], size: [0.33, 0.3, 0.05], color: '#4c5a36' },
    { type: 'box', pos: [0, 1.22, 0.14], size: [0.33, 0.3, 0.04], color: '#424e2f' },
    { type: 'box', pos: [0.11, 1.38, 0], size: [0.07, 0.035, 0.29], color: '#4c5a36' },
    { type: 'box', pos: [-0.11, 1.38, 0], size: [0.07, 0.035, 0.29], color: '#424e2f' },
    { type: 'box', pos: [-0.12, 1.11, -0.185], size: [0.07, 0.1, 0.04], color: '#3b4529' },
    { type: 'box', pos: [-0.04, 1.11, -0.185], size: [0.07, 0.1, 0.04], color: '#3b4529' },
    { type: 'box', pos: [0.04, 1.11, -0.185], size: [0.07, 0.1, 0.04], color: '#3b4529' },
    { type: 'box', pos: [0.12, 1.11, -0.185], size: [0.07, 0.1, 0.04], color: '#3b4529' },
  ],
};

/** A rig's four 1×2 pouches, as the chest rigs have. */
const RIG_POUCHES = [0, 1, 2, 3].map((x) => ({ at: [x, 0], size: [1, 2] }));

/**
 * A new item of a type with middling stats to start from (session 18), keys in the order
 * the hand-written files use, then its kind's default sounds and placeholder model. A weapon fires
 * `ammo` (the first ammo item, say).
 */
export function blankItem(kind: ItemKind, id: string, name: string, ammo = ''): ItemDef {
  const doc = blankStats(kind, id, name, ammo);
  const sounds = defaultSounds(doc);
  // A guessed weight and common to start with, after the value as the hand-written files have them.
  const stats = Object.entries(doc).flatMap(([k, v]) =>
    k === 'value'
      ? [[k, v] as const, ['weight', weightGuess(doc.type)] as const, ['rarity', 'common'] as const]
      : [[k, v] as const],
  );
  return {
    ...Object.fromEntries(stats),
    ...(sounds && { sounds }),
    model: kind === 'rig' || kind === 'armored rig' ? copyModel(RIG_MODEL) : placeholderModel(doc),
  } as ItemDef;
}

const copyModel = (m: ItemModel): ItemModel => structuredClone(m);

function blankStats(kind: ItemKind, id: string, name: string, ammo: string) {
  const common = { formatVersion: ITEM_FORMAT_VERSION as typeof ITEM_FORMAT_VERSION, id, name };
  const type = kind;
  switch (kind) {
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
        ergonomics: 55,
        range: 150,
        loudness: 150,
        slots: ['optic', 'muzzle', 'magazine'],
        hipSpread: 3,
        aimSpread: 0.5,
        recoil: { up: 1, side: 0.4, snap: 40, recovery: 4 },
      };
    case 'ammo':
      return {
        ...common,
        type,
        size: [1, 1],
        value: 30,
        stack: 60,
        caliber: 'new',
        level: 1,
        damage: 35,
        armorDamage: 10,
        bleedChance: 0.2,
      };
    case 'attachment':
      return { ...common, type, size: [1, 1], value: 5_000, slot: 'muzzle', mods: { recoil: 0.9 } };
    case 'armor':
      return {
        ...common,
        type,
        size: [3, 3],
        value: 10_000,
        slot: 'body',
        level: 1,
        durability: 60,
      };
    case 'rig':
      return {
        ...common,
        type: 'container' as const,
        size: [2, 3],
        value: 6_000,
        slot: 'rig',
        grid: [4, 2],
        sections: RIG_POUCHES,
      };
    case 'armored rig':
      return {
        ...common,
        type: 'container' as const,
        size: [3, 3],
        value: 26_000,
        slot: 'rig',
        grid: [4, 2],
        sections: RIG_POUCHES,
        armor: { level: 3, durability: 55, repairLoss: 0.12 },
      };
    case 'backpack':
      return {
        ...common,
        type: 'container' as const,
        size: [3, 3],
        value: 5_000,
        slot: 'backpack',
        grid: [4, 4],
      };
    case 'container':
      return { ...common, type, size: [2, 2], value: 5_000, slot: 'vault', grid: [3, 3] };
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
        armorDamage: 5,
        bleedChance: 0.3,
        swingTime: 0.5,
        reach: 1.5,
        drawTime: 0.3,
      };
    case 'grenade':
      return {
        ...common,
        type,
        size: [1, 1],
        value: 3_000,
        fuse: 3,
        throwSpeed: 15,
        radius: 7,
        damage: 100,
        level: 3,
        armorDamage: 15,
        bleedChance: 0.4,
        loudness: 1000,
      };
    case 'key':
      return { ...common, type, size: [1, 1], value: 2_000 };
    case 'quest':
      return { ...common, type, size: [1, 1], value: 0 };
    case 'loot':
      return { ...common, type, size: [1, 1], value: 1_000 };
    case 'repair':
      return { ...common, type, size: [2, 1], value: 10_000, points: 50, useTime: 8 };
    case 'headset':
      return { ...common, type, size: [2, 1], value: 8_000, hearing: 0.15 };
    case 'visor':
      return {
        ...common,
        type,
        size: [2, 1],
        value: 12_000,
        level: 3,
        durability: 30,
        repairLoss: 0.5,
        vision: { vignette: 0.25 },
      };
    case 'plate':
      return {
        ...common,
        type,
        size: [2, 2],
        value: 15_000,
        level: 4,
        durability: 50,
        repairLoss: 0.1,
      };
    case 'nightVision':
      return {
        ...common,
        type,
        size: [1, 2],
        value: 30_000,
        tint: '#7dff8a',
        noise: 0.35,
        softness: 0.4,
        gain: 3,
        shape: 'tube',
      };
  }
}

/** A new optic section, for an attachment moved to the optic slot: a red dot. */
export const BLANK_OPTIC = {
  zoom: 1,
  reticle: { color: '#ff3b30', shapes: [{ type: 'dot' as const, x: 0, y: 0, r: 0.8 }] },
};

/** What an item keeps when its type changes: what every type has, and its model. */
const KEPT_ON_RETYPE = ['name', 'shortName', 'size', 'value', 'rarity', 'view', 'model'] as const;

/**
 * The item as another type (2026-11-11, for loot that should have been a med): the new
 * type's blank stats and default sounds, keeping its name, size, value, rarity, view and
 * model. What only the old type had (a loot category, a gun's stats) is dropped.
 */
export function retype(def: ItemDef, kind: ItemKind, ammo = ''): ItemDef {
  const was = def as unknown as Record<string, unknown>;
  // One container kind to another keeps its inside too: only its slot and armor change.
  if (def.type === 'container' && CONTAINER_KINDS.includes(kind)) {
    const out = { ...was, slot: kindSlot(kind) } as Record<string, unknown>;
    if (kind === 'armored rig') out.armor ??= { level: 3, durability: 55, repairLoss: 0.12 };
    else delete out.armor;
    return out as unknown as ItemDef;
  }
  const out = blankItem(kind, def.id, def.name, ammo) as unknown as Record<string, unknown>;
  for (const k of KEPT_ON_RETYPE) if (was[k] !== undefined) out[k] = was[k];
  return out as unknown as ItemDef;
}

const CONTAINER_KINDS: readonly ItemKind[] = ['rig', 'armored rig', 'backpack', 'container'];

function kindSlot(kind: ItemKind): string {
  return kind === 'rig' || kind === 'armored rig'
    ? 'rig'
    : kind === 'backpack'
      ? 'backpack'
      : 'vault';
}

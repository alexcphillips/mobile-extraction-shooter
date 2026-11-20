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
 * A new rig's model, armored or not: worn on the chest, so a new rig isn't a backpack on
 * the back. The old chest rig's since 2026-11-15 (the user's call), which keeps out of the
 * arms' way (fit-check.test.ts); every rig shares it until each gets its own.
 */
const RIG_MODEL: ItemModel = {
  parts: [
    {
      name: 'backing',
      type: 'box',
      pos: [0, 1.3, -0.143],
      size: [0.33, 0.13, 0.05],
      color: '#3f4636',
    },
    {
      name: 'pouch -0.105',
      type: 'box',
      pos: [-0.105, 1.29, -0.189],
      size: [0.062, 0.11, 0.042],
      color: '#5d6266',
    },
    {
      name: 'flap -0.105',
      type: 'box',
      pos: [-0.105, 1.352, -0.19],
      size: [0.066, 0.024, 0.046],
      color: '#4e5357',
    },
    {
      name: 'tab -0.105',
      type: 'box',
      pos: [-0.105, 1.33, -0.213],
      size: [0.022, 0.03, 0.006],
      color: '#4e5357',
    },
    {
      name: 'pouch -0.035',
      type: 'box',
      pos: [-0.035, 1.29, -0.189],
      size: [0.062, 0.11, 0.042],
      color: '#5d6266',
    },
    {
      name: 'flap -0.035',
      type: 'box',
      pos: [-0.035, 1.352, -0.19],
      size: [0.066, 0.024, 0.046],
      color: '#4e5357',
    },
    {
      name: 'tab -0.035',
      type: 'box',
      pos: [-0.035, 1.33, -0.213],
      size: [0.022, 0.03, 0.006],
      color: '#4e5357',
    },
    {
      name: 'pouch 0.035',
      type: 'box',
      pos: [0.035, 1.29, -0.189],
      size: [0.062, 0.11, 0.042],
      color: '#5d6266',
    },
    {
      name: 'flap 0.035',
      type: 'box',
      pos: [0.035, 1.352, -0.19],
      size: [0.066, 0.024, 0.046],
      color: '#4e5357',
    },
    {
      name: 'tab 0.035',
      type: 'box',
      pos: [0.035, 1.33, -0.213],
      size: [0.022, 0.03, 0.006],
      color: '#4e5357',
    },
    {
      name: 'pouch 0.105',
      type: 'box',
      pos: [0.105, 1.29, -0.189],
      size: [0.062, 0.11, 0.042],
      color: '#5d6266',
    },
    {
      name: 'flap 0.105',
      type: 'box',
      pos: [0.105, 1.352, -0.19],
      size: [0.066, 0.024, 0.046],
      color: '#4e5357',
    },
    {
      name: 'tab 0.105',
      type: 'box',
      pos: [0.105, 1.33, -0.213],
      size: [0.022, 0.03, 0.006],
      color: '#4e5357',
    },
    {
      name: 'harness front R',
      type: 'box',
      pos: [0.115, 1.435, -0.124],
      size: [0.035, 0.14, 0.012],
      color: '#3f4636',
    },
    {
      name: 'harness front L',
      type: 'box',
      pos: [-0.115, 1.435, -0.124],
      size: [0.035, 0.14, 0.012],
      color: '#3f4636',
    },
    {
      name: 'harness top R',
      type: 'box',
      pos: [0.13, 1.514, -0.004],
      size: [0.035, 0.012, 0.24],
      color: '#3f4636',
    },
    {
      name: 'harness top L',
      type: 'box',
      pos: [-0.13, 1.514, -0.004],
      size: [0.035, 0.012, 0.24],
      color: '#3f4636',
    },
    {
      name: 'harness back R',
      type: 'box',
      pos: [0.115, 1.42, 0.112],
      size: [0.035, 0.17, 0.012],
      color: '#3f4636',
    },
    {
      name: 'harness back L',
      type: 'box',
      pos: [-0.115, 1.42, 0.112],
      size: [0.035, 0.17, 0.012],
      color: '#3f4636',
    },
    {
      name: 'back strap',
      type: 'box',
      pos: [0, 1.3, 0.112],
      size: [0.27, 0.03, 0.012],
      color: '#3f4636',
    },
    {
      name: 'side strap R',
      type: 'box',
      pos: [0.178, 1.3, -0.005],
      size: [0.025, 0.03, 0.23],
      color: '#3f4636',
    },
    {
      name: 'side strap L',
      type: 'box',
      pos: [-0.178, 1.3, -0.005],
      size: [0.025, 0.03, 0.23],
      color: '#3f4636',
    },
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
        stats: {
          recoilUp: 47,
          recoilSide: 49,
          stability: 50,
          handling: 55,
          hipFire: 26,
          accuracy: 30,
          range: 59,
          loudness: 74,
        },
        slots: ['optic', 'muzzle', 'magazine'],
        recoil: { snap: 40, recovery: 4 },
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
      return {
        ...common,
        type,
        size: [1, 1],
        value: 5_000,
        slot: 'muzzle',
        mods: { recoilUp: -2, recoilSide: -2 },
      };
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

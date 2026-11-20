import {
  bagRarity,
  defaultSounds,
  HANDLING,
  ITEM_FORMAT_VERSION,
  clampPoints,
  pointsFor,
  pointsForScale,
  type CurvedStat,
  type ItemDb,
  type ItemDef,
} from '../content/items';
import type { ItemModel } from '../content/models';
import { addItem, type Grid } from '../inventory/grid';
import { placeholderModel } from '../content/placeholder-models';

/** The test guns' handling: a 0.2 s aim (and a draw of about 0.5 s). */
const AIM_02 = (HANDLING.aimAt0 - 0.2) / HANDLING.aimPerPoint;

/**
 * The points a test gun's value sits at, unrounded so the sim gets the value back. Zero
 * spread or kick is as near as the curves go: 100 points of hip-fire or accuracy, 0 of recoil.
 */
const at = (stat: CurvedStat, value: number) => clampPoints(value ? pointsFor(stat, value) : 0);
const gunStats = (o: { range: number; loudness: number; up: number; side: number }) => ({
  recoilUp: at('recoilUp', o.up),
  recoilSide: at('recoilSide', o.side),
  stability: 50,
  handling: AIM_02,
  hipFire: 100,
  accuracy: 100,
  range: at('range', o.range),
  loudness: at('loudness', o.loudness),
});
/** An attachment's multipliers as points. */
const scale = (stat: CurvedStat, by: number) => pointsForScale(stat, by);

function common(id: string, size: [number, number]) {
  return {
    formatVersion: ITEM_FORMAT_VERSION as typeof ITEM_FORMAT_VERSION,
    id,
    name: id,
    size,
    value: 100,
  };
}

/**
 * A small item set for tests, independent of content/; models are the placeholders and
 * sounds the defaults.
 */
const defs = [
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'rifle',
    size: [4, 2],
    value: 100,
    name: 'Rifle',
    type: 'weapon',
    ammo: 'round',
    fireMode: 'auto',
    rpm: 600,
    magazine: 30,
    reloadTime: 2,
    stats: gunStats({ range: 200, loudness: 150, up: 1, side: 0 }),
    slots: ['optic', 'muzzle', 'magazine', 'rightRail'],
    recoil: { snap: 40, recovery: 10 },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'pistol',
    size: [2, 1],
    value: 100,
    name: 'Pistol',
    type: 'weapon',
    ammo: 'round',
    hold: 'pistol',
    fireMode: 'semi',
    rpm: 600,
    magazine: 12,
    reloadTime: 1,
    stats: gunStats({ range: 100, loudness: 100, up: 0, side: 0 }),
    slots: ['muzzle'],
    recoil: { snap: 40, recovery: 10 },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'shotgun',
    size: [4, 1],
    value: 100,
    name: 'Shotgun',
    type: 'weapon',
    ammo: 'shell',
    fireMode: 'semi',
    rpm: 60,
    magazine: 4,
    reloadTime: 2,
    stats: gunStats({ range: 50, loudness: 150, up: 2, side: 0 }),
    recoil: { snap: 40, recovery: 10 },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'shell',
    size: [1, 1],
    value: 100,
    name: 'Shell',
    type: 'ammo',
    stack: 20,
    caliber: 'shell',
    level: 1,
    damage: 5,
    armorDamage: 2,
    bleedChance: 0,
    pellets: 6,
    pelletSpread: 0,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'round',
    size: [1, 1],
    value: 100,
    name: 'Round',
    type: 'ammo',
    stack: 100,
    caliber: 'round',
    level: 3,
    damage: 40,
    armorDamage: 10,
    bleedChance: 0,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'ap-round',
    size: [1, 1],
    value: 300,
    name: 'AP round',
    type: 'ammo',
    stack: 100,
    caliber: 'round',
    level: 5,
    damage: 30,
    armorDamage: 15,
    bleedChance: 0,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'bleeder',
    size: [1, 1],
    value: 100,
    name: 'Bleeding round',
    type: 'ammo',
    stack: 100,
    caliber: 'round',
    level: 3,
    damage: 10,
    armorDamage: 10,
    bleedChance: 1,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'helmet',
    size: [2, 2],
    value: 100,
    name: 'Helmet',
    type: 'armor',
    slot: 'helmet',
    level: 3,
    durability: 30,
    // No repair wear, so tests of kits' points and timing stay simple; 'plate' wears.
    repairLoss: 0,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'vest',
    size: [3, 3],
    value: 100,
    name: 'Vest',
    type: 'armor',
    slot: 'body',
    level: 4,
    durability: 50,
    repairLoss: 0,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'plate',
    size: [3, 3],
    value: 100,
    name: 'Plate',
    type: 'armor',
    slot: 'body',
    level: 4,
    durability: 100,
    repairLoss: 0.1,
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'scope',
    size: [2, 1],
    value: 100,
    name: 'Scope',
    type: 'attachment',
    slot: 'optic',
    mods: { aimTime: 2 },
    optic: { zoom: 4, reticle: { color: '#000000', shapes: [{ type: 'dot', x: 0, y: 0, r: 1 }] } },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'combo-scope',
    size: [2, 1],
    value: 100,
    name: 'Combo scope',
    type: 'attachment',
    slot: 'optic',
    // A scope with a red dot riding on top (optic.alt), for the sight button.
    optic: {
      zoom: 4,
      reticle: { color: '#000000', shapes: [{ type: 'dot', x: 0, y: 0, r: 1 }] },
      alt: {
        zoom: 1,
        reticle: { color: '#ff0000', shapes: [{ type: 'dot', x: 0, y: 0, r: 0.3 }] },
        sight: [0, 0.07, -0.04],
      },
    },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'suppressor',
    size: [2, 1],
    value: 100,
    name: 'Suppressor',
    type: 'attachment',
    slot: 'muzzle',
    mods: {
      loudness: scale('loudness', 0.25),
      recoilUp: scale('recoilUp', 0.5),
      recoilSide: scale('recoilSide', 0.5),
    },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'big-mag',
    size: [1, 2],
    value: 100,
    name: 'Big magazine',
    type: 'attachment',
    slot: 'magazine',
    weapons: ['rifle'],
    mods: { magazine: 20, reloadTime: 1.5 },
  },
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'laser',
    size: [1, 1],
    value: 100,
    name: 'Laser',
    type: 'attachment',
    slot: 'rail',
    mods: { hipFire: scale('hipFire', 0.5) },
  },
  // WF-1, AT-1b: a carbine with a stub factory stock (no cells), a fixed stock and a folding one.
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'carbine',
    size: [3, 2],
    value: 100,
    name: 'Carbine',
    type: 'weapon',
    ammo: 'round',
    fireMode: 'auto',
    rpm: 600,
    magazine: 30,
    reloadTime: 2,
    stats: gunStats({ range: 200, loudness: 150, up: 1, side: 0.5 }),
    stock: { length: 0 },
    slots: ['optic', 'stock'],
    recoil: { snap: 40, recovery: 10 },
  },
  // AT-1b: the carbine with a factory stock that folds by itself, a cell shorter folded.
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'folder',
    size: [4, 2],
    value: 100,
    name: 'Folder',
    type: 'weapon',
    ammo: 'round',
    fireMode: 'auto',
    rpm: 600,
    magazine: 30,
    reloadTime: 2,
    stats: gunStats({ range: 200, loudness: 150, up: 1, side: 0.5 }),
    stock: { length: 1 },
    slots: ['optic', 'stock'],
    recoil: { snap: 40, recovery: 10 },
  },
  {
    ...common('stock', [2, 1]),
    type: 'attachment',
    slot: 'stock',
    stock: { length: 1 },
    mods: { recoilUp: scale('recoilUp', 0.5), recoilSide: scale('recoilSide', 0.5) },
  },
  {
    ...common('folding-stock', [2, 1]),
    type: 'attachment',
    slot: 'stock',
    stock: { length: 2, foldedLength: 1 },
    mods: { recoilUp: scale('recoilUp', 0.25), recoilSide: scale('recoilSide', 0.25) },
  },
  // MG-1: a gun that takes magazines, its own and a big one.
  {
    formatVersion: ITEM_FORMAT_VERSION,
    id: 'smg',
    size: [3, 2],
    value: 100,
    name: 'SMG',
    type: 'weapon',
    ammo: 'round',
    fireMode: 'auto',
    rpm: 600,
    magazine: 20,
    feed: 'magazine',
    reloadTime: 2,
    stats: gunStats({ range: 200, loudness: 150, up: 1, side: 0 }),
    defaults: { magazine: 'smg-mag' },
    slots: ['muzzle', 'magazine'],
    recoil: { snap: 40, recovery: 10 },
  },
  {
    ...common('smg-mag', [1, 1]),
    type: 'attachment',
    slot: 'magazine',
    weapons: ['smg'],
    capacity: 20,
    caliber: 'round',
  },
  {
    ...common('smg-drum', [2, 2]),
    type: 'attachment',
    slot: 'magazine',
    weapons: ['smg'],
    capacity: 50,
    caliber: 'round',
    mods: { reloadTime: 1.5 },
    rows: 1, // WF-2: a row under the gun
  },
  // WF-2: a long suppressor, a column longer on the gun.
  {
    ...common('long-can', [2, 1]),
    type: 'attachment',
    slot: 'muzzle',
    columns: 1,
    mods: { loudness: scale('loudness', 0.25) },
  },
  // GZ-2: a headset, and a helmet that covers the ears with comms built in.
  { ...common('headset', [2, 1]), type: 'headset', hearing: 0.2 },
  {
    ...common('full-helmet', [2, 2]),
    type: 'armor',
    slot: 'helmet',
    level: 4,
    durability: 40,
    hearing: 0.1,
    blocksHeadset: true,
    vision: { shape: 'slit' },
    visor: true,
  },
  // GZ-3: a full mask, covering the face itself.
  {
    ...common('mask-helmet', [2, 2]),
    type: 'armor',
    slot: 'helmet',
    level: 5,
    durability: 50,
    coversFace: true,
  },
  // GZ-4: plates, a carrier that comes with a front plate, and a bulky one.
  { ...common('plate-4', [2, 2]), type: 'plate', level: 4, durability: 40 },
  { ...common('plate-2', [2, 2]), type: 'plate', level: 2, durability: 40 },
  {
    ...common('carrier', [3, 3]),
    type: 'armor',
    slot: 'body',
    level: 2,
    durability: 30,
    carrier: { plates: ['front', 'back'], comesWith: { front: 'plate-4' } },
  },
  {
    ...common('bulky-carrier', [3, 3]),
    type: 'armor',
    slot: 'body',
    level: 1,
    durability: 30,
    carrier: { plates: ['front'], softZones: ['thorax'], blocksRig: true, swapTime: 4 },
  },
  // GZ-5: a visor for it.
  {
    ...common('visor', [2, 1]),
    type: 'visor',
    level: 4,
    durability: 20,
    vision: { vignette: 0.2 },
  },
  { ...common('bandage', [1, 1]), type: 'med', effect: 'bandage', useTime: 2 },
  { ...common('splint', [1, 1]), type: 'med', effect: 'splint', useTime: 3, uses: 2 },
  { ...common('surgery', [2, 1]), type: 'med', effect: 'surgery', useTime: 10 },
  { ...common('medkit', [1, 2]), type: 'med', effect: 'heal', useTime: 3, hp: 100 },
  {
    ...common('med-crate', [1, 2]),
    type: 'med',
    effect: 'heal',
    useTime: 5,
    hp: 100,
    bleedCost: 30,
  },
  { ...common('rig', [2, 2]), type: 'container', slot: 'rig', grid: [3, 2] },
  { ...common('backpack', [3, 3]), type: 'container', slot: 'backpack', grid: [4, 4] },
  { ...common('vault', [2, 2]), type: 'container', slot: 'vault', grid: [2, 2] },
  {
    // An armored rig (2026-11-11): the vest's level, chest armor as a rig.
    ...common('plate-rig', [2, 3]),
    type: 'container',
    slot: 'rig',
    grid: [2, 2],
    armor: { level: 4, durability: 60, repairLoss: 0.1 },
  },
  {
    ...common('pouch-rig', [2, 2]),
    type: 'container',
    slot: 'rig',
    grid: [3, 2],
    sections: [0, 1, 2].map((x) => ({ at: [x, 0], size: [1, 2] })),
  },
  {
    ...common('knife', [1, 2]),
    type: 'melee',
    damage: 40,
    level: 1,
    armorDamage: 5,
    bleedChance: 0,
    swingTime: 0.5,
    reach: 1.5,
    drawTime: 0.2,
  },
  {
    ...common('grenade', [1, 1]),
    type: 'grenade',
    fuse: 3,
    throwSpeed: 15,
    radius: 7,
    damage: 110,
    level: 3,
    armorDamage: 15,
    bleedChance: 0,
    loudness: 1000,
  },
  {
    ...common('smoke', [1, 1]),
    type: 'grenade',
    effect: 'smoke',
    fuse: 2,
    throwSpeed: 15,
    radius: 5,
    damage: 0,
    level: 1,
    armorDamage: 0,
    bleedChance: 0,
    loudness: 40,
    smokeTime: 20,
  },
  { ...common('key', [1, 1]), type: 'key' },
  { ...common('worn-key', [1, 1]), type: 'key', uses: 2 },
  { ...common('notes', [1, 1]), type: 'quest' },
  { ...common('cash', [1, 1]), value: 1, type: 'loot', stack: 1000, money: true },
  { ...common('watch', [1, 1]), type: 'loot' },
  // A kg each, to carry a load in tests (BW-3; see carryLoad).
  { ...common('ballast', [1, 1]), weight: 1, type: 'loot', stack: 1000 },
  { ...common('repair-kit', [2, 1]), type: 'repair', points: 50, useTime: 5 },
];

/** A rig's or backpack's grid; null for anything else (a vault has no rarity rule). */
function bagOf(d: Record<string, unknown>): Parameters<typeof bagRarity>[0] | null {
  return d.type === 'container' && d.slot !== 'vault'
    ? (d as unknown as Parameters<typeof bagRarity>[0])
    : null;
}

/** The folding stock folds by itself, about a hinge on its left, as the folder's own does. */
function withFold(id: string, model: ItemModel): ItemModel {
  const fold = { pivot: [-0.03, 0, 0], yaw: 180 } as const;
  if (id === 'folding-stock') return { ...model, fold: { ...fold, pivot: [...fold.pivot] } };
  if (id === 'folder') return { ...model, factoryFold: { ...fold, pivot: [...fold.pivot] } };
  return model;
}

/** The laser has a beam point, which makes it a laser (hasLaser) that can be switched off. */
function withLaser(id: string, model: ItemModel): ItemModel {
  return id === 'laser' ? { ...model, laser: [0, 0, -0.03] } : model;
}

export const TEST_ITEMS: ItemDb = new Map(
  defs.map((d) => {
    const sounds = defaultSounds(d);
    return [
      d.id,
      {
        // Weightless unless set (BW-3), so tests not about weight move as before.
        weight: 0,
        ...d,
        // A rig's or backpack's rarity by its cells (bagRarity); the rest are common.
        rarity: bagOf(d) ? bagRarity(bagOf(d)!) : 'common',
        ...(sounds && { sounds }),
        model: withLaser(d.id, withFold(d.id, placeholderModel(d))),
      } as ItemDef,
    ];
  }),
);

/**
 * Puts `kg` of ballast in a character's pockets (BW-3): the reference load (WEIGHT.reference)
 * makes footsteps as loud as before weight, for tests about hearing.
 */
export function carryLoad(c: { gear: { pockets: Grid } }, kg: number): void {
  addItem(TEST_ITEMS, c.gear.pockets, { item: 'ballast', count: kg });
}

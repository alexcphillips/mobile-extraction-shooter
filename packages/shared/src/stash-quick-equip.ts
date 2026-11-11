import {
  RARITIES,
  armorOf,
  isArmoredRig,
  itemDef,
  roundCaliber,
  caliberOf,
  roundOf,
  sectionsOf,
  type AmmoDef,
  type ItemDb,
  type ItemDef,
  type WeaponClass,
  type WeaponDef,
} from './content/items';
import { addItem, stackOf, type Grid, type Item } from './inventory/grid';
import type { Profile } from './profile';
import { carriedGrid, CARRIED_GRIDS, fitsSlot, type Gear, type GearSlot } from './sim/gear';
import { maxDurability } from './sim/repair';
import { createWeaponStats, loadedAmmo, weaponStats, type WeaponState } from './sim/weapons';

/*
 * Quick equip (2026-11-09, the user's call), from the stash's equipment panel. Everything
 * worn and carried goes into the stash (not the knife or the vault), then the best kit
 * from the stash is put on: see docs/design.md → Quick equip. All or none: if what's left
 * over doesn't fit back in the stash, nothing changes.
 *
 * Only what lies loose on a stash page (or was just taken off) is picked from, not what's
 * inside a rig or backpack stored on a page.
 */

/** A gun is picked only with rounds of one kind for a full load and this many reloads. */
export const QUICK_EQUIP_RELOADS = 3;
/** Armor under this share of its durability ranks two levels lower. */
const WORN_SHARE = 0.3;
const WORN_PENALTY = 2;
/** Bleeding: stop adding bandage meds at this many uses, or this many items. */
const BLEED_USES = 4;
const BLEED_ITEMS = 2;

export type QuickEquipResult = 'equipped' | 'unchanged' | 'full';

const stats = createWeaponStats();

/** The slots emptied into the stash first; the knife stays. */
const STRIPPED: readonly GearSlot[] = [
  'primary1',
  'primary2',
  'sidearm',
  'helmet',
  'bodyArmor',
  'rig',
  'backpack',
];

/** Where a candidate lies: taken off just now (loose), or on a stash page. */
interface Pool {
  loose: Item[];
  pages: Grid[];
}

function* poolItems(p: Pool): Generator<Item> {
  yield* p.loose;
  for (const g of p.pages) for (const gi of g.items) yield gi.item;
}

/** Takes an item out of the pool, wherever it is. */
function takeOut(p: Pool, it: Item): Item {
  const i = p.loose.indexOf(it);
  if (i >= 0) {
    p.loose.splice(i, 1);
    return it;
  }
  for (const g of p.pages) {
    const j = g.items.findIndex((gi) => gi.item === it);
    if (j >= 0) {
      g.items.splice(j, 1);
      return it;
    }
  }
  throw new Error(`"${it.item}" isn't in the pool`);
}

/** Rounds of an ammo item in the pool, loose and on the pages. */
function roundsIn(p: Pool, id: string): number {
  let n = 0;
  for (const it of poolItems(p)) if (it.item === id) n += it.count;
  return n;
}

/** Takes up to n of an item from the pool, loose first; returns the pieces taken. */
function takeRounds(p: Pool, id: string, n: number): Item[] {
  const out: Item[] = [];
  for (const it of [...poolItems(p)]) {
    if (n <= 0) break;
    if (it.item !== id) continue;
    const k = Math.min(it.count, n);
    n -= k;
    if (k === it.count) out.push(takeOut(p, it));
    else {
      it.count -= k;
      out.push(stackOf(it, k));
    }
  }
  return out;
}

const rarityOf = (def: ItemDef): number => RARITIES.indexOf(def.rarity);

/** Compares by keys in order, each higher first; then the name, A first. */
function better(a: readonly number[], an: string, b: readonly number[], bn: string): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return an.localeCompare(bn) < 0;
}

/** The best item by a score (null to skip it); on a full tie the first found wins. */
function best(
  p: Pool,
  items: ItemDb,
  score: (it: Item, def: ItemDef) => readonly number[] | null,
): Item | null {
  let top: Item | null = null;
  let topKey: readonly number[] = [];
  let topName = '';
  for (const it of poolItems(p)) {
    const def = itemDef(items, it.item);
    const key = score(it, def);
    if (!key) continue;
    if (!top || better(key, def.name, topKey, topName)) {
      top = it;
      topKey = key;
      topName = def.name;
    }
  }
  return top;
}

/** A gun with enough rounds: the best round for it, and the rounds a full load and reloads take. */
interface GunPick {
  gun: WeaponState;
  round: AmmoDef;
  need: number;
}

/** The round a gun would be loaded with: the highest level it has enough of, or null. */
function roundFor(p: Pool, items: ItemDb, gun: WeaponState, def: WeaponDef): GunPick | null {
  const round = roundOf(items, def.ammo);
  if (!round || round.type !== 'ammo') return null;
  const caliber = caliberOf(items, def);
  const mag = weaponStats(items, gun, stats).magazine;
  const need = mag * (1 + QUICK_EQUIP_RELOADS);
  const loaded = loadedAmmo(items, gun);
  let top: AmmoDef | null = null;
  const seen = new Set<string>();
  const consider = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const a = roundOf(items, id);
    if (!a || a.type !== 'ammo' || roundCaliber(a) !== caliber) return;
    const have = roundsIn(p, id) + (id === loaded ? gun.mag : 0);
    if (have < need) return;
    if (!top || better([a.level, a.damage], a.name, [top.level, top.damage], top.name)) top = a;
  };
  consider(loaded);
  for (const it of poolItems(p)) consider(it.item);
  return top ? { gun, round: top, need } : null;
}

/** The best gun for a slot of the classes given, with enough rounds, or null. */
function pickGun(
  p: Pool,
  items: ItemDb,
  favorites: ReadonlySet<string>,
  slot: GearSlot,
  classes: (c: WeaponClass) => boolean,
): GunPick | null {
  let pick: GunPick | null = null;
  const gun = best(p, items, (it, def) => {
    if (def.type !== 'weapon' || def.spawns || def.blast) return null;
    if (!classes(def.class ?? 'assault') || !fitsSlot(items, slot, it)) return null;
    const r = roundFor(p, items, it as WeaponState, def);
    if (!r) return null;
    // Then the name A–Z (better); guns are all common, so rarity says nothing (2026-11-09).
    return [r.round.level, favorites.has(def.id) ? 1 : 0];
  });
  // Scored again for the one picked, to get its round.
  if (gun) pick = roundFor(p, items, gun as WeaponState, itemDef(items, gun.item) as WeaponDef);
  return pick;
}

/** Puts a gun in its slot, full of its round; the rounds for its reloads go in `carry`. */
function equipGun(
  p: Pool,
  items: ItemDb,
  gear: Gear,
  slot: GearSlot,
  pick: GunPick,
  carry: Item[],
) {
  const gun = takeOut(p, pick.gun) as WeaponState;
  const def = itemDef(items, gun.item) as WeaponDef;
  const old = loadedAmmo(items, gun);
  if (old !== pick.round.id) {
    if (gun.mag > 0) p.loose.push({ item: old, count: gun.mag });
    gun.mag = 0;
    if (pick.round.id === def.ammo) delete gun.loaded;
    else gun.loaded = pick.round.id;
  }
  const mag = weaponStats(items, gun, stats).magazine;
  for (const r of takeRounds(p, pick.round.id, mag - gun.mag)) gun.mag += r.count;
  gun.reloading = 0;
  gun.cooldown = 0;
  gun.triggerHeld = false;
  delete gun.reloadWith;
  delete gun.reloadByHand;
  carry.push(...takeRounds(p, pick.round.id, mag * QUICK_EQUIP_RELOADS));
  (gear as unknown as Record<GearSlot, Item | null>)[slot] = gun;
}

/** How many cells a rig or backpack holds. */
function cellsOf(def: Extract<ItemDef, { type: 'container' }>): number {
  const s = sectionsOf(def);
  return s ? s.reduce((n, x) => n + x.w * x.h, 0) : def.grid[0] * def.grid[1];
}

/**
 * Empties the gear into the stash and puts on the best kit it has (see the top of the
 * file), page `page` first for what goes back. Returns 'full' (and changes nothing) if
 * what's left over doesn't fit in the stash.
 */
export function quickEquip(
  profile: Profile,
  items: ItemDb,
  favorites: ReadonlySet<string> = new Set(),
  page = 0,
): QuickEquipResult {
  const before = JSON.stringify({ gear: profile.gear, stash: profile.stash.map((g) => g.items) });
  // Worked on a copy, kept only if it all fits.
  const work = JSON.parse(before) as { gear: Gear; stash: Grid['items'][] };
  const gear = work.gear;
  const slots = gear as unknown as Record<GearSlot, Item | null>;
  const pages: Grid[] = profile.stash.map((g, i) => ({ ...g, items: work.stash[i]! }));
  const p: Pool = { loose: [], pages };

  // Take everything off.
  for (const s of STRIPPED) {
    const it = slots[s];
    if (it) p.loose.push(it);
    slots[s] = null;
  }
  const emptyInto = (grid: Grid): void => {
    for (const gi of grid.items.splice(0)) p.loose.push(gi.item);
  };
  emptyInto(gear.pockets);
  for (const it of [...p.loose]) if (it.grid) emptyInto(it.grid);

  // Armor ranks by level (two lower when worn), then durability, then rarity. The chest's
  // is body armor or an armored rig, whichever is best (2026-11-11): never both.
  const armorKey = (it: Item, def: ItemDef): readonly number[] | null => {
    const a = armorOf(def);
    if (!a) return null;
    const dur = it.durability ?? a.durability;
    const worn = dur < maxDurability(items, it) * WORN_SHARE;
    return [a.level - (worn ? WORN_PENALTY : 0), dur, rarityOf(def)];
  };
  const chest = best(p, items, (it, def) =>
    fitsSlot(items, 'bodyArmor', it) ||
    (isArmoredRig(def) && def.type === 'container' && !def.admin)
      ? armorKey(it, def)
      : null,
  );
  const armoredRig = !!chest && isArmoredRig(itemDef(items, chest.item));

  // Rigs and backpacks first, so there's somewhere to carry the rest.
  for (const slot of ['rig', 'backpack'] as const) {
    const bag =
      slot === 'rig' && armoredRig
        ? chest
        : best(p, items, (it, def) =>
            def.type === 'container' && !def.admin && !def.armor && fitsSlot(items, slot, it)
              ? [cellsOf(def)]
              : null,
          );
    if (!bag) continue;
    takeOut(p, bag);
    // One stored with things in: they go to the stash.
    if (bag.grid) emptyInto(bag.grid);
    slots[slot] = bag;
  }
  if (chest && !armoredRig) slots.bodyArmor = takeOut(p, chest);
  const helmet = best(p, items, (it, def) =>
    fitsSlot(items, 'helmet', it) ? armorKey(it, def) : null,
  );
  if (helmet) slots.helmet = takeOut(p, helmet);

  // Guns: the best primary, a sidearm, and with a sniper a close-range gun.
  const carry: Item[] = [];
  const primary = pickGun(
    p,
    items,
    favorites,
    'primary1',
    (c) => c !== 'pistol' && c !== 'special',
  );
  if (primary) equipGun(p, items, gear, 'primary1', primary, carry);
  const side = pickGun(p, items, favorites, 'sidearm', (c) => c === 'pistol');
  if (side) equipGun(p, items, gear, 'sidearm', side, carry);
  const sniper = primary && (itemDef(items, primary.gun.item) as WeaponDef).class === 'sniper';
  if (sniper) {
    const close =
      pickGun(p, items, favorites, 'primary2', (c) => c === 'smg' || c === 'shotgun') ??
      (side
        ? null
        : pickGun(p, items, favorites, 'primary2', (c) => c !== 'pistol' && c !== 'special'));
    if (close) equipGun(p, items, gear, 'primary2', close, carry);
  }

  // Meds: a heal, surgery, something for bleeding, a splint.
  const med = (effect: string): Item | null =>
    best(p, items, (it, def) =>
      def.type === 'med' && def.effect === effect && (it.left ?? 1) > 0 ? [it.left ?? 1] : null,
    );
  for (const effect of ['heal', 'surgery'] as const) {
    const m = med(effect);
    if (m) carry.push(takeOut(p, m));
  }
  let uses = 0;
  for (let n = 0; n < BLEED_ITEMS && uses < BLEED_USES; n++) {
    const m = med('bandage');
    if (!m) break;
    uses += m.left ?? 1;
    carry.push(takeOut(p, m));
  }
  const splint = med('splint');
  if (splint) carry.push(takeOut(p, splint));

  // Carried: pockets, then rig, then backpack. What doesn't fit stays in the stash.
  for (const it of carry) {
    let left = it.count;
    for (let i = 0; i < CARRIED_GRIDS && left > 0; i++) {
      const grid = carriedGrid(gear, i);
      if (grid) left = addItem(items, grid, it);
    }
    if (left > 0) p.loose.push(it);
  }
  gear.hand = gear.primary1
    ? 'primary1'
    : gear.sidearm
      ? 'sidearm'
      : gear.primary2
        ? 'primary2'
        : 'knife';

  // The rest back into the stash, from `page` on.
  const n = pages.length;
  for (const it of p.loose) {
    let left = it.count;
    for (let i = 0; i < n && left > 0; i++) left = addItem(items, pages[(page + i) % n]!, it);
    if (left > 0) return 'full';
  }

  const after = JSON.stringify({ gear, stash: pages.map((g) => g.items) });
  if (after === before) return 'unchanged';
  // In place: the stash screen's state shares these objects.
  Object.assign(profile.gear, gear);
  profile.stash.forEach((g, i) => (g.items = pages[i]!.items));
  return 'equipped';
}

import {
  GEAR_SLOTS,
  canHold,
  canSwap,
  findSpot,
  canReach,
  firesRound,
  fits,
  fitsSlot,
  gridOf,
  groundInReach,
  isFree,
  itemAt,
  itemDef,
  loadKind,
  repairable,
  sellPrice,
  stackSize,
  weaponDef,
  zoneToTreat,
  type AttachmentSlot,
  type Character,
  type GearSlot,
  type GridName,
  type GridRef,
  type GroundItem,
  type Item,
  type ItemDef,
  type ItemRef,
  type OnGround,
  type Owner,
  type PartRef,
  type MedRef,
  type Target,
} from '@mes/shared';
import {
  DragController,
  type DragHost,
  type DragSource,
  type DropZone,
  type Into,
  type LoadOn,
  type PartSlot,
  type RepairOn,
} from './drag';
import type { InventoryContext } from './raid';

const SELF: Owner = { kind: 'self' };
const GROUND: Owner = { kind: 'ground' };
const DOUBLE_TAP_MS = 350;
const GRID_NAMES: readonly GridName[] = ['pockets', 'rig', 'backpack', 'vault', 'loot'];
/** The grids you carry, in carriedGrid's order. */
const CARRIED: readonly GridName[] = ['pockets', 'rig', 'backpack'];

/** Identifies an item's place, to compare refs. */
export function refKey(r: ItemRef): string {
  if ('ground' in r) return JSON.stringify([r.owner, r.ground]);
  return JSON.stringify('slot' in r ? [r.owner, r.slot] : [r.owner, r.grid, r.index]);
}

function isPart(r: ItemRef | PartRef): r is PartRef {
  return 'gun' in r;
}

/** An attachment you can reach that fits the selected gun, for the picker. */
export interface PartChoice {
  ref: ItemRef;
  def: ItemDef;
  /** Which grid it's in. */
  where: GridName;
  owner: Owner;
}

/**
 * What the inventory tab does, outside React: the selected item (whose details are open),
 * taps and double-taps, and dragging. One per opening of the raid screen; it asks for a
 * redraw on a change.
 */
export class InventoryController implements DragHost {
  /** Cell size in CSS pixels: about ten rows fit the screen's height. */
  readonly cell = Math.max(28, Math.min(44, Math.floor(window.innerHeight / 10.5)));
  readonly drag = new DragController(this);
  selected: ItemRef | null = null;
  /** Picking items to sell between raids: the picks, or null when not picking. */
  selling: ItemRef[] | null = null;
  /** The gun attachment slot whose picker is open. */
  picking: AttachmentSlot | null = null;
  target: Owner | null;
  /** The selected item itself, to follow it when its index changes. */
  private selectedItem: Item | null = null;
  private lastTap = { key: '', at: 0 };
  /** A tap's details waiting to open (see tap), or 0. */
  private pendingOpen = 0;

  constructor(
    readonly ctx: InventoryContext,
    target: Owner | null,
    private readonly redraw: () => void,
  ) {
    this.target = target;
  }

  /** Opens another body or container beside yours (null: just yours), with nothing selected. */
  setTarget(target: Owner | null): void {
    this.target = target;
    this.select(null);
  }

  /** Whether the open body or container is in reach. */
  get reach(): boolean {
    return this.target !== null && canReach(this.ctx.sim, this.ctx.player, this.target);
  }

  /** Where a double-tap sends an item: yours to what's open, if anything; theirs to you. */
  quickTo(ref: ItemRef): Owner {
    return ref.owner.kind === 'self' && this.target && this.reach ? this.target : SELF;
  }

  quick(ref: ItemRef): void {
    this.select(null);
    this.ctx.send({ type: 'quick', from: ref, to: this.quickTo(ref) });
  }

  /** Drops an item at your feet. */
  toGround(ref: ItemRef): void {
    this.select(null);
    this.ctx.send({ type: 'quick', from: ref, to: GROUND });
  }

  /** The items on the ground within reach, for the ground panel. */
  nearby(): { ref: OnGround; g: GroundItem }[] {
    const out: { ref: OnGround; g: GroundItem }[] = [];
    this.ctx.sim.ground.forEach((g, i) => {
      if (groundInReach(this.ctx.player, g)) {
        out.push({ ref: { owner: { kind: 'ground' }, ground: i, item: g.item.item }, g });
      }
    });
    return out;
  }

  rotate(ref: ItemRef): void {
    if ('index' in ref) this.ctx.send({ type: 'rotate', at: ref });
  }

  select(ref: ItemRef | null): void {
    this.selected = ref;
    this.selectedItem = (ref && this.find(ref)?.item) ?? null;
    this.picking = null;
    this.redraw();
  }

  /**
   * Keeps the selection on the same item after a tick moved it to another index (an
   * attachment taken out of the grid the gun is in), or drops it if it's gone.
   */
  followSelection(): void {
    const sel = this.selected;
    const item = this.selectedItem;
    if (!sel || !item || this.find(sel)?.item === item) return;
    this.selected = this.locate(item);
    if (!this.selected) {
      this.selectedItem = null;
      this.picking = null;
    }
  }

  /** Opens or closes the picker for one of the selected gun's attachment slots. */
  togglePicker(slot: AttachmentSlot): void {
    this.picking = this.picking === slot ? null : slot;
    this.redraw();
  }

  /** Puts a loose attachment on the selected gun. */
  attach(from: ItemRef): void {
    if (!this.selected) return;
    this.picking = null;
    this.ctx.send({ type: 'attach', gun: this.selected, from });
    this.redraw();
  }

  /** Takes an attachment off a gun into what you carry. */
  detach(p: PartRef): void {
    this.picking = null;
    this.ctx.send({ type: 'detach', gun: p.gun, slot: p.slot, part: p.part, to: null });
    this.redraw();
  }

  /** Takes the rounds out of a gun into what you carry. */
  unload(gun: ItemRef): void {
    this.ctx.send({ type: 'unload', gun });
    this.redraw();
  }

  /**
   * The loose attachments you can reach that fit a slot of a gun: yours first, then the
   * open body's or container's. One of each kind.
   */
  partChoices(gun: Item, slot: AttachmentSlot): PartChoice[] {
    const { items } = this.ctx;
    const weapon = weaponDef(items, gun.item);
    const out: PartChoice[] = [];
    const seen = new Set<string>();
    const owners = this.target && this.reach ? [SELF, this.target] : [SELF];
    for (const owner of owners) {
      for (const name of GRID_NAMES) {
        const grid = gridOf(this.ctx.sim, this.ctx.player, { owner, grid: name });
        grid?.items.forEach((g, index) => {
          const def = itemDef(items, g.item.item);
          if (def.type !== 'attachment' || def.slot !== slot || seen.has(def.id)) return;
          if (!fits(weapon, def)) return;
          seen.add(def.id);
          out.push({ ref: { owner, grid: name, index, item: def.id }, def, where: name, owner });
        });
      }
    }
    return out;
  }

  /**
   * Where a repair kit can be used from (session 13b): in a raid one you carry (not the
   * vault, as for meds); in the stash one anywhere.
   */
  private kitPlaces(): GridRef[] {
    const places: GridRef[] = CARRIED.map((grid) => ({ owner: SELF, grid }));
    if (this.ctx.stash) {
      places.push({ owner: SELF, grid: 'vault' });
      for (const l of this.ctx.sim.loot)
        places.push({ owner: { kind: 'container', id: l.id }, grid: 'loot' });
    }
    return places;
  }

  /** Whether a kit (where it is) can mend a piece of your armour now. */
  canRepair(kit: ItemRef, armour: ItemRef): boolean {
    if (!('grid' in kit) || armour.owner.kind !== 'self') return false;
    const from = JSON.stringify([kit.owner, kit.grid]);
    if (!this.kitPlaces().some((p) => JSON.stringify([p.owner, p.grid]) === from)) return false;
    const k = this.find(kit);
    const a = this.find(armour);
    return !!k && !!a && repairable(this.ctx.items, k.item, a.item) > 0;
  }

  /** A repair kit that can mend an armour piece of yours now, or null. */
  kitFor(armour: ItemRef): ItemRef | null {
    const { sim, player } = this.ctx;
    for (const place of this.kitPlaces()) {
      const grid = gridOf(sim, player, place);
      if (!grid) continue;
      for (let index = 0; index < grid.items.length; index++) {
        const ref = { ...place, index, item: grid.items[index]!.item.item };
        if (this.canRepair(ref, armour)) return ref;
      }
    }
    return null;
  }

  /** Mends an armour piece with a kit (kitFor's if not given): at once in the stash, timed in a raid. */
  repair(armour: ItemRef, kit = this.kitFor(armour)): void {
    if (kit) this.ctx.send({ type: 'repair', kit, armour });
    this.redraw();
  }

  /**
   * Starts using a med you carry (in a raid), if it would do something now: the same as
   * picking it from the heal button.
   */
  useMed(ref: ItemRef): void {
    const med = this.medRef(ref);
    if (med) this.ctx.use?.(med);
    this.redraw();
  }

  /** A carried med as the heal button would use it, if it would do something now. */
  medRef(ref: ItemRef): MedRef | null {
    if (!this.ctx.use || ref.owner.kind !== 'self' || !('grid' in ref)) return null;
    const grid = CARRIED.indexOf(ref.grid);
    const def = this.find(ref)?.def;
    if (grid < 0 || def?.type !== 'med') return null;
    if (zoneToTreat(this.ctx.player.health, def.effect) < 0) return null;
    return { grid, index: ref.index, item: ref.item };
  }

  /** Stops the med or repair being used. */
  stopUse(): void {
    this.ctx.use?.('cancel');
  }

  // Selling several at once, between raids (session 13b).

  /** Starts picking items to sell, with one already picked; taps pick and unpick instead of selecting. */
  startSelling(first: ItemRef | null = null): void {
    this.select(null);
    this.selling = first && this.canPick(first) ? [first] : [];
    this.redraw();
  }

  stopSelling(): void {
    this.selling = null;
    this.redraw();
  }

  isPicked(ref: ItemRef): boolean {
    const key = refKey(ref);
    return !!this.selling?.some((r) => refKey(r) === key);
  }

  /** Whether an item can be picked to sell: yours, not on the ground, not the knife, worth something. */
  canPick(ref: ItemRef): boolean {
    if ('ground' in ref || ('slot' in ref && ref.slot === 'knife')) return false;
    const found = this.find(ref);
    return !!found && sellPrice(this.ctx.items, found.item) > 0;
  }

  private togglePick(ref: ItemRef): void {
    if (!this.selling) return;
    const key = refKey(ref);
    const at = this.selling.findIndex((r) => refKey(r) === key);
    if (at >= 0) this.selling.splice(at, 1);
    else if (this.canPick(ref)) this.selling.push(ref);
    this.redraw();
  }

  /** The items picked to sell, as they are now. */
  picked(): Item[] {
    return (this.selling ?? []).flatMap((r) => {
      const f = this.find(r);
      return f ? [f.item] : [];
    });
  }

  isSelected(ref: ItemRef): boolean {
    return !!this.selected && refKey(this.selected) === refKey(ref);
  }

  // DragHost

  gunZone(src: DragSource, gun: ItemRef): DropZone | null {
    const ref = src.ref;
    // Not back onto the gun it's on.
    if (isPart(ref) && refKey(ref.gun) === refKey(gun)) return null;
    const part = isPart(ref)
      ? this.partOn(ref)
        ? itemDef(this.ctx.items, ref.part)
        : null
      : this.find(ref)?.def;
    const target = this.find(gun)?.def;
    // Rounds the gun fires load it (grenades, for a launcher).
    if (
      !isPart(ref) &&
      (part?.type === 'ammo' || part?.type === 'grenade') &&
      target?.type === 'weapon'
    ) {
      return firesRound(this.ctx.items, target, part.id) ? { kind: 'load', gun } : null;
    }
    if (part?.type !== 'attachment' || target?.type !== 'weapon' || !fits(target, part)) {
      return null;
    }
    return { kind: 'part', gun, slot: part.slot };
  }

  armourZone(src: DragSource, armour: ItemRef): DropZone | null {
    if (isPart(src.ref) || this.find(src.ref)?.def.type !== 'repair') return null;
    return { kind: 'repair', armour };
  }

  zoneAt(el: HTMLElement): DropZone | null {
    const desc = JSON.parse(el.dataset.drop!) as
      { owner: Owner; grid: GridName } | { owner: Owner; slot: GearSlot } | PartSlot | Into;
    if ('into' in desc) return { kind: 'into', owner: desc.into };
    if ('gun' in desc) return { kind: 'part', gun: desc.gun, slot: desc.slot };
    if ('slot' in desc) return { kind: 'slot', owner: desc.owner, slot: desc.slot };
    if (desc.owner.kind === 'ground') return { kind: 'ground' };
    const grid = gridOf(this.ctx.sim, this.ctx.player, desc);
    return grid ? { kind: 'grid', ref: desc, grid } : null;
  }

  canDrop(src: DragSource, zone: DropZone, x: number, y: number, rotated: boolean): boolean {
    const { sim, player, items } = this.ctx;
    // Picking items to sell: nothing moves.
    if (this.selling) return false;
    if (zone.kind === 'repair') return !isPart(src.ref) && this.canRepair(src.ref, zone.armour);
    if (zone.kind === 'load') {
      if (isPart(src.ref)) return false;
      return !!loadKind(sim, player, items, zone.gun, src.ref, !!this.ctx.stash);
    }
    if (isPart(src.ref)) {
      // An attachment comes off a gun into a grid, or onto another gun (see gunZone).
      if (!this.partOn(src.ref)) return false;
      if (zone.kind === 'part') return refKey(zone.gun) !== refKey(src.ref.gun);
      // Not straight to the ground: off into a grid first, then drop it from there.
      if (zone.kind !== 'grid') return false;
      const loose = { item: src.ref.part, count: 1 };
      const w = rotated ? src.h : src.w;
      const h = rotated ? src.w : src.h;
      return canHold(items, zone.grid, loose) && isFree(items, zone.grid, x, y, w, h);
    }
    const found = this.find(src.ref);
    if (!found) return false;
    if (zone.kind === 'ground') return !('ground' in src.ref);
    if (zone.kind === 'into') {
      // Not into where it already is; and only if that grid has room for some of it.
      if (JSON.stringify(src.ref.owner) === JSON.stringify(zone.owner)) return false;
      const grid = gridOf(sim, player, { owner: zone.owner, grid: 'loot' });
      if (!grid || !canHold(items, grid, found.item)) return false;
      const stack = stackSize(found.def);
      return (
        !!findSpot(items, grid, found.item.item) ||
        grid.items.some((g) => g.item.item === found.item.item && g.item.count < stack)
      );
    }
    if (zone.kind === 'part') {
      const gun = this.find(zone.gun);
      return (
        !!gun &&
        'index' in src.ref &&
        found.def.type === 'attachment' &&
        found.def.slot === zone.slot &&
        fits(weaponDef(items, gun.item.item), found.def)
      );
    }
    if (zone.kind === 'slot') return fitsSlot(items, zone.slot, found.item);
    const grid = zone.grid;
    if (!canHold(items, grid, found.item)) return false;
    // On a stack of the same item, it tops it up.
    const under = grid.items[itemAt(items, grid, x, y)];
    if (under && under.item !== found.item && under.item.item === found.item.item) {
      return under.item.count < stackSize(found.def);
    }
    const fromGrid = 'index' in src.ref ? gridOf(sim, player, src.ref) : null;
    const ignore = fromGrid === grid && 'index' in src.ref ? src.ref.index : -1;
    const w = rotated ? src.h : src.w;
    const h = rotated ? src.w : src.h;
    if (isFree(items, grid, x, y, w, h, ignore)) return true;
    // On other items: a swap, if they fit where it came from.
    return (
      !!fromGrid &&
      'index' in src.ref &&
      canSwap(items, fromGrid, src.ref.index, grid, x, y, rotated)
    );
  }

  drop(src: DragSource, to: Target | PartSlot | Into | RepairOn | LoadOn): void {
    this.cancelOpen();
    const ref = src.ref;
    if ('load' in to) {
      if (!isPart(ref)) this.ctx.send({ type: 'load', gun: to.load, from: ref });
      this.redraw();
      return;
    }
    if ('repair' in to) {
      if (!isPart(ref)) this.repair(to.repair, ref);
      return;
    }
    if ('into' in to) {
      if (isPart(ref)) return;
      this.select(null);
      this.ctx.send({ type: 'quick', from: ref, to: to.into });
      return;
    }
    if (isPart(ref)) {
      this.picking = null;
      if ('gun' in to) {
        this.ctx.send({ type: 'attach', gun: to.gun, from: ref });
        this.redraw();
        return;
      }
      if (!('grid' in to)) return;
      this.ctx.send({ type: 'detach', gun: ref.gun, slot: ref.slot, part: ref.part, to });
      this.redraw();
    } else if ('gun' in to) {
      this.picking = null;
      this.ctx.send({ type: 'attach', gun: to.gun, from: ref });
      this.redraw();
    } else {
      this.select(null);
      this.ctx.send({ type: 'move', from: ref, to });
    }
  }

  tap(src: DragSource): void {
    const ref = src.ref;
    const key = isPart(ref) ? `part:${ref.slot}` : refKey(ref);
    const now = performance.now();
    const double = this.lastTap.key === key && now - this.lastTap.at < DOUBLE_TAP_MS;
    this.lastTap = double ? { key: '', at: 0 } : { key, at: now };
    if (this.selling) {
      if (!isPart(ref)) this.togglePick(ref);
      return;
    }
    if (isPart(ref)) {
      // On a gun: a tap opens its slot's picker, a double-tap takes it off.
      if (double) this.detach(ref);
      else this.togglePicker(ref.slot);
    } else if (double) {
      this.cancelOpen();
      this.quick(ref);
    } else {
      // Its details open once it's clear this isn't the first of a double-tap, unless
      // it's being dragged by then, or has gone.
      this.cancelOpen();
      this.pendingOpen = window.setTimeout(() => {
        this.pendingOpen = 0;
        if (!this.drag.busy && this.find(ref)) this.select(ref);
      }, DOUBLE_TAP_MS);
    }
  }

  /** Opens an item's details at once (a right-click). */
  inspect(ref: ItemRef): void {
    if (this.selling) return;
    this.cancelOpen();
    this.drag.cancel();
    this.select(ref);
  }

  /** Stops a tap's details from opening. */
  cancelOpen(): void {
    clearTimeout(this.pendingOpen);
    this.pendingOpen = 0;
  }

  /** Whether a gun still has the part a ref saw on it. */
  private partOn(p: PartRef): boolean {
    return this.find(p.gun)?.item.attachments?.[p.slot] === p.part;
  }

  /** Where an item is now, among yours and what's open, or null. */
  private locate(item: Item): ItemRef | null {
    const owners = this.target && this.reach ? [SELF, this.target] : [SELF];
    for (const owner of owners) {
      const ch = this.character(owner);
      if (ch) {
        const gear = ch.gear as unknown as Record<GearSlot, Item | null>;
        for (const slot of GEAR_SLOTS) {
          if (gear[slot] === item) return { owner, slot, item: item.item };
        }
      }
      for (const name of GRID_NAMES) {
        const grid = gridOf(this.ctx.sim, this.ctx.player, { owner, grid: name });
        const index = grid?.items.findIndex((g) => g.item === item) ?? -1;
        if (index >= 0) return { owner, grid: name, index, item: item.item };
      }
    }
    const ground = this.ctx.sim.ground.findIndex((g) => g.item === item);
    return ground >= 0 ? { owner: { kind: 'ground' }, ground, item: item.item } : null;
  }

  private character(owner: Owner): Character | undefined {
    if (owner.kind === 'self') return this.ctx.player;
    return owner.kind === 'body' ? this.ctx.sim.entities.find((e) => e.id === owner.id) : undefined;
  }

  /** The item a ref points at, if it's still there. */
  find(ref: ItemRef): { item: Item; def: ItemDef } | null {
    const { sim, player, items } = this.ctx;
    let item: Item | null | undefined;
    if ('ground' in ref) {
      const g = sim.ground[ref.ground];
      item = g && groundInReach(player, g) ? g.item : null;
    } else if ('slot' in ref) {
      const ch = this.character(ref.owner);
      item = ch && (ch.gear as unknown as Record<GearSlot, Item | null>)[ref.slot];
    } else {
      item = gridOf(sim, player, ref)?.items[ref.index]?.item;
    }
    return item && item.item === ref.item ? { item, def: itemDef(items, item.item) } : null;
  }
}

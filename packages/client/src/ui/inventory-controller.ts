import {
  canHold,
  canReach,
  fitsSlot,
  gridOf,
  isFree,
  itemAt,
  itemDef,
  stackSize,
  type GearSlot,
  type Item,
  type ItemDef,
  type ItemRef,
  type Owner,
  type Target,
} from '@mes/shared';
import { DragController, type DragHost, type DragSource, type DropZone } from './drag';
import type { RaidContext } from './raid';

const SELF: Owner = { kind: 'self' };
const DOUBLE_TAP_MS = 350;

/** Identifies an item's place, to compare refs. */
export function refKey(r: ItemRef): string {
  return JSON.stringify('slot' in r ? [r.owner, r.slot] : [r.owner, r.grid, r.index]);
}

/**
 * What the inventory tab does, outside React: the selected item, taps and double-taps,
 * and dragging. One per opening of the raid screen; it asks for a redraw on a change.
 */
export class InventoryController implements DragHost {
  /** Cell size in CSS pixels: about ten rows fit the screen's height. */
  readonly cell = Math.max(28, Math.min(44, Math.floor(window.innerHeight / 10.5)));
  readonly drag = new DragController(this);
  selected: ItemRef | null = null;
  target: Owner | null;
  private lastTap = { key: '', at: 0 };

  constructor(
    readonly ctx: RaidContext,
    target: Owner | null,
    private readonly redraw: () => void,
  ) {
    this.target = target;
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

  rotate(ref: ItemRef): void {
    if ('index' in ref) this.ctx.send({ type: 'rotate', at: ref });
  }

  select(ref: ItemRef | null): void {
    this.selected = ref;
    this.redraw();
  }

  isSelected(ref: ItemRef): boolean {
    return !!this.selected && refKey(this.selected) === refKey(ref);
  }

  // DragHost

  zoneAt(el: HTMLElement): DropZone | null {
    const desc = JSON.parse(el.dataset.drop!) as
      | { owner: Owner; grid: 'pockets' | 'rig' | 'backpack' | 'vault' | 'loot' }
      | { owner: Owner; slot: GearSlot };
    if ('slot' in desc) return { kind: 'slot', owner: desc.owner, slot: desc.slot };
    const grid = gridOf(this.ctx.sim, this.ctx.player, desc);
    return grid ? { kind: 'grid', ref: desc, grid } : null;
  }

  canDrop(src: DragSource, zone: DropZone, x: number, y: number, rotated: boolean): boolean {
    const { sim, player, items } = this.ctx;
    const found = this.find(src.ref);
    if (!found) return false;
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
    return isFree(items, grid, x, y, w, h, ignore);
  }

  drop(src: DragSource, to: Target): void {
    this.select(null);
    this.ctx.send({ type: 'move', from: src.ref, to });
  }

  tap(src: DragSource): void {
    const key = refKey(src.ref);
    const now = performance.now();
    if (this.lastTap.key === key && now - this.lastTap.at < DOUBLE_TAP_MS) {
      this.lastTap.key = '';
      this.quick(src.ref);
    } else {
      this.lastTap = { key, at: now };
      this.select(src.ref);
    }
  }

  /** The item a ref points at, if it's still there. */
  find(ref: ItemRef): { item: Item; def: ItemDef } | null {
    const { sim, player, items } = this.ctx;
    let item: Item | null | undefined;
    if ('slot' in ref) {
      const owner = ref.owner;
      const ch =
        owner.kind === 'self'
          ? player
          : owner.kind === 'body'
            ? sim.entities.find((e) => e.id === owner.id)
            : undefined;
      item = ch && (ch.gear as unknown as Record<GearSlot, Item | null>)[ref.slot];
    } else {
      item = gridOf(sim, player, ref)?.items[ref.index]?.item;
    }
    return item && item.item === ref.item ? { item, def: itemDef(items, item.item) } : null;
  }
}

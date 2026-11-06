import { GEAR, PROFILE, sectionsOf, type ItemDb, type Section } from '@mes/shared';

/*
 * The inventory's columns (2026-11-06, the user's call, after Delta Force's warehouse):
 * your gear, what you carry, and the stash, body or container, side by side on a phone
 * too. Each column's width is fixed by the content, not by what's in it now: the middle
 * one is as wide as the biggest rig or backpack there is, so putting one on or taking it
 * off moves nothing, and the right one is a stash page wide. The cell size is the
 * largest that fits them all across the screen and about ten rows down it.
 */

/** Pixels between a grid's sections. */
export const SECTION_GAP = 6;
/** Pixels between a rig's or backpack's slot and its grid. */
export const HOLDER_GAP = 6;
/** Gear slots across: two two-cell columns, and the gap between them. */
const GEAR_CELLS = 4;
const GEAR_GAP = 4;
/** What isn't cells across the screen: the page's padding, panel padding, gaps, scrollbars. */
const OVERHEAD = 150;
const MIN_CELL = 24;
const MAX_CELL = 44;

export interface InventoryLayout {
  cell: number;
  /** Each column's content width in pixels: gear, what you carry, what's open. */
  gear: number;
  carried: number;
  loot: number;
}

/** How far a grid of this size and these sections reaches across: cells, and gaps in pixels. */
export function gridAcross(w: number, sections: readonly Section[] | undefined) {
  const starts = new Set((sections ?? []).map((s) => s.x));
  return { cells: w, px: Math.max(0, starts.size - 1) * SECTION_GAP };
}

/** Where each section is drawn: at its cell, pushed right and down by a gap per column and row a section starts in before it. */
export function sectionBoxes(sections: readonly Section[], cell: number) {
  const xs = [...new Set(sections.map((s) => s.x))].sort((a, b) => a - b);
  const ys = [...new Set(sections.map((s) => s.y))].sort((a, b) => a - b);
  return sections.map((s) => ({
    s,
    left: s.x * cell + xs.indexOf(s.x) * SECTION_GAP,
    top: s.y * cell + ys.indexOf(s.y) * SECTION_GAP,
  }));
}

/**
 * The middle column's width as cells and pixels: the widest of the pockets, and a slot with
 * its grid beside it for the vault and every rig and backpack (not the admin ones).
 */
function carriedAcross(items: ItemDb): { cells: number; px: number } {
  let cells: number = GEAR.pockets[0];
  let px = 0;
  const holder = (w: number, sections?: readonly Section[]): void => {
    const g = gridAcross(w, sections);
    cells = Math.max(cells, 2 + g.cells);
    px = Math.max(px, HOLDER_GAP + g.px);
  };
  holder(GEAR.vault[0]);
  for (const def of items.values()) {
    if (def.type !== 'container' || def.admin || def.slot === 'vault') continue;
    holder(def.grid[0], sectionsOf(def));
  }
  return { cells, px };
}

/** The layout for a screen this size. */
export function inventoryLayout(items: ItemDb, width: number, height: number): InventoryLayout {
  const carried = carriedAcross(items);
  const lootCells = PROFILE.stash[0];
  const across = Math.floor(
    (width - OVERHEAD - GEAR_GAP - carried.px) / (GEAR_CELLS + carried.cells + lootCells),
  );
  const down = Math.floor(height / 10.5);
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, across, down));
  return {
    cell,
    gear: GEAR_CELLS * cell + GEAR_GAP,
    carried: carried.cells * cell + carried.px,
    loot: lootCells * cell,
  };
}

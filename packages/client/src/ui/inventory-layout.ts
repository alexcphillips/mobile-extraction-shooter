import { GEAR, POCKET_SECTIONS, PROFILE, sectionsOf, type ItemDb, type Section } from '@mes/shared';

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
/** The stash's page tabs, down the right of its grid (UX-3): a tab and the gap before it. */
export const PAGE_TABS = 34;
const MAX_CELL = 44;

export interface InventoryLayout {
  cell: number;
  /** Each column's content width in pixels: gear, what you carry, what's open. */
  gear: number;
  carried: number;
  loot: number;
}

/**
 * A grid's sections split into bands, top to bottom: sections whose rows overlap share a
 * band (a rig's pouches side by side; a backpack's main space, then the pockets under it).
 */
function bands(sections: readonly Section[]): Section[][] {
  const out: { y0: number; y1: number; list: Section[] }[] = [];
  for (const s of [...sections].sort((a, b) => a.y - b.y)) {
    const last = out[out.length - 1];
    if (last && s.y < last.y1) {
      last.list.push(s);
      last.y1 = Math.max(last.y1, s.y + s.h);
    } else out.push({ y0: s.y, y1: s.y + s.h, list: [s] });
  }
  return out.map((b) => b.list);
}

/** Gaps across a band: one before each column a section starts in, after the first. */
function bandGaps(band: readonly Section[]): number {
  return Math.max(0, new Set(band.map((s) => s.x)).size - 1);
}

/** How far a grid of this size and these sections reaches across: cells, and gaps in pixels. */
export function gridAcross(w: number, sections: readonly Section[] | undefined) {
  const gaps = sections ? Math.max(0, ...bands(sections).map(bandGaps)) : 0;
  return { cells: w, px: gaps * SECTION_GAP };
}

/**
 * Where each section is drawn: at its cell, pushed right by a gap per column a section in
 * its band starts in before it, and down by a gap per row a section starts in before it.
 * Each band is centred across the widest (UX-3, 2026-11-08: the large backpack's pockets
 * were left-aligned under its main space).
 */
export function sectionBoxes(sections: readonly Section[], cell: number) {
  const ys = [...new Set(sections.map((s) => s.y))].sort((a, b) => a - b);
  const laid = bands(sections).map((band) => {
    const xs = [...new Set(band.map((s) => s.x))].sort((a, b) => a - b);
    const boxes = band.map((s) => ({
      s,
      left: s.x * cell + xs.indexOf(s.x) * SECTION_GAP,
      top: s.y * cell + ys.indexOf(s.y) * SECTION_GAP,
    }));
    const from = Math.min(...boxes.map((b) => b.left));
    const to = Math.max(...boxes.map((b) => b.left + b.s.w * cell));
    return { boxes, from, width: to - from };
  });
  const widest = Math.max(...laid.map((b) => b.width));
  const out = new Map<Section, { s: Section; left: number; top: number }>();
  for (const { boxes, from, width } of laid) {
    const shift = Math.round((widest - width) / 2) - from;
    for (const b of boxes) out.set(b.s, { ...b, left: b.left + shift });
  }
  // In the sections' own order: the drop targets and their tiles follow it.
  return sections.map((s) => out.get(s)!);
}

/**
 * The middle column's width as cells and pixels: the widest of the pockets (five slots, a
 * gap apart), and a slot with
 * its grid beside it for the vault and every rig and backpack (not the admin ones).
 */
function carriedAcross(items: ItemDb): { cells: number; px: number } {
  let cells: number = GEAR.pockets[0];
  let px = gridAcross(GEAR.pockets[0], POCKET_SECTIONS).px;
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

/** The layout for a screen this size; in the stash, with room for its page tabs. */
export function inventoryLayout(
  items: ItemDb,
  width: number,
  height: number,
  stash = false,
): InventoryLayout {
  const carried = carriedAcross(items);
  const lootCells = PROFILE.stash[0];
  const tabs = stash ? PAGE_TABS : 0;
  const across = Math.floor(
    (width - OVERHEAD - GEAR_GAP - carried.px - tabs) / (GEAR_CELLS + carried.cells + lootCells),
  );
  const down = Math.floor(height / 10.5);
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, across, down));
  return {
    cell,
    gear: GEAR_CELLS * cell + GEAR_GAP,
    carried: carried.cells * cell + carried.px,
    loot: lootCells * cell + tabs,
  };
}

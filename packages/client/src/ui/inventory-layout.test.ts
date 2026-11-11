import { describe, expect, it } from 'vitest';
import { POCKET_SECTIONS } from '@mes/shared';
import { SECTION_GAP, gridAcross, sectionBoxes } from './inventory-layout';

const CELL = 40;
const G = SECTION_GAP;

describe('sectionBoxes', () => {
  it('centers a band narrower than the widest under it (UX-3)', () => {
    // The large backpack: a 5×4 main space over a 2×2, a 1×2 and a 2×2.
    const sections = [
      { x: 0, y: 0, w: 5, h: 4 },
      { x: 0, y: 4, w: 2, h: 2 },
      { x: 2, y: 4, w: 1, h: 2 },
      { x: 3, y: 4, w: 2, h: 2 },
    ];
    const boxes = sectionBoxes(sections, CELL);
    // The bottom band is two gaps wider, so the main space moves right by one.
    expect(boxes.map((b) => b.left)).toEqual([G, 0, 2 * CELL + G, 3 * CELL + 2 * G]);
    expect(boxes.map((b) => b.top)).toEqual([0, 4 * CELL + G, 4 * CELL + G, 4 * CELL + G]);
    expect(gridAcross(5, sections)).toEqual({ cells: 5, px: 2 * G });
  });

  it('keeps sections side by side in one band where their rows overlap', () => {
    // A 2×2 pouch beside two 1×1s stacked: one band, nothing centered.
    const sections = [
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 2, y: 0, w: 1, h: 1 },
      { x: 2, y: 1, w: 1, h: 1 },
    ];
    expect(sectionBoxes(sections, CELL).map((b) => [b.left, b.top])).toEqual([
      [0, 0],
      [2 * CELL + G, 0],
      [2 * CELL + G, CELL + G],
    ]);
  });

  it('draws the pockets as five slots a gap apart', () => {
    expect(sectionBoxes(POCKET_SECTIONS, CELL).map((b) => b.left)).toEqual(
      [0, 1, 2, 3, 4].map((x) => x * (CELL + G)),
    );
    expect(gridAcross(5, POCKET_SECTIONS)).toEqual({ cells: 5, px: 4 * G });
  });
});

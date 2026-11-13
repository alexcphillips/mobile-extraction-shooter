import { describe, expect, it } from 'vitest';
import { floorAt, placeLabels, roadOutline } from './map-tab';

describe('the map tab', () => {
  const floors = [
    { name: 'Ground', y: 0 },
    { name: 'Upper', y: 6 },
  ];

  it('finds the floor a height is on', () => {
    expect(floorAt(undefined, 3)).toBe(-1);
    expect(floorAt(floors, -2)).toBe(0);
    expect(floorAt(floors, 0.2)).toBe(0);
    expect(floorAt(floors, 5.4)).toBe(0);
    // Standing a little under the floor's height (a slab at 5.9) counts as on it.
    expect(floorAt(floors, 5.6)).toBe(1);
    expect(floorAt(floors, 10.4)).toBe(1);
  });

  it('leaves out a name that would run into one placed before it', () => {
    const at = (x: number, text: string, big = false) => ({ x, z: 0, text, big, key: text });
    const placed = placeLabels([at(0, 'Warehouse', true), at(3, 'Office'), at(40, 'Toys')], 1);
    expect(placed.map((l) => l.text)).toEqual(['Warehouse', 'Toys']);
    // Zoomed in (a smaller font in meters), they part and both show.
    expect(placeLabels([at(0, 'Warehouse', true), at(3, 'Office')], 0.2)).toHaveLength(2);
  });

  it('draws a road as its outline: along the left edge, back along the right', () => {
    // Two samples of a strip 4 m across along +x (x y z left, x y z right each).
    const strip = [0, 1, -2, 0, 1, 2, 10, 1, -2, 10, 1, 2];
    expect(roadOutline(strip)).toBe('0,-2 10,-2 10,2 0,2');
  });
});

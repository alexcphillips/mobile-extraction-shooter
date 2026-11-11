import { describe, expect, it } from 'vitest';
import { floorAt, placeLabels } from './map-tab';

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
});

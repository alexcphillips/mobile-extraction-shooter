import type { Profile, ProfileResponse } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { hangarContent, itemOrigins, loadHangar, loadRecipes } from '../content';
import { collectedLine, craftTime, hangarLine, readyCrafts, timeLeft } from './hangar-text';

describe('the Hangar page (H3)', () => {
  it('loads the modules in order, and recipes that name them', () => {
    const modules = [...loadHangar().values()];
    expect(modules[0]!.id).toBe('power-grid');
    const orders = modules.map((m) => m.order ?? 0);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    for (const r of loadRecipes().values()) expect(loadHangar().has(r.module)).toBe(true);
  });

  it("puts recipes in item details' sources", () => {
    for (const recipe of hangarContent().recipes)
      expect(itemOrigins().get(recipe.output.item)!.crafted.length).toBeGreaterThan(0);
  });

  it('formats time left and craft times', () => {
    expect(timeLeft(40_000)).toBe('40s');
    expect(timeLeft(12 * 60_000 + 5_000)).toBe('12m 05s');
    expect(timeLeft(65 * 60_000)).toBe('1h 05m');
    expect(timeLeft(-5)).toBe('0s');
    expect(craftTime(45)).toBe('45 min');
    expect(craftTime(150)).toBe('2h 30m');
    expect(craftTime(480)).toBe('8h');
  });

  it("counts crafts ready by the server's clock, not the device's", () => {
    const profile = {
      hangar: {},
      crafts: {
        'trauma-bay': { recipe: 'r', item: 'bandage', count: 1, done: 1_000 },
        'armor-bench': { recipe: 'r', item: 'bandage', count: 1, done: 5_000 },
      },
    } as unknown as Profile;
    const me = { profile, now: 2_000 } as ProfileResponse;
    expect(readyCrafts(me)).toBe(1);
    expect(hangarLine([...loadHangar().values()], me)).toBe('1 ready to collect · 1 crafting');
  });

  it('words what was collected', () => {
    const names = { item: (id: string) => `<${id}>` };
    expect(collectedLine(names, { recipe: 'r', item: 'kiln-key', count: 1, done: 0 })).toBe(
      "Collected <kiln-key>: it's in your stash.",
    );
    expect(collectedLine(names, { recipe: 'r', item: 'bandage', count: 3, done: 0 })).toBe(
      "Collected <bandage> ×3: it's in your stash.",
    );
  });
});

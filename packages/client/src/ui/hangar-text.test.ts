import { recipeResults, type Profile, type ProfileResponse } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { hangarContent, itemOrigins, loadContracts, loadHangar, loadRecipes } from '../content';
import {
  collectedLine,
  contractObjectiveText,
  contractRaidLines,
  craftTime,
  hangarLine,
  readyCrafts,
  resultChances,
  timeLeft,
  type Names,
} from './hangar-text';

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
      for (const r of recipeResults(recipe))
        if (r.item) expect(itemOrigins().get(r.item)!.crafted.length).toBeGreaterThan(0);
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
        'armour-bench': { recipe: 'r', item: 'bandage', count: 1, done: 5_000 },
      },
      contracts: { day: 0, taken: [] },
    } as unknown as Profile;
    const me = { profile, now: 2_000 } as ProfileResponse;
    expect(readyCrafts(me)).toBe(1);
    expect(hangarLine([...loadHangar().values()], me)).toBe('1 ready to collect · 1 crafting');
  });

  it('words contracts, and counts a finished one on the menu (H6)', () => {
    const contracts = loadContracts();
    const names: Names = { item: (id) => id, vendor: (id) => id };
    const mapName = (id: string): string => (id === 'silver-creek' ? 'Silver Creek' : id);
    const creek = contracts.get('creek-patrol')!;
    expect(creek.objectives.map((o) => contractObjectiveText(names, mapName, o))).toEqual([
      'Kill 3 scavs on Silver Creek',
      'Hand over 2 × duct-tape (found in raid)',
    ]);
    const running = {
      hangar: {},
      crafts: {},
      contracts: {
        day: 0,
        taken: ['scav-sweep'],
        active: { id: 'scav-sweep', ends: 3_600_000, progress: {} },
      },
    } as unknown as Profile;
    const me = { profile: running, now: 0 } as ProfileResponse;
    expect(readyCrafts(me, contracts)).toBe(0);
    expect(hangarLine([], me, contracts)).toBe('contract 1h 00m left');
    running.contracts.active!.progress.scavs = 5;
    expect(readyCrafts(me, contracts)).toBe(1);
    expect(hangarLine([], me, contracts)).toBe('contract to claim');
    const lines = contractRaidLines(running, contracts, 'northpoint', { scav: 2 }, names, mapName);
    expect(lines).toEqual([]);
    running.contracts.active!.progress = { scavs: 1 };
    expect(
      contractRaidLines(running, contracts, 'northpoint', { scav: 2, pmc: 1 }, names, mapName),
    ).toEqual([{ quest: 'Contract: Scav sweep', text: 'Kill 5 scavs: 3/5' }]);
    expect(running.contracts.active!.progress).toEqual({ scavs: 1 });
  });

  it('words a decryption: its chances, and what was collected (H5)', () => {
    const recipe = loadRecipes().get('intel-flash-drive')!;
    const chances = resultChances(recipe);
    expect(chances.reduce((n, c) => n + c.percent, 0)).toBe(100);
    expect(chances[0]!.percent).toBeGreaterThanOrEqual(chances.at(-1)!.percent);
    const names = { item: (id: string) => `<${id}>`, vendor: (id: string) => `[${id}]` };
    expect(collectedLine(names, { recipe: 'r', vendor: 'fence', rep: 0.05, done: 0 })).toBe(
      'Decrypted: [fence] +0.05 rep.',
    );
    expect(collectedLine(names, { recipe: 'r', item: 'kiln-key', count: 1, done: 0 })).toBe(
      "Collected <kiln-key>: it's in your stash.",
    );
  });
});

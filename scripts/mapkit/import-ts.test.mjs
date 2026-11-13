import { describe, expect, it } from 'vitest';
import { importTs } from './import-ts.mjs';

describe('importTs (MK-3)', () => {
  it("bundles shared's TypeScript for a script", async () => {
    const kit = await importTs();
    const layout = kit.loadLayout(
      {
        formatVersion: 1,
        id: 't',
        bounds: { x0: 0, z0: 0, x1: 10, z1: 10 },
        slope: { low: [0, 10], lowY: 0, high: [0, 0], highY: 4 },
      },
      't',
    );
    expect(kit.heightAt(layout, 5, 5)).toBeCloseTo(2);
  }, 30000);
});

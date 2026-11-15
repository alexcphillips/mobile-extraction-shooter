import { itemDef, type ItemDb, type ItemDef } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { loadBody, loadItems, loadSkeleton } from '../content';
import { FIT_KIT, FIT_POSES, fitCheck } from './fit-check';
import * as THREE from 'three';
import { Pose, compileSkeleton, torsoBoxes, torsoDistance } from './skeleton-pose';
import { TriangleBuilder } from './geometry';
import { modelShapes } from '@mes/shared';

const skeleton = compileSkeleton(loadSkeleton());
const body = loadBody();
const items = loadItems();

/** The item database with one more item in it. */
function plus(def: ItemDef): ItemDb {
  return new Map([...items, [def.id, def]]);
}

describe('fit check', () => {
  it('finds the head poking through a helmet too small for it', () => {
    const small = {
      ...itemDef(items, 'combat-helmet'),
      id: 'small-helmet',
      // A shell that sits low on the skull and is narrower than it.
      model: {
        parts: [
          {
            type: 'cylinder' as const,
            pos: [0, 1.7, -0.025] as [number, number, number],
            radius: 0.07,
            height: 0.08,
            sides: 8,
            color: '#5d6266',
          },
        ],
      },
    } as ItemDef;
    const [, row] = fitCheck(
      body,
      skeleton,
      { helmet: 'small-helmet' },
      plus(small),
      FIT_POSES.slice(0, 1),
    );
    expect(row!.item).toBe('small-helmet');
    expect(row!.cells[0]!.through).toBeGreaterThan(0.01);
    expect(row!.cells[0]!.throughBy).toBe('head');
  });

  it("fits CH-3's test kit: nothing shows through any piece in any test pose", () => {
    const rows = fitCheck(body, skeleton, FIT_KIT, items);
    expect(rows.map((r) => r.item)).toEqual([
      '(chest)',
      'plate-carrier',
      'chest-rig',
      'tactical-headset',
      'combat-helmet',
      'heavy-visor',
    ]);
    for (const row of rows)
      row.cells.forEach((cell, i) =>
        expect(cell.through, `${row.item} in ${FIT_POSES[i]!.name}`).toBeLessThan(0.01),
      );
    // The head gear clears the head and each other in every pose.
    for (const row of rows.filter((r) => ['tactical-headset', 'combat-helmet'].includes(r.item)))
      for (const cell of row.cells) expect(cell.into).toBeLessThan(0.005);
    // About a second alone; slower with the whole suite running.
  }, 30_000);

  it('hangs arms clear of the torso and a carrier, and finds an arm forced into them', () => {
    const down = FIT_POSES.filter((p) => p.name === 'down');
    const [chest, carrier] = fitCheck(body, skeleton, { armor: 'plate-carrier' }, items, down);
    expect(chest!.cells[0]!.into).toBe(0);
    expect(carrier!.cells[0]!.into).toBeLessThan(0.01);
    // The right arm swung down and in, past where clearArms would let it: caught.
    const forced = [
      {
        name: 'in',
        set: (p: Pose) => {
          p.turnLocal(skeleton.index.upperArmR, new THREE.Vector3(0, 0, 1), -1.75);
          p.update();
        },
      },
    ];
    const [c2, a2] = fitCheck(body, skeleton, { armor: 'plate-carrier' }, items, forced);
    expect(c2!.cells[0]!.into).toBeGreaterThan(0.01);
    expect(c2!.cells[0]!.intoBy).toMatch(/^(upperArm|forearm|hand)R$/);
    expect(a2!.cells[0]!.into).toBeGreaterThan(0.005);
    expect(a2!.cells[0]!.intoArea).toBeGreaterThan(0);
  });

  it('keeps every armor and rig inside its layer, where the arms keep out (CH-3c)', () => {
    // Made for the pack's body before our own; CH-3d refits them. Nothing new joins this.
    const REFIT = new Set([
      'armored-chest-rig',
      'assault-armor',
      'heavy-plate-carrier',
      'jug-armor',
      'police-vest',
      'soft-vest',
      'tactical-vest',
      'trail-4-chest-rig',
    ]);
    for (const def of items.values()) {
      const layer =
        def.type === 'armor' && def.slot === 'body'
          ? 'armor'
          : def.type === 'container' && def.slot === 'rig'
            ? 'rig'
            : null;
      if (!layer || REFIT.has(def.id)) continue;
      const b = new TriangleBuilder(false);
      for (const s of modelShapes(def.model)) b.shape(s);
      const p = b.build().getAttribute('position').array;
      let worst = 0;
      // Where the arms go: from the hips to under the shoulders (straps over them are fine).
      for (let i = 0; i < p.length; i += 3)
        if (p[i + 1]! > 0.95 && p[i + 1]! < 1.45)
          worst = Math.max(
            worst,
            torsoDistance(torsoBoxes(layer), p[i]!, p[i + 1]! - 1.28, p[i + 2]!),
          );
      expect(worst, def.id).toBeLessThan(0.005);
    }
  });
});

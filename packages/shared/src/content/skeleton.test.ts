import { describe, expect, it } from 'vitest';
import { loadContent } from './format';
import {
  BODY_FORMAT,
  CLIP_FORMAT,
  CLIP_FORMAT_VERSION,
  SKELETON_BONES,
  SKELETON_FORMAT,
  outfitSlotOf,
} from './skeleton';

const bones = SKELETON_BONES.map((name, i) => ({
  name,
  parent: i === 0 ? null : 'hips',
  offset: [0, 0.1, 0],
}));
const skeleton = {
  formatVersion: 1,
  bones,
  mounts: { helmet: 'head', armor: 'chest', rig: 'chest', backpack: 'chest' },
  headVolume: { a: [0, 0, 0], b: [0, 0.1, 0], radius: 0.1 },
};
const loadSkeleton = (raw: object) => loadContent(SKELETON_FORMAT, raw, 'skeleton.json');

const walk = {
  formatVersion: CLIP_FORMAT_VERSION,
  id: 'walk',
  layer: 'lower',
  length: 1,
  loop: true,
  keys: {
    thighL: [
      [0, 30, 0, 0],
      [0.5, -20, 0, 0],
    ],
  },
  move: [
    [0, 0, 0.02, 0],
    [0.5, 0, -0.02, 0],
  ],
};
const loadClip = (raw: object) => loadContent(CLIP_FORMAT, raw, 'walk.json');

describe('skeleton', () => {
  it('loads a skeleton with every bone, parents first', () => {
    expect(loadSkeleton(skeleton).bones).toHaveLength(SKELETON_BONES.length);
  });

  it('rejects a missing bone, a second root or a parent listed later', () => {
    expect(() => loadSkeleton({ ...skeleton, bones: bones.slice(1) })).toThrow(/no hips/);
    const twoRoots = bones.map((b, i) => (i === 1 ? { ...b, parent: null } : b));
    expect(() => loadSkeleton({ ...skeleton, bones: twoRoots })).toThrow(/listed before/);
    const late = bones.map((b, i) => (i === 1 ? { ...b, parent: 'footR' } : b));
    expect(() => loadSkeleton({ ...skeleton, bones: late })).toThrow(/listed before/);
  });

  it('rejects limits whose min is over the max', () => {
    const bad = bones.map((b, i) =>
      i === 1 ? { ...b, limits: { min: [10, 0, 0], max: [0, 0, 0] } } : b,
    );
    expect(() => loadSkeleton({ ...skeleton, bones: bad })).toThrow(/at most its max/);
  });
});

describe('animation clips', () => {
  it('loads a legs clip with the hips moving', () => {
    expect(loadClip(walk).keys.thighL).toHaveLength(2);
  });

  it('keeps each layer to its own bones, and the move to the legs', () => {
    expect(() => loadClip({ ...walk, keys: { chest: [[0, 0, 0, 0]] } })).toThrow(/upper layer/);
    expect(() => loadClip({ ...walk, layer: 'upper' })).toThrow(/lower layer/);
    expect(() => loadClip({ ...walk, layer: 'upper', keys: {} })).toThrow(/moves the hips/);
  });

  it('rejects times out of order or outside the clip', () => {
    const keys = (k: number[][]) => loadClip({ ...walk, keys: { thighL: k } });
    expect(() =>
      keys([
        [0.5, 0, 0, 0],
        [0.2, 0, 0, 0],
      ]),
    ).toThrow(/times must go up/);
    expect(() =>
      keys([
        [0, 0, 0, 0],
        [1.5, 0, 0, 0],
      ]),
    ).toThrow(/outside the clip/);
  });
});

describe('the body (CH-2)', () => {
  const part = { type: 'box', pos: [0, 1.6, 0], size: [0.1, 0.1, 0.1], color: '#c99a78' };
  const body = (parts: object[]) => ({
    formatVersion: 1,
    colors: {
      skin: '#c99a78',
      top: '#5d6670',
      bottom: '#3f4650',
      hands: '#3b3530',
      feet: '#2e2a26',
    },
    model: { parts },
  });
  const load = (raw: object) => loadContent(BODY_FORMAT, raw, 'body.json');

  it("takes each part's group as its bone", () => {
    expect(load(body([{ ...part, group: 'head' }])).model.parts).toHaveLength(1);
    expect(() => load(body([part]))).toThrow(/group is its bone/);
    expect(() => load(body([{ ...part, group: 'tail' }]))).toThrow(/group is its bone/);
    expect(() => load(body([{ ...part, group: 'head', hiddenBy: 'optic' }]))).toThrow(
      /never hidden/,
    );
  });

  it('colors each bone by its outfit slot', () => {
    expect(outfitSlotOf('head')).toBe('skin');
    expect(outfitSlotOf('neck')).toBe('skin');
    expect(outfitSlotOf('chest')).toBe('top');
    expect(outfitSlotOf('forearmL')).toBe('top');
    expect(outfitSlotOf('handR')).toBe('hands');
    expect(outfitSlotOf('hips')).toBe('bottom');
    expect(outfitSlotOf('shinL')).toBe('bottom');
    expect(outfitSlotOf('footR')).toBe('feet');
  });
});

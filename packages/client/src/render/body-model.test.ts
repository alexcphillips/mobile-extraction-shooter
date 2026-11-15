import { HEAD, HIT_CAPSULES, SKELETON_BONES, type Outfit } from '@mes/shared';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadBody, loadItems, loadSkeleton } from '../content';
import { NO_WORN, bodyGeometry } from './body-model';
import { compileSkeleton } from './skeleton-pose';

const skeleton = compileSkeleton(loadSkeleton());
const body = loadBody();
const items = loadItems();
const outfit: Outfit = { ...body.colors };

describe('our body (CH-2)', () => {
  it('is one mesh, every vertex on one bone, inside its budget', () => {
    const g = bodyGeometry(body, skeleton, outfit, NO_WORN, items);
    const n = g.getAttribute('position').count;
    expect(n / 3).toBeLessThanOrEqual(1500);
    const index = g.getAttribute('skinIndex');
    const weight = g.getAttribute('skinWeight');
    const bones = new Set<number>();
    for (let i = 0; i < n; i++) {
      expect(weight.getX(i)).toBe(1);
      bones.add(index.getX(i));
    }
    // Every bone has a piece.
    expect(bones.size).toBe(SKELETON_BONES.length);
  });

  it('keeps each piece near its bone, and the head inside the head volume', () => {
    const g = bodyGeometry(body, skeleton, outfit, NO_WORN, items);
    const pos = g.getAttribute('position');
    const index = g.getAttribute('skinIndex');
    const head = HIT_CAPSULES.find((c) => c.zone === HEAD)!;
    const axis = new THREE.Line3(
      new THREE.Vector3(head.a[0], head.a[1], -head.a[2]),
      new THREE.Vector3(head.b[0], head.b[1], -head.b[2]),
    );
    const p = new THREE.Vector3();
    const near = new THREE.Vector3();
    const at = (i: number) => new THREE.Vector3().fromArray(skeleton.rest, i * 3);
    const bones = SKELETON_BONES.map((_, i) => {
      const child = [...skeleton.parent].indexOf(i);
      return new THREE.Line3(at(i), at(child < 0 ? i : child));
    });
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const bone = index.getX(i);
      // No vertex is more than 0.22 m from its bone: the segment from its joint to its
      // child's (the joint alone for a hand, foot or head; a foot reaches its toe).
      expect(bones[bone]!.closestPointToPoint(p, true, near).distanceTo(p)).toBeLessThan(0.22);
      if (bone === skeleton.index.head)
        expect(axis.closestPointToPoint(p, true, near).distanceTo(p)).toBeLessThan(head.radius);
    }
  });

  it('tints each piece by its outfit slot, keeping its shades', () => {
    const red: Outfit = { ...outfit, top: '#c0392b' };
    const plain = bodyGeometry(body, skeleton, outfit, NO_WORN, items).getAttribute('color');
    const g = bodyGeometry(body, skeleton, red, NO_WORN, items);
    const color = g.getAttribute('color');
    const index = g.getAttribute('skinIndex');
    const k = new THREE.Color('#c0392b');
    const was = new THREE.Color(body.colors.top);
    let chest = 0;
    for (let i = 0; i < color.count; i++) {
      const bone = index.getX(i);
      if (bone === skeleton.index.chest) {
        expect(color.getX(i)).toBeCloseTo(Math.min(1, (plain.getX(i) * k.r) / was.r), 5);
        chest++;
      } else if (bone === skeleton.index.head) {
        expect(color.getX(i)).toBe(plain.getX(i));
      }
    }
    expect(chest).toBeGreaterThan(0);
  });

  it('leaves the head out under a helmet that hides it', () => {
    const full = [...items.values()].find((d) => d.type === 'armor' && d.hidesHead)!;
    expect(full).toBeDefined();
    // The same helmet without the flag: the difference on the head bone is the body's head.
    const open = new Map(items).set(full.id, { ...full, hidesHead: undefined } as typeof full);
    const onHead = (db: typeof items) => {
      const g = bodyGeometry(body, skeleton, outfit, { ...NO_WORN, helmet: full.id }, db);
      const index = g.getAttribute('skinIndex');
      let n = 0;
      for (let i = 0; i < index.count; i++) if (index.getX(i) === skeleton.index.head) n++;
      return n;
    };
    const headParts = body.model.parts.filter((p) => p.group === 'head').length;
    expect(headParts).toBeGreaterThan(0);
    const bare = bodyGeometry(body, skeleton, outfit, NO_WORN, items).getAttribute('skinIndex');
    let headVerts = 0;
    for (let i = 0; i < bare.count; i++) if (bare.getX(i) === skeleton.index.head) headVerts++;
    expect(onHead(open) - onHead(items)).toBe(headVerts);
  });
});

import { compileMap, loadContent, MAP_FORMAT, type MapFile, type MapNode } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { buildSilhouettes, LandmarkPass, SILHOUETTE_SHADE } from './landmarks';

function compiled(nodes: MapNode[]) {
  const row = Array<number>(11).fill(0);
  return compileMap(
    loadContent(
      MAP_FORMAT,
      {
        formatVersion: 4,
        id: 'test',
        name: 'Test',
        environment: { sky: '#a0b0c0', fogNear: 40, fogFar: 120 },
        terrain: {
          origin: [-20, -20],
          cellSize: 4,
          heights: Array.from({ length: 11 }, () => row),
          color: '#6b8f4e',
        },
        nodes,
        zones: [],
      } satisfies MapFile,
      'test.json',
    ),
    new Map(),
  );
}

const tower = (x: number): MapNode => ({
  type: 'group',
  pos: [x, 0, 0],
  landmark: true,
  nodes: [
    { type: 'box', pos: [0, 0, 0], size: [3, 12, 3], color: '#884422' },
    // A ladder rung's worth of detail: left out of the silhouette.
    { type: 'box', pos: [2, 1, 0], size: [0.4, 0.05, 0.05], color: '#222222' },
  ],
});

describe('landmark silhouettes (MT-1)', () => {
  it('merges every landmark into one mesh, one draw call, in one flat color', () => {
    const one = buildSilhouettes(compiled([tower(0)]))!;
    const three = buildSilhouettes(compiled([tower(-10), tower(0), tower(10)]))!;
    // However many landmarks, one mesh with one material: one draw call.
    expect(three.isMesh).toBe(true);
    expect(Array.isArray(three.material)).toBe(false);
    expect(three.geometry.groups).toHaveLength(0);
    // The small part is left out: a box is 12 triangles.
    expect(one.geometry.getAttribute('position').count).toBe(12 * 3);
    expect(three.geometry.getAttribute('position').count).toBe(3 * 12 * 3);
    expect(three.geometry.getAttribute('color')).toBeUndefined();
    const material = three.material as import('three').MeshBasicMaterial;
    expect(material.fog).toBe(false);
    expect(material.color.r).toBeCloseTo((0xa0 / 255) ** 2.2 * SILHOUETTE_SHADE, 1);
  });

  it('draws nothing, and costs nothing, with no landmarks', () => {
    const map = compiled([{ type: 'box', pos: [0, 0, 0], size: [3, 12, 3], color: '#884422' }]);
    expect(buildSilhouettes(map)).toBeNull();
    const pass = new LandmarkPass(map);
    expect(pass.scene.children).toHaveLength(0);
    // It never touches the renderer.
    expect(pass.render(null as never, null as never)).toBe(false);
  });
});

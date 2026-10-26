import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadContent, type ContentFormat } from './format';
import { MAP_FORMAT } from './schema';

// A made-up format at version 3: v1 had `n`, v2 renamed it to `count`, v3 added `tags`.
const thing: ContentFormat<{ formatVersion: 3; count: number; tags: string[] }> = {
  kind: 'thing',
  version: 3,
  schema: z.strictObject({
    formatVersion: z.literal(3),
    count: z.number(),
    tags: z.array(z.string()),
  }),
  migrations: {
    1: ({ n, ...rest }) => ({ ...rest, count: n }),
    2: (doc) => ({ ...doc, tags: [] }),
  },
};

const flatMap = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  environment: { sky: '#9fb3c8', fogNear: 40, fogFar: 120 },
  terrain: {
    origin: [0, 0],
    cellSize: 4,
    heights: [
      [0, 0],
      [0, 0],
    ],
    colour: '#6b8f4e',
  },
  nodes: [],
  zones: [],
  ...extra,
});

describe('loadContent', () => {
  it('runs every migration from the file version up', () => {
    expect(loadContent(thing, { formatVersion: 1, n: 4 }, 'a.json')).toEqual({
      formatVersion: 3,
      count: 4,
      tags: [],
    });
    expect(loadContent(thing, { formatVersion: 2, count: 5 }, 'a.json').count).toBe(5);
  });

  it('rejects bad or newer versions and non-objects', () => {
    expect(() => loadContent(thing, [], 'a.json')).toThrow(/a\.json: a thing must be/);
    expect(() => loadContent(thing, { count: 1 }, 'a.json')).toThrow(/formatVersion/);
    expect(() => loadContent(thing, { formatVersion: 1.5 }, 'a.json')).toThrow(/formatVersion/);
    expect(() => loadContent(thing, { formatVersion: 4 }, 'a.json')).toThrow(/newer/);
    const gap = { ...thing, migrations: { 2: thing.migrations[2]! } };
    expect(() => loadContent(gap, { formatVersion: 1, n: 1 }, 'a.json')).toThrow(/no migration/);
  });

  it('reports schema errors with their path', () => {
    expect(() => loadContent(thing, { formatVersion: 3, count: 'x', tags: [] }, 'a.json')).toThrow(
      /count/,
    );
  });
});

describe('map schema', () => {
  const load = (doc: unknown): unknown => loadContent(MAP_FORMAT, doc, 'm.json');

  it('accepts a minimal map', () => {
    expect(() => load(flatMap())).not.toThrow();
  });

  it('rejects unknown fields, so typos are caught', () => {
    expect(() => load(flatMap({ zone: [] }))).toThrow(/zone/);
    const box = { type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff', yaww: 9 };
    expect(() => load(flatMap({ nodes: [box] }))).toThrow(/yaww/);
  });

  it('checks shapes, colours, ids and the terrain grid', () => {
    const box = (fields: Record<string, unknown>): unknown =>
      flatMap({
        nodes: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#ffffff', ...fields }],
      });
    expect(() => load(box({ size: [1, 0, 1] }))).toThrow(/greater than 0/);
    expect(() => load(box({ colour: 'Red' }))).toThrow(/colour/);
    expect(() => load(box({ colour: 'paint' }))).not.toThrow();
    const twice = { type: 'lootSpawn', id: 'a', pos: [0, 0, 0], lootTable: 'household' };
    expect(() => load(flatMap({ nodes: [twice, twice] }))).toThrow(/duplicate id "a"/);
    const ragged = flatMap();
    (ragged.terrain as { heights: number[][] }).heights = [[0, 0], [0]];
    expect(() => load(ragged)).toThrow(/same length/);
    const fog = flatMap({ environment: { sky: '#000000', fogNear: 100, fogFar: 50 } });
    expect(() => load(fog)).toThrow(/fogNear/);
  });
});

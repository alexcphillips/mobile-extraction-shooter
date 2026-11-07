import { describe, expect, it } from 'vitest';
import { apply, diff, strip } from './sync';

/** What a guest's copy becomes after the host's patch. */
function roundTrip<T>(prev: T, next: T, omit?: ReadonlySet<string>): T {
  const copy = JSON.parse(JSON.stringify(prev)) as T;
  const p = diff(prev, next, omit);
  return p ? apply(copy, JSON.parse(JSON.stringify(p))) : copy;
}

describe('state sync', () => {
  it('turns one value into another, through JSON', () => {
    const cases: [unknown, unknown][] = [
      [1, 2],
      [
        { a: 1, b: { c: [1, 2, 3] } },
        { a: 1, b: { c: [1, 5] }, d: 'new' },
      ],
      [{ a: 1, gone: true }, { a: 2 }],
      [
        [1, 2],
        [1, 2, 3],
      ],
      [{ x: null }, { x: { y: 1 } }],
      [{ x: { y: 1 } }, { x: null }],
      [
        [
          { id: 1, v: 1 },
          { id: 2, v: 2 },
        ],
        [
          { id: 2, v: 3 },
          { id: 3, v: 4 },
        ],
      ],
      [[], [{ id: 'a', v: 1 }]],
      [[{ id: 'a', v: 1 }], []],
    ];
    for (const [a, b] of cases) expect(roundTrip(a, b)).toEqual(b);
  });

  it('sends a key set to undefined as gone, so the guest and the mirror agree', () => {
    const prev = { opening: 5, keep: 1 };
    const next = { opening: undefined, keep: 1 };
    const mirror = apply({ ...prev }, diff(prev, next)!);
    expect(roundTrip<object>(prev, next)).toEqual({ keep: 1 });
    expect(mirror).toEqual({ keep: 1 });
    expect('opening' in mirror).toBe(false);
    expect(strip({ a: undefined, b: 2 })).toEqual({ b: 2 });
  });

  it('sends nothing when nothing changed', () => {
    const s = { a: [1, { b: 2 }], c: [{ id: 1, x: 1 }] };
    expect(diff(s, JSON.parse(JSON.stringify(s)))).toBeUndefined();
    expect(diff({ n: NaN }, { n: NaN })).toBeUndefined();
  });

  it('keeps each object the guest holds, matching lists by id', () => {
    const host = {
      entities: [
        { id: 1, x: 0 },
        { id: 2, x: 0 },
        { id: 3, x: 0 },
      ],
    };
    const guest = JSON.parse(JSON.stringify(host)) as typeof host;
    const me = guest.entities[2]!;
    const next = {
      entities: [
        { id: 1, x: 1 },
        { id: 3, x: 5 },
      ],
    };
    apply(guest, diff(host, next)!);
    expect(guest.entities).toEqual(next.entities);
    // Entity 2 left; entity 3 moved up a place but is still the same object.
    expect(guest.entities[1]).toBe(me);
    expect(me.x).toBe(5);
  });

  it('leaves omitted keys out, at any depth', () => {
    const prev = { rng: 1, e: [{ id: 1, ai: { t: 1 }, x: 1 }] };
    const next = {
      rng: 2,
      e: [
        { id: 1, ai: { t: 2 }, x: 2 },
        { id: 2, ai: { t: 0 }, x: 0 },
      ],
    };
    const omit = new Set(['rng', 'ai']);
    const p = diff(prev, next, omit)!;
    expect(JSON.stringify(p)).not.toMatch(/rng|ai/);
    expect(strip(next, omit)).toEqual({
      e: [
        { id: 1, x: 2 },
        { id: 2, x: 0 },
      ],
    });
  });
});

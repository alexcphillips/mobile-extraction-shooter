import { ITEM_FORMAT, loadContent, modelShapes, type ItemDef, type ModelPart } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { itemContentProblem, itemUses, loadItems } from '../content';
import { reticleMarkup } from '../hud/optic';
import { TriangleBuilder } from '../render/geometry';
import { budgetOf, triangleCount } from './budget';
import {
  appendParts,
  duplicateParts,
  groupsOf,
  mirrorPart,
  partLabel,
  removeParts,
  setSlots,
  type Axis,
} from './model-edit';
import { coloursOf } from './palette';
import { dragged, mirrored, repeated } from './reticle-edit';
import { storageRisks } from './risk';
import { ITEM_TYPES, blankItem } from './templates';

/** The content items with one changed, as a fresh database. */
function edited(id: string, change: (d: Record<string, unknown>) => void): Map<string, ItemDef> {
  const items = new Map(loadItems());
  const doc = structuredClone(items.get(id)) as unknown as Record<string, unknown>;
  change(doc);
  items.set(id, loadContent(ITEM_FORMAT, doc, id));
  return items;
}

describe('item editor', () => {
  it.each(ITEM_TYPES)('a new %s passes the item schema', (type) => {
    const doc = blankItem(type, 'new-thing', 'New thing', 'ammo-9mm');
    expect(() => loadContent(ITEM_FORMAT, structuredClone(doc), 'new')).not.toThrow();
    expect(Object.keys(doc).slice(0, 4)).toEqual(['formatVersion', 'id', 'name', 'type']);
  });

  it('finds nothing wrong with the content as it is', () => {
    expect(itemContentProblem(loadItems())).toBeNull();
  });

  it('finds what an edit breaks elsewhere in content/', () => {
    // An attachment lists the gun it fits; a loadout puts a suppressor on the boss's rifle.
    const noMags = edited('assault-rifle', (d) => setSlots(d, ['optic', 'muzzle']));
    expect(itemContentProblem(noMags)).toMatch(/mag-762x39-45.*no magazine slot/);
    const noMuzzle = edited('assault-rifle', (d) => setSlots(d, ['optic', 'magazine']));
    expect(itemContentProblem(noMuzzle)).toMatch(/loadouts\/boss-kit.*suppressor/);
    // The test map's shed door needs a key item.
    const notAKey = edited('shed-key', (d) => {
      d.type = 'loot';
      delete d.uses;
    });
    expect(itemContentProblem(notAKey)).toMatch(/door .* not a key item/);
    // A new player carries a medkit.
    const hugeMedkit = edited('medkit', (d) => (d.size = [5, 5]));
    expect(itemContentProblem(hugeMedkit)).toMatch(/kit new-player: no room to carry "medkit"/);
  });

  it('lists where content names an item', () => {
    const items = loadItems();
    expect(itemUses('shed-key', items)).toContain('door shed-door on test-map');
    expect(itemUses('ammo-9mm', items)).toEqual(
      expect.arrayContaining(['m9a3 fires it', 'vendor quartermaster', 'starting kit new-player']),
    );
    expect(itemUses('assault-rifle', items)).toEqual(
      expect.arrayContaining(['scope-4x fits it', 'loadout scav-kit']),
    );
    expect(itemUses('m416', items)).toEqual(
      expect.arrayContaining(['scope-4x fits it', 'starting kit new-player']),
    );
    expect(itemUses('patient-notes', items)).toEqual(['quest lost-notes']);
  });

  it('warns about changes that can break saved stashes, and only those', () => {
    const items = loadItems();
    const risks = (id: string, change: (d: Record<string, unknown>) => void): string[] =>
      storageRisks(items.get(id)!, edited(id, change).get(id)!);
    expect(risks('m9a3', (d) => (d.size = [2, 2]))).toHaveLength(1);
    expect(risks('m9a3', (d) => (d.magazine = 10))).toHaveLength(1);
    expect(risks('m9a3', (d) => setSlots(d, ['optic']))).toEqual([
      expect.stringMatching(/muzzle and magazine/),
    ]);
    expect(
      risks('chest-rig', (d) => {
        d.grid = [3, 2];
        delete d.sections;
      }),
    ).toHaveLength(1);
    expect(risks('chest-rig', (d) => (d.sections = [{ at: [0, 0], size: [4, 2] }]))).toHaveLength(
      1,
    );
    expect(risks('steel-helmet', (d) => (d.durability = 30))).toHaveLength(1);
    expect(risks('cash', (d) => (d.stack = 100))).toHaveLength(1);
    expect(risks('medkit', (d) => (d.hp = 150))).toHaveLength(1);
    expect(
      risks('mag-9mm-24', (d) => ((d.mods as { magazine: number }).magazine = 5)),
    ).toHaveLength(1);
    expect(risks('suppressor', (d) => (d.weapons = ['m9a3']))).toHaveLength(1);
    expect(risks('shed-key', (d) => (d.uses = 5))).toHaveLength(1);
    // Making things bigger, or changing what doesn't limit saved items, is safe.
    expect(risks('m9a3', (d) => (d.magazine = 20))).toEqual([]);
    expect(risks('m9a3', (d) => (d.rpm = 300))).toEqual([]);
    expect(risks('chest-rig', (d) => (d.grid = [5, 3]))).toEqual([]);
    expect(risks('scope-4x', (d) => (d.weapons = [...(d.weapons as string[]), 'm9a3']))).toEqual(
      [],
    );
    expect(risks('steel-helmet', (d) => (d.level = 5))).toEqual([]);
  });

  it("keeps a gun's mounts and hidden parts in step with its slots", () => {
    const rifle = structuredClone(loadItems().get('assault-rifle')) as unknown as Record<
      string,
      unknown
    >;
    setSlots(rifle, ['muzzle']);
    const model = rifle.model as { mounts: object; parts: { hiddenBy?: string }[] };
    expect(Object.keys(model.mounts)).toEqual(['muzzle']);
    // Only the muzzle brake, hidden by the slot that's kept, is still hidden by anything.
    expect(model.parts.every((p) => !p.hiddenBy || p.hiddenBy === 'muzzle')).toBe(true);
    // A slot coming back gets the placeholder's mount, in the file's order.
    setSlots(rifle, ['magazine', 'optic', 'muzzle']);
    expect(model.mounts).toEqual({
      optic: [0, 0.045, 0],
      muzzle: [0, 0.005, -0.54],
      magazine: [0, -0.045, -0.06],
    });
    expect(() => loadContent(ITEM_FORMAT, rifle, 'r')).not.toThrow();
  });

  it('mirrors a part across the middle', () => {
    const p = {
      type: 'box' as const,
      pos: [0.1, 0, -0.2] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
      yaw: 20,
      pitch: 10,
      colour: '#000000',
    };
    expect(mirrorPart(p)).toMatchObject({ pos: [-0.1, 0, -0.2], yaw: -20, pitch: 10 });
  });
  it('names, groups, duplicates, removes and pastes parts (IE-1)', () => {
    const box = (x: number, extra: Partial<ModelPart> = {}): ModelPart =>
      ({
        type: 'box',
        pos: [x, 0, 0],
        size: [0.1, 0.1, 0.1],
        colour: '#000000',
        ...extra,
      }) as ModelPart;
    const parts = [
      box(0, { group: 'stock', name: 'butt' }),
      box(1),
      box(2, { group: 'barrel' }),
      box(3, { group: 'stock' }),
    ];
    expect(groupsOf(parts)).toEqual(['stock', 'barrel']);
    expect(partLabel(parts[0]!, 0)).toBe('butt');
    expect(partLabel(parts[1]!, 1)).toBe('box 2');
    // One part's copy goes after it; several go to the end, mirrored left for right.
    expect(duplicateParts(parts, [1], false)).toEqual([2]);
    expect(parts).toHaveLength(5);
    expect(duplicateParts(parts, [4, 0], true)).toEqual([5, 6]);
    expect(parts[5]!.pos[0]).toBe(0);
    expect(parts[6]).toMatchObject({ pos: [-3, 0, 0], group: 'stock' });
    // Removing keeps at least one part.
    expect(
      removeParts(
        parts,
        parts.map((_, i) => i),
      ),
    ).toBe(false);
    expect(parts).toHaveLength(7);
    expect(removeParts(parts, [0, 2, 6])).toBe(true);
    expect(parts.map((p) => p.pos[0])).toEqual([1, 2, 3, 0]);
    // Pasted parts are copies, at the end.
    const clip = [box(9)];
    expect(appendParts(parts, clip)).toEqual([4]);
    parts[4]!.pos[0] = 8;
    expect(clip[0]!.pos[0]).toBe(9);
    // A part's name and group pass the item schema, and the game ignores them.
    const rifle = structuredClone(loadItems().get('assault-rifle')) as unknown as {
      model: { parts: ModelPart[] };
    };
    const before = modelShapes(rifle.model);
    rifle.model.parts[0]!.name = 'receiver';
    rifle.model.parts[0]!.group = 'body';
    expect(() => loadContent(ITEM_FORMAT, structuredClone(rifle), 'r')).not.toThrow();
    expect(modelShapes(rifle.model)).toEqual(before);
  });

  it('counts triangles against a budget by kind, and content is within it', () => {
    const items = loadItems();
    expect(budgetOf(items.get('m416')!)).toEqual({ triangles: 2000, kind: 'long gun' });
    expect(budgetOf(items.get('m9a3')!).kind).toBe('pistol');
    expect(budgetOf(items.get('red-dot')!).kind).toBe('optic');
    const cube = modelShapes({
      parts: [{ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour: '#000000' }],
    });
    expect(triangleCount(cube)).toBe(12);
    for (const d of items.values())
      expect(triangleCount(modelShapes(d.model)), d.id).toBeLessThanOrEqual(budgetOf(d).triangles);
  });

  it('mirrors parts across y and z into true mirror images (IE-2)', () => {
    /** A part's corners where the game draws them, rounded, as a sorted list. */
    const corners = (p: ModelPart, flip?: Axis): string[] => {
      const b = new TriangleBuilder(false);
      for (const sh of modelShapes({ parts: [p] })) b.shape(sh);
      const pos = b.build().getAttribute('position');
      const out = new Set<string>();
      for (let i = 0; i < pos.count; i++) {
        const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        if (flip) v['xyz'.indexOf(flip)]! *= -1;
        out.add(v.map((n) => (Math.round(n * 1e4) / 1e4 || 0).toFixed(4)).join(' '));
      }
      return [...out].sort();
    };
    const parts: ModelPart[] = [
      {
        type: 'wedge',
        pos: [0.1, 0.2, -0.3],
        size: [0.1, 0.2, 0.3],
        yaw: 20,
        pitch: 30,
        roll: 10,
        colour: '#000000',
      },
      {
        type: 'cylinder',
        pos: [0.05, -0.1, 0.2],
        radius: 0.05,
        radiusTop: 0.01,
        height: 0.2,
        sides: 5,
        yaw: 15,
        pitch: 70,
        colour: '#000000',
      },
      {
        type: 'slab',
        pos: [0, 0.1, 0.1],
        size: [0.2, 0.05, 0.3],
        corners: [0.01, 0.02, 0.05, 0.08],
        roll: 25,
        colour: '#000000',
      },
      {
        type: 'box',
        pos: [0.2, 0.1, 0.1],
        size: [0.2, 0.05, 0.3],
        yaw: 40,
        pitch: -10,
        colour: '#000000',
      },
    ];
    for (const p of parts)
      for (const axis of ['x', 'y', 'z'] as const)
        expect(corners(mirrorPart(p, axis)), `${p.type} across ${axis}`).toEqual(corners(p, axis));
    // A plain box keeps its angles' signs simple, and its copies go after it.
    expect(mirrorPart(parts[3]!, 'y')).toMatchObject({ pos: [0.2, -0.1, 0.1], yaw: 40, pitch: 10 });
    expect(mirrorPart(parts[3]!, 'z')).toMatchObject({
      pos: [0.2, 0.1, -0.1],
      yaw: -40,
      pitch: 10,
    });
    const list = [structuredClone(parts[3]!)];
    expect(duplicateParts(list, [0], 'z')).toEqual([1]);
    expect(list[1]!.pos[2]).toBe(-0.1);
  });

  it('lists an item’s colours by use (IE-2)', () => {
    const p = (colour: string): ModelPart =>
      ({ type: 'box', pos: [0, 0, 0], size: [1, 1, 1], colour }) as ModelPart;
    expect(coloursOf([p('#111111'), p('#222222'), p('#222222'), p('#AABBCC')])).toEqual([
      '#222222',
      '#111111',
      '#aabbcc',
    ]);
  });

  it('draws and edits arcs, triangles and shape colours in reticles (IE-2)', () => {
    const scope = structuredClone(
      [...loadItems().values()].find((d) => d.type === 'attachment' && d.optic && d.optic.zoom > 1),
    ) as unknown as { optic: { zoom: number; reticle: { colour: string; shapes: object[] } } };
    const arc = { type: 'arc', x: 0, y: 0, r: 10, width: 0.3, from: -45, to: 45 } as const;
    const chevron = {
      type: 'triangle',
      x1: 0,
      y1: 0,
      x2: 1.5,
      y2: 2.5,
      x3: -1.5,
      y3: 2.5,
      colour: '#ff0000',
    } as const;
    scope.optic.reticle.shapes.push(arc, chevron, {
      type: 'dot',
      x: 0,
      y: 0,
      r: 0.5,
      colour: '#ff0000',
    });
    const def = loadContent(ITEM_FORMAT, structuredClone(scope), 's');
    if (def.type !== 'attachment' || !def.optic) throw new Error('not an optic');
    const svg = reticleMarkup(def.optic);
    expect(svg).toContain('<path d="M-7.071 -7.071A10 10 0 0 1 7.071 -7.071"');
    expect(svg).toContain('<polygon points="0,0 1.5,2.5 -1.5,2.5" stroke="none" fill="#ff0000"');
    expect(svg).toContain('r="0.5" stroke="none" fill="#ff0000"');
    // An arc runs clockwise, more than nothing and no more than a full turn.
    for (const bad of [{ to: -45 }, { from: 0, to: 361 }]) {
      scope.optic.reticle.shapes = [{ ...arc, ...bad }];
      expect(() => loadContent(ITEM_FORMAT, structuredClone(scope), 's')).toThrow(/clockwise/);
    }
    // Mirrored left for right, an arc on the right comes out on the left, running clockwise.
    const right = { ...arc, from: 45, to: 135 };
    expect(mirrored(right, 'x')).toMatchObject({ from: -135, to: -45 });
    expect(mirrored(right, 'y')).toMatchObject({ from: 45, to: 135 });
    expect(mirrored(chevron, 'y')).toMatchObject({ y1: 0, y2: -2.5, y3: -2.5 });
    // Dragging an arc's end to straight down sets it to 180°, staying above the start.
    const snap = (v: number): number => v;
    expect(dragged(arc, 'to', 0, 0, snap, { x: 0, y: 10 }, true)).toMatchObject({
      from: -45,
      to: 180,
    });
    expect(dragged(arc, 'from', 0, 0, snap, { x: 10, y: 1 }, true)).toMatchObject({ from: -265 });
    expect(dragged(chevron, 'c', 1, 1, snap, { x: 0, y: 0 }, false)).toMatchObject({
      x1: 0,
      x3: -0.5,
      y3: 3.5,
    });
    // Repeated: plain shapes, each a step on.
    expect(
      repeated({ type: 'line', x1: 0, y1: 2, x2: 1, y2: 2, width: 0.2 }, 3, 0, 2).map(
        (l) => l.type === 'line' && l.y1,
      ),
    ).toEqual([4, 6, 8]);
  });
});

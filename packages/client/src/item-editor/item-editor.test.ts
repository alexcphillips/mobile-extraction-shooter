import { ITEM_FORMAT, loadContent, modelShapes, type ItemDef, type ModelPart } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { itemContentProblem, itemUses, loadItems } from '../content';
import { budgetOf, triangleCount } from './budget';
import {
  appendParts,
  duplicateParts,
  groupsOf,
  mirrorPart,
  partLabel,
  removeParts,
  setSlots,
} from './model-edit';
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
    expect(parts[5]!.pos[0]).toBe(-0);
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
    expect(parts.map((p) => p.pos[0])).toEqual([1, 2, 3, -0]);
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
});

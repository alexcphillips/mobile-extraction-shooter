import { ITEM_FORMAT, loadContent, type ItemDef } from '@mes/shared';
import { describe, expect, it } from 'vitest';
import { itemContentProblem, itemUses, loadItems } from '../content';
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
    // An attachment lists the gun it fits; a loadout puts a suppressor on the pistol.
    const noMags = edited('assault-rifle', (d) => (d.slots = ['optic', 'muzzle']));
    expect(itemContentProblem(noMags)).toMatch(/mag-556-45.*no magazine slot/);
    const noMuzzle = edited('pistol', (d) => (d.slots = ['optic', 'magazine']));
    expect(itemContentProblem(noMuzzle)).toMatch(/loadouts\/scav-kit.*suppressor/);
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
      expect.arrayContaining([
        'pistol fires it',
        'vendor quartermaster',
        'starting kit new-player',
      ]),
    );
    expect(itemUses('assault-rifle', items)).toEqual(
      expect.arrayContaining(['scope-4x fits it', 'loadout scav-kit', 'starting kit new-player']),
    );
    expect(itemUses('patient-notes', items)).toEqual(['quest lost-notes']);
  });

  it('warns about changes that can break saved stashes, and only those', () => {
    const items = loadItems();
    const risks = (id: string, change: (d: Record<string, unknown>) => void): string[] =>
      storageRisks(items.get(id)!, edited(id, change).get(id)!);
    expect(risks('pistol', (d) => (d.size = [2, 2]))).toHaveLength(1);
    expect(risks('pistol', (d) => (d.magazine = 10))).toHaveLength(1);
    expect(risks('pistol', (d) => (d.slots = ['optic']))).toEqual([
      expect.stringMatching(/muzzle and magazine/),
    ]);
    expect(risks('chest-rig', (d) => (d.grid = [3, 2]))).toHaveLength(1);
    expect(risks('steel-helmet', (d) => (d.durability = 30))).toHaveLength(1);
    expect(risks('cash', (d) => (d.stack = 100))).toHaveLength(1);
    expect(risks('medkit', (d) => (d.hp = 150))).toHaveLength(1);
    expect(
      risks('mag-9mm-24', (d) => ((d.mods as { magazine: number }).magazine = 5)),
    ).toHaveLength(1);
    expect(risks('suppressor', (d) => (d.weapons = ['pistol']))).toHaveLength(1);
    expect(risks('shed-key', (d) => (d.uses = 5))).toHaveLength(1);
    // Making things bigger, or changing what doesn't limit saved items, is safe.
    expect(risks('pistol', (d) => (d.magazine = 20))).toEqual([]);
    expect(risks('pistol', (d) => (d.rpm = 300))).toEqual([]);
    expect(risks('chest-rig', (d) => (d.grid = [5, 3]))).toEqual([]);
    expect(risks('scope-4x', (d) => (d.weapons = ['assault-rifle', 'pistol']))).toEqual([]);
    expect(risks('steel-helmet', (d) => (d.absorb = 0.9))).toEqual([]);
  });
});

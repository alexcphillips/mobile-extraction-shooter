import { describe, expect, it } from 'vitest';
import { loadItems, loadVendors, mapIds, questDocs, questMarkerIds } from '../content';
import {
  ancestors,
  canRequire,
  descendants,
  layoutChains,
  newObjectiveId,
  newQuestId,
  rewireForDelete,
  type ChainQuest,
} from './chain';
import { QuestEditor } from './editor';

const chain = (...qs: [string, string, string[]?][]): Map<string, ChainQuest> =>
  new Map(qs.map(([id, vendor, requires = []]) => [id, { id, vendor, requires }]));

describe('quest chains', () => {
  // Mara's quest unlocks one for Kovacs, which unlocks another for Mara.
  const quests = chain(['a', 'mara'], ['b', 'kovacs', ['a']], ['c', 'mara', ['b']], ['d', 'mara']);

  it('walks requirements both ways', () => {
    expect([...ancestors(quests, 'c')].sort()).toEqual(['a', 'b']);
    expect([...descendants(quests, 'a')].sort()).toEqual(['b', 'c']);
  });

  it('refuses loops, itself and repeats', () => {
    expect(canRequire(quests, 'a', 'c')).toBe(false);
    expect(canRequire(quests, 'a', 'a')).toBe(false);
    expect(canRequire(quests, 'b', 'a')).toBe(false);
    expect(canRequire(quests, 'c', 'd')).toBe(true);
  });

  it('passes a deleted quest’s requirements on', () => {
    expect(rewireForDelete(quests, 'b')).toEqual(new Map([['c', ['a']]]));
    expect(rewireForDelete(quests, 'a')).toEqual(new Map([['b', []]]));
    const both = chain(['a', 'm'], ['b', 'm', ['a']], ['c', 'm', ['a', 'b']]);
    expect(rewireForDelete(both, 'b')).toEqual(new Map([['c', ['a']]]));
  });

  it('lays chains out by vendor lane, each quest right of what it needs', () => {
    const l = layoutChains(quests, ['kovacs', 'mara']);
    const at = (id: string) => l.cards.find((c) => c.id === id)!;
    expect(l.lanes.map((x) => x.vendor)).toEqual(['kovacs', 'mara']);
    expect([at('a').col, at('b').col, at('c').col]).toEqual([0, 1, 2]);
    expect(at('b').row).toBe(0);
    expect(new Set([at('a').row, at('c').row, at('d').row]).size).toBeGreaterThan(1);
    // An empty vendor still gets a lane.
    expect(layoutChains(quests, ['kovacs', 'mara', 'doc']).lanes.at(-1)).toMatchObject({
      vendor: 'doc',
      rows: 1,
    });
  });

  it('makes ids that are new and valid', () => {
    expect(newQuestId(() => false)).toMatch(/^q-[0-9a-f]{6}$/);
    expect(newObjectiveId(['o-0000'])).toMatch(/^o-[0-9a-f]{4}$/);
  });
});

describe('quest editor', () => {
  const make = () => {
    const markers = new Map(mapIds().map((m) => [m, questMarkerIds(m) ?? []]));
    return new QuestEditor(
      questDocs(),
      { vendors: loadVendors(), items: loadItems(), markers },
      '',
    );
  };

  it('opens content/quests with no problems', () => {
    const e = make();
    expect(e.getState().problem).toBeNull();
    expect(e.getState().quests.size).toBe(questDocs().size);
  });

  it('renames without touching other quests', () => {
    const e = make();
    e.select('area-familiarization');
    e.edit((q) => (q.name = 'Renamed'));
    expect(e.getState().unsaved).toEqual(['area-familiarization']);
    expect(e.getState().quests.get('under-the-mill')!.requires).toEqual(['area-familiarization']);
    expect(e.getState().problem).toBeNull();
  });

  it('deletes a quest in the middle of a chain without breaking it, and undoes', () => {
    const e = make();
    e.remove('under-the-mill');
    const s = e.getState();
    expect(s.quests.has('under-the-mill')).toBe(false);
    expect(s.quests.get('kiln-four')!.requires).toEqual(['area-familiarization']);
    expect(s.problem).toBeNull();
    expect([...s.unsaved].sort()).toEqual(['kiln-four', 'under-the-mill']);
    e.undo();
    expect(e.getState().quests.get('kiln-four')!.requires).toEqual(['under-the-mill']);
    expect(e.getState().unsaved).toEqual([]);
  });

  it('makes a quest unlocked by another, for another vendor, that passes the checks', () => {
    const e = make();
    const vendor = [...loadVendors().keys()].find((v) => v !== 'guns-ammo-vendor')!;
    const id = e.create({ vendor, after: 'kiln-four' });
    const q = e.getState().quests.get(id)!;
    expect(q.vendor).toBe(vendor);
    expect(q.requires).toEqual(['kiln-four']);
    expect(e.getState().problem).toBeNull();
  });

  it('refuses a loop', () => {
    const e = make();
    e.require('area-familiarization', 'kiln-four');
    expect(e.getState().quests.get('area-familiarization')!.requires).toBeUndefined();
    expect(e.getState().message).toMatch(/loop/);
  });

  it('gives an objective a new id when what it asks for changes, not its count', () => {
    const e = make();
    e.select('shiny-stock');
    e.editObjective(0, (o) => o.type === 'handOver' && (o.count = 3));
    expect(e.getState().quests.get('shiny-stock')!.objectives[0]!.id).toBe('hand-over');
    e.retypeObjective(0, 'investigate');
    const o = e.getState().quests.get('shiny-stock')!.objectives[0]!;
    expect(o.type).toBe('investigate');
    expect(o.id).not.toBe('hand-over');
    expect(e.getState().problem).toBeNull();
  });

  // Silver Creek's chain: area-familiarization → under-the-mill → kiln-four.
  it('inserts a new quest before one, taking its requirements', () => {
    const e = make();
    const id = e.create({ vendor: 'armorer', before: 'kiln-four' });
    const s = e.getState();
    expect(s.quests.get(id)!.requires).toEqual(['under-the-mill']);
    expect(s.quests.get('kiln-four')!.requires).toEqual([id]);
    expect(s.problem).toBeNull();
    e.undo();
    expect(e.getState().quests.has(id)).toBe(false);
    expect(e.getState().quests.get('kiln-four')!.requires).toEqual(['under-the-mill']);
  });

  it('moves a quest before another in one step, closing the gap it left', () => {
    const e = make();
    e.move('kiln-four', 'under-the-mill', 'before');
    const s = e.getState();
    expect(s.quests.get('kiln-four')!.requires).toEqual(['area-familiarization']);
    expect(s.quests.get('under-the-mill')!.requires).toEqual(['kiln-four']);
    expect(s.problem).toBeNull();
    e.undo();
    expect(e.getState().unsaved).toEqual([]);
  });

  it('moves a quest after another, its old dependents rewired', () => {
    const e = make();
    e.move('under-the-mill', 'kiln-four', 'after');
    const s = e.getState();
    expect(s.quests.get('kiln-four')!.requires).toEqual(['area-familiarization']);
    expect(s.quests.get('under-the-mill')!.requires).toEqual(['kiln-four']);
    expect(s.problem).toBeNull();
  });

  it('sets several requirements at once, refusing a loop', () => {
    const e = make();
    e.setRequires('kiln-four', ['under-the-mill', 'shiny-stock', 'scrap-plates']);
    expect(e.getState().quests.get('kiln-four')!.requires).toEqual([
      'under-the-mill',
      'shiny-stock',
      'scrap-plates',
    ]);
    e.setRequires('area-familiarization', ['kiln-four']);
    expect(e.getState().quests.get('area-familiarization')!.requires).toBeUndefined();
    expect(e.getState().message).toMatch(/loop/);
  });

  it('gives a quest to another vendor, keeping its links', () => {
    const e = make();
    e.setVendor('under-the-mill', 'medic');
    const q = e.getState().quests.get('under-the-mill')!;
    expect(q.vendor).toBe('medic');
    expect(q.requires).toEqual(['area-familiarization']);
  });
});

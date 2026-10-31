import { describe, expect, it } from 'vitest';
import { loadContent } from './content/format';
import { QUEST_FORMAT, checkQuests, type QuestDef } from './content/quests';
import { STARTING_KIT_FORMAT } from './content/starting-kits';
import type { VendorDef } from './content/vendors';
import { addItem, countOf, createGrid } from './inventory/grid';
import { PROFILE, PROFILE_FORMAT, newProfile, type Profile } from './profile';
import {
  acceptQuest,
  completeQuest,
  handOver,
  handOverCount,
  questStatus,
  questsFor,
  raidObjectives,
  raidProgress,
  sameQuests,
} from './quests';
import { createItem } from './sim/create-item';
import { TEST_ITEMS as items } from './sim/test-items';

const kit = loadContent(
  STARTING_KIT_FORMAT,
  { formatVersion: 1, id: 'test', money: 100, stash: [{ item: 'watch' }, { item: 'backpack' }] },
  'test.json',
);

function profile(): Profile {
  return loadContent(PROFILE_FORMAT, JSON.parse(JSON.stringify(newProfile(items, kit))), 'p');
}

function quest(raw: Record<string, unknown>): QuestDef {
  return loadContent(
    QUEST_FORMAT,
    { formatVersion: 1, name: 'Q', vendor: 'v', description: 'D', ...raw },
    'q.json',
  );
}

const radio = quest({
  id: 'radio',
  objectives: [{ id: 'look', type: 'investigate', map: 'm', marker: 'old-radio', text: 'Look' }],
  rewards: { money: 500 },
});
const watches = quest({
  id: 'watches',
  requires: ['radio'],
  objectives: [{ id: 'give', type: 'handOver', item: 'watch', count: 3 }],
  rewards: { money: 1000, items: [{ item: 'medkit' }, { item: 'cash', count: 50 }] },
});

const notes = quest({
  id: 'notes',
  objectives: [
    { id: 'grab', type: 'extract', item: 'notes', map: 'm', spots: ['desk', 'shelf'] },
    { id: 'look', type: 'investigate', map: 'm', marker: 'office', text: 'Look round' },
    { id: 'other', type: 'investigate', map: 'elsewhere', marker: 'office', text: 'Not here' },
  ],
});

describe('quests for an item', () => {
  it('lists the quests that ask for it to be handed over or got out with', () => {
    const all = [radio, watches, notes];
    expect(questsFor(all, 'watch').map((q) => [q.quest.id, q.objective.id])).toEqual([
      ['watches', 'give'],
    ]);
    expect(questsFor(all, 'notes').map((q) => [q.quest.id, q.objective.id])).toEqual([
      ['notes', 'grab'],
    ]);
    expect(questsFor(all, 'bandage')).toEqual([]);
  });
});

describe('quests in raids', () => {
  it('set up only active, unfinished objectives on the map', () => {
    const p = profile();
    expect(raidObjectives(p, [radio, notes], 'm')).toEqual({ investigate: [], extract: [] });
    p.quests.radio = { status: 'active', progress: { look: 1 } };
    p.quests.notes = { status: 'active', progress: {} };
    expect(raidObjectives(p, [radio, notes], 'm')).toEqual({
      investigate: ['office'],
      extract: [{ item: 'notes', spots: ['desk', 'shelf'] }],
    });
    expect(raidObjectives(p, [radio, notes], 'elsewhere').investigate).toEqual(['office']);
    p.quests.notes = { status: 'done' };
    expect(raidObjectives(p, [notes], 'm')).toEqual({ investigate: [], extract: [] });
  });

  it("count markers on the raid's map and quest items kept, and take every quest item", () => {
    const p = profile();
    p.quests.radio = { status: 'active', progress: {} };
    p.quests.notes = { status: 'active', progress: {} };
    const gear = JSON.parse(JSON.stringify(p.gear)) as typeof p.gear;
    addItem(items, gear.vault!, createItem(items, 'notes'));
    addItem(items, gear.pockets, createItem(items, 'notes'));
    addItem(items, gear.pockets, createItem(items, 'watch'));
    const done = raidProgress(p, [radio, notes], items, 'm', ['office', 'old-radio'], gear);
    expect(done.map((d) => `${d.quest.id}/${d.objective.id}`)).toEqual([
      'radio/look',
      'notes/grab',
      'notes/look',
    ]);
    expect(p.quests.notes).toEqual({ status: 'active', progress: { grab: 1, look: 1 } });
    expect(questStatus(p, radio)).toBe('ready');
    // Both copies are gone, and only the watch is left.
    expect(countOf(gear.vault!, 'notes') + countOf(gear.pockets, 'notes')).toBe(0);
    expect(countOf(gear.pockets, 'watch')).toBe(1);
    // A marker of the same name on another map doesn't count; nor does a quest not taken.
    const q = profile();
    q.quests.notes = { status: 'active', progress: {} };
    raidProgress(
      q,
      [radio, notes],
      items,
      'elsewhere',
      ['office', 'old-radio'],
      JSON.parse(JSON.stringify(gear)) as typeof gear,
    );
    expect(q.quests).toEqual({ notes: { status: 'active', progress: { other: 1 } } });
  });
});

describe('quests', () => {
  it('open in a chain, and only once', () => {
    const p = profile();
    expect(questStatus(p, radio)).toBe('available');
    expect(questStatus(p, watches)).toBe('locked');
    expect(acceptQuest(p, watches)).toMatch(/first/);
    expect(acceptQuest(p, radio)).toBeNull();
    expect(acceptQuest(p, radio)).toMatch(/already/);
    expect(questStatus(p, radio)).toBe('active');
    expect(completeQuest(p, items, radio)).toMatch(/isn't finished/);
    // Investigating comes with a raid's result (14b).
    p.quests.radio = { status: 'active', progress: { look: 1 } };
    expect(questStatus(p, radio)).toBe('ready');
    expect(completeQuest(p, items, radio)).toBeNull();
    expect(p.money).toBe(600);
    expect(questStatus(p, radio)).toBe('done');
    expect(completeQuest(p, items, radio)).toMatch(/done already/);
    expect(questStatus(p, watches)).toBe('available');
  });

  it('take hand-overs from the stash and the bags in it, a bit at a time, not from gear', () => {
    const p = profile();
    p.quests.radio = { status: 'done' };
    expect(handOver(p, watches, 'give')).toMatch(/haven't got/);
    acceptQuest(p, watches);
    expect(handOver(p, watches, 'nope')).toMatch(/no such/);
    // One loose in the stash, one in a backpack in the stash, and one carried.
    const bag = p.stash[0]!.items.find((g) => g.item.item === 'backpack')!.item;
    addItem(items, bag.grid!, createItem(items, 'watch'));
    addItem(items, p.gear.pockets, createItem(items, 'watch'));
    expect(handOverCount(p, 'watch')).toBe(2);
    expect(handOver(p, watches, 'give')).toBeNull();
    expect(p.quests.watches).toEqual({ status: 'active', progress: { give: 2 } });
    expect(countOf(p.stash[0]!, 'watch')).toBe(0);
    expect(countOf(bag.grid!, 'watch')).toBe(0);
    expect(countOf(p.gear.pockets, 'watch')).toBe(1);
    expect(handOver(p, watches, 'give')).toMatch(/none in your stash/);
    // On another page, two more: only the one it still needs goes.
    p.stash.push(createGrid(PROFILE.stash[0], PROFILE.stash[1], true));
    addItem(items, p.stash[1]!, createItem(items, 'watch'));
    addItem(items, p.stash[1]!, createItem(items, 'watch'));
    expect(handOver(p, watches, 'give')).toBeNull();
    expect(handOverCount(p, 'watch')).toBe(1);
    expect(questStatus(p, watches)).toBe('ready');
    expect(handOver(p, watches, 'give')).toMatch(/already/);
  });

  it('only take plain items: no bag with things in it, no gun with parts', () => {
    const give = quest({
      id: 'give',
      objectives: [
        { id: 'bag', type: 'handOver', item: 'backpack' },
        { id: 'gun', type: 'handOver', item: 'rifle' },
      ],
    });
    const p = profile();
    acceptQuest(p, give);
    const bag = p.stash[0]!.items.find((g) => g.item.item === 'backpack')!.item;
    addItem(items, bag.grid!, createItem(items, 'bandage'));
    const rifle = createItem(items, 'rifle');
    rifle.attachments!.optic = 'scope';
    addItem(items, p.stash[0]!, rifle);
    expect(handOverCount(p, 'backpack')).toBe(0);
    expect(handOver(p, give, 'bag')).toMatch(/none/);
    expect(handOver(p, give, 'gun')).toMatch(/none/);
    bag.grid!.items = [];
    rifle.attachments!.optic = null;
    expect(handOver(p, give, 'bag')).toBeNull();
    expect(handOver(p, give, 'gun')).toBeNull();
    expect(questStatus(p, give)).toBe('ready');
  });

  it('give their rewards into the stash, or nothing without room', () => {
    const p = profile();
    p.quests.radio = { status: 'done' };
    p.quests.watches = { status: 'active', progress: { give: 3 } };
    const page = p.stash[0]!;
    const filler = page.items.slice();
    // Fill page 1 with medkits (1×2) so neither reward fits.
    while (addItem(items, page, createItem(items, 'medkit')) === 0);
    expect(completeQuest(p, items, watches)).toMatch(/no room/);
    expect(p.money).toBe(100);
    expect(questStatus(p, watches)).toBe('ready');
    page.items = filler;
    expect(completeQuest(p, items, watches)).toBeNull();
    expect(p.money).toBe(1100);
    expect(countOf(p.stash[0]!, 'medkit')).toBe(1);
    expect(countOf(p.stash[0]!, 'cash')).toBe(50);
    expect(p.quests.watches).toEqual({ status: 'done' });
  });

  it('are compared by content, not key order', () => {
    const a = profile();
    const b = profile();
    a.quests = { x: { status: 'active', progress: { a: 1, b: 2 } }, y: { status: 'done' } };
    b.quests = { y: { status: 'done' }, x: { status: 'active', progress: { b: 2, a: 1 } } };
    expect(sameQuests(a, b)).toBe(true);
    b.quests.y = { status: 'active', progress: {} };
    expect(sameQuests(a, b)).toBe(false);
  });

  it('come to a format 2 profile empty', () => {
    const old = JSON.parse(JSON.stringify(newProfile(items, kit))) as Record<string, unknown>;
    delete old.quests;
    old.formatVersion = 2;
    expect(loadContent(PROFILE_FORMAT, old, 'p').quests).toEqual({});
  });
});

describe('checkQuests', () => {
  const vendors = new Map([['v', { id: 'v' } as VendorDef]]);
  const check =
    (...qs: QuestDef[]) =>
    () =>
      checkQuests(new Map(qs.map((q) => [q.id, q])), vendors, items);

  it('passes good quests', () => {
    expect(check(radio, watches)).not.toThrow();
  });

  it('refuses unknown vendors, items and requirements, and loops', () => {
    expect(check({ ...radio, vendor: 'nobody' })).toThrow(/no vendor/);
    expect(check({ ...watches, requires: ['gone'] })).toThrow(/doesn't exist/);
    const give = (item: string) =>
      quest({ id: 'g', objectives: [{ id: 'a', type: 'handOver', item }] });
    expect(check(give('gold-bar'))).toThrow(/no item/);
    expect(check(give('notes'))).toThrow(/can't be handed over/);
    const out = (item: string) =>
      quest({ id: 'e', objectives: [{ id: 'a', type: 'extract', item, map: 'm', spots: ['s'] }] });
    expect(check(out('notes'))).not.toThrow();
    expect(check(out('watch'))).toThrow(/must be a quest item/);
    expect(check(out('notes'), { ...out('notes'), id: 'e2' })).toThrow(/extracts "notes" too/);
    expect(() =>
      quest({
        id: 'e',
        objectives: [{ id: 'a', type: 'extract', item: 'notes', map: 'm', spots: [] }],
      }),
    ).toThrow();
    expect(check({ ...radio, requires: ['watches'] }, watches)).toThrow(/loop/);
    const twice = { ...radio, objectives: [radio.objectives[0]!, radio.objectives[0]!] };
    expect(check(twice)).toThrow(/two objectives/);
    expect(check({ ...radio, rewards: { money: 0, items: [{ item: 'notes' }] } })).toThrow(
      /quest item/,
    );
    expect(
      check({ ...radio, rewards: { money: 0, items: [{ item: 'cash', count: 5000 }] } }),
    ).toThrow(/more than a stack/);
  });
});

// The user's loot rules (2026-11-17): mythic ("red") valuables are loose loot only, never
// in a container or on a body. So no table a container kind, a placed container, a prefab's
// container or an enemy's loot rolls may hold one. Epic and higher paintings are loose only
// too (the-tempest, portrait-of-the-regent, the-unfinished-masterpiece, a-world-beyond,
// the-last-supper-of-kings): listed by hand, since two are modeled without a canvas.
// Gear (ammo, armor) isn't a valuable: the military table's top rounds are the user's call.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONTENT = resolve(import.meta.dirname, '../../content');
/** Every JSON file in a content folder. */
const json = (dir) =>
  readdirSync(resolve(CONTENT, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(CONTENT, dir, f), 'utf8')));

const PAINTINGS_EPIC_UP = new Set([
  'the-tempest',
  'portrait-of-the-regent',
  'the-unfinished-masterpiece',
  'a-world-beyond',
  'the-last-supper-of-kings',
]);

/** The tables a loot field rolls: its one table, its mix's, a container kind's. */
const tablesOf = (l) => [
  ...(l.lootTable ? [l.lootTable] : []),
  ...Object.keys(l.mix?.tables ?? {}),
  ...Object.keys(l.tables ?? {}),
];

describe('loot rules', () => {
  it('no container or body rolls a mythic valuable or an epic+ painting', () => {
    const items = new Map(json('items').map((i) => [i.id, i]));
    const looseOnly = (id) => {
      const i = items.get(id);
      return !!i && i.type === 'loot' && (i.rarity === 'mythic' || PAINTINGS_EPIC_UP.has(id));
    };
    const rolled = new Set();
    for (const c of json('loot-containers')) tablesOf(c.loot ?? {}).forEach((t) => rolled.add(t));
    for (const e of json('enemies')) tablesOf(e.loot ?? {}).forEach((t) => rolled.add(t));
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const o = n;
      const loot = n.loot;
      if (loot?.container) tablesOf(loot).forEach((t) => rolled.add(t));
      Object.values(n).forEach((v) => typeof v === 'object' && walk(v));
    };
    [...json('maps'), ...json('prefabs')].forEach(walk);
    const tables = new Map(json('loot-tables').map((t) => [t.id, t]));
    const bad = [];
    for (const id of rolled) {
      const t = tables.get(id);
      for (const i of t?.items ?? []) if (looseOnly(i.item)) bad.push(`${id}: ${i.item}`);
    }
    expect(bad).toEqual([]);
  });
});

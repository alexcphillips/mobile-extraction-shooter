import { itemDef, type ItemDb } from './content/items';
import type { QuestDef, QuestObjective } from './content/quests';
import { removeAt, type Grid, type Item } from './inventory/grid';
import { PROFILE, type Profile } from './profile';
import type { Gear } from './sim/gear';
import { takeQuestItems, type RaidObjectives } from './sim/raid';
import { addToStash } from './stash';

/*
 * Quests between raids (session 14): accepting one, handing items over from the stash,
 * and claiming the rewards once every objective is done. The server does all of this;
 * the client shows it. Progress made in raids (investigating, extracting with a quest
 * item) comes with the raid's result (14b): raidObjectives says what a raid sets up, and
 * raidProgress what its result counts.
 */

/** Where a quest is for a player. "ready" is active with every objective done. */
export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

/** How much progress an objective needs: the items to hand over, else 1. */
export function objectiveGoal(o: QuestObjective): number {
  return o.type === 'handOver' ? o.count : 1;
}

/** How far an objective has got, from 0 to its goal. */
export function objectiveProgress(profile: Profile, quest: QuestDef, o: QuestObjective): number {
  const s = profile.quests[quest.id];
  if (s?.status === 'done') return objectiveGoal(o);
  return Math.min(objectiveGoal(o), s?.progress[o.id] ?? 0);
}

export function questStatus(profile: Profile, quest: QuestDef): QuestStatus {
  const s = profile.quests[quest.id];
  if (s?.status === 'done') return 'done';
  if (s?.status === 'active') {
    const done = quest.objectives.every(
      (o) => objectiveProgress(profile, quest, o) >= objectiveGoal(o),
    );
    return done ? 'ready' : 'active';
  }
  const open = quest.requires.every((r) => profile.quests[r]?.status === 'done');
  return open ? 'available' : 'locked';
}

/** What an objective says, by default from its type and item. */
export function objectiveText(items: ItemDb, o: QuestObjective): string {
  if (o.text) return o.text;
  const name = o.type === 'investigate' ? '' : itemDef(items, o.item).name;
  switch (o.type) {
    case 'handOver':
      return o.count > 1 ? `Hand over ${o.count} × ${name}` : `Hand over the ${name.toLowerCase()}`;
    case 'extract':
      return `Get out of a raid with the ${name.toLowerCase()}`;
    case 'investigate':
      return o.text;
  }
}

/** Accepts a quest that's open to the player. Returns why it can't be, or null. */
export function acceptQuest(profile: Profile, quest: QuestDef): string | null {
  const status = questStatus(profile, quest);
  if (status === 'locked') return 'finish the quests before it first';
  if (status !== 'available') return 'you already have that quest';
  profile.quests[quest.id] = { status: 'active', progress: {} };
  return null;
}

/** An item in the stash that can be handed over: nothing in it or fitted to it. */
function plain(item: Item): boolean {
  if (item.grid?.items.length) return false;
  return !Object.values(item.attachments ?? {}).some((a) => a);
}

/** The stash's grids, each page then the rigs and backpacks in it. */
function stashGrids(profile: Profile): Grid[] {
  const out: Grid[] = [];
  for (const page of profile.stash) {
    out.push(page);
    for (const g of page.items) if (g.item.grid) out.push(g.item.grid);
  }
  return out;
}

/** How many of an item the stash has that could be handed over. */
export function handOverCount(profile: Profile, id: string): number {
  let n = 0;
  for (const grid of stashGrids(profile))
    for (const g of grid.items) if (g.item.item === id && plain(g.item)) n += g.item.count;
  return n;
}

/**
 * Hands over as many of an objective's items from the stash as it still needs (or as
 * there are): they're gone, and its progress goes up. Only plain items count: an empty
 * backpack, a gun with nothing fitted. Returns why it can't be, or null.
 */
export function handOver(profile: Profile, quest: QuestDef, objective: string): string | null {
  const o = quest.objectives.find((x) => x.id === objective);
  if (!o || o.type !== 'handOver') return 'that quest has no such hand-over';
  const s = profile.quests[quest.id];
  if (s?.status !== 'active') return "you haven't got that quest";
  let need = objectiveGoal(o) - objectiveProgress(profile, quest, o);
  if (need <= 0) return "that's handed over already";
  let given = 0;
  for (const grid of stashGrids(profile)) {
    for (let i = grid.items.length - 1; i >= 0 && need > 0; i--) {
      const item = grid.items[i]!.item;
      if (item.item !== o.item || !plain(item)) continue;
      const n = Math.min(need, item.count);
      item.count -= n;
      if (item.count === 0) removeAt(grid, i);
      need -= n;
      given += n;
    }
  }
  if (!given) return 'there are none in your stash';
  s.progress[o.id] = (s.progress[o.id] ?? 0) + given;
  return null;
}

/**
 * Finishes a quest with every objective done: its reward items go into the stash, page
 * `page` first, and its money into the balance. All or none: with no room in the stash
 * nothing changes. Returns why it can't be, or null.
 */
export function completeQuest(
  profile: Profile,
  items: ItemDb,
  quest: QuestDef,
  page = 0,
): string | null {
  const status = questStatus(profile, quest);
  if (status === 'done') return 'that quest is done already';
  if (status !== 'ready') return "that quest isn't finished yet";
  if (!addToStash(profile, items, quest.rewards.items, page))
    return 'there is no room in your stash for the rewards';
  profile.money = Math.min(PROFILE.maxMoney, profile.money + quest.rewards.money);
  profile.quests[quest.id] = { status: 'done' };
  return null;
}

/** An objective's progress, with the quest active and the objective not yet done. */
function unfinished(profile: Profile, quest: QuestDef, o: QuestObjective): boolean {
  return (
    profile.quests[quest.id]?.status === 'active' &&
    objectiveProgress(profile, quest, o) < objectiveGoal(o)
  );
}

/**
 * What a player's active quests want in a raid on a map: the markers still to
 * investigate, and the quest items still to get out with (session 14b). Only for active
 * quests, so a quest item spawns only for a player who has its quest.
 */
export function raidObjectives(
  profile: Profile,
  quests: Iterable<QuestDef>,
  map: string,
): RaidObjectives {
  const out: RaidObjectives = { investigate: [], extract: [] };
  for (const q of quests) {
    for (const o of q.objectives) {
      if (o.type === 'handOver' || o.map !== map || !unfinished(profile, q, o)) continue;
      if (o.type === 'investigate') out.investigate.push(o.marker);
      else out.extract.push({ item: o.item, spots: o.spots });
    }
  }
  return out;
}

/** An objective a raid finished. */
export interface RaidProgress {
  quest: QuestDef;
  objective: QuestObjective;
}

/**
 * Counts a raid's result towards the player's quests, in place: each marker investigated
 * on that map (even if they died afterwards), and each quest item in the gear they kept.
 * Every quest item comes out of the gear, wanted or not, so none reaches the stash.
 * Quests can't change during a raid (their routes are refused), so the ones active now
 * were active when it started. Returns the objectives it finished.
 */
export function raidProgress(
  profile: Profile,
  quests: Iterable<QuestDef>,
  items: ItemDb,
  map: string,
  investigated: readonly string[],
  kept: Gear,
): RaidProgress[] {
  const brought = takeQuestItems(items, kept);
  const out: RaidProgress[] = [];
  for (const q of quests) {
    for (const o of q.objectives) {
      if (o.type === 'handOver' || o.map !== map || !unfinished(profile, q, o)) continue;
      const done =
        o.type === 'investigate' ? investigated.includes(o.marker) : brought.includes(o.item);
      if (!done) continue;
      const s = profile.quests[q.id];
      if (s?.status === 'active') s.progress[o.id] = 1;
      out.push({ quest: q, objective: o });
    }
  }
  return out;
}

/** Whether two profiles' quests are the same: only the server's quest routes change them. */
export function sameQuests(a: Profile, b: Profile): boolean {
  return JSON.stringify(sortKeys(a.quests)) === JSON.stringify(sortKeys(b.quests));
}

function sortKeys(v: unknown): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => [k, sortKeys(x)]),
  );
}

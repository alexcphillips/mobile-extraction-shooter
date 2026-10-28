import {
  gearItems,
  objectiveGoal,
  objectiveProgress,
  objectiveText,
  questStatus,
  type Character,
  type ItemDb,
  type Profile,
  type QuestDef,
  type QuestObjective,
  type SimState,
} from '@mes/shared';
import type { ReactNode } from 'react';

/*
 * The raid screen's Quests tab (session 14b): your active quests and how each objective
 * stands, counting what you've done in this raid. Read only: quests are accepted and
 * handed in from the menu between raids.
 */

/** How an objective stands in this raid: done, or what's left, in a word or two. */
function standing(
  profile: Profile,
  sim: SimState,
  player: Character,
  map: string,
  q: QuestDef,
  o: QuestObjective,
): { done: boolean; note: string } {
  const got = objectiveProgress(profile, q, o);
  const goal = objectiveGoal(o);
  if (got >= goal) return { done: true, note: '' };
  if (o.type === 'handOver') return { done: false, note: `${got} / ${goal} · from your stash` };
  if (o.map !== map) return { done: false, note: 'Not on this map' };
  if (o.type === 'investigate') {
    const spot = sim.raid?.investigate.find((s) => s.holder === player.id && s.marker === o.marker);
    return spot?.done
      ? { done: true, note: 'Investigated' }
      : { done: false, note: 'Marked on screen' };
  }
  const carried = gearItems(player.gear).some((i) => i.item === o.item);
  return { done: false, note: carried ? 'Got it: now get out' : 'Not found yet' };
}

export function RaidQuests({
  items,
  profile,
  quests,
  sim,
  player,
  map,
}: {
  items: ItemDb;
  profile: Profile;
  quests: readonly QuestDef[];
  sim: SimState;
  player: Character;
  /** The raid's map id. */
  map: string;
}): ReactNode {
  const active = quests.filter((q) => {
    const s = questStatus(profile, q);
    return s === 'active' || s === 'ready';
  });
  if (!active.length)
    return <div className="raid-empty">No active quests. Accept them from the menu.</div>;
  return (
    <div className="raid-quests">
      <ul className="quests-list">
        {active.map((q) => (
          <li key={q.id} className="quests-quest">
            <div className="quests-head">
              <span className="quests-name">{q.name}</span>
            </div>
            <ul className="quests-objectives">
              {q.objectives.map((o) => {
                const s = standing(profile, sim, player, map, q, o);
                return (
                  <li key={o.id} className={s.done ? 'done' : ''}>
                    <span className="quests-tick">{s.done ? '✓' : '○'}</span>
                    <span className="quests-objective">
                      {objectiveText(items, o)}
                      {s.note && <span className="raid-quests-note"> · {s.note}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <p className="raid-note">
        Investigating counts even if you die. A quest item counts if you get out with it, or keep it
        in your vault.
      </p>
    </div>
  );
}

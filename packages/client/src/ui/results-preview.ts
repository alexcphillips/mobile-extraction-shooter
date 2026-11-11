import { createItem, newProfile, TICK_RATE, type Character } from '@mes/shared';
import { loadItems, loadRaid, loadStartingKit } from '../content';
import { showResults } from './results';

/**
 * Dev only (`?victory`): the victory screen with made-up results, to check its layout without
 * playing a raid out (npm run look -- --base "http://localhost:5180/?victory").
 */
export function previewVictory(container: HTMLElement): void {
  // Over the main menu, which a real raid has taken down.
  container.style.zIndex = '50';
  const items = loadItems();
  const profile = newProfile(items, loadStartingKit('new-player'));
  const found = (id: string, count = 1) => ({ ...createItem(items, id), count });
  const kept = [
    found('graphics-card', 2),
    found('gold-bar'),
    found('gold-watch'),
    found('cash', 48000),
    found('malachite-money-frog'),
  ];
  const killList = ['Scav', 'Scav', 'PMC', 'Scav', 'Mill guard', 'Foreman'].map((name, i) => ({
    name,
    tick: (90 + i * 75) * TICK_RATE,
  }));
  showResults(
    container,
    {
      how: 'extracted',
      detail: 'at North gate',
      seconds: 1234,
      kills: killList.length,
      killList: killList.reverse(),
      map: loadRaid('northpoint').name,
      place: 'North gate',
      player: { gear: profile.gear } as Character,
      kept,
      lost: [],
      quests: [],
      taken: [],
      keptAll: true,
    },
    items,
    () => location.reload(),
  );
}

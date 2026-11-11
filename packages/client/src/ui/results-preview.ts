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

/**
 * Dev only (`?defeat`): the defeat screen with a made-up last fight against two enemies
 * (npm run look -- --base "http://localhost:5180/?defeat").
 */
export function previewDefeat(container: HTMLElement): void {
  container.style.zIndex = '50';
  const items = loadItems();
  const found = (id: string, count = 1) => ({ ...createItem(items, id), count });
  const t = (s: number): number => s * TICK_RATE;
  const hit = (
    s: number,
    name: string,
    dealt: boolean,
    zones: string[],
    damage: number,
    absorbed: number,
    distance: number,
    more: object = {},
  ) => ({
    tick: t(s),
    other: name === 'PMC' ? 7 : 9,
    name,
    dealt,
    cause: 'shot' as const,
    zones,
    hits: 1,
    damage,
    absorbed,
    distance,
    ...more,
  });
  const combat = [
    hit(611, 'PMC', false, ['head'], 74, 12, 38, {
      killing: true,
      weapon: 'm416',
      ammo: 'ammo-556x45',
    }),
    hit(610, 'PMC', false, ['chest'], 18, 23, 38),
    hit(609, 'PMC', true, ['left arm'], 31, 0, 38),
    hit(606, 'Scav', true, ['chest', 'right leg'], 64, 0, 12, { hits: 3 }),
    hit(604, 'Scav', false, ['left leg'], 22, 0, 12),
    hit(603, 'Scav', true, ['head'], 40, 18, 12),
  ];
  showResults(
    container,
    {
      how: 'killed',
      detail: 'by a PMC',
      killedBy: 'PMC',
      seconds: 611,
      kills: 2,
      killList: [
        { name: 'Scav', tick: t(420) },
        { name: 'Scav', tick: t(188) },
      ],
      map: loadRaid('northpoint').name,
      kept: [found('gold-watch'), found('cash', 12000)],
      lost: [],
      quests: [],
      taken: [],
      combat,
      keptAll: false,
    },
    items,
    () => location.reload(),
  );
}

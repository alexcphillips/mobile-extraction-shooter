import {
  MAP_FORMAT,
  PREFAB_FORMAT,
  RAID_FORMAT_VERSION,
  compileMap,
  loadContent,
  newProfile,
  type PrefabFile,
} from '@mes/shared';
import { checkDoorKeys, loadItems, loadStartingKit } from './content';
import { startPlay, type PlayElements, type PlayOptions } from './play';
import { readPlayTest } from './play-test-handoff';

/** The kit you play-test with. */
const KIT = 'new-player';

/**
 * A raid on the map as it is in the map editor, unsaved changes and all (session 17): dev
 * only, at /play-test, opened by the editor's Play button. No server: you wear the new-player
 * kit, and nothing is saved or sent. The URL takes the game's debug options (?spawn, ?at,
 * ?debug, ?nav, ?peaceful…). The results screen's Continue reloads the page, which plays the
 * map again as the editor last handed it over.
 */
export async function startPlayTest(
  el: PlayElements,
  options: Omit<PlayOptions, 'raid' | 'test' | 'serverRaid' | 'profile' | 'resume'>,
): Promise<void> {
  const files = readPlayTest();
  if (!files) throw new Error('nothing to play-test: press Play in the map editor');
  const prefabs = new Map<string, PrefabFile>();
  for (const p of files.prefabs)
    prefabs.set(p.id, loadContent(PREFAB_FORMAT, p, `prefabs/${p.id}.json`));
  const map = compileMap(loadContent(MAP_FORMAT, files.map, `maps/${files.map.id}.json`), prefabs);
  checkDoorKeys(map);
  const items = loadItems();
  document.title = `Play-test: ${map.name}`;
  await startPlay(el, {
    ...options,
    raid: '',
    test: {
      map,
      raid: {
        formatVersion: RAID_FORMAT_VERSION,
        id: 'play-test',
        name: 'Play-test',
        map: files.map.id,
        duration: 15 * 60,
      },
    },
    serverRaid: '',
    profile: newProfile(items, loadStartingKit(KIT)),
    resume: null,
  });
}

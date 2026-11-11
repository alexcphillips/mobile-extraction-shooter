import {
  PROTOCOL_VERSION,
  newProfile,
  type HelloResponse,
  type Profile,
  type ProfileResponse,
} from '@mes/shared';
import { unlockAudioOnTap } from './app/audio';
import { reloadOnStaleBuild } from './app/stale-build';
import { GAME_SOUNDS } from './audio/sound-ids';
import { sounds } from './audio/sounds';
import { preventZoom } from './app/no-zoom';
import { watchPauseTriggers } from './app/pause';
import { Hud } from './hud/hud';
import { OpticOverlay } from './hud/optic';
import { RaidHud } from './hud/raid-hud';
import { HitDirection } from './hud/hit-direction';
import { Vitals } from './hud/vitals';
import { startBodies } from './bodies';
import { startPerfTest } from './perf';
import { readParams } from './perf/params';
import { mountPresets } from './perf/presets';
import { AccountError, fetchProfile, syncSettings } from './account';
import type { CoopOptions } from './play/coop';
import { joinCodeIn } from './social';
import { startPlay, type PlayElements, type PlayOptions } from './play';
import {
  abandonRaid,
  clearSnapshot,
  readSnapshot,
  sendPending,
  startServerRaid,
  type RaidSnapshot,
} from './raids';
import {
  loadItems,
  loadQuests,
  loadHangar,
  loadRecipes,
  loadRaid,
  loadStartingKit,
  loadTutorial,
  loadVendors,
  loadZombies,
  raidIds,
  zombiesIds,
} from './content';
import { settings } from './settings';
import { setTutorialSeen, tutorialSeen } from './tutorial-seen';
import { lastRaid } from './ui/last-raid';
import { padCursor } from './input/pad-cursor';
import { padLog } from './input/pad-diagnostics';
import { openPadTest } from './input/pad-test';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

const status = byId('status');

async function checkServer(el: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/api/hello');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hello = (await res.json()) as HelloResponse;
    const match = hello.protocolVersion === PROTOCOL_VERSION ? '' : ' (protocol mismatch!)';
    el.textContent = `${hello.message}, ${hello.tickRate} Hz${match}`;
  } catch (err) {
    el.textContent = `server unreachable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void checkServer(byId('server'));
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

watchPauseTriggers();
// A controller works menus with a cursor of its own (CP-2), once one is connected.
padCursor.start();
// What the browser reports about controllers, for Settings → Controller and the test.
padLog.start();
if (new URLSearchParams(location.search).has('padtest')) openPadTest();
if (import.meta.env.DEV && new URLSearchParams(location.search).has('victory'))
  void import('./ui/results-preview')
    .then((m) => m.previewVictory(byId('results')))
    .catch((err: unknown) => console.error('victory preview failed', err));
if (import.meta.env.DEV && new URLSearchParams(location.search).has('defeat'))
  void import('./ui/results-preview')
    .then((m) => m.previewDefeat(byId('results')))
    .catch((err: unknown) => console.error('defeat preview failed', err));
unlockAudioOnTap();
reloadOnStaleBuild();
preventZoom();
// Menu buttons tick (session 19); the raid's controls and inventory have their own sounds.
byId('ui').addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('button')) sounds().play(GAME_SOUNDS.tap);
});

const hud = new Hud(
  byId('controls'),
  byId('stick'),
  byId('knob'),
  byId('sprint-zone'),
  byId('sprint-lock'),
  byId('settings-button'),
);
byId('settings-button').addEventListener('click', () => {
  import('./ui/menu')
    .then((menu) => menu.openSettings(byId('ui'), hud))
    .catch((err: unknown) => (status.textContent = `settings failed: ${message(err)}`));
});

// The fps, timings and enemy overlay: dev builds only (2026-11-10), never in prod.
const showStats = (): void => {
  const on = import.meta.env.DEV && settings.current.showStats;
  byId('stats').hidden = !on;
  byId('server').hidden = !on;
};
showStats();
settings.subscribe(showStats);

// iOS sets navigator.standalone when opened from the home screen.
const standalone =
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

if (location.pathname === '/bodies') {
  for (const id of ['controls', 'settings-button']) byId(id).hidden = true;
  startBodies(byId('scene') as HTMLCanvasElement, status).catch((err: unknown) => {
    status.textContent = `bodies failed: ${message(err)}`;
  });
} else if (location.pathname === '/editor' && import.meta.env.DEV) {
  import('./editor')
    .then((editor) => editor.startEditor(byId('scene') as HTMLCanvasElement, byId('editor')))
    .catch((err: unknown) => (status.textContent = `editor failed: ${message(err)}`));
} else if (location.pathname === '/item-editor' && import.meta.env.DEV) {
  import('./item-editor')
    .then((editor) => editor.startItemEditor(byId('editor')))
    .catch((err: unknown) => (status.textContent = `item editor failed: ${message(err)}`));
} else if (location.pathname === '/loot-editor' && import.meta.env.DEV) {
  import('./loot-editor')
    .then((editor) => editor.startLootEditor(byId('editor')))
    .catch((err: unknown) => (status.textContent = `loot editor failed: ${message(err)}`));
} else if (location.pathname === '/quest-editor' && import.meta.env.DEV) {
  import('./quest-editor')
    .then((editor) => editor.startQuestEditor(byId('editor')))
    .catch((err: unknown) => (status.textContent = `quest editor failed: ${message(err)}`));
} else if (location.pathname === '/sounds' && import.meta.env.DEV) {
  import('./sound-editor')
    .then((editor) => editor.startSoundEditor(byId('editor')))
    .catch((err: unknown) => (status.textContent = `sound editor failed: ${message(err)}`));
} else if (location.pathname === '/play-test' && import.meta.env.DEV) {
  // Opened by the map editor's Play button, with the map as edited.
  import('./play-test')
    .then((test) =>
      test.startPlayTest(playElements(), debugOptions(new URLSearchParams(location.search))),
    )
    .catch((err: unknown) => (status.textContent = `play-test failed: ${message(err)}`));
} else if (location.pathname === '/perf') {
  mountPresets(byId('presets'));
  startPerfTest(
    {
      canvas: byId('scene') as HTMLCanvasElement,
      stats: byId('stats'),
      status,
      hud,
    },
    readParams(location.search),
  ).catch((err: unknown) => {
    status.textContent = `perf test failed: ${message(err)}`;
  });
} else {
  // ?zombies=<id> goes straight into a zombies game from content/zombies (just ?zombies, the
  // first), with no sign-in. ?raid=<id> picks a raid config from content/raids, ?time=<seconds> sets its timer,
  // ?spawn=<id> a player spawn in its map (?at=<x>,<z> starts you at a point instead, on the
  // floor nearest the ground; ?at=<x>,<z>,<y> on the highest floor at or below y),
  // ?nav shows the navigation grid, and ?debug shows markers, zones, patrols
  // and what enemies think, with buttons (and keys 7 and 8) for hurt and heal. ?respawn
  // brings dead enemies back, ?peaceful makes them ignore you (the admin cheat), and ?hitzones draws hit
  // zones over their bodies.
  const q = new URLSearchParams(location.search);
  // A party invite link (/join/<code>): joined once signed in, on the menu. The address
  // goes back to / so a reload doesn't join again.
  const joinCode = joinCodeIn(location.pathname);
  if (joinCode) history.replaceState(null, '', `/${location.search}`);
  const zombies = q.get('zombies');
  // ?tutorial plays the tutorial (Settings → Play the tutorial again); ?signup, which it
  // leaves to, opens the account screen on creating one. Neither stays in the address.
  const tutorial = q.has('tutorial');
  const signup = q.has('signup');
  if (tutorial || signup) {
    q.delete('tutorial');
    q.delete('signup');
    const rest = q.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}`);
  }
  (zombies !== null
    ? playZombies(zombies || zombiesIds()[0]!, q)
    : tutorial
      ? playTutorial(q)
      : runGame(q, joinCode, signup)
  ).catch((err: unknown) => (status.textContent = `raid failed: ${message(err)}`));
}

/**
 * The tutorial (TU-3, design.md → Tutorial): its offline raid in its kit, with no server
 * and no sign-in. Finishing or skipping it marks it seen on this device and goes to the
 * account screen, on creating an account (or, signed in, to the menu).
 */
async function playTutorial(q: URLSearchParams): Promise<void> {
  const def = loadTutorial('tutorial');
  await startPlay(playElements(), {
    ...debugOptions(q),
    raid: def.raid,
    test: null,
    serverRaid: '',
    profile: newProfile(loadItems(), loadStartingKit(def.kit)),
    resume: null,
    tutorial: {
      def,
      leave: () => {
        setTutorialSeen();
        location.replace('/?signup');
      },
    },
    status: (text) => (status.textContent = text),
  });
}

/**
 * A first launch: nobody signed in (or the server out of reach, since the tutorial needs
 * none) and the tutorial not yet seen here. Someone signed in has it marked seen.
 */
async function firstLaunch(): Promise<boolean> {
  if (tutorialSeen()) return false;
  try {
    if (!(await fetchProfile())) return true;
  } catch (err) {
    if (err instanceof AccountError && err.code === 'offline') return true;
    throw err;
  }
  setTutorialSeen();
  return false;
}

/**
 * A zombies game (2026-11-04): no server, since nothing from the stash goes in and nothing
 * comes out. Everyone wears the mode's starting kit. The results screen's button reloads
 * the page, back to the menu (or, from ?zombies, another game).
 */
async function playZombies(id: string, q: URLSearchParams): Promise<void> {
  const def = loadZombies(id);
  document.title = def.name;
  await startPlay(playElements(), {
    ...debugOptions(q),
    raid: '',
    test: null,
    serverRaid: '',
    profile: newProfile(loadItems(), loadStartingKit(def.kit)),
    resume: null,
    zombies: def,
    status: (text) => (status.textContent = text),
  });
}

/** The page's elements a raid draws into. */
function playElements(): PlayElements {
  return {
    canvas: byId('scene') as HTMLCanvasElement,
    stats: byId('stats'),
    hud,
    optic: new OpticOverlay(byId('optic')),
    vitals: new Vitals(byId('vitals'), byId('ammo'), byId('hurt')),
    hitDirection: new HitDirection(byId('hit-dir')),
    raidHud: new RaidHud(byId('timer'), byId('extract'), byId('prompt'), byId('use-ring')),
    raid: byId('raid'),
    results: byId('results'),
    enemyBars: byId('enemy-bars'),
    tutorial: byId('tutorial'),
  };
}

/** The raid options set from the URL (see above), for testing. */
function debugOptions(
  q: URLSearchParams,
): Omit<PlayOptions, 'raid' | 'test' | 'serverRaid' | 'profile' | 'resume'> {
  return {
    duration: Number(q.get('time')) > 0 ? Number(q.get('time')) : null,
    spawn: q.get('spawn'),
    at: parseAt(q.get('at')),
    debug: q.has('debug'),
    nav: q.has('nav'),
    respawn: q.has('respawn'),
    peaceful: q.has('peaceful'),
    hitZones: q.has('hitzones'),
    note: standalone ? 'standalone' : 'browser',
  };
}

/**
 * The game: sign in, the main menu (stash and loadout), then a raid with the gear the
 * server hands back; or straight back into a raid saved when the page was hidden. The
 * results screen's button reloads the page, which comes back here. With no connection when
 * starting, it says so and goes back to the menu.
 */
async function runGame(
  q: URLSearchParams,
  joinCode: string | null,
  signup: boolean,
): Promise<void> {
  if (await firstLaunch()) {
    await playTutorial(q);
    return;
  }
  const prepared = await prepareMenu(signup);
  let me = prepared.me;
  const items = loadItems();
  const wanted = q.get('raid') ?? lastRaid();
  // In the list's order (MT-2: the starter map first); the last one played is picked.
  const raids = raidIds()
    .map((id) => loadRaid(id))
    .map((r) => ({ id: r.id, name: r.name, duration: r.duration, map: r.map, tags: r.tags }));
  const play = (
    raid: string,
    serverRaid: string,
    profile: Profile,
    resume: RaidSnapshot | null,
    coop: CoopOptions | null = null,
  ) =>
    startPlay(playElements(), {
      raid,
      test: null,
      serverRaid,
      profile,
      resume,
      ...debugOptions(q),
      coop,
      status: (text) => (status.textContent = text),
    });

  const resume = prepared.resume;
  if (resume && me.raid) {
    try {
      await play(resume.raid, resume.serverRaid, me.profile, resume);
      return;
    } catch (err) {
      // A saved raid that won't load (say, the map changed since): it counts as missing.
      console.error('resuming failed', err);
      clearSnapshot();
      await abandonRaid(me.raid.id);
      await (
        await accountUi()
      ).showMessage(byId('account'), {
        title: 'Your last raid',
        text: [
          "Your last raid couldn't be picked up again, so it counted as missing in action: you kept only your knife and your vault.",
        ],
        button: 'Continue',
      });
      // The page has a half-built raid in it: start clean, on the menu.
      location.reload();
      return;
    }
  }

  const menuEl = byId('menu');
  for (;;) {
    const choice = await (
      await import('./ui/main-menu')
    ).showMainMenu(menuEl, {
      me,
      items,
      raids,
      raid: wanted,
      vendors: [...loadVendors().values()],
      zombies: zombiesIds().map((id) => {
        const def = loadZombies(id);
        const gear = loadStartingKit(def.kit).gear;
        return {
          id,
          name: def.name,
          map: def.map,
          points: def.points.start,
          kit: Object.values(gear).filter((g) => g !== undefined),
          box: def.box.map((o) => o.item),
        };
      }),
      quests: [...loadQuests().values()],
      hangar: [...loadHangar().values()],
      recipes: [...loadRecipes().values()],
      joinCode,
      openSettings: (done) => {
        import('./ui/menu')
          .then((menu) => menu.openSettings(byId('ui'), hud, done))
          .catch((err: unknown) => (status.textContent = `settings failed: ${message(err)}`));
      },
    });
    me = choice.me;
    if (choice.zombies) {
      await playZombies(choice.zombies, q);
      return;
    }
    let started: ProfileResponse;
    try {
      started = await startServerRaid(choice.raid);
    } catch (err) {
      if (!(err instanceof AccountError && err.code === 'offline')) throw err;
      await noConnection('Try again');
      continue;
    }
    await play(choice.raid, started.raid!.id, started.profile, null, choice.coop ?? null);
    return;
  }
}

const accountUi = (): Promise<typeof import('./ui/account')> => import('./ui/account');

/** Says there's no connection, and resolves when its button is pressed. */
async function noConnection(button: string): Promise<void> {
  await (
    await accountUi()
  ).showMessage(byId('account'), {
    title: 'No connection',
    text: [
      "Can't reach the server. Raids need it to start, so they can take your gear in.",
      'Check your connection and try again.',
    ],
    button,
  });
}

/**
 * Everything before the main menu, on the server: sign in if no one is, and send a result
 * left from an earlier raid. A raid still open is resumed if this phone saved it when the
 * page was hidden; otherwise it's counted as missing in action once the player has been
 * told, so the stash can be edited. With no connection it says
 * so, with a button to try again, since the profile lives on the server.
 */
async function prepareMenu(
  signup: boolean,
): Promise<{ me: ProfileResponse; resume: RaidSnapshot | null }> {
  for (;;) {
    try {
      let me =
        (await fetchProfile()) ??
        (await (await accountUi()).showAccount(byId('account'), signup ? 'register' : 'login'));
      setTutorialSeen();
      syncSettings(me);
      const notices: string[] = [];
      const pending = await sendPending();
      if (pending.notice) notices.push(pending.notice);
      if (pending.sent) me = (await fetchProfile()) ?? me;
      // A raid left mid-way (iOS unloaded the page, or it was closed) and saved: carry on.
      const resume = readSnapshot(me.raid?.id ?? null);
      if (resume) {
        await (
          await accountUi()
        ).showMessage(byId('account'), {
          title: 'Your raid is still on',
          text: [
            ...notices,
            `You left ${loadRaid(resume.raid).name} part-way through. Pick up where you were; the clock stopped while you were away.`,
          ],
          button: 'Resume raid',
        });
        return { me, resume };
      }
      if (me.raid)
        notices.push(
          'Your last raid never finished, so it counted as missing in action: you kept only your knife and your vault.',
        );
      if (notices.length) {
        await (
          await accountUi()
        ).showMessage(byId('account'), {
          title: 'Your last raid',
          text: notices,
          button: 'Continue',
        });
      }
      if (me.raid) me = await abandonRaid(me.raid.id);
      return { me, resume: null };
    } catch (err) {
      if (!(err instanceof AccountError && err.code === 'offline')) throw err;
      await noConnection('Try again');
    }
  }
}

/** "x,z" as two numbers, or null. */
function parseAt(s: string | null): PlayOptions['at'] {
  const [x, z, y] = (s ?? '').split(',').map(Number);
  if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return y !== undefined && Number.isFinite(y) ? [x, z, y] : [x, z];
}

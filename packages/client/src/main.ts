import { PROTOCOL_VERSION, type Gear, type HelloResponse, type ProfileResponse } from '@mes/shared';
import { unlockAudioOnTap } from './app/audio';
import { preventZoom } from './app/no-zoom';
import { watchPauseTriggers } from './app/pause';
import { Hud } from './hud/hud';
import { OpticOverlay } from './hud/optic';
import { RaidHud } from './hud/raid-hud';
import { Vitals } from './hud/vitals';
import { startBodies } from './bodies';
import { startPerfTest } from './perf';
import { readParams } from './perf/params';
import { mountPresets } from './perf/presets';
import { AccountError, fetchProfile, syncSettings } from './account';
import { startPlay } from './play';
import {
  abandonRaid,
  clearSnapshot,
  readSnapshot,
  sendPending,
  startServerRaid,
  type RaidSnapshot,
} from './raids';
import { loadItems, loadQuests, loadRaid, loadVendors, raidIds } from './content';
import { settings } from './settings';

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
unlockAudioOnTap();
preventZoom();

const hud = new Hud(
  byId('controls'),
  byId('stick'),
  byId('knob'),
  byId('sprint-zone'),
  byId('sprint-lock'),
);
byId('settings-button').addEventListener('click', () => {
  import('./ui/menu')
    .then((menu) => menu.openSettings(byId('ui'), hud))
    .catch((err: unknown) => (status.textContent = `settings failed: ${message(err)}`));
});

const showStats = (on: boolean): void => {
  byId('stats').hidden = !on;
  byId('server').hidden = !on;
};
showStats(settings.current.showStats);
settings.subscribe((s) => showStats(s.showStats));

// iOS sets navigator.standalone when opened from the home screen.
const standalone =
  matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

if (location.pathname === '/bodies') {
  for (const id of ['controls', 'settings-button']) byId(id).hidden = true;
  startBodies(byId('scene') as HTMLCanvasElement, status).catch((err: unknown) => {
    status.textContent = `bodies failed: ${message(err)}`;
  });
} else if (location.pathname === '/perf') {
  mountPresets(byId('presets'));
  startPerfTest(
    {
      canvas: byId('scene') as HTMLCanvasElement,
      stats: byId('stats'),
      status,
      hud,
      crosshair: byId('crosshair'),
    },
    readParams(location.search),
  ).catch((err: unknown) => {
    status.textContent = `perf test failed: ${message(err)}`;
  });
} else {
  // ?raid=<id> picks a raid config from content/raids, ?time=<seconds> sets its timer,
  // ?spawn=<id> a player spawn in its map (?at=<x>,<z> starts you at a point instead),
  // ?nav shows the navigation grid, and ?debug shows markers, zones, patrols
  // and what enemies think, with buttons (and keys 7 and 8) for hurt and heal. ?respawn
  // brings dead enemies back, ?peaceful sends them in unarmed, and ?hitzones draws hit
  // zones over their bodies.
  const q = new URLSearchParams(location.search);
  runGame(q).catch((err: unknown) => (status.textContent = `raid failed: ${message(err)}`));
}

/**
 * The game: sign in, the main menu (stash and loadout), then a raid with the gear the
 * server hands back; or straight back into a raid saved when the page was hidden. The
 * results screen's button reloads the page, which comes back here. With no connection when
 * starting, it says so and goes back to the menu.
 */
async function runGame(q: URLSearchParams): Promise<void> {
  const prepared = await prepareMenu();
  let me = prepared.me;
  const items = loadItems();
  const wanted = q.get('raid');
  const raids = raidIds()
    .map((id) => loadRaid(id))
    .sort((a, b) => Number(b.id === wanted) - Number(a.id === wanted))
    .map((r) => ({ id: r.id, name: r.name, duration: r.duration }));
  const play = (raid: string, serverRaid: string, gear: Gear, resume: RaidSnapshot | null) =>
    startPlay(
      {
        canvas: byId('scene') as HTMLCanvasElement,
        stats: byId('stats'),
        hud,
        optic: new OpticOverlay(byId('optic'), byId('crosshair')),
        vitals: new Vitals(byId('vitals'), byId('ammo'), byId('crosshair'), byId('hurt')),
        raidHud: new RaidHud(byId('timer'), byId('extract'), byId('prompt')),
        raid: byId('raid'),
        results: byId('results'),
      },
      {
        raid,
        serverRaid,
        gear,
        resume,
        duration: Number(q.get('time')) > 0 ? Number(q.get('time')) : null,
        spawn: q.get('spawn'),
        at: parseAt(q.get('at')),
        debug: q.has('debug'),
        nav: q.has('nav'),
        respawn: q.has('respawn'),
        peaceful: q.has('peaceful'),
        hitZones: q.has('hitzones'),
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        note: standalone ? 'standalone' : 'browser',
      },
    );

  const resume = prepared.resume;
  if (resume && me.raid) {
    try {
      await play(resume.raid, resume.serverRaid, me.profile.gear, resume);
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
      vendors: [...loadVendors().values()],
      quests: [...loadQuests().values()],
      openSettings: (done) => {
        import('./ui/menu')
          .then((menu) => menu.openSettings(byId('ui'), hud, done))
          .catch((err: unknown) => (status.textContent = `settings failed: ${message(err)}`));
      },
    });
    me = choice.me;
    let started: ProfileResponse;
    try {
      started = await startServerRaid(choice.raid);
    } catch (err) {
      if (!(err instanceof AccountError && err.code === 'offline')) throw err;
      await noConnection('Try again');
      continue;
    }
    await play(choice.raid, started.raid!.id, started.profile.gear, null);
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
async function prepareMenu(): Promise<{ me: ProfileResponse; resume: RaidSnapshot | null }> {
  for (;;) {
    try {
      let me = (await fetchProfile()) ?? (await (await accountUi()).showAccount(byId('account')));
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
function parseAt(s: string | null): [number, number] | null {
  const [x, z] = (s ?? '').split(',').map(Number);
  return x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z)
    ? [x, z]
    : null;
}

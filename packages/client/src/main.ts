import { PROTOCOL_VERSION, type HelloResponse, type ProfileResponse } from '@mes/shared';
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
import { sendPending, startServerRaid } from './raids';
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
  const raidId = q.get('raid') ?? 'test-raid';
  prepareRaid(raidId)
    .then((started) =>
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
          raid: raidId,
          serverRaid: started.raid!.id,
          gear: started.profile.gear,
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
      ),
    )
    .catch((err: unknown) => (status.textContent = `raid failed: ${message(err)}`));
}

/**
 * Everything before a raid, on the server: sign in if no one is, send a result left from
 * an earlier raid, then start this one, whose reply has the gear to wear. Anything
 * worth knowing about the last raid is shown first. With no connection it says so, with
 * a button to try again, since a raid can't start without the server.
 */
async function prepareRaid(raid: string): Promise<ProfileResponse> {
  const ui = (): Promise<typeof import('./ui/account')> => import('./ui/account');
  for (;;) {
    try {
      let me = (await fetchProfile()) ?? (await (await ui()).showAccount(byId('account')));
      syncSettings(me);
      const notices: string[] = [];
      const pending = await sendPending();
      if (pending.notice) notices.push(pending.notice);
      if (pending.sent) me = (await fetchProfile()) ?? me;
      if (me.raid)
        notices.push(
          'Your last raid never finished, so it counted as missing in action: you kept only your knife and your vault.',
        );
      const started = await startServerRaid(raid);
      if (notices.length) {
        await (
          await ui()
        ).showMessage(byId('account'), {
          title: 'Your last raid',
          text: notices,
          button: 'Continue',
        });
      }
      return started;
    } catch (err) {
      if (!(err instanceof AccountError && err.code === 'offline')) throw err;
      await (
        await ui()
      ).showMessage(byId('account'), {
        title: 'No connection',
        text: [
          "Can't reach the server. Raids need it to start, so they can take your gear in.",
          'Check your connection and try again.',
        ],
        button: 'Try again',
      });
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

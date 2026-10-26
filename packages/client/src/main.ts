import { PROTOCOL_VERSION, type HelloResponse } from '@mes/shared';
import { unlockAudioOnTap } from './app/audio';
import { preventZoom } from './app/no-zoom';
import { watchPauseTriggers } from './app/pause';
import { Hud } from './hud/hud';
import { OpticOverlay } from './hud/optic';
import { Vitals } from './hud/vitals';
import { startPerfTest } from './perf';
import { readParams } from './perf/params';
import { mountPresets } from './perf/presets';
import { startPlay } from './play';
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

if (location.pathname === '/perf') {
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
  // ?map=<id> picks a map from content/maps, ?spawn=<id> a player spawn in it, ?weapon=<id>
  // the gun, ?attach=<id>,<id> its attachments, ?nav shows the navigation grid, and ?debug
  // shows markers, zones, patrols and what enemies think, and turns the quick slots into
  // hurt, heal, next optic and next muzzle. ?respawn brings dead enemies back, and
  // ?peaceful sends them in unarmed.
  const q = new URLSearchParams(location.search);
  byId('try-again').addEventListener('click', () => location.reload());
  try {
    startPlay(
      {
        canvas: byId('scene') as HTMLCanvasElement,
        stats: byId('stats'),
        hud,
        optic: new OpticOverlay(byId('optic'), byId('crosshair')),
        vitals: new Vitals(
          byId('vitals'),
          byId('ammo'),
          byId('crosshair'),
          byId('hurt'),
          byId('death'),
        ),
      },
      {
        map: q.get('map') ?? 'test-map',
        spawn: q.get('spawn'),
        weapon: q.get('weapon') ?? 'assault-rifle',
        attachments: q.get('attach')?.split(',').filter(Boolean) ?? [],
        debug: q.has('debug'),
        nav: q.has('nav'),
        respawn: q.has('respawn'),
        peaceful: q.has('peaceful'),
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        note: standalone ? 'standalone' : 'browser',
      },
    );
  } catch (err) {
    status.textContent = `map failed: ${message(err)}`;
  }
}

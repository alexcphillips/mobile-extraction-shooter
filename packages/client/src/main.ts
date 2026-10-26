import { PROTOCOL_VERSION, type HelloResponse } from '@mes/shared';
import { startPerfTest } from './perf';
import { readParams } from './perf/params';
import { mountPresets } from './perf/presets';
import { startPlay } from './play';

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

if (location.pathname === '/perf') {
  mountPresets(byId('presets'));
  startPerfTest(
    {
      canvas: byId('scene') as HTMLCanvasElement,
      stats: byId('stats'),
      status,
      stick: byId('stick'),
      knob: byId('knob'),
      jump: byId('jump'),
      crouch: byId('crouch'),
      crosshair: byId('crosshair'),
    },
    readParams(location.search),
  ).catch((err: unknown) => {
    status.textContent = `perf test failed: ${message(err)}`;
  });
} else {
  // ?map=<id> picks a map from content/maps, ?spawn=<id> a player spawn in it, and ?debug
  // shows markers and zones.
  const q = new URLSearchParams(location.search);
  try {
    startPlay(
      {
        canvas: byId('scene') as HTMLCanvasElement,
        stats: byId('stats'),
        stick: byId('stick'),
        knob: byId('knob'),
        jump: byId('jump'),
        crouch: byId('crouch'),
      },
      {
        map: q.get('map') ?? 'test-map',
        spawn: q.get('spawn'),
        debug: q.has('debug'),
        pixelRatio: Math.min(window.devicePixelRatio, 2),
      },
    );
  } catch (err) {
    status.textContent = `map failed: ${message(err)}`;
  }
}

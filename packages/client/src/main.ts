import { PROTOCOL_VERSION, type HelloResponse } from '@mes/shared';
import { startPerfTest } from './perf';
import { readParams } from './perf/params';
import { mountPresets } from './perf/presets';

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
mountPresets(byId('presets'));
startPerfTest(
  {
    canvas: byId('scene') as HTMLCanvasElement,
    stats: byId('stats'),
    status,
    stick: byId('stick'),
    knob: byId('knob'),
    crosshair: byId('crosshair'),
  },
  readParams(location.search),
).catch((err: unknown) => {
  status.textContent = `perf test failed: ${err instanceof Error ? err.message : String(err)}`;
});

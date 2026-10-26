import { PROTOCOL_VERSION, type HelloResponse } from '@mes/shared';
import { createScene } from './scene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const status = document.querySelector<HTMLDivElement>('#status');
if (!canvas || !status) throw new Error('missing #scene or #status');

createScene(canvas);

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

void checkServer(status);

import { padCursor } from './pad-cursor';
import { diagnose, modeLines, padLog, reportText, snapshot, type PadInfo } from './pad-diagnostics';

/*
 * The controller test (2026-11-08): a live view of what the browser reports for each pad
 * slot — id, mapping, which buttons are down, the axes — over everything else, with Copy for
 * the full report. Opened from Settings → Controller, or with `?padtest` in the URL. Plain
 * DOM, so it works even when the menus don't. While it's open the pad cursor is held off, so
 * pressing buttons to test them doesn't click anything.
 */

let open: HTMLElement | null = null;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function padHtml(p: PadInfo): string {
  const buttons = Array.from(
    { length: p.buttonCount },
    (_, i) => `<span class="pad-test-btn${p.pressed.includes(i) ? ' on' : ''}">${i}</span>`,
  ).join('');
  const axes = p.axes
    .map(
      (a, i) =>
        `<span class="pad-test-axis"><i style="left:${50 + a * 50}%"></i></span><span>a${i} ${a.toFixed(2)}</span>`,
    )
    .join('');
  const ok = p.mapping === 'standard';
  return `<div class="pad-test-pad">
    <div><b>[${p.index}] ${esc(p.id)}</b></div>
    <div class="${ok ? '' : 'bad'}">mapping: “${esc(p.mapping) || '(none)'}”${ok ? '' : ' — the game can’t read this'}${p.connected ? '' : ' · not connected'}</div>
    <div class="pad-test-btns">${buttons}</div>
    <div class="pad-test-axes">${axes}</div>
  </div>`;
}

export function openPadTest(): void {
  if (open) return;
  padLog.start();
  const root = document.createElement('div');
  root.className = 'pad-test';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Controller test');
  root.innerHTML = `<header><b>Controller test</b><span class="raid-spacer"></span>
    <button data-copy>Copy report</button><button data-close>Close</button></header>
    <p class="pad-test-status"></p><p class="hint pad-test-detail"></p>
    <p class="hint pad-test-env"></p><div class="pad-test-pads"></div>
    <pre class="pad-test-log pad-test-mode"></pre><pre class="pad-test-log pad-test-events"></pre><p class="hint pad-test-copied"></p>`;
  document.body.append(root);
  open = root;

  const q = (s: string): HTMLElement => root.querySelector(s)!;
  const status = q('.pad-test-status');
  const detail = q('.pad-test-detail');
  const envEl = q('.pad-test-env');
  const padsEl = q('.pad-test-pads');
  const log = q('.pad-test-events');
  const modeEl = q('.pad-test-mode');
  let raf = 0;

  const update = (): void => {
    if (open !== root) return;
    raf = requestAnimationFrame(update);
    padCursor.claim();
    const { env, pads } = snapshot();
    padLog.note(pads, env);
    const d = diagnose(env, pads);
    status.textContent = d.title;
    status.className = `pad-test-status ${d.status === 'ok' ? 'good' : 'bad'}`;
    detail.textContent = d.detail;
    envEl.textContent =
      `secure ${env.secure ? 'yes' : 'NO'} · API ${env.hasApi ? 'yes' : 'NO'} · ` +
      `policy ${env.policyAllows === null ? '?' : env.policyAllows ? 'allows' : 'BLOCKS'} · ` +
      `frame ${env.framed ? 'YES' : 'no'} · tab focused ${env.focused ? 'yes' : 'NO'}` +
      (env.error ? ` · error: ${env.error}` : '');
    padsEl.innerHTML = pads.length
      ? pads.map(padHtml).join('')
      : '<p class="hint">No pad slots filled. Press a button on the controller.</p>';
    modeEl.textContent = modeLines().join('\n');
    log.textContent = padLog.events.length
      ? padLog.events
          .map((e) => `${(e.t / 1000).toFixed(1)}s ${e.type} [${e.index}] ${e.id} “${e.mapping}”`)
          .join('\n')
      : 'No controller events yet.';
  };

  const close = (): void => {
    cancelAnimationFrame(raf);
    root.remove();
    open = null;
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  q('[data-close]').addEventListener('click', close);
  q('[data-copy]').addEventListener('click', () => {
    const { env, pads } = snapshot();
    const text = reportText(env, pads, padLog.events);
    const copied = q('.pad-test-copied');
    navigator.clipboard.writeText(text).then(
      () => (copied.textContent = 'Copied. Paste it to Claude.'),
      () => {
        copied.textContent = 'Couldn’t copy; the report is in the console.';
        console.log(text);
      },
    );
  });
  update();
}

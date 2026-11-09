/*
 * Why a controller isn't being picked up (2026-11-08). The game only plays a pad that the
 * browser lists as connected with the standard mapping (`firstPad`); everything else used to
 * fail silently. This module records what the browser actually reports — the page's
 * environment, every pad slot, and the connect / disconnect events — so the settings panel
 * and the controller test (`pad-test.ts`) can say which step failed, and Copy can hand the
 * whole report over. `diagnose` is pure, for tests.
 */

import { inputMode } from './mode';

/** What the page is allowed to do, as far as reading a pad goes. */
export interface PadEnv {
  /** `navigator.getGamepads` exists (it's missing outside HTTPS and localhost). */
  hasApi: boolean;
  secure: boolean;
  /** The page is in an iframe, where the parent can withhold the gamepad permission. */
  framed: boolean;
  /** Chrome's permissions policy for `gamepad`; null where the browser can't say. */
  policyAllows: boolean | null;
  /** The message `getGamepads()` threw, if it did (a blocked policy throws). */
  error: string | null;
  focused: boolean;
  visible: boolean;
  userAgent: string;
}

/** One slot of `getGamepads()`, copied out. */
export interface PadInfo {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  buttonCount: number;
  axisCount: number;
  /** Indices of buttons pressed past half. */
  pressed: number[];
  axes: number[];
  timestamp: number;
}

export type PadStatus = 'no-api' | 'blocked' | 'none' | 'non-standard' | 'ok';

export interface Diagnosis {
  status: PadStatus;
  /** One line for the settings panel. */
  title: string;
  /** What to do about it. */
  detail: string;
}

export interface PadEvent {
  /** ms since the page loaded. */
  t: number;
  type: 'connected' | 'disconnected' | 'first-seen' | 'error';
  index: number;
  id: string;
  mapping: string;
}

export function diagnose(env: PadEnv, pads: readonly PadInfo[]): Diagnosis {
  if (!env.hasApi) {
    return {
      status: 'no-api',
      title: 'This browser gives the page no controller access',
      detail: env.secure
        ? 'navigator.getGamepads is missing even though the page is secure. Try another browser.'
        : 'The page isn’t on HTTPS (or localhost), and browsers only expose controllers to secure pages.',
    };
  }
  if (env.error || env.policyAllows === false) {
    return {
      status: 'blocked',
      title: 'Controller access is blocked for this page',
      detail: env.framed
        ? 'The page is inside a frame that doesn’t allow “gamepad”. Open the game in its own tab.'
        : 'A Permissions-Policy header disallows “gamepad”. Check the server or CDN headers.',
    };
  }
  const live = pads.filter((p) => p.connected);
  if (live.length === 0) {
    return {
      status: 'none',
      title: 'No controller seen yet',
      detail:
        'Chrome hides a controller until a button is pressed while this tab is focused. Press ✕. ' +
        'If nothing shows after that, the computer isn’t passing it to Chrome: check it’s paired ' +
        'and that no other app (Steam, DS4Windows) has taken it over.',
    };
  }
  const standard = live.find((p) => p.mapping === 'standard');
  if (!standard) {
    return {
      status: 'non-standard',
      title: `Controller found, but Chrome didn't map it: ${live[0]!.id}`,
      detail:
        'The game only reads pads in the standard mapping. Try a USB cable, or turn off Steam ' +
        'Input / DS4Windows, which can present the pad as a different device.',
    };
  }
  return {
    status: 'ok',
    title: `Controller ready: ${standard.id}`,
    detail: 'Press any button or push a stick to switch to controller controls.',
  };
}

const PRESSED = 0.5;

function info(gp: Gamepad): PadInfo {
  const pressed: number[] = [];
  gp.buttons.forEach((b, i) => {
    if (b.pressed || b.value > PRESSED) pressed.push(i);
  });
  return {
    index: gp.index,
    id: gp.id,
    mapping: gp.mapping,
    connected: gp.connected,
    buttonCount: gp.buttons.length,
    axisCount: gp.axes.length,
    pressed,
    axes: Array.from(gp.axes, (a) => Math.round(a * 100) / 100),
    timestamp: Math.round(gp.timestamp),
  };
}

/** Reads the environment and every pad slot now. Allocates: for the diagnostics only. */
export function snapshot(): { env: PadEnv; pads: PadInfo[] } {
  let framed: boolean;
  try {
    framed = window.top !== window;
  } catch {
    framed = true;
  }
  const policy = (document as { featurePolicy?: { allowsFeature?(f: string): boolean } })
    .featurePolicy;
  const env: PadEnv = {
    hasApi: typeof navigator.getGamepads === 'function',
    secure: window.isSecureContext,
    framed,
    policyAllows: policy?.allowsFeature ? policy.allowsFeature('gamepad') : null,
    error: null,
    focused: document.hasFocus(),
    visible: document.visibilityState === 'visible',
    userAgent: navigator.userAgent,
  };
  const pads: PadInfo[] = [];
  if (env.hasApi) {
    try {
      for (const gp of navigator.getGamepads()) if (gp) pads.push(info(gp));
    } catch (err) {
      env.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }
  return { env, pads };
}

const LOG_MAX = 40;

/** Connect and disconnect events since the page loaded, kept for the report. */
class PadLog {
  readonly events: PadEvent[] = [];
  private started = false;
  private seen = new Set<string>();

  start(): void {
    if (this.started) return;
    this.started = true;
    const on =
      (type: 'connected' | 'disconnected') =>
      (e: Event): void => {
        const gp = (e as GamepadEvent).gamepad;
        this.add({ type, index: gp.index, id: gp.id, mapping: gp.mapping });
        if (type === 'connected' && gp.mapping !== 'standard') {
          console.warn(
            `Controller "${gp.id}" has mapping "${gp.mapping}"; the game can't read it.`,
          );
        }
      };
    window.addEventListener('gamepadconnected', on('connected'));
    window.addEventListener('gamepaddisconnected', on('disconnected'));
  }

  /** Called by the test panel each update, so pads Chrome lists without an event are logged. */
  note(pads: readonly PadInfo[], env: PadEnv): void {
    if (env.error && !this.seen.has(env.error)) {
      this.seen.add(env.error);
      this.add({ type: 'error', index: -1, id: env.error, mapping: '' });
    }
    for (const p of pads) {
      const key = `${p.index}|${p.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      this.add({ type: 'first-seen', index: p.index, id: p.id, mapping: p.mapping });
    }
  }

  private add(e: Omit<PadEvent, 't'>): void {
    this.events.push({ t: Math.round(performance.now()), ...e });
    if (this.events.length > LOG_MAX) this.events.shift();
  }
}

export const padLog = new PadLog();

/** The input mode now and its last switches, as lines. */
export function modeLines(): string[] {
  return [
    `Input mode: ${inputMode.current}`,
    ...inputMode.changes.map((c) => `  ${(c.t / 1000).toFixed(1)}s → ${c.mode} (${c.cause})`),
  ];
}

/** The whole picture as text, for Copy. */
export function reportText(
  env: PadEnv,
  pads: readonly PadInfo[],
  events: readonly PadEvent[],
): string {
  const d = diagnose(env, pads);
  const lines = [
    `Controller report (${new Date().toISOString()})`,
    `Status: ${d.status} — ${d.title}`,
    `URL: ${location.origin}${location.pathname}`,
    `UA: ${env.userAgent}`,
    `api=${env.hasApi} secure=${env.secure} framed=${env.framed} policy=${env.policyAllows} ` +
      `focused=${env.focused} visible=${env.visible} error=${env.error ?? 'none'}`,
    ...modeLines(),
    `Pads (${pads.length}):`,
    ...(pads.length === 0
      ? ['  none']
      : pads.map(
          (p) =>
            `  [${p.index}] "${p.id}" mapping="${p.mapping}" connected=${p.connected} ` +
            `buttons=${p.buttonCount} axes=${p.axisCount} pressed=[${p.pressed.join(',')}] ` +
            `axesNow=[${p.axes.join(', ')}] ts=${p.timestamp}`,
        )),
    `Events:`,
    ...(events.length === 0
      ? ['  none']
      : events.map((e) => `  ${e.t} ms ${e.type} [${e.index}] "${e.id}" mapping="${e.mapping}"`)),
  ];
  return lines.join('\n');
}

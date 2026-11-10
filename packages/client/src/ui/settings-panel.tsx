import type { Settings } from '@mes/shared';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { signOut, username } from '../account';
import { firstPad } from '../input/gamepad';
import { diagnose, snapshot } from '../input/pad-diagnostics';
import { openPadTest } from '../input/pad-test';
import { inputMode } from '../input/mode';
import { PAD_GLYPHS, padLayout } from '../input/pad-labels';
import { LayoutSettings } from './layout-settings';
import { settings } from '../settings';

/** Signing out reloads the page, which then asks to sign in. */
function signOutAndReload(): void {
  signOut()
    .catch((err: unknown) => console.error('sign out failed', err))
    .finally(() => location.reload());
}

const subscribe = (onChange: () => void): (() => void) => settings.subscribe(onChange);
const current = (): Settings => settings.current;

interface Props {
  onClose: () => void;
  onEditLayout: () => void;
  /** The close button's label: Resume over a raid, Done over the menu. */
  closeLabel: string;
  /** Dies on the spot; only during a raid. */
  onGiveUp?: (() => void) | null;
  /** Leaves the tutorial; only during it (TU-3). */
  onSkipTutorial?: (() => void) | null;
  /** Plays the tutorial again; only from the main menu (TU-3). */
  onReplayTutorial?: (() => void) | null;
}

/** The settings screen. Every change saves and applies straight away. */
export function SettingsPanel({
  onClose,
  onEditLayout,
  closeLabel,
  onGiveUp,
  onSkipTutorial,
  onReplayTutorial,
}: Props): ReactNode {
  const s = useSyncExternalStore(subscribe, current);
  // Giving up asks again first: it loses everything you carry.
  const [confirming, setConfirming] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  // With a pad in use, or one plugged in (Chrome lists a pad only after a press on it).
  const pad = inputMode.gamepad || firstPad(navigator.getGamepads?.() ?? []) !== null;
  const padSnap = snapshot();
  const padStatus = diagnose(padSnap.env, padSnap.pads);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    settings.update((draft) => {
      draft[key] = value;
    });

  return (
    <div className="panel" role="dialog" aria-label="Settings">
      <header>
        <h1>Settings</h1>
        <button className="primary" onClick={onClose}>
          {closeLabel}
        </button>
      </header>
      <div className="panel-body">
        {onGiveUp && (
          <section>
            <h2>Raid</h2>
            {confirming ? (
              <div className="row give-up-row">
                <span>Die here and lose what you carry?</span>
                <button className="danger" onClick={onGiveUp}>
                  Give up
                </button>
                <button onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            ) : (
              <div className="row">
                <button onClick={() => setConfirming(true)}>Give up</button>
              </div>
            )}
          </section>
        )}
        {(onSkipTutorial || onReplayTutorial) && (
          <section>
            <h2>Tutorial</h2>
            <div className="row">
              {onSkipTutorial ? (
                <button onClick={onSkipTutorial}>Skip tutorial</button>
              ) : (
                <button onClick={onReplayTutorial!}>Play the tutorial again</button>
              )}
            </div>
          </section>
        )}
        <section>
          <h2>Controls</h2>
          <Choice
            label="Aim"
            value={s.aim}
            options={[
              ['hold', 'Hold to aim'],
              ['toggle', 'Toggle'],
            ]}
            hint={
              inputMode.desktop
                ? 'Toggle: right click (or Z) aims, and you stay aimed until you press it again.'
                : inputMode.gamepad
                  ? 'Toggle: L2 aims, and you stay aimed until you press it again.'
                  : 'Toggle: tap aim to aim, and you stay aimed until you tap it again.'
            }
            onChange={(v) => set('aim', v)}
          />
          <Choice
            label="Lean"
            value={s.lean}
            options={[
              ['toggle', 'Toggle'],
              ['hold', 'Hold to lean'],
            ]}
            hint={
              inputMode.desktop
                ? 'Toggle: Q or E leans until you press it again (or the other one, or sprint).'
                : inputMode.gamepad
                  ? 'Toggle: D-pad ← or → leans until you press it again (or the other one, or sprint), so your thumb can go back to the stick.'
                  : "Toggle: tap a lean button to lean until you tap it again (or sprint). Holding one means you can't fire with that thumb."
            }
            onChange={(v) => set('lean', v)}
          />
          <Toggle label="Aim while leaning" value={s.leanAim} onChange={(v) => set('leanAim', v)} />
          <Choice
            label="Crouch"
            value={s.crouch}
            options={[
              ['toggle', 'Toggle'],
              ['hold', 'Hold to crouch'],
            ]}
            hint={
              inputMode.desktop
                ? 'Toggle: C crouches until you press it again (or sprint). Hold: crouched while C is down.'
                : inputMode.gamepad
                  ? s.crouch === 'hold'
                    ? 'Hold: crouched while ○ is down. Double-tap it to go prone; a tap gets up.'
                    : 'Toggle: ○ crouches until you press it again (or sprint). Hold it to go prone.'
                  : s.crouch === 'hold'
                    ? 'Hold: crouched while the button is down. Double-tap it to go prone; a tap gets up.'
                    : 'Toggle: tap crouch to crouch until you tap it again (or sprint). Hold it to go prone.'
            }
            onChange={(v) => set('crouch', v)}
          />
          <Choice
            label="Firing"
            value={s.fire}
            options={[
              ['auto', 'Auto-fire on target'],
              ['manual', 'Fire button only'],
            ]}
            hint="Auto-fire shoots by itself while the crosshair is on an enemy. The fire button always works too."
            onChange={(v) => set('fire', v)}
          />
          <Choice
            label="Aim assist"
            value={s.aimAssist}
            options={[
              ['off', 'Off'],
              ['low', 'Low'],
              ['medium', 'Medium'],
              ['high', 'High'],
            ]}
            hint="Slows your aim slightly as it passes over an enemy."
            onChange={(v) => set('aimAssist', v)}
          />
          {/* Each way of playing has its own look speed; only the one in use shows. */}
          {inputMode.gamepad ? (
            <Slider
              label="Controller look sensitivity"
              value={s.padSensitivity}
              min={0.2}
              max={3}
              onChange={(v) => set('padSensitivity', v)}
            />
          ) : inputMode.desktop ? (
            <Slider
              label="Mouse sensitivity"
              value={s.mouseSensitivity}
              min={0.2}
              max={3}
              onChange={(v) => set('mouseSensitivity', v)}
            />
          ) : (
            <Slider
              label="Look sensitivity"
              value={s.lookSensitivity}
              min={0.2}
              max={3}
              onChange={(v) => set('lookSensitivity', v)}
            />
          )}
          <Slider
            label="Sensitivity while aiming"
            value={s.aimSensitivity}
            min={0.2}
            max={1.5}
            onChange={(v) => set('aimSensitivity', v)}
          />
          <Toggle
            label="Invert look up and down"
            value={s.invertY}
            onChange={(v) => set('invertY', v)}
          />
        </section>
        {/* Always on desktop, so a pad that isn't picked up can be looked into. */}
        {(pad || !inputMode.touch) && (
          <section className={showLayout ? 'wide' : undefined}>
            <h2>Controller</h2>
            <p className={padStatus.status === 'ok' ? 'hint' : 'hint bad'}>{padStatus.title}</p>
            <Choice
              label="Input"
              value={s.inputPreference}
              options={[
                ['auto', 'Last used'],
                ['controller', 'Controller only'],
              ]}
              hint="Controller only: while a controller is connected, the keyboard and mouse never switch the game away from it."
              onChange={(v) => set('inputPreference', v)}
            />
            {padStatus.status !== 'ok' && <p className="hint">{padStatus.detail}</p>}
            {pad && <Toggle label="Rumble" value={s.rumble} onChange={(v) => set('rumble', v)} />}
            <div className="row">
              {pad && (
                <button onClick={() => setShowLayout((v) => !v)}>
                  {showLayout ? 'Hide button layout' : 'Show button layout'}
                </button>
              )}
              <button onClick={openPadTest}>Test controller</button>
            </div>
            {showLayout && <PadLayoutTable s={s} />}
          </section>
        )}
        {/* The touch buttons don't show on desktop or with a pad, so neither do their layouts. */}
        {inputMode.touch && (
          <section>
            <h2>Buttons</h2>
            <LayoutSettings s={s} onEdit={onEditLayout} />
          </section>
        )}
        <section>
          <h2>Sound</h2>
          <Slider
            label="Volume"
            value={s.volume}
            min={0}
            max={1}
            onChange={(v) => set('volume', v)}
          />
        </section>
        <section>
          <h2>Display</h2>
          <Choice
            label="Graphics"
            value={s.graphics}
            options={[
              ['high', 'High'],
              ['balanced', 'Balanced'],
              ['low', 'Low'],
            ]}
            hint="Lower draws the 3D view at a lower resolution, which runs smoother and saves battery. Low also turns off edge smoothing, from the next raid."
            onChange={(v) => set('graphics', v)}
          />
          {import.meta.env.DEV && (
            <Toggle
              label="Show performance stats (dev)"
              value={s.showStats}
              onChange={(v) => set('showStats', v)}
            />
          )}
        </section>
        <section>
          <h2>Account</h2>
          {username ? (
            <div className="row account-row">
              <span>
                Signed in as <strong>{username}</strong>
              </span>
              <button onClick={signOutAndReload}>Sign out</button>
            </div>
          ) : (
            <p className="hint">Not signed in: the server can't be reached.</p>
          )}
        </section>
        <section>
          <div className="row">
            <button onClick={() => settings.reset()}>Reset all settings</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The controller's buttons and what they do (CP-3), worded for the current settings. */
function PadLayoutTable({ s }: { s: Settings }): ReactNode {
  return (
    <table className="pad-layout">
      <thead>
        <tr>
          <th>Button</th>
          <th>In a raid</th>
          <th>In menus</th>
        </tr>
      </thead>
      <tbody>
        {padLayout(s).map((row) => (
          <tr key={row.keys.join()}>
            <td>
              {row.keys.map((k) => (
                <PadKey key={k} name={k} />
              ))}
            </td>
            <td>{row.raid}</td>
            <td>{row.menus || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A pad button's name, face buttons as their round coloured glyph. */
export function PadKey({ name }: { name: string }): ReactNode {
  const face = PAD_GLYPHS.includes(name);
  return (
    <kbd className={face ? 'pad' : undefined} data-glyph={face ? name : undefined}>
      {name}
    </kbd>
  );
}

function Choice<T extends string>(props: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  hint?: string;
  onChange: (value: T) => void;
}): ReactNode {
  const name = useId();
  return (
    <fieldset>
      <legend>{props.label}</legend>
      <div className="choices">
        {props.options.map(([value, text]) => (
          <label key={value} className={value === props.value ? 'checked' : undefined}>
            <input
              type="radio"
              name={name}
              checked={value === props.value}
              onChange={() => props.onChange(value)}
            />
            {text}
          </label>
        ))}
      </div>
      {props.hint && <p className="hint">{props.hint}</p>}
    </fieldset>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): ReactNode {
  return (
    <label className="slider">
      <span>
        {props.label} <output>{props.value.toFixed(1)}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={0.1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): ReactNode {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

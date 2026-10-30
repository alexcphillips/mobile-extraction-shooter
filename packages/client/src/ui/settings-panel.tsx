import type { Settings } from '@mes/shared';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { signOut, username } from '../account';
import { inputMode } from '../input/mode';
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
}

/** The settings screen. Every change saves and applies straight away. */
export function SettingsPanel({ onClose, onEditLayout, closeLabel, onGiveUp }: Props): ReactNode {
  const s = useSyncExternalStore(subscribe, current);
  // Giving up asks again first: it loses everything you carry.
  const [confirming, setConfirming] = useState(false);
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
                ? 'Toggle: right click (or Q) aims, and you stay aimed until you press it again.'
                : 'Toggle: tap aim to aim, and you stay aimed until you tap it again.'
            }
            onChange={(v) => set('aim', v)}
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
          {inputMode.desktop ? (
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
          {!inputMode.desktop && (
            <div className="row">
              <button onClick={onEditLayout}>Edit button layout</button>
            </div>
          )}
        </section>
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
          <Toggle
            label="Show performance stats"
            value={s.showStats}
            onChange={(v) => set('showStats', v)}
          />
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

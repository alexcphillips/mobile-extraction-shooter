import { LAYOUT_SLOTS, equippedLayout, type Settings } from '@mes/shared';
import { useRef, useState, type ReactNode } from 'react';
import { decodeLayout, encodeLayout } from '../hud/layout-code';
import { settings } from '../settings';

const isDefault = (s: Settings, slot: number): boolean => {
  const l = s.layouts[slot]!;
  return Object.keys(l.placements).length === 0 && l.hidden.length === 0;
};

/**
 * The button layouts in settings (UX-4, 2026-11-08): pick which of the saved layouts is
 * equipped, edit it, and share it as a code to copy and paste (no server).
 */
export function LayoutSettings(props: { s: Settings; onEdit: () => void }): ReactNode {
  const { s } = props;
  const slot = s.equippedLayout;
  const code = encodeLayout(equippedLayout(s));
  const codeField = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const equip = (i: number): void => {
    setConfirming(false);
    setMessage(null);
    settings.update((d) => {
      d.equippedLayout = i;
    });
  };

  const copy = (): void => {
    codeField.current?.select();
    // The clipboard needs a secure page; elsewhere the code is selected to copy by hand.
    const byHand = (): void => setMessage({ text: 'Copy the selected code.' });
    if (!navigator.clipboard) return byHand();
    navigator.clipboard.writeText(code).then(() => setMessage({ text: 'Code copied.' }), byHand);
  };

  const load = (sure: boolean): void => {
    const layout = decodeLayout(pasted);
    if ('error' in layout) {
      setMessage({ text: layout.error, bad: true });
      return;
    }
    // Replacing a layout you've made asks first; there's no getting it back.
    if (!sure && !isDefault(s, slot)) {
      setConfirming(true);
      return;
    }
    settings.update((d) => {
      d.layouts[slot] = layout;
    });
    setConfirming(false);
    setPasted('');
    setMessage({ text: `Loaded into Layout ${slot + 1}.` });
  };

  return (
    <>
      <fieldset>
        <legend>Button layout</legend>
        <div className="choices">
          {Array.from({ length: LAYOUT_SLOTS }, (_, i) => (
            <label key={i} className={i === slot ? 'checked' : undefined}>
              <input
                type="radio"
                name="layout-slot"
                checked={i === slot}
                onChange={() => equip(i)}
              />
              Layout {i + 1}
            </label>
          ))}
        </div>
        <p className="hint">
          Each layout keeps its own button places, sizes and hidden buttons. The one picked is used
          in raids.
        </p>
      </fieldset>
      <div className="row">
        <button onClick={props.onEdit}>Edit layout {slot + 1}</button>
      </div>
      <div className="layout-share">
        <label>
          <span>Share code</span>
          <input
            ref={codeField}
            type="text"
            readOnly
            value={code}
            onFocus={(e) => e.target.select()}
          />
        </label>
        <button onClick={copy}>Copy</button>
      </div>
      <div className="layout-share">
        <label>
          <span>Paste a code</span>
          <input
            type="text"
            value={pasted}
            placeholder="MES1-…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setPasted(e.target.value);
              setConfirming(false);
              setMessage(null);
            }}
          />
        </label>
        {confirming ? (
          <>
            <button className="danger" onClick={() => load(true)}>
              Replace layout {slot + 1}
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <button disabled={!pasted.trim()} onClick={() => load(false)}>
            Load
          </button>
        )}
      </div>
      {message && <p className={message.bad ? 'hint bad' : 'hint'}>{message.text}</p>}
    </>
  );
}

import {
  ATTACHMENT_SLOTS,
  fits,
  type AttachmentDef,
  type AttachmentSlot,
  type ItemDb,
  type ItemDef,
  type WeaponDef,
} from '@mes/shared';
import { useEffect, useState } from 'react';
import { Toggle } from '../editor/fields';
import { reticleMarkup } from '../hud/optic';
import { gunModel } from '../render/gun-model';
import { shapesPortrait } from '../render/item-portrait';
import { aimedPicture } from './aimed-picture';
import type { ItemEditorState } from './editor';
import { gunState } from './model-panel';
import type { ViewMode } from './model-view';

/*
 * The fits page (IE-1, 2026-11-09): every gun with each attachment that fits it, one at a
 * time, from the side, and aimed through its iron sights and each optic without zoom, all as
 * edited. After a gun's mounts move, a floating magazine or a sight line through the front
 * post shows at a glance. A click opens the model tab with that attachment fitted.
 * Pictures are drawn a few a frame and kept until the gun or attachment changes.
 */

type Fitted = Partial<Record<AttachmentSlot, string>>;

export interface OpenFit {
  gun: string;
  fitted: Fitted;
  mode: ViewMode;
}

interface Fit {
  label: string;
  fitted: Fitted;
  /** The optic fitted, if any. */
  optic: AttachmentDef | null;
  /** Aimed through it: iron sights or an optic without zoom. */
  aimed: boolean;
}

const SIDE: [number, number] = [4, 2];
/** Aimed pictures are drawn this big and shown cropped to their middle, twice as close. */
const AIMED_W = 640;
const AIMED_H = 360;
const CROP = 2;

/** The reticle overlay's viewBox for the cropped aimed picture (reticle units: % of height). */
const aimedViewBox = (() => {
  const h = 100 / CROP;
  const w = h * (16 / 9);
  return `${-w / 2} ${-h / 2} ${w} ${h}`;
})();

/** Pictures by what they were drawn from (a hash of the gun and attachment as edited). */
const kept = new Map<string, string | null>();

/** A short hash of a string (FNV-1a), for keys. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${s.length}`;
}

function fitsOf(gun: WeaponDef, items: ItemDb, only: AttachmentDef | null): Fit[] {
  const out: Fit[] = only
    ? []
    : [{ label: 'nothing fitted', fitted: {}, optic: null, aimed: true }];
  for (const slot of ATTACHMENT_SLOTS) {
    if (!gun.slots?.includes(slot)) continue;
    for (const a of items.values()) {
      if (a.type !== 'attachment' || a.slot !== slot || !fits(gun, a)) continue;
      if (only && a.id !== only.id) continue;
      const optic = slot === 'optic' ? a : null;
      out.push({
        label: a.name,
        fitted: { [slot]: a.id },
        optic,
        aimed: !optic || (a.optic?.zoom ?? 1) <= 1,
      });
    }
  }
  return out;
}

/** What a fit's pictures are drawn from, as keys. */
function keysOf(gun: WeaponDef, fit: Fit, items: ItemDb): { side: string; aimed: string } {
  const parts = Object.values(fit.fitted).map((id) => JSON.stringify(items.get(id!)));
  const base = hash(JSON.stringify(gun) + parts.join(''));
  return { side: `side ${base}`, aimed: `aimed ${base}` };
}

export function FitsPage(props: {
  state: ItemEditorState;
  def: ItemDef | undefined;
  open: (fit: OpenFit) => void;
}) {
  const { state: s, def } = props;
  const db = s.db;
  const forItem = def?.type === 'weapon' || def?.type === 'attachment';
  const [every, setEvery] = useState(!forItem);
  const [, redraw] = useState(0);

  const only = !every && def?.type === 'attachment' ? def : null;
  const guns: WeaponDef[] = !db
    ? []
    : [...db.values()]
        .filter((g): g is WeaponDef => g.type === 'weapon')
        .filter((g) =>
          every
            ? true
            : def?.type === 'weapon'
              ? g.id === def.id
              : def?.type === 'attachment'
                ? fits(g, def)
                : false,
        )
        .sort((a, b) => a.name.localeCompare(b.name));
  const rows = db
    ? guns.map((gun) => ({
        gun,
        fits: fitsOf(gun, db, only).map((fit) => ({ fit, keys: keysOf(gun, fit, db) })),
      }))
    : [];

  // Draw what's missing, a few a frame, so the page stays responsive.
  const missing = rows.flatMap(({ gun, fits }) =>
    fits.flatMap(({ fit, keys }) => [
      ...(kept.has(keys.side) ? [] : [{ key: keys.side, gun, fit, aimed: false }]),
      ...(fit.aimed && !kept.has(keys.aimed) ? [{ key: keys.aimed, gun, fit, aimed: true }] : []),
    ]),
  );
  const missingKey = missing.map((m) => m.key).join(' ');
  useEffect(() => {
    if (!db || !missing.length) return;
    let stop = false;
    let i = 0;
    const step = (): void => {
      if (stop) return;
      const until = performance.now() + 14;
      while (i < missing.length && performance.now() < until) {
        const { key, gun, fit, aimed } = missing[i++]!;
        const state = gunState(gun.id, fit.fitted);
        try {
          kept.set(
            key,
            aimed
              ? aimedPicture(state, db, AIMED_W, AIMED_H)
              : shapesPortrait(gunModel(state, db).shapes, 'side', SIDE),
          );
        } catch {
          kept.set(key, null);
        }
      }
      redraw((n) => n + 1);
      if (i < missing.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, db]);

  const tile = (gun: WeaponDef, fit: Fit, keys: { side: string; aimed: string }, label: string) => (
    <div key={`${gun.id} ${fit.label}`} className="ie-fit">
      <span className="ed-note">{label}</span>
      <Picture
        url={kept.get(keys.side)}
        className="ie-fit-side"
        onClick={() => props.open({ gun: gun.id, fitted: fit.fitted, mode: 'build' })}
        title="Open in the model tab"
      />
      {fit.aimed ? (
        <div
          className="ie-fit-aimed"
          onClick={() => props.open({ gun: gun.id, fitted: fit.fitted, mode: 'aimed' })}
          title="Open aimed in the model tab"
        >
          <Picture url={kept.get(keys.aimed)} />
          {fit.optic?.optic && (
            <svg
              viewBox={aimedViewBox}
              // Drawn by the game's own markup, as in the model tab.
              dangerouslySetInnerHTML={{ __html: reticleMarkup(fit.optic.optic) }}
            />
          )}
        </div>
      ) : (
        <span className="ed-note">scope: aimed shows its mask</span>
      )}
    </div>
  );

  const pictures = rows.reduce((n, r) => n + r.fits.length, 0);
  return (
    <main className="ie-main ie-fits">
      <div className="ed-row ie-tools">
        <Toggle on={!every} onClick={() => setEvery(false)} title="The open gun or attachment">
          {def && forItem ? def.name : 'this item'}
        </Toggle>
        <Toggle on={every} onClick={() => setEvery(true)}>
          every gun
        </Toggle>
        <span className="ed-note">
          {db
            ? `${guns.length} gun${guns.length === 1 ? '' : 's'}, ${pictures} fits${
                missing.length ? `, drawing ${missing.length}…` : ''
              }. Click one to open it in the model tab.`
            : 'Fits show once every item passes its checks.'}
        </span>
      </div>
      {!every && !forItem && (
        <p className="ed-note">Open a gun or an attachment, or show every gun.</p>
      )}
      {only ? (
        // One attachment: a tile per gun, labeled by the gun.
        <div className="ie-fit-tiles">
          {rows.flatMap(({ gun, fits }) =>
            fits.map(({ fit, keys }) => tile(gun, fit, keys, gun.name)),
          )}
        </div>
      ) : (
        rows.map(({ gun, fits }) => (
          <section key={gun.id} className="ie-fit-row">
            <h4>{gun.name}</h4>
            <div className="ie-fit-tiles">
              {fits.map(({ fit, keys }) => tile(gun, fit, keys, fit.label))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

function Picture(props: {
  url: string | null | undefined;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  if (props.url === undefined)
    return <div className={`${props.className ?? ''} ie-fit-wait`} onClick={props.onClick} />;
  if (props.url === null)
    return (
      <div className={props.className} onClick={props.onClick}>
        can&apos;t draw
      </div>
    );
  return (
    <img className={props.className} src={props.url} onClick={props.onClick} title={props.title} />
  );
}

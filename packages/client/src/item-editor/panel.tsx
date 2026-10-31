import {
  ATTACHMENT_SLOTS,
  FIRE,
  GRENADE_EFFECTS,
  MED_EFFECTS,
  RARITIES,
  VENDOR,
  firesRound,
  fits,
  roundOf,
  idSchema,
  type AttachmentDef,
  type ItemDb,
  type ItemDef,
  type WeaponDef,
} from '@mes/shared';
import { useState, useSyncExternalStore } from 'react';
import { sounds } from '../audio/sounds';
import { itemUses, soundSources } from '../content';
import { Check, N, P, Row, put, type Bound } from '../editor/bound-fields';
import { Text, Toggle } from '../editor/fields';
import { colourOf } from '../ui/raid-screen';
import type { Doc, ItemEditor, ItemEditorState } from './editor';
import { fitPointsToSlot, setSlots } from './model-edit';
import { ModelTab } from './model-panel';
import { ReticleDesigner } from './reticle';
import { BLANK_OPTIC, ITEM_TYPES, type ItemType } from './templates';

/*
 * The item editor's page (session 18): the list of items down the left, the open item's
 * fields, and beside them what it looks like in a grid, what it works out to, what names
 * it, and for optics the reticle designer.
 */

export function ItemEditorPanel({ editor }: { editor: ItemEditor }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [making, setMaking] = useState<'new' | 'copy' | null>(null);
  const [tab, setTab] = useState<'stats' | 'model'>('stats');
  const def = s.items.get(s.current);
  const status = s.message ?? (s.problem ? `Problem: ${s.problem}` : null);
  return (
    <div className="ie">
      {making && (
        <NewItem editor={editor} state={s} copy={making === 'copy'} close={() => setMaking(null)} />
      )}
      <aside className="ie-list">
        <div className="ed-actions">
          <button
            className={s.unsaved.length ? 'ed-save ed-dirty' : 'ed-save'}
            disabled={s.saving}
            onClick={() => void editor.save()}
            title={s.unsaved.length ? `⌘S: ${s.unsaved.join(', ')}` : '⌘S'}
          >
            {s.saving
              ? 'Saving…'
              : s.unsaved.length > 1
                ? `Save ${s.unsaved.length} items`
                : s.unsaved.length
                  ? 'Save'
                  : 'Saved'}
          </button>
          <button onClick={() => editor.undo()} disabled={!s.canUndo} title="⌘Z">
            Undo
          </button>
          <button onClick={() => editor.redo()} disabled={!s.canRedo} title="⇧⌘Z">
            Redo
          </button>
          <button onClick={() => setMaking('new')} title="Make a new item">
            New…
          </button>
          <button onClick={() => setMaking('copy')} disabled={!def} title="Copy this item">
            Copy…
          </button>
        </div>
        <div className="ed-row ie-tabs">
          {(['stats', 'model'] as const).map((t) => (
            <Toggle key={t} on={tab === t} onClick={() => setTab(t)}>
              {t}
            </Toggle>
          ))}
        </div>
        <ItemList state={s} editor={editor} />
        <a className="ie-link" href="/editor">
          Map editor
        </a>
      </aside>
      {!def ? (
        <main />
      ) : tab === 'model' ? (
        <ModelTab editor={editor} state={s} def={def} />
      ) : (
        <ItemPage key={s.current} editor={editor} state={s} def={def} />
      )}
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ?? 'Fields change when you press Enter or leave them. ⌘S saves every changed item.'}
      </div>
    </div>
  );
}

function ItemList({ state: s, editor }: { state: ItemEditorState; editor: ItemEditor }) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const all = [...s.items.values()].filter(
    (d) => !f || d.id.includes(f) || d.name.toLowerCase().includes(f),
  );
  return (
    <>
      <input
        className="ie-filter"
        placeholder="Find an item"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ie-items">
        {ITEM_TYPES.map((type) => {
          const of = all.filter((d) => d.type === type).sort((a, b) => a.id.localeCompare(b.id));
          if (!of.length) return null;
          return (
            <div key={type}>
              <h4>{type}</h4>
              <ul className="ed-list">
                {of.map((d) => (
                  <li
                    key={d.id}
                    className={d.id === s.current ? 'ed-on' : undefined}
                    onClick={() => editor.select(d.id)}
                    title={s.problems.get(d.id) ?? d.id}
                  >
                    <span className="ie-swatch" style={{ background: colourOf(d) }} />
                    {d.name}
                    {s.unsaved.includes(d.id) && <span className="ie-dot"> ●</span>}
                    {s.problems.has(d.id) && <span className="ed-problem"> !</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ItemPage(props: { editor: ItemEditor; state: ItemEditorState; def: ItemDef }) {
  const { editor, state: s, def } = props;
  const doc = def as unknown as Doc;
  const b: Bound = { doc, edit: (change) => editor.edit(change) };
  const problem = s.problems.get(def.id);
  const risks = s.risks.get(def.id);
  const optic = def.type === 'attachment' && def.optic ? def.optic : null;
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form">
        <h3>{def.name}</h3>
        <p className="ed-note">
          content/items/{def.id}.json · {def.type}
        </p>
        <Text label="name" value={def.name} onChange={(v) => b.edit((d) => put(d, ['name'], v))} />
        <h4>in the inventory</h4>
        <Row>
          <N {...b} path={['size', 0]} label="width (cells)" min={1} />
          <N {...b} path={['size', 1]} label="height (cells)" min={1} />
        </Row>
        <N
          {...b}
          path={['value']}
          label="value (money, new)"
          min={0}
          hint="What vendors sell it for; they buy it for a share of this"
        />
        <P {...b} path={['rarity']} label="rarity (its tile's colour)" options={RARITIES} />
        <TypeFields {...b} def={def} items={s.items} />
        <SoundFields {...b} def={def} />
        {problem && <p className="ed-problem">{problem}</p>}
        {risks && (
          <div className="ie-risk">
            <strong>Saved stashes may break:</strong>
            <ul>
              {risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            The server refuses a stash it can&apos;t check, so a player holding one couldn&apos;t
            save until it&apos;s fixed by hand.
          </div>
        )}
      </section>
      <section className="ie-side">
        <SizePreview def={def} />
        {s.db && <Facts def={def} db={s.db} />}
        <UsedBy id={def.id} items={s.db ?? s.items} />
        {optic && (
          <ReticleDesigner
            optic={optic}
            edit={(change, gesture) =>
              editor.edit((d) => change((d as { optic: typeof optic }).optic), gesture)
            }
            gesture={(on) => (on ? editor.beginGesture() : editor.endGesture())}
          />
        )}
      </section>
    </main>
  );
}

function TypeFields(props: Bound & { def: ItemDef; items: ReadonlyMap<string, ItemDef> }) {
  const { def, items, ...b } = props;
  const ofType = (t: ItemType): string[] =>
    [...items.values()].filter((d) => d.type === t).map((d) => d.id);
  switch (def.type) {
    case 'weapon':
      return (
        <>
          <h4>gun</h4>
          <P
            {...b}
            path={['ammo']}
            label="ammo"
            options={[
              ...ofType('ammo'),
              // Not C4: it's placed by hand, never launched.
              ...ofType('grenade').filter((id) => roundOf(items, id)),
            ]}
          />
          {items.get(def.ammo)?.type === 'grenade' && (
            <Row>
              <N
                {...b}
                path={['launchSpeed']}
                label="launch speed (m/s)"
                min={0}
                hint="Grenade launchers: how fast a grenade leaves the barrel"
              />
              <N
                {...b}
                path={['armDistance']}
                label="arms after (m)"
                min={0}
                hint="Goes off on impact once it's flown this far; blank keeps only the fuse"
              />
            </Row>
          )}
          <P
            {...b}
            path={['hold']}
            label="held as"
            options={['rifle', 'pistol']}
            unset="rifle (default)"
          />
          <P {...b} path={['fireMode']} label="fire mode" options={['auto', 'semi']} />
          <Row>
            <N {...b} path={['rpm']} label="rounds a minute" min={0} />
            <N {...b} path={['magazine']} label="magazine" min={1} />
          </Row>
          <Row>
            <N {...b} path={['reloadTime']} label="reload (s)" min={0} />
            <N {...b} path={['aimTime']} label="aim (s)" min={0} />
            <N {...b} path={['drawTime']} label="draw (s)" min={0} />
          </Row>
          <Row>
            <N {...b} path={['range']} label="range (m)" min={0} />
            <N
              {...b}
              path={['loudness']}
              label="heard to (m)"
              min={0}
              hint="How far away enemies hear a shot"
            />
          </Row>
          <h4>accuracy (degrees)</h4>
          <Row>
            <N {...b} path={['hipSpread']} label="hip spread" min={0} />
            <N {...b} path={['aimSpread']} label="aimed spread" min={0} />
          </Row>
          <Row>
            <N {...b} path={['recoil', 'up']} label="kick up" min={0} />
            <N {...b} path={['recoil', 'side']} label="kick sideways" min={0} />
            <N {...b} path={['recoil', 'recovery']} label="settles (°/s)" min={0} />
          </Row>
          <h4>attachment slots</h4>
          <Row>
            {ATTACHMENT_SLOTS.map((slot) => (
              <label key={slot} className="ed-field">
                <input
                  type="checkbox"
                  checked={!!def.slots?.includes(slot)}
                  onChange={(e) =>
                    b.edit((d) => {
                      const was = (d.slots as string[] | undefined) ?? [];
                      setSlots(
                        d,
                        ATTACHMENT_SLOTS.filter((s) =>
                          s === slot ? e.target.checked : was.includes(s),
                        ),
                      );
                    })
                  }
                />
                {slot}
              </label>
            ))}
          </Row>
        </>
      );
    case 'ammo':
      return (
        <>
          <h4>rounds</h4>
          <N {...b} path={['stack']} label="stack (most in one cell)" min={2} />
          <Row>
            <Text
              label="calibre"
              value={def.calibre}
              onChange={(v) => b.edit((d) => put(d, ['calibre'], v))}
            />
            <N
              {...b}
              path={['level']}
              label="level (1–6)"
              min={1}
              hint="Against armour's level: below it does nothing until it breaks, level half, above all"
            />
          </Row>
          <label
            className="ed-field"
            title="A flamethrower's fuel: flames that set alight, no bullet"
          >
            <input
              type="checkbox"
              checked={!!def.flame}
              onChange={(e) =>
                b.edit((d) => {
                  // Fuel does no damage itself: the burning does it.
                  if (e.target.checked) {
                    d.flame = { speed: 18, burnTime: 8, burnDamage: 1.5, fireTime: 7 };
                    d.damage = 0;
                    delete d.pellets;
                    delete d.pelletSpread;
                  } else {
                    delete d.flame;
                    d.damage = 10;
                  }
                })
              }
            />
            flamethrower fuel
          </label>
          {def.flame && (
            <>
              <Row>
                <N {...b} path={['flame', 'speed']} label="flame speed (m/s)" min={0} />
                <N
                  {...b}
                  path={['flame', 'fireTime']}
                  label="burns on the map (s)"
                  min={0}
                  hint="Where it lands; anyone touching it is set alight"
                />
              </Row>
              <Row>
                <N
                  {...b}
                  path={['flame', 'burnDamage']}
                  label="burn damage (/s a zone)"
                  min={0}
                  hint="To every zone, past armour, while alight"
                />
                <N
                  {...b}
                  path={['flame', 'burnTime']}
                  label="burns someone for (s)"
                  min={0}
                  hint={`If they don't put it out, which takes ${FIRE.extinguishTime} s`}
                />
              </Row>
            </>
          )}
          {!def.flame && <N {...b} path={['damage']} label="damage (to the chest)" min={0} />}
          {!def.flame && (
            <label
              className="ed-field"
              title="May set alight whoever it hits, on top of its damage"
            >
              <input
                type="checkbox"
                checked={!!def.incendiary}
                onChange={(e) =>
                  b.edit((d) => {
                    if (e.target.checked)
                      d.incendiary = { chance: 0.25, burnTime: 4, burnDamage: 1.5 };
                    else delete d.incendiary;
                  })
                }
              />
              incendiary
            </label>
          )}
          {def.incendiary && (
            <Row>
              <N
                {...b}
                path={['incendiary', 'chance']}
                label="sets alight (0–1 a hit)"
                min={0}
                hint="Each pellet's own chance, for shells"
              />
              <N {...b} path={['incendiary', 'burnTime']} label="burns for (s)" min={0} />
              <N
                {...b}
                path={['incendiary', 'burnDamage']}
                label="burn damage (/s a zone)"
                min={0}
              />
            </Row>
          )}
          <Row>
            <N
              {...b}
              path={['armourDamage']}
              label="armour damage"
              min={0}
              hint="Durability lost per hit, less against armour above its level"
            />
            <N {...b} path={['bleedChance']} label="bleed chance (0–1)" min={0} />
          </Row>
          <Row>
            <N
              {...b}
              path={['pellets']}
              label="pellets (1)"
              min={2}
              hint="Shotgun shells: pellets a round fires, each doing the damage; blank is 1"
            />
            <N
              {...b}
              path={['pelletSpread']}
              label="pellet spread (°)"
              min={0}
              hint="With pellets: the most each strays from the shot's line"
            />
          </Row>
        </>
      );
    case 'armour':
      return (
        <>
          <h4>armour</h4>
          <P {...b} path={['slot']} label="worn as" options={['helmet', 'body']} />
          <Row>
            <N {...b} path={['level']} label="level (1–6)" min={1} />
            <N {...b} path={['durability']} label="durability" min={0} />
          </Row>
        </>
      );
    case 'attachment':
      return <AttachmentFields {...b} def={def} weapons={ofType('weapon')} items={items} />;
    case 'med':
      return (
        <>
          <h4>med</h4>
          <P
            {...b}
            path={['effect']}
            label="does"
            options={MED_EFFECTS}
            then={(d, v) => {
              if (v === 'heal') {
                put(d, ['uses'], undefined);
                if (d.hp === undefined) put(d, ['hp'], 100);
              } else put(d, ['hp'], undefined);
            }}
          />
          <p className="ed-note">{MED_NOTES[def.effect]}</p>
          <Row>
            <N {...b} path={['useTime']} label="use time (s)" min={0} />
            {def.effect === 'heal' ? (
              <N {...b} path={['hp']} label="HP in all" min={0} />
            ) : (
              <N {...b} path={['uses']} label="uses (1)" min={1} hint="Blank is 1" />
            )}
          </Row>
        </>
      );
    case 'container':
      return (
        <>
          <h4>rig or backpack</h4>
          <P {...b} path={['slot']} label="worn as" options={['rig', 'backpack']} />
          <Row>
            <N {...b} path={['grid', 0]} label="inside width" min={1} />
            <N {...b} path={['grid', 1]} label="inside height" min={1} />
          </Row>
        </>
      );
    case 'melee':
      return (
        <>
          <h4>knife</h4>
          <Row>
            <N {...b} path={['damage']} label="damage" min={0} />
            <N {...b} path={['level']} label="level (1–6)" min={1} />
          </Row>
          <Row>
            <N {...b} path={['armourDamage']} label="armour damage" min={0} />
            <N {...b} path={['bleedChance']} label="bleed chance" min={0} />
          </Row>
          <Row>
            <N {...b} path={['swingTime']} label="swing (s)" min={0} />
            <N {...b} path={['reach']} label="reach (m)" min={0} />
            <N {...b} path={['drawTime']} label="draw (s)" min={0} />
          </Row>
          {def.id !== 'knife' && (
            <p className="ed-note">Players always carry the item called knife; this one is loot.</p>
          )}
        </>
      );
    case 'grenade':
      return (
        <>
          <h4>grenade</h4>
          <P
            {...b}
            path={['effect']}
            label="effect"
            options={[...GRENADE_EFFECTS]}
            unset="frag (default)"
            then={(d, v) => {
              // Each effect's own field, there only for it.
              if (v === 'flash') d.blindTime ??= 5;
              else delete d.blindTime;
              if (v === 'smoke') d.smokeTime ??= 25;
              else delete d.smokeTime;
              if (v === 'molotov') d.fire ??= { burnTime: 8, burnDamage: 1.5, fireTime: 7 };
              else delete d.fire;
            }}
          />
          {def.effect === 'flash' && (
            <N
              {...b}
              path={['blindTime']}
              label="blinds for (s)"
              min={0}
              hint="Looking at it, close; less further out"
            />
          )}
          {def.effect === 'smoke' && (
            <N {...b} path={['smokeTime']} label="cloud lasts (s)" min={0} />
          )}
          {def.effect === 'molotov' && (
            <Row>
              <N
                {...b}
                path={['fire', 'fireTime']}
                label="fire burns (s)"
                min={0}
                hint="Spilled across its radius where it breaks"
              />
              <N {...b} path={['fire', 'burnTime']} label="burns someone for (s)" min={0} />
              <N {...b} path={['fire', 'burnDamage']} label="burn damage (/s a zone)" min={0} />
            </Row>
          )}
          <Row>
            <N {...b} path={['damage']} label="damage at the centre" min={0} />
            <N {...b} path={['level']} label="level (1–6)" min={1} />
          </Row>
          <Row>
            <N {...b} path={['armourDamage']} label="armour damage" min={0} />
            <N {...b} path={['bleedChance']} label="bleed chance" min={0} />
          </Row>
          <Row>
            <N {...b} path={['radius']} label="radius (m)" min={0} />
            <N
              {...b}
              path={['fuse']}
              label="fuse (s)"
              min={0}
              hint="From the throw; for C4, from the detonator"
            />
          </Row>
          <Row>
            <N {...b} path={['throwSpeed']} label="throw speed (m/s)" min={0} />
            <N {...b} path={['loudness']} label="heard from (m)" min={0} />
          </Row>
        </>
      );
    case 'key':
      return (
        <>
          <h4>key</h4>
          <N
            {...b}
            path={['uses']}
            label="uses (blank: never wears out)"
            min={1}
            hint="Unlocks this many times, then it's gone"
          />
        </>
      );
    case 'loot':
      return (
        <>
          <h4>loot</h4>
          <N {...b} path={['stack']} label="stack (blank: doesn't stack)" min={2} />
          <Check {...b} path={['money']} label="money: deposited at full value" />
        </>
      );
    case 'repair':
      return (
        <>
          <h4>repair kit</h4>
          <Row>
            <N {...b} path={['points']} label="durability in all" min={0} />
            <N {...b} path={['useTime']} label="use time (s)" min={0} />
          </Row>
        </>
      );
    case 'quest':
      return (
        <p className="ed-note">A quest item has nothing more: its quest says where it lies.</p>
      );
  }
}

const SOUND_USES: Record<string, string> = {
  shot: 'shot',
  suppressed: 'shot, suppressed',
  reload: 'reload',
  swing: 'swing',
  use: 'using it',
  throw: 'throw',
  bounce: 'bounce',
  explode: 'going off',
};

/** The sound files it plays (session 19), each with a button to hear it and a link to tune it. */
function SoundFields(props: Bound & { def: ItemDef }) {
  const { def, ...b } = props;
  if (!('sounds' in def)) return null;
  const ids = [...soundSources().keys()];
  return (
    <>
      <h4>sounds</h4>
      {Object.entries(def.sounds).map(([use, id]) => (
        <Row key={use}>
          <P {...b} path={['sounds', use]} label={SOUND_USES[use] ?? use} options={ids} />
          <button onClick={() => sounds().play(id)} title="Play it">
            ▶
          </button>
          <a className="ie-link" href={`/sounds?sound=${id}`} target="sounds">
            tune
          </a>
        </Row>
      ))}
    </>
  );
}

const MED_NOTES: Record<(typeof MED_EFFECTS)[number], string> = {
  bandage: 'Stops one zone bleeding per use.',
  splint: "Takes away a broken limb's effects (it stays at 0 HP).",
  surgery: 'Brings a broken limb back to 1 HP.',
  heal: "Restores HP to limbs that aren't broken, from its pool.",
};

const MODS: [key: string, label: string, hint: string][] = [
  ['spread', 'spread ×', 'Hip and aimed spread'],
  ['recoil', 'recoil ×', 'Kick up and sideways'],
  ['aimTime', 'aim time ×', ''],
  ['reloadTime', 'reload ×', ''],
  ['loudness', 'loudness ×', 'Below 1 is quieter'],
];

function AttachmentFields(
  props: Bound & { def: AttachmentDef; weapons: string[]; items: ReadonlyMap<string, ItemDef> },
) {
  const { def, weapons, items, ...b } = props;
  const withSlot = weapons.filter((w) => {
    const g = items.get(w);
    return g?.type === 'weapon' && g.slots?.includes(def.slot);
  });
  const listed = def.weapons ?? [];
  return (
    <>
      <h4>attachment</h4>
      <P
        {...b}
        path={['slot']}
        label="slot"
        options={ATTACHMENT_SLOTS}
        then={(d, v) => {
          if (v === 'optic' && d.optic === undefined)
            put(d, ['optic'], structuredClone(BLANK_OPTIC));
          if (v !== 'optic') put(d, ['optic'], undefined);
          fitPointsToSlot(d);
        }}
      />
      <h4>fits</h4>
      <p className="ed-note">
        {listed.length ? 'Only the guns ticked.' : `Every gun with a ${def.slot} slot.`}
      </p>
      <Row>
        {[...new Set([...withSlot, ...listed])].map((w) => (
          <label key={w} className="ed-field">
            <input
              type="checkbox"
              checked={listed.includes(w)}
              onChange={(e) =>
                b.edit((d) => {
                  const next = weapons.filter((x) =>
                    x === w ? e.target.checked : listed.includes(x),
                  );
                  put(d, ['weapons'], next.length ? next : undefined);
                })
              }
            />
            {w}
          </label>
        ))}
      </Row>
      <h4>changes to the gun (blank: none)</h4>
      <Row>
        {MODS.slice(0, 3).map(([k, label, hint]) => (
          <N key={k} {...b} path={['mods', k]} label={label} min={0} hint={hint} />
        ))}
      </Row>
      <Row>
        {MODS.slice(3).map(([k, label, hint]) => (
          <N key={k} {...b} path={['mods', k]} label={label} min={0} hint={hint} />
        ))}
        <N {...b} path={['mods', 'magazine']} label="extra rounds" min={1} />
      </Row>
      {def.optic && (
        <>
          <h4>optic</h4>
          <N
            {...b}
            path={['optic', 'zoom']}
            label="zoom (1: red dot, above: scope)"
            min={1}
            hint="A scope zooms the whole screen behind a mask"
          />
        </>
      )}
    </>
  );
}

/** The item at its grid size, and a rig's or backpack's grid inside. */
function SizePreview({ def }: { def: ItemDef }) {
  const [w, h] = def.size;
  return (
    <div className="ie-card">
      <h4>
        {w}×{h} in the inventory
        {def.type === 'container' && ` · ${def.grid[0]}×${def.grid[1]} inside`}
      </h4>
      <div className="ie-sizes">
        <Cells w={w} h={h} colour={colourOf(def)} label={def.name} />
        {def.type === 'container' && <Cells w={def.grid[0]} h={def.grid[1]} colour="" label="" />}
      </div>
    </div>
  );
}

function Cells(props: { w: number; h: number; colour: string; label: string }) {
  const { w, h } = props;
  if (!(w >= 1 && h >= 1 && w <= 20 && h <= 20)) return null;
  return (
    <div
      className="ie-cells"
      style={{ gridTemplateColumns: `repeat(${w}, 26px)`, gridTemplateRows: `repeat(${h}, 26px)` }}
    >
      {props.colour ? (
        <div
          className="ie-tile"
          style={{ background: props.colour, gridArea: `1 / 1 / ${h + 1} / ${w + 1}` }}
        >
          {props.label}
        </div>
      ) : (
        Array.from({ length: w * h }, (_, i) => <div key={i} className="ie-cell" />)
      )}
    </div>
  );
}

const fmt = (n: number, places = 2): string => String(Number(n.toFixed(places)));

/** What an item's numbers work out to, for balancing. */
function Facts({ def, db }: { def: ItemDef; db: ItemDb }) {
  const lines: string[] = [];
  const money = def.type === 'loot' && def.money;
  if (money) lines.push(`Each is deposited as ${def.value} money.`);
  else if (def.value > 0)
    lines.push(
      `Vendors sell it for ${def.value} and buy it new for ${Math.floor(def.value * VENDOR.sellShare)}.`,
    );
  else lines.push("Worth nothing: it can't be bought or sold.");
  switch (def.type) {
    case 'weapon': {
      const ammo = db.get(def.ammo);
      const gap = 60 / def.rpm;
      lines.push(
        `A shot every ${fmt(gap, 3)} s; a full magazine lasts ${fmt(def.magazine * gap)} s.`,
      );
      if (ammo?.type === 'ammo' && ammo.flame) {
        const f = ammo.flame;
        lines.push(
          `With ${ammo.name}: a flame every ${fmt(gap, 3)} s, landing ${fmt(def.range / f.speed, 2)} s out at its range. Someone set alight loses ${fmt(f.burnDamage * 6 * f.burnTime, 0)} HP if they let it burn out, ${fmt(f.burnDamage * 6 * FIRE.extinguishTime, 0)} if they put it out at once.`,
        );
      } else if (ammo?.type === 'ammo') {
        // Every pellet landing.
        const round = ammo.damage * (ammo.pellets ?? 1);
        lines.push(
          `With ${ammo.name}: ${fmt(round * (def.rpm / 60), 0)} damage a second to an unarmoured chest, ${fmt(round * def.magazine, 0)} a magazine.`,
        );
      }
      break;
    }
    case 'attachment':
      for (const g of db.values()) {
        if (g.type !== 'weapon' || !fits(g, def)) continue;
        const changes = gunChanges(g, def);
        lines.push(`On ${g.name}: ${changes.length ? changes.join(', ') : 'no stat changes'}.`);
      }
      break;
    case 'container': {
      const inside = def.grid[0] * def.grid[1];
      const outside = def.size[0] * def.size[1];
      lines.push(`Holds ${inside} cells for the ${outside} it takes up: ${inside - outside} more.`);
      break;
    }
    case 'ammo': {
      lines.push(`A full stack of ${def.stack} is worth ${def.stack * def.value}.`);
      const guns = [...db.values()].filter((g) => g.type === 'weapon' && firesRound(db, g, def.id));
      lines.push(
        guns.length ? `Fired by ${guns.map((g) => g.name).join(', ')}.` : 'No gun fires it.',
      );
      break;
    }
    case 'med':
      if (def.effect === 'heal') lines.push(`${fmt(def.hp! / def.useTime, 1)} HP a second of use.`);
      break;
    case 'armour':
      lines.push(`${fmt(def.value / def.durability, 0)} money a point of durability.`);
      break;
  }
  return (
    <div className="ie-card">
      <h4>works out to</h4>
      {lines.map((l) => (
        <p key={l} className="ed-note">
          {l}
        </p>
      ))}
    </div>
  );
}

/** How an attachment changes one gun's stats, as "reload 2.4 → 2.76 s". */
function gunChanges(g: WeaponDef, a: AttachmentDef): string[] {
  const m = a.mods ?? {};
  const out: string[] = [];
  const show = (label: string, from: number, by: number | undefined, unit = ''): void => {
    if (by !== undefined && by !== 1) out.push(`${label} ${fmt(from)} → ${fmt(from * by)}${unit}`);
  };
  if (m.magazine) out.push(`magazine ${g.magazine} → ${g.magazine + m.magazine}`);
  show('aimed spread', g.aimSpread, m.spread, '°');
  show('kick', g.recoil.up, m.recoil, '°');
  show('aim', g.aimTime, m.aimTime, ' s');
  show('reload', g.reloadTime, m.reloadTime, ' s');
  show('heard to', g.loudness, m.loudness, ' m');
  return out;
}

function UsedBy({ id, items }: { id: string; items: ReadonlyMap<string, ItemDef> }) {
  const uses = itemUses(id, items);
  return (
    <div className="ie-card">
      <h4>named by</h4>
      {uses.length ? (
        <p className="ed-note">{uses.join(' · ')}</p>
      ) : (
        <p className="ed-note">Nothing names it yet: it won&apos;t turn up in the game.</p>
      )}
    </div>
  );
}

/** The form for a new item, blank of a type or a copy of the open one. */
function NewItem(props: {
  editor: ItemEditor;
  state: ItemEditorState;
  copy: boolean;
  close: () => void;
}) {
  const { state: s, copy } = props;
  const from = s.items.get(s.current);
  const [type, setType] = useState<ItemType>(from?.type ?? 'loot');
  const [id, setId] = useState(copy && from ? `${from.id}-2` : '');
  const [name, setName] = useState(copy && from ? `${from.name} 2` : '');
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : s.items.has(id)
        ? 'that item exists'
        : null;
  const make = (): void => {
    if (idProblem || !name.trim()) return;
    props.editor.create(type, id, name.trim(), copy ? s.current : undefined);
    props.close();
  };
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>{copy ? `copy ${from?.name}` : 'new item'}</h3>
        {!copy && (
          <label className="ed-field">
            type
            <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
              {ITEM_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label className="ed-field">
          id
          <input value={id} autoFocus onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="ed-field">
          name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        <p className="ed-note">
          The id is the file name, content/items/&lt;id&gt;.json, and can&apos;t change later.
        </p>
        {id && idProblem && <p className="ed-problem">{idProblem}</p>}
        <div className="ed-row">
          <button onClick={make} disabled={!!idProblem || !name.trim()}>
            Make
          </button>
          <button onClick={props.close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

import {
  FILTERS,
  NOISE_COLOURS,
  WAVES,
  idSchema,
  soundLength,
  type SoundDef,
  type SoundLayer,
} from '@mes/shared';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GAME_SOUNDS } from '../audio/sound-ids';
import { SoundPlayer } from '../audio/sounds';
import { SPATIAL, place, type Placement } from '../audio/spatial';
import { renderSound } from '../audio/synth';
import { soundUses } from '../content';
import { P, Row, get, put, type Bound, type Doc, type Path } from '../editor/bound-fields';
import { Num, Text, Toggle } from '../editor/fields';
import type { SoundEditor, SoundEditorState } from './editor';

/*
 * The sound editor's page (session 19): the sounds down the left, the open one's layers
 * with a slider for each value, and beside them its waveform, where to hear it from (near
 * or far, which side, behind a wall), and what plays it.
 */

const DIRECTIONS = ['ahead', 'right', 'behind', 'left'] as const;
type Direction = (typeof DIRECTIONS)[number];

/**
 * Plays the open sound as edited, as the raid would: centred, or from a distance and
 * direction, through a wall. Its own player, so the game's sounds aren't touched.
 */
export class Audition {
  private readonly player = new SoundPlayer(new Map());
  private loaded = '';
  /** 0 plays it centred, as your own sounds are. */
  distance = 0;
  direction: Direction = 'ahead';
  wall = false;
  /** Plays each change as it's made. */
  auto = true;

  play(def: SoundDef): void {
    const json = JSON.stringify(def);
    if (json !== this.loaded) {
      this.player.setSounds(new Map([[def.id, def]]));
      this.loaded = json;
    }
    if (this.distance === 0) return this.player.play(def.id);
    const [x, z] = this.offset();
    this.player.playAt(def.id, x, 0, z, { range: def.range, occluded: this.wall });
  }

  /** How it would be placed, for the readout; false when out of range. */
  placement(def: SoundDef, out: Placement): boolean {
    if (this.distance === 0) {
      out.gain = 1;
      out.pan = 0;
      out.cutoff = SPATIAL.open;
      return true;
    }
    const [x, z] = this.offset();
    return place(out, this.player.listener, x, 0, z, def.range, this.wall);
  }

  private offset(): [number, number] {
    const d = this.distance;
    return { ahead: [0, -d], right: [d, 0], behind: [0, d], left: [-d, 0] }[this.direction] as [
      number,
      number,
    ];
  }
}

export function SoundEditorPanel({
  editor,
  audition,
}: {
  editor: SoundEditor;
  audition: Audition;
}) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const [making, setMaking] = useState<'new' | 'copy' | null>(null);
  const def = s.sounds.get(s.current);
  const status = s.message ?? (s.problem ? `Problem: ${s.problem}` : null);
  return (
    <div className="ie">
      {making && (
        <NewSound
          editor={editor}
          state={s}
          copy={making === 'copy'}
          close={() => setMaking(null)}
        />
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
                ? `Save ${s.unsaved.length} sounds`
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
          <button onClick={() => setMaking('new')} title="Make a new sound">
            New…
          </button>
          <button onClick={() => setMaking('copy')} disabled={!def} title="Copy this sound">
            Copy…
          </button>
        </div>
        <SoundList state={s} editor={editor} />
        <a className="ie-link" href="/item-editor">
          Item editor
        </a>
      </aside>
      {def ? (
        <SoundPage key={s.current} editor={editor} state={s} def={def} audition={audition} />
      ) : (
        <main />
      )}
      <div className={s.problem && !s.message ? 'ed-status ed-problem' : 'ed-status'}>
        {status ??
          'Space plays the sound. Fields change when you press Enter or leave them; a slider plays it when let go. ⌘S saves.'}
      </div>
    </div>
  );
}

/** The sounds by who plays them: items, the game, or nothing yet. */
function SoundList({ state: s, editor }: { state: SoundEditorState; editor: SoundEditor }) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const game = new Set<string>(Object.values(GAME_SOUNDS));
  const groups: [string, (id: string) => boolean][] = [
    ['the game', (id) => game.has(id)],
    ['items', (id) => !game.has(id) && soundUses(id).length > 0],
    ['nothing yet', (id) => !game.has(id) && soundUses(id).length === 0],
  ];
  const all = [...s.sounds.values()]
    .filter((d) => !f || d.id.includes(f) || d.name.toLowerCase().includes(f))
    .sort((a, b) => a.id.localeCompare(b.id));
  return (
    <>
      <input
        className="ie-filter"
        placeholder="Find a sound"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="ie-items">
        {groups.map(([title, test]) => {
          const of = all.filter((d) => test(d.id));
          if (!of.length) return null;
          return (
            <div key={title}>
              <h4>played by {title}</h4>
              <ul className="ed-list">
                {of.map((d) => (
                  <li
                    key={d.id}
                    className={d.id === s.current ? 'ed-on' : undefined}
                    onClick={() => editor.select(d.id)}
                    title={s.problems.get(d.id) ?? d.id}
                  >
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

function SoundPage(props: {
  editor: SoundEditor;
  state: SoundEditorState;
  def: SoundDef;
  audition: Audition;
}) {
  const { editor, state: s, def, audition } = props;
  const doc = def as unknown as Doc;
  const valid = !s.problems.has(def.id);
  const play = (): void => {
    if (valid) audition.play(def);
  };
  // Each change plays, unless it's a slider still moving (that plays when let go).
  const dragging = useRef(false);
  const json = JSON.stringify(def);
  const last = useRef(json);
  useEffect(() => {
    if (json === last.current) return;
    last.current = json;
    if (audition.auto && !dragging.current && valid) audition.play(def);
  }, [json, valid, def, audition]);
  const b: Bound = { doc, edit: (change) => editor.edit(change) };
  const slide: Slide = {
    ...b,
    drag: (change) => editor.edit(change, true),
    begin: () => {
      dragging.current = true;
      editor.beginGesture();
    },
    end: () => {
      dragging.current = false;
      editor.endGesture();
      if (audition.auto) play();
    },
  };
  const gun = soundUses(def.id).some((u) => /shot/.test(u));
  return (
    <main className="ie-main">
      <section className="ed-inspector ie-form se-form">
        <h3>{def.name}</h3>
        <p className="ed-note">content/sounds/{def.id}.json</p>
        <Text label="name" value={def.name} onChange={(v) => b.edit((d) => put(d, ['name'], v))} />
        <Row>
          <Knob {...slide} path={['gain']} label="loudness" min={0} max={2} />
          <Knob {...slide} path={['range']} label="heard to (m)" min={1} max={200} log />
          <Knob {...slide} path={['pitchJitter']} label="pitch varies ±" min={0} max={0.3} />
        </Row>
        {gun && (
          <p className="ed-note">
            A shot is heard as far as its gun&apos;s loudness, not this range.
          </p>
        )}
        {def.layers.map((l, i) => (
          <LayerCard
            key={i}
            slide={slide}
            layer={l}
            i={i}
            count={def.layers.length}
            solo={() => valid && audition.play({ ...def, layers: [l] })}
          />
        ))}
        <Row>
          <button onClick={() => b.edit((d) => (d.layers as unknown[]).push(NEW_LAYER.noise))}>
            + noise
          </button>
          <button onClick={() => b.edit((d) => (d.layers as unknown[]).push(NEW_LAYER.tone))}>
            + tone
          </button>
        </Row>
        {s.problems.get(def.id) && <p className="ed-problem">{s.problems.get(def.id)}</p>}
      </section>
      <section className="ie-side">
        <Listen def={def} audition={audition} play={play} valid={valid} />
        {valid && <Waveform def={def} />}
        <div className="ie-card">
          <h4>played by</h4>
          {soundUses(def.id).map((u) => (
            <p key={u} className="ed-note">
              {u}
            </p>
          ))}
          {!soundUses(def.id).length && <p className="ed-note">Nothing yet.</p>}
        </div>
      </section>
    </main>
  );
}

const NEW_LAYER: Record<'noise' | 'tone', SoundLayer> = {
  noise: { source: 'noise', colour: 'white', at: 0, attack: 0.001, hold: 0, decay: 0.1, gain: 0.5 },
  tone: {
    source: 'tone',
    wave: 'sine',
    freq: [440, 440],
    at: 0,
    attack: 0.001,
    hold: 0,
    decay: 0.2,
    gain: 0.3,
  },
};

function LayerCard(props: {
  slide: Slide;
  layer: SoundLayer;
  i: number;
  count: number;
  solo: () => void;
}) {
  const { slide: b, layer: l, i } = props;
  const at = (...rest: (string | number)[]): Path => ['layers', i, ...rest];
  const layers = (d: Doc) => d.layers as Doc[];
  return (
    <div className="se-layer">
      <Row>
        <P
          {...b}
          path={at('source')}
          label={`layer ${i + 1}`}
          options={['noise', 'tone']}
          then={(d, v) => {
            const layer = layers(d)[i]!;
            if (v === 'tone') {
              delete layer.colour;
              layer.wave ??= 'sine';
              layer.freq ??= [440, 440];
            } else {
              delete layer.wave;
              delete layer.freq;
              layer.colour ??= 'white';
            }
          }}
        />
        {l.source === 'noise' ? (
          <P {...b} path={at('colour')} label="colour" options={NOISE_COLOURS} unset="white" />
        ) : (
          <P {...b} path={at('wave')} label="wave" options={WAVES} unset="sine" />
        )}
        <button onClick={props.solo} title="Play this layer alone">
          ▶ alone
        </button>
        <button
          onClick={() => b.edit((d) => layers(d).splice(i + 1, 0, structuredClone(layers(d)[i]!)))}
          title="Copy this layer"
        >
          copy
        </button>
        <button
          disabled={props.count < 2}
          onClick={() => b.edit((d) => layers(d).splice(i, 1))}
          title="Remove this layer"
        >
          ✕
        </button>
      </Row>
      {l.source === 'tone' && (
        <Row>
          <Knob {...b} path={at('freq', 0)} label="pitch from (Hz)" min={20} max={8000} log />
          <Knob {...b} path={at('freq', 1)} label="to (Hz)" min={20} max={8000} log />
        </Row>
      )}
      <Row>
        <Knob {...b} path={at('at')} label="starts (s)" min={0} max={2} />
        <Knob {...b} path={at('attack')} label="rises (s)" min={0} max={0.5} />
        <Knob {...b} path={at('hold')} label="holds (s)" min={0} max={1} />
        <Knob {...b} path={at('decay')} label="falls (s)" min={0} max={2} />
      </Row>
      <Row>
        <Knob {...b} path={at('curve')} label="fall curve (1)" min={0.1} max={10} log blank={1} />
        <Knob {...b} path={at('gain')} label="loudness" min={0} max={2} />
        <Knob {...b} path={at('drive')} label="crunch" min={0} max={1} blank={0} />
      </Row>
      <Row>
        <P
          {...b}
          path={at('filter', 'type')}
          label="filter"
          options={FILTERS}
          unset="none"
          then={(d, v) => {
            const layer = layers(d)[i]!;
            if (!v) delete layer.filter;
            else layer.filter = { freq: [1000, 1000], q: 0.7, ...(layer.filter as Doc), type: v };
          }}
        />
        {l.filter && (
          <>
            <Knob
              {...b}
              path={at('filter', 'freq', 0)}
              label="from (Hz)"
              min={20}
              max={20000}
              log
            />
            <Knob {...b} path={at('filter', 'freq', 1)} label="to (Hz)" min={20} max={20000} log />
            <Knob {...b} path={at('filter', 'q')} label="resonance" min={0.1} max={30} log />
          </>
        )}
      </Row>
      {(l.filter || l.source === 'tone') && (
        <Knob
          {...b}
          path={at('sweep')}
          label="glide takes (s; blank: the whole layer)"
          min={0}
          max={2}
          blank={l.attack + l.hold + l.decay}
        />
      )}
    </div>
  );
}

/** A bound field that can also be dragged, as one undo step, and plays when let go. */
interface Slide extends Bound {
  drag: (change: (doc: Doc) => void) => void;
  begin: () => void;
  end: () => void;
}

/** Steps on a slider; a log slider moves by ratio, for hertz and the like. */
const STEPS = 200;

function Knob(
  props: Slide & {
    path: Path;
    label: string;
    min: number;
    max: number;
    log?: boolean;
    /** Where the slider sits while the field is left out: what it defaults to. */
    blank?: number;
  },
) {
  const { min, max, log } = props;
  const v = get(props.doc, props.path);
  const value = typeof v === 'number' ? v : undefined;
  const toStep = (x: number): number =>
    Math.round((log ? Math.log(x / min) / Math.log(max / min) : (x - min) / (max - min)) * STEPS);
  const fromStep = (n: number): number => {
    const t = n / STEPS;
    const x = log ? min * Math.pow(max / min, t) : min + (max - min) * t;
    // Three significant figures: enough to hear, and short in the file.
    return Number(x.toPrecision(3));
  };
  return (
    <span className="se-knob">
      <Num
        label={props.label}
        value={value}
        min={min}
        onChange={(n) => props.edit((d) => put(d, props.path, n))}
      />
      <input
        type="range"
        min={0}
        max={STEPS}
        value={toStep(Math.min(max, Math.max(min, value ?? props.blank ?? min)))}
        onPointerDown={props.begin}
        onPointerUp={props.end}
        onChange={(e) => props.drag((d) => put(d, props.path, fromStep(Number(e.target.value))))}
      />
    </span>
  );
}

/** Where to hear it from, and what that does to it. */
function Listen(props: { def: SoundDef; audition: Audition; play: () => void; valid: boolean }) {
  const { def, audition: a } = props;
  // The audition's settings live outside React, so a change re-renders through this.
  const [, redraw] = useState(0);
  const change = (patch: Partial<Pick<Audition, 'distance' | 'direction' | 'wall' | 'auto'>>) => {
    Object.assign(a, patch);
    redraw((n) => n + 1);
  };
  const at: Placement = { gain: 0, pan: 0, cutoff: 0 };
  const heard = a.placement(def, at);
  const db = 20 * Math.log10(Math.max(at.gain, 1e-6));
  return (
    <div className="ie-card">
      <h4>listen</h4>
      <Row>
        <button onClick={props.play} disabled={!props.valid} title="Space">
          ▶ Play
        </button>
        <Toggle on={a.auto} onClick={() => change({ auto: !a.auto })} title="Play each change">
          play changes
        </Toggle>
      </Row>
      <label className="ed-field se-range">
        from {a.distance === 0 ? 'your own hands' : `${a.distance} m`}
        <input
          type="range"
          min={0}
          max={Math.max(10, Math.round(def.range))}
          value={a.distance}
          onChange={(e) => change({ distance: Number(e.target.value) })}
        />
      </label>
      {a.distance > 0 && (
        <Row>
          {DIRECTIONS.map((d) => (
            <Toggle key={d} on={a.direction === d} onClick={() => change({ direction: d })}>
              {d}
            </Toggle>
          ))}
          <Toggle on={a.wall} onClick={() => change({ wall: !a.wall })}>
            behind a wall
          </Toggle>
        </Row>
      )}
      <p className="ed-note">
        {!heard
          ? 'Out of range: not heard.'
          : `${db.toFixed(0)} dB` +
            (at.pan ? `, ${at.pan > 0 ? 'right' : 'left'} ${Math.abs(at.pan).toFixed(1)}` : '') +
            (at.cutoff < SPATIAL.open
              ? `, muffled above ${(at.cutoff / 1000).toFixed(1)} kHz`
              : '')}
      </p>
    </div>
  );
}

const WIDTH = 520;
const HEIGHT = 120;

/** The sound as drawn: the loudest and quietest sample in each column. */
function Waveform({ def }: { def: SoundDef }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const rendered = useMemo(() => renderSound(def, 22050), [def]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const { samples } = rendered;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#2a3038';
    ctx.fillRect(0, HEIGHT / 2, WIDTH, 1);
    ctx.fillStyle = '#7fb3e0';
    const per = samples.length / WIDTH;
    for (let x = 0; x < WIDTH; x++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(samples.length, Math.ceil((x + 1) * per));
      for (let i = Math.floor(x * per); i < end; i++) {
        lo = Math.min(lo, samples[i]!);
        hi = Math.max(hi, samples[i]!);
      }
      const top = ((1 - hi) * HEIGHT) / 2;
      ctx.fillRect(x, top, 1, Math.max(1, ((hi - lo) * HEIGHT) / 2));
    }
  }, [rendered]);
  const { peak } = rendered;
  return (
    <div className="ie-card">
      <h4>waveform</h4>
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="se-wave" />
      <p className="ed-note">
        {soundLength(def).toFixed(2)} s · peak {peak.toFixed(2)}
        {peak > 1 && <span className="ed-problem"> · too loud: turned down to fit</span>}
      </p>
    </div>
  );
}

function NewSound(props: {
  editor: SoundEditor;
  state: SoundEditorState;
  copy: boolean;
  close: () => void;
}) {
  const { state: s, copy } = props;
  const from = s.sounds.get(s.current);
  const [id, setId] = useState(copy && from ? `${from.id}-2` : '');
  const [name, setName] = useState(copy && from ? `${from.name} 2` : '');
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : s.sounds.has(id)
        ? 'that sound exists'
        : null;
  const make = (): void => {
    if (idProblem || !name.trim()) return;
    props.editor.create(id, name.trim(), copy ? s.current : undefined);
    props.close();
  };
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>{copy ? `copy ${from?.name}` : 'new sound'}</h3>
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
          The id is the file name, content/sounds/&lt;id&gt;.json. Items pick their sounds in the
          item editor.
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

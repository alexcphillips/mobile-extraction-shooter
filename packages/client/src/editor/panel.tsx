import { idSchema, nodeSchema, type MapFile, type MapNode, type PrefabFile } from '@mes/shared';

type WallGap = Extract<MapNode, { type: 'wall' }>['openings'][number];
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { loadEnemies, loadItems, loadLootContainers, loadLootTables, loadQuests } from '../content';
import { ContainerLootFields } from './loot-mix';
import {
  canEnter,
  canTurn,
  countPlacements,
  markerPath,
  nodeAt,
  nodeLabel,
  nodePos,
  nodeYaw,
  nodesAt,
  patrolPoint,
  placeNode,
  round,
  setPatrolStop,
} from './doc';
import {
  ANGLE_SNAPS,
  BRUSH_RADII,
  CAMERA_START,
  GRID_SNAPS,
  MARKERS,
  PLACEABLE,
  QUICK,
  type EditorState,
  type MapEditor,
  type MarkerKind,
} from './editor';
import { HexColour, Num, Pick, Text, Toggle, UNSET } from './fields';
import { BRUSH_MODES, SIDES, isAreaMode } from './terrain';
import { PrefabBrowser } from './prefab-browser';
import { CURVE_MODES, CURVE_NAMES, type CurveSettings } from './curves';
import { WALL_MODES } from './walls';

/*
 * The map editor's panels (session 15): the toolbar along the top, the list of nodes in
 * the group or prefab being edited and the selected node's fields on the right (the map's
 * or prefab's own settings when nothing is selected), overlaps, and the status line.
 */

const STRENGTHS = [0.25, 0.5, 1, 2, 4];
const EXTEND_METRES = [8, 16, 32, 64, 128];

export function EditorPanel({ editor, maps }: { editor: MapEditor; maps: readonly string[] }) {
  const s = useSyncExternalStore(editor.subscribe, editor.getState);
  const prefabs = editor.prefabs;
  const nodes = nodesAt(s.map, s.scope, prefabs);
  const active = s.selected.length ? nodes[s.selected[s.selected.length - 1]!] : undefined;
  const inPrefab = editor.scopePrefab();
  const atPrefab = nodeAt(s.map, s.scope, prefabs)?.type === 'prefab';
  const [making, setMaking] = useState(false);
  const [makingPrefab, setMakingPrefab] = useState(false);
  const [start, setStart] = useState('');
  const overlaps = [
    ...s.overlaps.buildings.map((p) => ({ pair: p, building: true })),
    ...s.overlaps.props.map((p) => ({ pair: p, building: false })),
  ];

  return (
    <>
      {making && <NewMap editor={editor} maps={maps} close={() => setMaking(false)} />}
      {makingPrefab && <NewPrefab editor={editor} close={() => setMakingPrefab(false)} />}
      {s.browsing && (
        <PrefabBrowser editor={editor} state={s} close={() => editor.setBrowsing(false)} />
      )}
      <div className="ed-bar">
        <select
          value={s.map.id}
          title="Map"
          onChange={(e) => {
            if (s.dirty && !confirm('Leave without saving?')) return;
            location.search = `?map=${e.target.value}`;
          }}
        >
          {maps.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
        <button onClick={() => setMaking(true)} title="Make a new map">
          New…
        </button>
        <button
          className={s.dirty ? 'ed-save ed-dirty' : 'ed-save'}
          disabled={s.saving}
          onClick={() => void editor.save()}
          title={s.unsaved.length ? `⌘S: ${s.unsaved.join(', ')}` : '⌘S'}
        >
          {s.saving
            ? 'Saving…'
            : s.unsaved.length > 1
              ? `Save ${s.unsaved.length} files`
              : s.dirty
                ? 'Save'
                : 'Saved'}
        </button>
        <span className="ed-sep" />
        <button onClick={() => editor.undo()} disabled={!s.canUndo} title="⌘Z">
          Undo
        </button>
        <button onClick={() => editor.redo()} disabled={!s.canRedo} title="⇧⌘Z">
          Redo
        </button>
        <span className="ed-sep" />
        <Toggle on={s.tool === 'select'} onClick={() => editor.setTool('select')} title="Esc">
          Select
        </Toggle>
        {PLACEABLE.map((t, i) => (
          <Toggle key={t} on={s.tool === t} onClick={() => editor.setTool(t)} title={`${i + 1}`}>
            {t}
          </Toggle>
        ))}
        {QUICK.map((t) => (
          <Toggle
            key={t}
            on={s.tool === t}
            onClick={() => editor.setTool(t)}
            title={
              t === 'floor'
                ? 'A thin floor: click two opposite corners'
                : 'A thin 4 m straight wall where clicked (R to turn it)'
            }
          >
            {t === 'floor' ? 'floor' : 'wall ▭'}
          </Toggle>
        ))}
        <Toggle
          on={s.tool === 'prefab'}
          onClick={() => editor.setTool('prefab')}
          title={`${PLACEABLE.length + 1}`}
        >
          prefab
        </Toggle>
        <button onClick={() => editor.setBrowsing(true)} title="P: pick the prefab to place">
          {s.placing || 'none'} ▾
        </button>
        <Toggle on={s.tool === 'marker'} onClick={() => editor.setTool('marker')} title="7">
          marker
        </Toggle>
        <select
          value={s.marker}
          title="What the marker tool places"
          onChange={(e) => editor.setMarker(e.target.value as MarkerKind)}
        >
          {Object.entries(MARKERS).map(([kind, name]) => (
            <option key={kind} value={kind}>
              {name}
            </option>
          ))}
        </select>
        <Toggle
          on={s.tool === 'zone'}
          onClick={() => editor.setTool('zone')}
          title="8: draw a named zone"
        >
          zone
        </Toggle>
        <Toggle
          on={s.tool === 'wall'}
          onClick={() => editor.setTool('wall')}
          title="9: draw walls a corner at a time, cut doors and windows into them, glaze windows, or put railings on edges"
        >
          wall
        </Toggle>
        <Toggle
          on={s.tool === 'curve'}
          onClick={() => editor.setTool('curve')}
          title="0: curved walls, round floors with a hole, and curved stairs"
        >
          curve
        </Toggle>
        <span title="What new shapes, walls, floors and curves are coloured: a colour, or a slot of the map's (or the prefab's you're in)">
          <Colour
            label="paint"
            value={s.colour}
            slots={Object.keys(editor.slots())}
            onChange={(c) => c !== undefined && editor.setColour(c)}
          />
        </span>
        <Toggle on={s.tool === 'terrain'} onClick={() => editor.setTool('terrain')} title="G">
          ground
        </Toggle>
        <span className="ed-sep" />
        <Toggle
          on={s.grid}
          onClick={() => editor.setGrid(!s.grid)}
          title="H: show the snapping grid's lines"
        >
          grid
        </Toggle>
        {s.grid && (
          <span
            className="ed-short"
            title="The grid's height, in metres; blank follows the cutaway or the camera"
          >
            <Num
              label="y"
              value={s.gridY ?? undefined}
              onChange={(v) => editor.setGridY(v ?? null)}
            />
          </span>
        )}
        <Toggle on={s.nav} onClick={() => editor.setNav(!s.nav)} title="N: where enemies can walk">
          nav
        </Toggle>
        <Toggle
          on={s.cut !== null}
          onClick={() => editor.toggleCut()}
          title="C: hide everything above a height, to see inside; ↑ and ↓ a floor at a time"
        >
          cut
        </Toggle>
        {s.cut !== null && (
          <>
            <button onClick={() => editor.stepCut(-1)} title="↓: a floor down">
              ▼
            </button>
            <span className="ed-short" title="The cut's height, in metres">
              <Num label="" value={s.cut} onChange={(v) => v !== undefined && editor.setCut(v)} />
            </span>
            <button onClick={() => editor.stepCut(1)} title="↑: a floor up">
              ▲
            </button>
          </>
        )}
        <select
          value={start}
          title="Where the play-test starts"
          onChange={(e) => setStart(e.target.value)}
        >
          <option value="">random spawn</option>
          {s.spawns.map((id) => (
            <option key={id}>{id}</option>
          ))}
          <option value={CAMERA_START}>camera target</option>
        </select>
        <button
          onClick={() => editor.playTest(start)}
          title="Play the map as it is now, in another tab: no server, the new-player kit, nothing saved"
        >
          Play ▸
        </button>
        <span className="ed-sep" />
        {s.tool === 'terrain' ? (
          <>
            {BRUSH_MODES.map((m) => (
              <Toggle key={m} on={s.brush.mode === m} onClick={() => editor.setBrush({ mode: m })}>
                {m}
              </Toggle>
            ))}
            {s.brush.mode === 'level' && (
              <span title="Metres; empty levels to the ground where the drag starts">
                <Num
                  label="Height"
                  value={s.brush.height ?? undefined}
                  onChange={(v) => editor.setBrush({ height: v ?? null })}
                />
              </span>
            )}
            {!isAreaMode(s.brush.mode) && (
              <>
                <label title="Brush radius ([ and ])">
                  Size
                  <select
                    value={s.brush.radius}
                    onChange={(e) => editor.setBrush({ radius: Number(e.target.value) })}
                  >
                    {BRUSH_RADII.map((r) => (
                      <option key={r} value={r}>
                        {r} m
                      </option>
                    ))}
                  </select>
                </label>
                <label title="Raise and lower: metres a second in the middle">
                  Strength
                  <select
                    value={s.brush.strength}
                    onChange={(e) => editor.setBrush({ strength: Number(e.target.value) })}
                  >
                    {STRENGTHS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </>
        ) : (
          <>
            {s.tool === 'wall' && (
              <>
                {WALL_MODES.map((m) => (
                  <Toggle
                    key={m}
                    on={s.wall.mode === m}
                    onClick={() => editor.setWall({ mode: m })}
                  >
                    {m}
                  </Toggle>
                ))}
                {s.wall.mode === 'railing' ? (
                  <>
                    <span className="ed-short" title="Railing height, in metres">
                      <Num
                        label="height"
                        value={s.wall.railingHeight}
                        min={0.1}
                        onChange={(v) => v && editor.setWall({ railingHeight: v })}
                      />
                    </span>
                    <span className="ed-short" title="How wide a gap clicking a railing cuts">
                      <Num
                        label="gap"
                        value={s.wall.width}
                        min={0.1}
                        onChange={(v) => v && editor.setWall({ width: v })}
                      />
                    </span>
                  </>
                ) : s.wall.mode === 'glass' ? (
                  <GlassTint editor={editor} colour={s.wall.glassColour} />
                ) : s.wall.mode === 'draw' ? (
                  <>
                    <span className="ed-short" title="Wall height, in metres">
                      <Num
                        label="height"
                        value={s.wall.height}
                        min={0.1}
                        onChange={(v) => v && editor.setWall({ height: v })}
                      />
                    </span>
                    <span className="ed-short" title="Wall thickness, in metres">
                      <Num
                        label="thick"
                        value={s.wall.thickness}
                        min={0.05}
                        onChange={(v) => v && editor.setWall({ thickness: v })}
                      />
                    </span>
                  </>
                ) : (
                  <span
                    className="ed-short"
                    title={
                      s.wall.mode === 'window'
                        ? 'Window width, in metres: 0.7 or more to vault through. Its sill is 0.9 m up and it is 1.1 m tall.'
                        : 'Door width, in metres. Doorways are 2.1 m tall.'
                    }
                  >
                    <Num
                      label="width"
                      value={s.wall.width}
                      min={0.1}
                      onChange={(v) => v && editor.setWall({ width: v })}
                    />
                    <span
                      className="ed-short"
                      title="How many one click cuts: over 1, spaced evenly along the whole wall"
                    >
                      <Num
                        label="count"
                        value={s.wall.count}
                        min={1}
                        onChange={(v) => v && editor.setWall({ count: Math.max(1, Math.round(v)) })}
                      />
                    </span>
                    {s.wall.count > 1 && (
                      <span
                        className="ed-short"
                        title="The gap between them, in metres, the row centred on the wall; blank or 0 spaces them evenly along the whole wall"
                      >
                        <Num
                          label="gap"
                          value={s.wall.gap || undefined}
                          min={0}
                          onChange={(v) => editor.setWall({ gap: v ?? 0 })}
                        />
                      </span>
                    )}
                    {s.wall.mode === 'window' && (
                      <>
                        <Toggle
                          on={s.wall.glass}
                          onClick={() => editor.setWall({ glass: !s.wall.glass })}
                          title="Put glass in the windows cut"
                        >
                          glazed
                        </Toggle>
                        {s.wall.glass && <GlassTint editor={editor} colour={s.wall.glassColour} />}
                      </>
                    )}
                  </span>
                )}
                <span className="ed-sep" />
              </>
            )}
            {s.tool === 'curve' && <CurveBar editor={editor} curve={s.curve} />}
            <Toggle
              on={s.gizmo === 'translate'}
              onClick={() => editor.setGizmo('translate')}
              title="T"
            >
              Move
            </Toggle>
            <Toggle on={s.gizmo === 'rotate'} onClick={() => editor.setGizmo('rotate')} title="R">
              Turn
            </Toggle>
            <label title="Grid snap">
              Grid
              <select
                value={s.gridSnap}
                onChange={(e) => editor.setOption({ gridSnap: Number(e.target.value) })}
              >
                {GRID_SNAPS.map((g) => (
                  <option key={g} value={g}>
                    {g ? `${g} m` : 'off'}
                  </option>
                ))}
              </select>
            </label>
            <label title="Angle snap">
              Angle
              <select
                value={s.angleSnap}
                onChange={(e) => editor.setOption({ angleSnap: Number(e.target.value) })}
              >
                {ANGLE_SNAPS.map((a) => (
                  <option key={a} value={a}>
                    {a ? `${a}°` : 'off'}
                  </option>
                ))}
              </select>
            </label>
            <label title="Drop what's moved or placed onto the surface below">
              <input
                type="checkbox"
                checked={s.snapDown}
                onChange={(e) => editor.setOption({ snapDown: e.target.checked })}
              />
              Snap down
            </label>
            <label title="Snap what's dragged flush with, or in line with, things beside it">
              <input
                type="checkbox"
                checked={s.objectSnap}
                onChange={(e) => editor.setOption({ objectSnap: e.target.checked })}
              />
              Snap to things
            </label>
          </>
        )}
      </div>

      <div className="ed-side">
        <div className="ed-crumbs">
          <button onClick={() => editor.select([], [])} disabled={!s.scope.length}>
            {s.map.name}
          </button>
          {s.scope.map((_, k) => {
            const path = s.scope.slice(0, k + 1);
            const g = nodeAt(s.map, path, prefabs)!;
            return (
              <span key={k}>
                {' › '}
                <button
                  className={g.type === 'prefab' ? 'ed-prefab' : undefined}
                  onClick={() => editor.select([], path)}
                  disabled={k === s.scope.length - 1}
                >
                  {nodeLabel(g)}
                </button>
              </span>
            );
          })}
        </div>
        {inPrefab && (
          <p className="ed-note ed-prefab">
            Editing prefab {inPrefab.id}: every copy changes (
            {countPlacements(s.map.nodes, inPrefab.id, prefabs)} on this map).
          </p>
        )}
        <ul className="ed-list">
          {nodes.map((n, i) => (
            <li
              key={i}
              className={s.selected.includes(i) ? 'ed-on' : undefined}
              onClick={(e) =>
                editor.select(
                  e.shiftKey || e.metaKey
                    ? s.selected.includes(i)
                      ? s.selected.filter((k) => k !== i)
                      : [...s.selected, i]
                    : [i],
                )
              }
              onDoubleClick={() => editor.enter(i)}
            >
              <span className="ed-type">{n.type === 'group' ? '▸' : n.type}</span>{' '}
              {nodeLabel(n) || `#${i}`}
            </li>
          ))}
        </ul>
        <div className="ed-actions">
          <button onClick={() => editor.groupSelected()} disabled={!s.selected.length} title="⌘G">
            Group
          </button>
          <button
            onClick={() => editor.ungroupSelected()}
            disabled={!s.selected.some((i) => nodes[i]?.type === 'group')}
            title="⇧⌘G"
          >
            Ungroup
          </button>
          <button
            onClick={() => editor.duplicateSelected()}
            disabled={!s.selected.length}
            title="⌘D"
          >
            Copy
          </button>
          <button onClick={() => editor.dropSelected()} disabled={!s.selected.length} title="B">
            Drop
          </button>
          <button onClick={() => editor.matchRotation()} disabled={s.selected.length < 2} title="M">
            Match turn
          </button>
          <button onClick={() => editor.deleteSelected()} disabled={!s.selected.length} title="⌫">
            Delete
          </button>
          <button
            onClick={() => setMakingPrefab(true)}
            disabled={!s.selected.length}
            title="Make what's selected a prefab, placed where it is"
          >
            Make prefab…
          </button>
          <button
            onClick={() => editor.unpackSelected()}
            disabled={!s.selected.some((i) => nodes[i]?.type === 'prefab')}
            title="Turn a placed prefab into a group of its parts, to change this copy alone"
          >
            Unpack
          </button>
        </div>
        {overlaps.length + s.overlaps.buried.length > 0 && (
          <details className="ed-overlaps" open>
            <summary>Overlaps ({overlaps.length + s.overlaps.buried.length})</summary>
            <ul>
              {overlaps.map(({ pair: [a, b], building }) => (
                <li key={`${a.join('.')}|${b.join('.')}`} className={building ? 'ed-problem' : ''}>
                  <button onClick={() => editor.reveal(a)}>{editor.label(a)}</button>
                  {' and '}
                  <button onClick={() => editor.reveal(b)}>{editor.label(b)}</button>
                  {building && ' (buildings)'}
                </li>
              ))}
              {s.overlaps.buried.map((p) => (
                <li key={p.join('.')}>
                  <button onClick={() => editor.reveal(p)}>{editor.label(p)}</button>: ground
                  through the floor
                </li>
              ))}
            </ul>
          </details>
        )}
        <Notes editor={editor} state={s} />
        {s.exposed.length > 0 && (
          <details className="ed-overlaps" open>
            <summary>Enemies near a player spawn ({s.exposed.length})</summary>
            <ul>
              {s.exposed.map((x) => (
                <li key={`${x.enemy}|${x.player}`}>
                  <MarkerLink editor={editor} map={s.map} id={x.enemy} />
                  {x.seen ? ' sees ' : ' is near '}
                  <MarkerLink editor={editor} map={s.map} id={x.player} />
                  {` (${Math.round(x.distance)} m)`}
                </li>
              ))}
            </ul>
          </details>
        )}
        {s.drawing && <DrawingNote editor={editor} drawing={s.drawing} />}
        {s.hole && <HoleNote editor={editor} hole={s.hole} label={editor.label(s.hole.path)} />}
        {s.nav && <NavPanel editor={editor} hiding={s.hiding} />}
        {s.selected.length > 1 && <p className="ed-note">{s.selected.length} selected.</p>}
        {!s.selected.length && !s.scope.length && (
          <MapSettings editor={editor} map={s.map} zone={s.zone} point={s.point} paint={s.colour} />
        )}
        {!s.selected.length && atPrefab && inPrefab && (
          <PrefabSettings editor={editor} prefab={inPrefab} />
        )}
        {active && s.selected.length === 1 && (
          <Inspector
            key={`${s.scope.join('.')}:${s.selected[0]}`}
            editor={editor}
            node={active}
            slots={Object.keys(editor.slots())}
            prefabs={[...prefabs.keys()].sort()}
            mapId={s.map.id}
            point={s.point}
            tint={s.wall.glassColour}
            gap={s.wall.gap}
          />
        )}
      </div>

      <div className={s.problem ? 'ed-status ed-problem' : 'ed-status'}>
        {s.problem ? `⚠ ${s.problem}` : (s.message ?? HELP)}
      </div>
    </>
  );
}

/** What the curve tool makes and its sizes, in the toolbar. */
function CurveBar({ editor, curve }: { editor: MapEditor; curve: CurveSettings }) {
  const field = (key: keyof CurveSettings, label: string, title: string, min = 0.05) => (
    <span className="ed-short" title={title}>
      <Num
        label={label}
        value={curve[key] as number}
        min={min}
        onChange={(v) => v !== undefined && editor.setCurve({ [key]: v })}
      />
    </span>
  );
  return (
    <>
      {CURVE_MODES.map((m) => (
        <Toggle key={m} on={curve.mode === m} onClick={() => editor.setCurve({ mode: m })}>
          {CURVE_NAMES[m].toLowerCase()}
        </Toggle>
      ))}
      {curve.mode === 'wall' && (
        <>
          {field('wallHeight', 'height', 'Wall height, in metres: about 1 for a railing')}
          {field('wallThickness', 'thick', 'Wall thickness, in metres')}
        </>
      )}
      {curve.mode === 'floor' && (
        <>
          {field(
            'floorWidth',
            'width',
            'How wide the ring of floor is, out from the hole, in metres',
          )}
          {field('floorThickness', 'thick', 'Floor thickness, in metres')}
        </>
      )}
      {curve.mode === 'stairs' && (
        <>
          {field('stairsWidth', 'width', 'Stairs width, in metres')}
          {field('stairsRise', 'rise', 'How high the stairs climb, in metres: one floor up')}
        </>
      )}
      {curve.mode === 'hole' ? (
        <>
          {field('holeRadius', 'radius', "The hole's radius, in metres (half across)", 0.25)}
          <label title="A railing round the hole's edge">
            <input
              type="checkbox"
              checked={curve.railing}
              onChange={(e) => editor.setCurve({ railing: e.target.checked })}
            />
            railing
          </label>
          {curve.railing &&
            field(
              'railingHeight',
              'height',
              'Railing height, in metres: 1.1 or less can be vaulted',
              0.1,
            )}
        </>
      ) : (
        field(
          'raise',
          'raise',
          'How high above the centre you click it is built, in metres: a wall or the stairs stand there, a floor is walked on there. For an upper floor, its height.',
          -100,
        )
      )}
      <span className="ed-sep" />
    </>
  );
}

const HELP =
  'Two-finger scroll orbit, ⇧ pan · pinch zoom · ⌥-drag orbit, ⌥⇧-drag pan · WASD QE fly · ' +
  'click select, ⇧ add · double-click enter group or prefab · F focus · G ground · 7 marker · ' +
  '8 zone · 9 wall · 0 curve · P prefabs · N nav · H grid · C cut, ↑ ↓ floors';

/** The map's own settings, shown when nothing is selected, and its named zones. */
function MapSettings(props: {
  editor: MapEditor;
  map: MapFile;
  zone: number | null;
  point: number | null;
  /** The colour new shapes get, for a new slot to start at. */
  paint: string;
}) {
  const { editor, map } = props;
  const edit = (change: (m: MapFile) => void) => editor.editMap(change);
  const water = map.water;
  return (
    <div className="ed-inspector">
      <h3>map</h3>
      <Text label="name" value={map.name} onChange={(v) => v && edit((m) => (m.name = v))} />
      <HexColour
        label="sky"
        value={map.environment.sky}
        onChange={(c) => edit((m) => (m.environment.sky = c))}
      />
      <HexColour
        label="ground"
        value={map.terrain.colour}
        onChange={(c) => edit((m) => (m.terrain.colour = c))}
      />
      <h4 title="Named colours the map's shapes can use: change one and all of them change">
        colour slots
      </h4>
      <ColourSlots
        colours={map.colours}
        edit={edit}
        fresh={props.paint.startsWith('#') ? props.paint : '#b5b0a6'}
      />
      <div className="ed-row">
        <Num
          label="fog near"
          value={map.environment.fogNear}
          min={0.01}
          onChange={(v) => v !== undefined && edit((m) => (m.environment.fogNear = v))}
        />
        <Num
          label="fog far"
          value={map.environment.fogFar}
          min={0.01}
          onChange={(v) => v !== undefined && edit((m) => (m.environment.fogFar = v))}
        />
      </div>
      <label className="ed-field">
        <input
          type="checkbox"
          checked={!!water}
          onChange={(e) =>
            edit((m) => {
              if (e.target.checked) m.water = { level: 0, colour: '#3d7ea6', opacity: 0.7 };
              else delete m.water;
            })
          }
        />
        water
      </label>
      {water && (
        <>
          <div className="ed-row">
            <Num
              label="level"
              value={water.level}
              onChange={(v) => v !== undefined && edit((m) => (m.water!.level = v))}
            />
            <Num
              label="opacity"
              value={water.opacity}
              min={0.01}
              onChange={(v) => v !== undefined && v <= 1 && edit((m) => (m.water!.opacity = v))}
            />
          </div>
          <HexColour
            label="water"
            value={water.colour}
            onChange={(c) => edit((m) => (m.water!.colour = c))}
          />
        </>
      )}
      <p className="ed-note">
        {map.terrain.heights[0]!.length - 1} × {map.terrain.heights.length - 1} cells of{' '}
        {map.terrain.cellSize} m. Press G to shape the ground.
      </p>
      <Extend editor={editor} cellSize={map.terrain.cellSize} />
      <Zones {...props} />
    </div>
  );
}

/** Adds ground on a side of the map: how far, then which side. North is −z. */
function Extend({ editor, cellSize }: { editor: MapEditor; cellSize: number }) {
  const [metres, setMetres] = useState(32);
  const cells = Math.max(1, Math.round(metres / cellSize));
  return (
    <div className="ed-row" title="Adds ground on that side; nothing on the map moves">
      <label>
        Extend
        <select value={metres} onChange={(e) => setMetres(Number(e.target.value))}>
          {EXTEND_METRES.map((m) => (
            <option key={m} value={m}>
              {m} m
            </option>
          ))}
        </select>
      </label>
      {SIDES.map((side) => (
        <button key={side} onClick={() => editor.extendMap(side, cells)}>
          {side}
        </button>
      ))}
    </div>
  );
}

/**
 * The map's named zones (for map labels): picking one shows its corners as handles to drag;
 * the picked corner can be deleted or have a corner put in after it.
 */
function Zones({ editor, map, zone, point }: Parameters<typeof MapSettings>[0]) {
  const z = zone === null ? undefined : map.zones[zone];
  const edit = (change: (z: MapFile['zones'][number]) => void) =>
    editor.editMap((m) => change(m.zones[zone!]!));
  return (
    <>
      <h4>zones</h4>
      <ul className="ed-list ed-zones">
        {map.zones.map((zz, i) => (
          <li
            key={i}
            className={i === zone ? 'ed-on' : undefined}
            onClick={() => editor.pickZone(i === zone ? null : i)}
          >
            {zz.name} <span className="ed-type">{zz.id}</span>
          </li>
        ))}
      </ul>
      <button onClick={() => editor.setTool('zone')} title="8">
        Draw a zone
      </button>
      {z && (
        <>
          <Text label="name" value={z.name} onChange={(v) => v && edit((zz) => (zz.name = v))} />
          <Text label="id" value={z.id} onChange={(v) => v && edit((zz) => (zz.id = v))} />
          <p className="ed-note">
            Drag its corners in the scene.{' '}
            {point === null ? 'Click one to pick it.' : `Corner ${point + 1} picked: ⌫ deletes it.`}
          </p>
          <div className="ed-row">
            <button disabled={point === null} onClick={() => editor.splitZoneEdge()}>
              Add corner after
            </button>
            <button disabled={point === null} onClick={() => editor.deletePoint()}>
              Delete corner
            </button>
            <button
              onClick={() => {
                editor.editMap((m) => void m.zones.splice(zone!, 1));
                editor.pickZone(null);
              }}
            >
              Delete zone
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** What's being drawn a click at a time, with buttons to finish or stop. */
/** The map's notes from play-tests and other developers (content/notes). */
function Notes({ editor, state }: { editor: MapEditor; state: EditorState }) {
  return (
    <details className="ed-overlaps" open={state.notes.length > 0}>
      <summary>Notes ({state.notes.length})</summary>
      <ul>
        {state.notes.map((n) => (
          <li key={n.id} className={n.id === state.note ? 'ed-on' : undefined}>
            <button onClick={() => editor.pickNote(n.id)} title="Go to it">
              {n.text}
            </button>{' '}
            <span className="ed-type">
              {n.author}, {n.date}
            </span>{' '}
            <button
              onClick={() =>
                confirm(`Remove "${n.text}" for everyone?`) && editor.resolveNote(n.id)
              }
              title="Dealt with: take it out of content/notes"
            >
              Resolve
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => editor.noteHere()}
        title="Drop a note at the camera's target. In a play-test, N drops one where you stand."
      >
        Note here…
      </button>
    </details>
  );
}

/** The round hole being placed: exactly where, and cutting it. */
function HoleNote({
  editor,
  hole,
  label,
}: {
  editor: MapEditor;
  hole: NonNullable<EditorState['hole']>;
  label: string;
}) {
  return (
    <div className="ed-inspector">
      <h3>round hole in {label}</h3>
      <p className="ed-note">
        From the floor&apos;s middle, along its own sides: 0, 0 is the middle. Click the floor to
        move it.
      </p>
      <div className="ed-row">
        <Num
          label="x"
          value={hole.x}
          onChange={(v) => v !== undefined && editor.moveHole({ x: v })}
        />
        <Num
          label="z"
          value={hole.z}
          onChange={(v) => v !== undefined && editor.moveHole({ z: v })}
        />
      </div>
      <div className="ed-row">
        <button onClick={() => editor.moveHole({ x: 0, z: 0 })}>Middle</button>
        <button onClick={() => editor.cutPendingHole()} title="Enter">
          Cut hole
        </button>
        <button onClick={() => editor.cancelHole()} title="Esc">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DrawingNote({
  editor,
  drawing,
}: {
  editor: MapEditor;
  drawing: NonNullable<EditorState['drawing']>;
}) {
  const what =
    drawing.what === 'zone'
      ? 'a zone'
      : drawing.what === 'patrol'
        ? 'a patrol'
        : drawing.what === 'walls'
          ? 'walls'
          : drawing.what === 'curve'
            ? 'a curve'
            : drawing.what === 'floor'
              ? 'a floor'
              : 'patrol points';
  if (drawing.what === 'curve') {
    const started = drawing.points.length > 1;
    return (
      <div className="ed-inspector">
        <p className="ed-note">
          {started
            ? 'Drawing a curve. Click where it ends: it follows the mouse either way round.'
            : 'Drawing a curve. Click where it starts: how far from the middle sets the size.'}
        </p>
        <div className="ed-row">
          {started && (
            <button onClick={() => editor.finishDrawing()} title="Enter, or click the start">
              Full circle
            </button>
          )}
          <button onClick={() => editor.setTool('select')} title="Esc">
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ed-inspector">
      <p className="ed-note">
        Drawing {what}: {drawing.points.length} point{drawing.points.length === 1 ? '' : 's'}. Click
        to add; drag a point to move it.
      </p>
      <div className="ed-row">
        <button onClick={() => editor.finishDrawing()} title="Enter">
          Finish
        </button>
        {drawing.what === 'walls' && (
          <button
            onClick={() => editor.finishDrawing(true)}
            disabled={drawing.points.length < 3}
            title="Or click the first corner"
          >
            Close room
          </button>
        )}
        <button onClick={() => editor.setTool('select')} title="Esc">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The navigation overlay's key, and the search for hiding spots: where a player can stand
 * but enemies can neither walk to nor see them.
 */
function NavPanel({ editor, hiding }: { editor: MapEditor; hiding: EditorState['hiding'] }) {
  return (
    <div className="ed-inspector ed-nav">
      <h3>navigation</h3>
      <p className="ed-note">
        <span className="ed-key ed-key-main" /> enemies walk here{' '}
        <span className="ed-key ed-key-island" /> they can't{' '}
        <span className="ed-key ed-key-hidden" /> nor see you there
      </p>
      <button
        onClick={() => editor.findHiding()}
        disabled={hiding?.running}
        title="Spots enemies can't walk to, checked for sight from where they can (70 m)"
      >
        {hiding?.running
          ? `Checking… ${Math.round((100 * hiding.checked) / Math.max(1, hiding.total))}%`
          : 'Find hiding spots'}
      </button>
      {hiding && !hiding.running && (
        <>
          {hiding.stale && <p className="ed-note">The map has changed since: check again.</p>}
          {hiding.spots.length === 0 ? (
            <p className="ed-note">
              None: enemies can reach or see every spot ({hiding.total} cut off).
            </p>
          ) : (
            <ul className="ed-list">
              {hiding.spots.map((h, i) => (
                <li
                  key={i}
                  onClick={() => editor.view.lookAt(h.x, h.y, h.z)}
                  className="ed-problem"
                >
                  {round(h.area, 0.25)} m² at {Math.round(h.x)}, {Math.round(h.z)} (y{' '}
                  {round(h.y, 0.1)})
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Named colours of a map or prefab (wall, road…): what's in it can use one by name, so
 * changing the slot recolours all of it. A new one starts at `fresh`.
 */
function ColourSlots(props: {
  colours: Readonly<Record<string, string>> | undefined;
  edit: (change: (file: { colours?: Record<string, string> | undefined }) => void) => void;
  fresh: string;
}) {
  const { colours, edit } = props;
  const [slot, setSlot] = useState('');
  const problem = !slot
    ? null
    : !idSchema.safeParse(slot).success
      ? 'lower-case letters, digits and dashes'
      : colours?.[slot] !== undefined
        ? 'there is one'
        : null;
  return (
    <>
      {Object.entries(colours ?? {}).map(([name, colour]) => (
        <div key={name} className="ed-row">
          <HexColour
            label={name}
            value={colour}
            onChange={(c) => edit((f) => (f.colours![name] = c))}
          />
          <button
            title="Remove the slot (what uses it must be changed first)"
            onClick={() =>
              edit((f) => {
                delete f.colours![name];
                if (!Object.keys(f.colours!).length) delete f.colours;
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <div className="ed-row">
        <label className="ed-field">
          new slot
          <input value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="wall" />
        </label>
        <button
          disabled={!slot || !!problem}
          onClick={() => {
            edit((f) => (f.colours = { ...f.colours, [slot]: props.fresh }));
            setSlot('');
          }}
        >
          Add
        </button>
      </div>
      {problem && <p className="ed-problem">{problem}</p>}
    </>
  );
}

/**
 * The own settings of the prefab being edited inside, shown when nothing in it is selected:
 * its name, instancing, colour slots (their defaults) and building footprint.
 */
function PrefabSettings({ editor, prefab }: { editor: MapEditor; prefab: PrefabFile }) {
  const edit = (change: (p: PrefabFile) => void) => editor.editPrefab(change);
  const b = prefab.building;
  const setBuilding = (change: (b: NonNullable<PrefabFile['building']>) => void) =>
    edit((p) => p.building && change(p.building));
  return (
    <div className="ed-inspector">
      <h3>prefab {prefab.id}</h3>
      <Text
        label="name"
        value={prefab.name ?? ''}
        onChange={(v) => edit((p) => (v ? (p.name = v) : delete p.name))}
      />
      <label className="ed-field" title="One instanced mesh for every copy: for small props">
        <input
          type="checkbox"
          checked={!!prefab.instanced}
          onChange={(e) =>
            edit((p) => (e.target.checked ? (p.instanced = true) : delete p.instanced))
          }
        />
        instanced
      </label>
      <h4>colour slots</h4>
      <ColourSlots colours={prefab.colours} edit={edit} fresh="#b5b0a6" />
      <h4>building</h4>
      <label className="ed-field" title="A footprint: a concrete base under it, and no overlaps">
        <input
          type="checkbox"
          checked={!!b}
          onChange={(e) => {
            if (e.target.checked) editor.fitFootprint();
            else edit((p) => delete p.building);
          }}
        />
        building (floor at y = 0)
      </label>
      {b && (
        <>
          <div className="ed-row">
            {(['w', 'd'] as const).map((l, k) => (
              <Num
                key={l}
                label={l}
                value={b.size[k]}
                min={0.01}
                onChange={(v) =>
                  v !== undefined &&
                  setBuilding((f) => (f.size = k ? [f.size[0], v] : [v, f.size[1]]))
                }
              />
            ))}
            {(['x', 'z'] as const).map((l, k) => (
              <Num
                key={l}
                label={l}
                value={b.centre?.[k] ?? 0}
                onChange={(v) =>
                  setBuilding((f) => {
                    const c: [number, number] = [...(f.centre ?? [0, 0])];
                    c[k] = v ?? 0;
                    if (c[0] || c[1]) f.centre = c;
                    else delete f.centre;
                  })
                }
              />
            ))}
          </div>
          <Colour
            label="base"
            value={b.colour}
            unset="concrete"
            slots={Object.keys(prefab.colours ?? {})}
            onChange={(c) =>
              setBuilding((f) => (c === undefined ? delete f.colour : (f.colour = c)))
            }
          />
          <button onClick={() => editor.fitFootprint()} title="To what stands on the floor">
            Fit footprint
          </button>
        </>
      )}
    </div>
  );
}

/** The form for a new prefab made of what's selected: its id (the file name) and name. */
function NewPrefab(props: { editor: MapEditor; close: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : props.editor.prefabs.has(id)
        ? 'that prefab exists'
        : null;
  const make = (): void => {
    if (idProblem) return;
    props.editor.makePrefab(id, name.trim());
    props.close();
  };
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>new prefab</h3>
        <p className="ed-note">
          What's selected becomes content/prefabs/{id || '…'}.json, and one copy of it stays where
          it was.
        </p>
        <label className="ed-field">
          id
          <input
            value={id}
            autoFocus
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        <label className="ed-field">
          name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && make()}
          />
        </label>
        {id && idProblem && <p className="ed-problem">{idProblem}</p>}
        <div className="ed-row">
          <button onClick={make} disabled={!!idProblem}>
            Make
          </button>
          <button onClick={props.close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** The form for a new map: its id (the file name), name, size and cell size. */
function NewMap(props: { editor: MapEditor; maps: readonly string[]; close: () => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState(192);
  const [cell, setCell] = useState(2);
  const idProblem = !id
    ? 'needs an id'
    : !idSchema.safeParse(id).success
      ? 'ids are lower-case letters, digits and dashes'
      : props.maps.includes(id)
        ? 'that map exists'
        : null;
  const make = (): void => {
    if (idProblem || !name.trim()) return;
    if (props.editor.getState().dirty && !confirm('Leave without saving?')) return;
    void props.editor.createMap(id, name.trim(), size, cell);
  };
  return (
    <div className="ed-modal" onKeyDown={(e) => e.key === 'Escape' && props.close()}>
      <div className="ed-inspector">
        <h3>new map</h3>
        <label className="ed-field">
          id
          <input value={id} autoFocus onChange={(e) => setId(e.target.value)} />
        </label>
        <label className="ed-field">
          name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="ed-field">
          size
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[64, 128, 192, 256, 384].map((v) => (
              <option key={v} value={v}>
                {v} m
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          cells
          <select value={cell} onChange={(e) => setCell(Number(e.target.value))}>
            {[1, 2, 4].map((v) => (
              <option key={v} value={v}>
                {v} m
              </option>
            ))}
          </select>
        </label>
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

type Edit = (change: (n: MapNode) => void) => void;

function Inspector(props: {
  editor: MapEditor;
  node: MapNode;
  slots: string[];
  prefabs: string[];
  mapId: string;
  point: number | null;
  /** The tint glass is put in with. */
  tint: string;
  /** The wall tool's gap between windows; 0 is even. */
  gap: number;
}) {
  const { editor, node: n } = props;
  const edit: Edit = (change) => editor.editActive(change);
  const pos = nodePos(n);
  const any = n as Record<string, unknown>;
  const num = (key: string, label = key, fallback?: number) => (
    <Num
      label={label}
      value={(any[key] as number | undefined) ?? fallback}
      onChange={(v) =>
        edit((m) => {
          const r = m as Record<string, unknown>;
          if (v === undefined) delete r[key];
          else r[key] = v;
        })
      }
    />
  );
  const vec = (key: 'size', labels: string[]) => {
    const v = any[key] as number[];
    return labels.map((l, k) => (
      <Num
        key={l}
        label={l}
        value={v[k]}
        min={0.01}
        onChange={(x) =>
          x !== undefined &&
          edit((m) => {
            const arr = [...((m as Record<string, unknown>)[key] as number[])];
            arr[k] = x;
            (m as Record<string, unknown>)[key] = arr;
          })
        }
      />
    ));
  };

  return (
    <div className="ed-inspector">
      <h3>{n.type}</h3>
      {n.type === 'group' ? (
        <Text
          label="name"
          value={n.name ?? ''}
          onChange={(v) =>
            edit((m) => (v ? ((m as typeof n).name = v) : delete (m as typeof n).name))
          }
        />
      ) : (
        <Text
          label="id"
          value={n.id ?? ''}
          onChange={(v) =>
            edit((m) => {
              const r = m as { id?: string };
              if (v) r.id = v;
              else delete r.id;
            })
          }
        />
      )}
      <div className="ed-row">
        {(['x', 'y', 'z'] as const).map((l, k) => (
          <Num
            key={l}
            label={l}
            value={pos[k]}
            onChange={(v) => {
              if (v === undefined) return;
              const to = [...pos];
              to[k] = v;
              edit((m) => placeNode(m, to));
            }}
          />
        ))}
      </div>
      <div className="ed-row">
        {canTurn(n) && (
          <Num
            label="yaw"
            value={nodeYaw(n)}
            onChange={(v) => edit((m) => placeNode(m, nodePos(m), v ?? 0))}
          />
        )}
        {(n.type === 'box' || n.type === 'cylinder') && (
          <>
            {num('pitch')}
            {num('roll')}
          </>
        )}
      </div>
      {(n.type === 'box' || n.type === 'ramp' || n.type === 'stairs') && (
        <div className="ed-row">{vec('size', ['w', 'h', 'd'])}</div>
      )}
      {n.type === 'box' && (
        <>
          <p className="ed-note">Bulge: how far each face's middle is pushed out (drawn only).</p>
          <div className="ed-row">
            {BULGE_FACES.map((label, k) => (
              <Num
                key={label}
                label={label}
                value={n.bulge?.[k] ?? 0}
                onChange={(v) =>
                  edit((m) => {
                    if (m.type !== 'box') return;
                    const b = m.bulge ?? [0, 0, 0, 0, 0, 0];
                    b[k] = Math.max(0, v ?? 0);
                    if (b.some((x) => x > 0)) m.bulge = b;
                    else delete m.bulge;
                  })
                }
              />
            ))}
          </div>
        </>
      )}
      {n.type === 'wall' && (
        <>
          <div className="ed-row">{vec('size', ['long', 'h', 'thick'])}</div>
          <WallFields
            editor={editor}
            edit={edit}
            node={n}
            point={props.point}
            tint={props.tint}
            gap={props.gap}
          />
        </>
      )}
      {n.type === 'cylinder' && (
        <div className="ed-row">
          {num('radius')}
          {num('radiusTop', 'top r')}
          {num('height')}
          {num('sides', 'sides', 8)}
        </div>
      )}
      {n.type === 'stairs' && <div className="ed-row">{num('steps')}</div>}
      {n.type === 'ladder' && (
        <div className="ed-row">
          {num('height')}
          {num('width', 'width', 0.6)}
        </div>
      )}
      <MarkerFields editor={editor} node={n} num={num} mapId={props.mapId} />
      {n.type === 'door' && <div className="ed-row">{vec('size', ['w', 'h'])}</div>}
      {n.type === 'door' && <DoorFields edit={edit} node={n} num={num} />}
      {n.type === 'glass' && (
        <div className="ed-row">
          {vec('size', ['w', 'h'])}
          {num('thickness', 'thick', 0.02)}
        </div>
      )}
      {n.type === 'patrol' && <PatrolFields editor={editor} node={n} point={props.point} />}
      {n.type === 'prefab' && (
        <>
          <label className="ed-field">
            prefab
            <select
              value={n.prefab}
              onChange={(e) => edit((m) => ((m as typeof n).prefab = e.target.value))}
            >
              {props.prefabs.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <PlacementColours editor={editor} node={n} slots={props.slots} />
        </>
      )}
      {'colour' in n && (
        <Colour
          value={n.colour}
          slots={props.slots}
          onChange={(c) => {
            if (c === undefined) return;
            // Glass keeps a tint of its own, so a wall drawn next isn't glass-coloured.
            if (n.type === 'glass') {
              if (c.startsWith('#')) editor.setWall({ glassColour: c });
            } else editor.setColour(c);
            edit((m) => ((m as typeof n).colour = c));
          }}
        />
      )}
      {n.type === 'box' || n.type === 'cylinder' || n.type === 'ramp' || n.type === 'stairs' ? (
        <label className="ed-field">
          <input
            type="checkbox"
            checked={(n as { collide?: boolean }).collide !== false}
            onChange={(e) =>
              edit((m) => {
                const r = m as { collide?: boolean };
                if (e.target.checked) delete r.collide;
                else r.collide = false;
              })
            }
          />
          collides
        </label>
      ) : null}
      {(n.type === 'box' || n.type === 'cylinder' || n.type === 'group' || n.type === 'prefab') && (
        <LootFields edit={edit} node={n} />
      )}
      {canEnter(n, editor.prefabs) && (
        <button
          onClick={() => editor.enter(editor.getState().selected[0]!)}
          title={n.type === 'prefab' ? 'Changes every copy of it' : undefined}
        >
          {n.type === 'prefab' ? 'Edit prefab' : 'Edit inside'}
        </button>
      )}
      <Json editor={editor} node={n} />
    </div>
  );
}

/** A number typed in, applied on Enter or leaving the field. Empty clears an optional one. */
/**
 * A #rrggbb colour (with a picker) or one of the colour slots of the file it's in. With
 * `unset`, it can also be left out (and shows that label).
 */
function Colour(props: {
  label?: string;
  value: string | undefined;
  unset?: string;
  /** The colour shown while it's unset. */
  shown?: string;
  slots: string[];
  onChange: (c: string | undefined) => void;
}) {
  const { value } = props;
  const hex = value?.startsWith('#') ?? false;
  return (
    <label className="ed-field">
      {props.label ?? 'colour'}
      <select
        value={value === undefined ? UNSET : hex ? '' : value}
        onChange={(e) => {
          const v = e.target.value;
          props.onChange(v === UNSET ? undefined : v || (props.shown ?? '#b5b0a6'));
        }}
      >
        {props.unset !== undefined && <option value={UNSET}>{props.unset}</option>}
        <option value="">custom</option>
        {props.slots.map((slot) => (
          <option key={slot}>{slot}</option>
        ))}
      </select>
      {hex && <input type="color" value={value} onChange={(e) => props.onChange(e.target.value)} />}
      {value === undefined && props.shown && (
        <input type="color" value={props.shown} disabled title={props.unset} />
      )}
    </label>
  );
}

/**
 * A placed prefab's colours: each of its slots left at the prefab's colour, or set for this
 * copy (a colour, or a slot of the file it's placed in).
 */
function PlacementColours(props: {
  editor: MapEditor;
  node: Extract<MapNode, { type: 'prefab' }>;
  slots: string[];
}) {
  const { editor, node: n } = props;
  const prefab = editor.prefabs.get(n.prefab);
  const slots = Object.entries(prefab?.colours ?? {});
  if (!slots.length) return null;
  return (
    <>
      <h4>colours</h4>
      {slots.map(([slot, colour]) => (
        <Colour
          key={slot}
          label={slot}
          value={n.colours?.[slot]}
          unset="prefab's"
          shown={colour}
          slots={props.slots}
          onChange={(c) =>
            editor.editActive((m) => {
              const p = m as typeof n;
              if (c !== undefined) p.colours = { ...p.colours, [slot]: c };
              else if (p.colours) {
                delete p.colours[slot];
                if (!Object.keys(p.colours).length) delete p.colours;
              }
            })
          }
        />
      ))}
    </>
  );
}

type NumField = (key: string, label?: string, fallback?: number) => ReactNode;

/** Sets a field of the active node, or leaves it out for undefined. */
const setField = (editor: MapEditor, key: string, v: unknown): void =>
  editor.editActive((m) => {
    const r = m as Record<string, unknown>;
    if (v === undefined) delete r[key];
    else r[key] = v;
  });

/** The fields of the gameplay markers (session 17): what they name, and their settings. */
function MarkerFields(props: { editor: MapEditor; node: MapNode; num: NumField; mapId: string }) {
  const { editor, node: n, num } = props;
  const set = (key: string, v: unknown) => setField(editor, key, v);
  const tables = [...loadLootTables().keys()].sort();
  switch (n.type) {
    case 'enemySpawn': {
      const { types, loadouts } = loadEnemies();
      const type = types.get(n.enemy);
      return (
        <>
          <Pick
            label="enemy"
            value={n.enemy}
            options={[...types.keys()].sort()}
            onChange={(v) => set('enemy', v)}
          />
          <Pick
            label="loadout"
            value={n.loadout}
            options={[...loadouts.keys()].sort()}
            unset={`its type's${type ? ` (${type.loadout})` : ''}`}
            onChange={(v) => set('loadout', v)}
          />
          <Pick
            label="patrol"
            value={n.patrol}
            options={editor.patrols()}
            unset="none: guards its spot"
            onChange={(v) => set('patrol', v)}
          />
          <div className="ed-row">{num('radius', 'spawn radius', 0)}</div>
          <div className="ed-row" title="The chance it spawns at all, 0 to 1">
            {num('chance', 'chance', 1)}
          </div>
          <div title="Enemy spawns sharing this name: only one, picked at random, is used each raid">
            <Text
              label="one of"
              value={n.oneOf ?? ''}
              onChange={(v) => set('oneOf', v || undefined)}
            />
          </div>
          <h4 title="Multiplies how likely it drops from each table (1 if blank, 0 for never)">
            loot weights
          </h4>
          <div className="ed-row">
            {tables.map((t) => (
              <Num
                key={t}
                label={t}
                value={n.lootWeights?.[t]}
                min={0}
                onChange={(v) =>
                  editor.editActive((m) => {
                    const e = m as typeof n;
                    if (v !== undefined) e.lootWeights = { ...e.lootWeights, [t]: v };
                    else if (e.lootWeights) {
                      delete e.lootWeights[t];
                      if (!Object.keys(e.lootWeights).length) delete e.lootWeights;
                    }
                  })
                }
              />
            ))}
          </div>
        </>
      );
    }
    case 'lootContainer':
      return (
        <ContainerLootFields
          value={n}
          onChange={(v) =>
            editor.editActive((m) => {
              const r = m as Record<string, unknown>;
              r.container = v.container;
              for (const key of ['lootTable', 'mix'] as const) {
                if (v[key] === undefined) delete r[key];
                else r[key] = v[key];
              }
            })
          }
        />
      );
    case 'lootSpawn':
      return (
        <>
          <Pick
            label="loot"
            value={n.lootTable}
            options={tables}
            onChange={(v) => set('lootTable', v)}
          />
          <div className="ed-row" title="The chance anything is there, 0 to 1">
            {num('chance', 'chance', 1)}
          </div>
          <div title="Spots sharing this name: only one, picked at random, is used each raid">
            <Text
              label="one of"
              value={n.oneOf ?? ''}
              onChange={(v) => set('oneOf', v || undefined)}
            />
          </div>
        </>
      );
    case 'extraction':
      return (
        <>
          <Text label="name" value={n.name} onChange={(v) => v && set('name', v)} />
          <div className="ed-row">{num('radius')}</div>
        </>
      );
    case 'questMarker': {
      const users = [...loadQuests().values()].filter((q) =>
        q.objectives.some(
          (o) =>
            o.type !== 'handOver' &&
            o.map === props.mapId &&
            (o.type === 'investigate' ? o.marker === n.id : o.spots.includes(n.id)),
        ),
      );
      return (
        <p className="ed-note">
          {users.length
            ? `Used by ${users.map((q) => q.name).join(', ')}.`
            : 'No quest on this map names it (inside a prefab, quests name it placement/id).'}
        </p>
      );
    }
    default:
      return null;
  }
}

/**
 * A wall node's windows (2026-11-02): each one's place along the wall, width, bottom and
 * top and glass, the picked one (its handle) marked; and spacing them evenly.
 */
function WallFields(props: {
  editor: MapEditor;
  edit: Edit;
  node: Extract<MapNode, { type: 'wall' }>;
  point: number | null;
  tint: string;
  /** The wall tool's gap between windows; 0 is even. */
  gap: number;
}) {
  const { editor, edit, node: n } = props;
  const change = (k: number, f: (o: WallGap) => void) =>
    edit((m) => f((m as typeof n).openings[k]!));
  const field = (k: number, key: 'along' | 'width' | 'bottom' | 'top') => (
    <Num
      label={key === 'along' ? 'at' : key === 'width' ? 'w' : key}
      value={n.openings[k]![key]}
      {...(key === 'along' ? {} : { min: key === 'bottom' ? 0 : 0.05 })}
      onChange={(v) => v !== undefined && change(k, (o) => (o[key] = v))}
    />
  );
  return (
    <div className="ed-wall">
      {n.openings.map((o, k) => (
        <div
          key={k}
          className={`ed-row${k === props.point ? ' ed-picked' : ''}`}
          onClick={() => editor.pickPoint(k)}
        >
          {field(k, 'along')}
          {field(k, 'width')}
          {field(k, 'bottom')}
          {field(k, 'top')}
          <label title="Glass in it, of this tint">
            <input
              type="checkbox"
              checked={o.glass !== undefined}
              onChange={(e) =>
                change(k, (g) => {
                  if (e.target.checked) g.glass = props.tint;
                  else delete g.glass;
                })
              }
            />
            glass
          </label>
          {o.glass?.startsWith('#') && (
            <input
              type="color"
              value={o.glass}
              onChange={(e) => change(k, (g) => (g.glass = e.target.value))}
            />
          )}
          <button
            title="Fill this window in"
            onClick={() => edit((m) => void (m as typeof n).openings.splice(k, 1))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="ed-actions">
        <button
          disabled={!n.openings.length}
          onClick={() => editor.spaceWindows()}
          title="The same gap between the windows and at both ends, keeping their widths"
        >
          Space evenly
        </button>
        <span
          className="ed-short"
          title="Blank or 0: even along the whole wall. Else this far apart, centred"
        >
          <Num
            label="gap"
            value={props.gap || undefined}
            min={0}
            onChange={(v) => editor.setWall({ gap: v ?? 0 })}
          />
        </span>
      </div>
    </div>
  );
}

/** The tint of glass the wall tool puts in. */
function GlassTint(props: { editor: MapEditor; colour: string }) {
  return (
    <label title="The tint of glass put in; it's drawn see-through">
      tint
      <input
        type="color"
        value={props.colour}
        onChange={(e) => props.editor.setWall({ glassColour: e.target.value })}
      />
    </label>
  );
}

/** A door's thickness, hinge, key and whether it starts open. */
function DoorFields(props: {
  edit: Edit;
  node: Extract<MapNode, { type: 'door' }>;
  num: NumField;
}) {
  const { edit, node: n } = props;
  const keys = [...loadItems().values()]
    .filter((i) => i.type === 'key')
    .map((i) => i.id)
    .sort();
  const set = (key: string, v: unknown) =>
    edit((m) => {
      const r = m as Record<string, unknown>;
      if (v === undefined) delete r[key];
      else r[key] = v;
    });
  return (
    <>
      <div className="ed-row">{props.num('thickness', 'thickness', 0.05)}</div>
      <Pick
        label="hinge"
        value={n.hinge ?? 'left'}
        options={['left', 'right']}
        onChange={(v) => set('hinge', v === 'left' ? undefined : v)}
      />
      <Pick
        label="key"
        value={n.key}
        options={keys}
        unset="none: never locked"
        onChange={(v) => set('key', v)}
      />
      <label className="ed-field">
        <input
          type="checkbox"
          checked={!!n.open}
          onChange={(e) => set('open', e.target.checked || undefined)}
        />
        starts open
      </label>
    </>
  );
}

/**
 * Makes a box, cylinder, group or placed prefab a loot container: you loot it by aiming at
 * what collides in it.
 */
function LootFields(props: {
  edit: Edit;
  node: Extract<MapNode, { type: 'box' | 'cylinder' | 'group' | 'prefab' }>;
}) {
  const { edit, node: n } = props;
  const kinds = [...loadLootContainers().keys()].sort();
  const tables = [...loadLootTables().keys()].sort();
  // Starts as the first kind with loot of its own, so it needs no table of its own.
  const kind = kinds.find((k) => loadLootContainers().get(k)?.loot) ?? kinds[0] ?? 'desk';
  const kindLoot = loadLootContainers().get(kind)?.loot;
  type Loot = NonNullable<typeof n.loot>;
  const set = (loot: Loot | undefined) =>
    edit((m) => {
      const r = m as { loot?: Loot };
      if (loot) r.loot = loot;
      else delete r.loot;
    });
  return (
    <>
      <label className="ed-field" title="Looted by aiming at what collides in it">
        <input
          type="checkbox"
          checked={!!n.loot}
          onChange={(e) =>
            set(
              e.target.checked
                ? { container: kind, ...(!kindLoot && { lootTable: tables[0] ?? 'household' }) }
                : undefined,
            )
          }
        />
        loot container
      </label>
      {n.loot && (
        <ContainerLootFields
          value={n.loot}
          onChange={(v) =>
            set({
              container: v.container,
              ...(v.lootTable !== undefined && { lootTable: v.lootTable }),
              ...(v.mix && { mix: v.mix }),
            })
          }
        />
      )}
    </>
  );
}

/**
 * A patrol's points: each a stop (stand and look round for a wait, anywhere within a radius)
 * or walked through; which repeat, and how. The points are dragged in the scene.
 */
function PatrolFields(props: {
  editor: MapEditor;
  node: Extract<MapNode, { type: 'patrol' }>;
  point: number | null;
}) {
  const { editor, node: n, point } = props;
  type P = typeof n;
  const edit = (change: (p: P) => void) => editor.editActive((m) => change(m as P));
  const from = n.repeatFrom ?? 0;
  const picked = point === null ? undefined : n.points[point];
  return (
    <>
      <h4>points</h4>
      <p className="ed-note">
        Drag them in the scene. The way in (before the first that repeats) is walked once.
      </p>
      <ul className="ed-list ed-points">
        {n.points.map((q, k) => (
          <li
            key={k}
            className={k === point ? 'ed-on' : undefined}
            onClick={() => editor.pickPoint(k === point ? null : k)}
          >
            {k + 1}
            {k < from ? ' (way in)' : ''}:{' '}
            {Array.isArray(q)
              ? 'walk through'
              : `stop ${q.wait ?? 3} s${q.radius ? `, ${q.radius} m` : ''}`}
          </li>
        ))}
      </ul>
      {picked !== undefined && point !== null && (
        <>
          <div className="ed-row">
            {(['x', 'y', 'z'] as const).map((l, k) => (
              <Num
                key={l}
                label={l}
                value={patrolPoint(n, point)[k]}
                onChange={(v) =>
                  v !== undefined &&
                  edit((p) => {
                    const at = patrolPoint(p, point);
                    at[k] = v;
                    const q = p.points[point]!;
                    p.points[point] = Array.isArray(q) ? at : { ...q, pos: at };
                  })
                }
              />
            ))}
          </div>
          <label className="ed-field">
            <input
              type="checkbox"
              checked={!Array.isArray(picked)}
              onChange={(e) => edit((p) => setPatrolStop(p, point, e.target.checked ? {} : null))}
            />
            stop here
          </label>
          {!Array.isArray(picked) && (
            <div className="ed-row">
              <Num
                label="wait s"
                value={picked.wait ?? 3}
                min={0}
                onChange={(v) =>
                  edit((p) => setPatrolStop(p, point, { ...(p.points[point] as object), wait: v }))
                }
              />
              <Num
                label="radius"
                value={picked.radius ?? 0}
                min={0}
                onChange={(v) =>
                  edit((p) =>
                    setPatrolStop(p, point, { ...(p.points[point] as object), radius: v }),
                  )
                }
              />
            </div>
          )}
          <button disabled={n.points.length <= 2} onClick={() => editor.deletePoint()} title="⌫">
            Delete point
          </button>
        </>
      )}
      <button onClick={() => editor.extendPatrol()}>Add points…</button>
      <label className="ed-field">
        repeats from
        <select
          value={from}
          onChange={(e) =>
            edit((p) => {
              const v = Number(e.target.value);
              if (v) p.repeatFrom = v;
              else delete p.repeatFrom;
            })
          }
        >
          {n.points.slice(0, -1).map((_, k) => (
            <option key={k} value={k}>
              point {k + 1}
            </option>
          ))}
        </select>
      </label>
      <label className="ed-field">
        <input
          type="checkbox"
          checked={n.loop !== false}
          onChange={(e) => edit((p) => (e.target.checked ? delete p.loop : (p.loop = false)))}
        />
        loops (else back and forth)
      </label>
    </>
  );
}

/** The node as JSON, for anything the fields above don't show. */
function Json({ editor, node }: { editor: MapEditor; node: MapNode }) {
  const json = JSON.stringify(node, null, 2);
  // Only the text is keyed, so the panel stays open after Apply.
  return (
    <details className="ed-json">
      <summary>JSON</summary>
      <JsonInput key={json} editor={editor} json={json} />
    </details>
  );
}

function JsonInput({ editor, json }: { editor: MapEditor; json: string }) {
  const [text, setText] = useState(json);
  const [error, setError] = useState<string | null>(null);
  const apply = (): void => {
    try {
      const parsed = nodeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'not a node');
      editor.replaceActive(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <>
      <textarea value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      {error && <p className="ed-problem">{error}</p>}
      <button onClick={apply} disabled={text === json}>
        Apply
      </button>
    </>
  );
}

/** A compiled marker's id, as a link that selects it (or the prefab it's in). */
function MarkerLink({ editor, map, id }: { editor: MapEditor; map: MapFile; id: string }) {
  const path = markerPath(map, id);
  return path ? <button onClick={() => editor.reveal(path)}>{id}</button> : <>{id}</>;
}

/** A box's faces in its bulge's order. */
const BULGE_FACES = ['−x', '+x', 'bottom', 'top', '−z', '+z'] as const;

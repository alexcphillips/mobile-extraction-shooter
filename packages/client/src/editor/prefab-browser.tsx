import { useState } from 'react';
import { countPlacements } from './doc';
import type { EditorState, MapEditor } from './editor';
import { Thumbnails } from './thumbnails';

/*
 * The prefab browser (the user's call, 2026-10-30): a picture of every prefab, searchable,
 * in place of a list of ids. Picking one picks the prefab tool with it.
 */

const thumbnails = new Thumbnails();

export function PrefabBrowser(props: { editor: MapEditor; state: EditorState; close: () => void }) {
  const { editor, state, close } = props;
  const [query, setQuery] = useState('');
  const prefabs = editor.prefabs;
  const q = query.trim().toLowerCase();
  const shown = [...prefabs.values()]
    .filter((p) => !q || p.id.includes(q) || !!p.name?.toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pick = (id: string): void => {
    editor.setPlacing(id);
    close();
  };
  return (
    <div className="ed-modal" onClick={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="ed-browser" onClick={(e) => e.stopPropagation()}>
        <div className="ed-row">
          <input
            autoFocus
            placeholder="Search prefabs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0].id)}
          />
          <button onClick={close} title="Esc">
            Close
          </button>
        </div>
        <ul className="ed-cards">
          {shown.map((p) => {
            const picture = thumbnails.get(p.id, prefabs);
            const placed = countPlacements(state.map.nodes, p.id, prefabs);
            return (
              <li
                key={p.id}
                className={p.id === state.placing ? 'ed-on' : undefined}
                onClick={() => pick(p.id)}
                title={`Place ${p.id}`}
              >
                {picture ? <img src={picture} alt="" /> : <div className="ed-noimg">?</div>}
                <b>{p.name ?? p.id}</b>
                <span className="ed-type">
                  {p.id}
                  {p.building && ' · building'}
                  {placed > 0 && ` · ${placed} here`}
                </span>
              </li>
            );
          })}
        </ul>
        {!shown.length && <p className="ed-note">No prefab matches “{query}”.</p>}
      </div>
    </div>
  );
}

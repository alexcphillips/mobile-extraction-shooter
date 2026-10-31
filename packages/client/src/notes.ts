import * as THREE from 'three';

/*
 * Notes on a map (the user's call, 2026-10-30): "fix this" pins dropped where you stand in a
 * play-test, or at the camera's target in the map editor, kept in content/notes/<map>.json
 * so other developers see them through git. Dev only: the dev server reads and writes them
 * (editor-save.mjs), stamping who wrote each and when; the game never loads them.
 */

export interface MapNote {
  id: string;
  /** Where it was dropped (the player's feet), in the world. */
  pos: [number, number, number];
  text: string;
  author: string;
  /** YYYY-MM-DD. */
  date: string;
}

export interface NotesFile {
  formatVersion: 1;
  map: string;
  notes: MapNote[];
}

/** The event the dev server sends when a map's notes change. */
export const NOTES_EVENT = 'mes:notes';

export async function fetchNotes(map: string): Promise<MapNote[]> {
  const res = await fetch(`/__editor/notes?map=${encodeURIComponent(map)}`);
  if (!res.ok) throw new Error(`notes: ${res.status}`);
  return ((await res.json()) as NotesFile).notes;
}

export function addNote(map: string, pos: readonly number[], text: string): Promise<MapNote[]> {
  return change({ map, add: { pos, text } });
}

export function removeNote(map: string, id: string): Promise<MapNote[]> {
  return change({ map, remove: id });
}

async function change(body: unknown): Promise<MapNote[]> {
  const res = await fetch('/__editor/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = (await res.json()) as NotesFile & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `notes: ${res.status}`);
  return out.notes;
}

/** How high over its spot a note's label floats. */
const LIFT = 2;
const FONT = 26;
const MAX_CHARS = 34;

/**
 * Notes as labels that show through walls (drawn last, without depth), the same size on
 * screen however far away. `picked` is drawn highlighted.
 */
export function noteLabels(notes: readonly MapNote[], picked: string | null = null): THREE.Group {
  const group = new THREE.Group();
  for (const n of notes) {
    const label = sprite(`✎ ${clip(n.text)}`, `${n.author}, ${n.date}`, n.id === picked);
    label.position.set(n.pos[0], n.pos[1] + LIFT, n.pos[2]);
    label.userData.note = n.id;
    group.add(label);
    // A line down to the spot.
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2]),
        new THREE.Vector3(n.pos[0], n.pos[1] + LIFT, n.pos[2]),
      ]),
      new THREE.LineBasicMaterial({
        color: 0xffd400,
        depthTest: false,
        transparent: true,
        fog: false,
      }),
    );
    line.renderOrder = 20;
    line.raycast = () => {};
    group.add(line);
  }
  return group;
}

export function disposeLabels(group: THREE.Object3D): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.SpriteMaterial | undefined;
    mat?.map?.dispose();
    mat?.dispose();
  });
}

const clip = (s: string): string => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s);

function sprite(text: string, by: string, picked: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = `600 ${FONT}px system-ui, sans-serif`;
  const small = `${Math.round(FONT * 0.7)}px system-ui, sans-serif`;
  g.font = font;
  const w1 = g.measureText(text).width;
  g.font = small;
  const w2 = g.measureText(by).width;
  canvas.width = Math.ceil(Math.max(w1, w2) + 24);
  canvas.height = Math.round(FONT * 2.3);
  g.fillStyle = picked ? 'rgba(255, 140, 0, 0.92)' : 'rgba(24, 28, 34, 0.85)';
  g.strokeStyle = '#ffd400';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(1.5, 1.5, canvas.width - 3, canvas.height - 3, 8);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = font;
  g.textBaseline = 'top';
  g.fillText(text, 12, 6);
  g.fillStyle = picked ? '#ffffff' : '#c9ced6';
  g.font = small;
  g.fillText(by, 12, 8 + FONT);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      sizeAttenuation: false,
      fog: false,
    }),
  );
  // A fixed size on screen: sizeAttenuation off scales by the view's height.
  const h = 0.05;
  s.scale.set((h * canvas.width) / canvas.height, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 21;
  return s;
}

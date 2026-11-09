/*
 * Reference pictures to trace under the model tab's side view (IE-2), kept per item in this
 * browser's IndexedDB: editor only, never written into content. Every call fails quietly
 * (private windows, blocked storage); a picture then lasts until the page reloads.
 */

export interface StoredReference {
  picture: Blob;
  /** Metres along z the picture spans. */
  width: number;
  /** Where its middle is. */
  y: number;
  z: number;
  opacity: number;
  flip: boolean;
}

const DB = 'mes-item-editor';
const STORE = 'references';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export const readReference = (item: string): Promise<StoredReference | undefined> =>
  run('readonly', (s) => s.get(item) as IDBRequest<StoredReference>);

export const writeReference = (item: string, ref: StoredReference): Promise<unknown> =>
  run('readwrite', (s) => s.put(ref, item));

export const removeReference = (item: string): Promise<unknown> =>
  run('readwrite', (s) => s.delete(item));

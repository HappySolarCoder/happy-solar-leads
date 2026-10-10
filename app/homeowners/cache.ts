import type { HomeTile } from "./model";
const NAME = "raydar-homeowners-v12";
const MAX_DOCS = 25000,
  MAX_BYTES = 24 * 1024 * 1024,
  MAX_TILES = 64;
let opened: Promise<IDBDatabase> | undefined;
function database() {
  if (!opened)
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("tiles");
        r.result.createObjectStore("meta");
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => {
          r.result.close();
          opened = undefined;
        };
        resolve(r.result);
      };
      r.onerror = () => {
        opened = undefined;
        reject(r.error);
      };
    });
  return opened;
}
const key = (scope: string, tile: string) => `${scope}:${tile}`;
export async function readTile(scope: string, tile: string): Promise<HomeTile> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction("tiles")
      .objectStore("tiles")
      .get(key(scope, tile));
    r.onsuccess = () =>
      resolve(r.result || { tile, docs: {}, receipts: [], touched: 0 });
    r.onerror = () => reject(r.error);
  });
}
export async function saveTile(scope: string, tile: HomeTile) {
  const db = await database(),
    id = key(scope, tile.tile),
    bytes = JSON.stringify(tile).length * 2,
    docs = Object.keys(tile.docs).length;
  if (bytes > MAX_BYTES || docs > MAX_DOCS)
    throw Error("This saved area is too large. Zoom closer.");
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["tiles", "meta"], "readwrite"),
      tiles = tx.objectStore("tiles"),
      meta = tx.objectStore("meta");
    tiles.put(tile, id);
    meta.put({ id, bytes, docs, touched: Date.now() }, id);
    const r = meta.getAll();
    r.onsuccess = () => {
      const entries = r.result.sort((a, b) => a.touched - b.touched);
      let total = entries.reduce((n, e) => n + e.bytes, 0),
        count = entries.reduce((n, e) => n + e.docs, 0),
        size = entries.length;
      for (const e of entries) {
        if (total <= MAX_BYTES && count <= MAX_DOCS && size <= MAX_TILES) break;
        if (e.id === id) continue;
        tiles.delete(e.id);
        meta.delete(e.id);
        total -= e.bytes;
        count -= e.docs;
        size--;
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Local cache unavailable"));
  });
}

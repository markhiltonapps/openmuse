/**
 * Receipt photos that couldn't be sent (no connection) wait here, in IndexedDB on this device,
 * until the app is open and online again. The device is told it "kept" a photo only when the
 * write really finished (CLAUDE.md: never say "saved on this device" unless it was).
 */

export interface QueuedPhoto {
  id: string;
  name: string;
  type: string;
  bytes: ArrayBuffer;
  /** When it was taken (ms), so photos nobody can send any more are cleared after two weeks. */
  at: number;
}

const DB = "openmuse-receipt-box";
const STORE = "photos";
/** A photo that waited this long is dropped: the receipt is old news and the space is the device's. */
export const KEEP_MS = 14 * 24 * 3_600_000;

let opened: Promise<IDBDatabase | undefined> | undefined;
function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(undefined);
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opened;
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest | undefined,
  fallback: T,
): Promise<T> {
  const db = await open();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      let result = fallback;
      if (request)
        request.onsuccess = () => {
          result = request.result as T;
        };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => resolve(fallback);
      transaction.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

/** Keeps a photo on this device. True only when the device really kept it. */
export async function queuePhoto(file: File): Promise<boolean> {
  try {
    const photo: QueuedPhoto = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name || "receipt.jpg",
      type: file.type || "image/jpeg",
      bytes: await file.arrayBuffer(),
      at: Date.now(),
    };
    // The device has it only when the whole transaction committed: a full disk aborts it at the
    // end, after the request itself looked fine. `run` answers with the key only on commit.
    const key = await run<IDBValidKey | undefined>(
      "readwrite",
      (store) => store.put(photo),
      undefined,
    );
    return key !== undefined;
  } catch {
    return false;
  }
}

/** The photos waiting, oldest first (anything older than two weeks is dropped first). */
export async function queuedPhotos(now = Date.now()): Promise<QueuedPhoto[]> {
  const all = await run<QueuedPhoto[]>("readonly", (store) => store.getAll(), []);
  const old = all.filter((photo) => now - photo.at > KEEP_MS);
  for (const photo of old) await removeQueued(photo.id);
  return all.filter((photo) => now - photo.at <= KEEP_MS).sort((a, b) => a.at - b.at);
}

export async function removeQueued(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id), undefined);
}

export const queuedFile = (photo: QueuedPhoto) =>
  new File([photo.bytes], photo.name, { type: photo.type });

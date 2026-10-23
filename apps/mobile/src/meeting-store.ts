/**
 * Where a recording's audio waits on this device until the server has it. Each 30-second piece is
 * written here before it is sent and removed once the server has it, so a failed upload, a closed
 * tab or a reload loses nothing (an hour of audio once went nowhere while the server's storage
 * refused every piece and the pieces lived only in memory).
 */

export interface StoredPiece {
  meetingId: string;
  part: number;
  n: number;
  type: string;
  bytes: ArrayBuffer;
  /** When it was recorded (ms), so pieces nobody can send any more are cleared after two weeks. */
  at: number;
}
/** What Stop told the server, kept until every piece is there and the server has been told. */
export interface FinishPayload {
  seconds: number;
  parts: { index: number; seconds: number; missedBefore?: number }[];
}
export interface StoredJob {
  meetingId: string;
  finish?: FinishPayload;
}

export interface PieceStore {
  /** Whether the device really kept it: false when storage is full, blocked or unavailable. */
  putPiece(piece: StoredPiece): Promise<boolean>;
  removePiece(meetingId: string, part: number, n: number): Promise<void>;
  /** Every piece kept, oldest first (by part, then piece); one meeting's, or all. */
  pieces(meetingId?: string): Promise<StoredPiece[]>;
  putJob(job: StoredJob): Promise<void>;
  jobs(): Promise<StoredJob[]>;
  removeJob(meetingId: string): Promise<void>;
  /** Everything kept for a meeting (thrown away, or gone from the server). */
  forget(meetingId: string): Promise<void>;
}

const order = (a: StoredPiece, b: StoredPiece) => a.part - b.part || a.n - b.n;

/** Kept in memory only: for tests, and for a browser that won't give out storage. */
export function memoryStore(): PieceStore {
  const pieces = new Map<string, StoredPiece>();
  const jobs = new Map<string, StoredJob>();
  const key = (meetingId: string, part: number, n: number) => `${meetingId}/${part}/${n}`;
  return {
    async putPiece(piece) {
      pieces.set(key(piece.meetingId, piece.part, piece.n), piece);
      return true;
    },
    async removePiece(meetingId, part, n) {
      pieces.delete(key(meetingId, part, n));
    },
    async pieces(meetingId) {
      return [...pieces.values()]
        .filter((p) => !meetingId || p.meetingId === meetingId)
        .sort(order);
    },
    async putJob(job) {
      jobs.set(job.meetingId, job);
    },
    async jobs() {
      return [...jobs.values()];
    },
    async removeJob(meetingId) {
      jobs.delete(meetingId);
    },
    async forget(meetingId) {
      for (const [k, p] of pieces) if (p.meetingId === meetingId) pieces.delete(k);
      jobs.delete(meetingId);
    },
  };
}

const DB_NAME = "openmuse-meetings";

/** IndexedDB: survives a reload and a closed tab. Every call is best-effort, never throws. */
export function indexedStore(): PieceStore {
  // A browser without IndexedDB keeps nothing: say so (putPiece false) instead of claiming it's safe.
  if (typeof indexedDB === "undefined") return { ...memoryStore(), putPiece: async () => false };
  let opened: Promise<IDBDatabase | undefined> | undefined;
  const open = () => {
    opened ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("pieces", { keyPath: ["meetingId", "part", "n"] });
          db.createObjectStore("jobs", { keyPath: "meetingId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
    return opened;
  };
  const run = async <T>(
    store: "pieces" | "jobs",
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest | undefined,
    fallback: T,
  ): Promise<T> => {
    const db = await open();
    if (!db) return fallback;
    return new Promise<T>((resolve) => {
      try {
        const transaction = db.transaction(store, mode);
        const request = work(transaction.objectStore(store));
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
  };
  return {
    async putPiece(piece) {
      let kept = false;
      await run(
        "pieces",
        "readwrite",
        (s) => {
          const request = s.put(piece);
          request.addEventListener("success", () => {
            kept = true;
          });
          return request;
        },
        undefined,
      );
      return kept;
    },
    async removePiece(meetingId, part, n) {
      await run("pieces", "readwrite", (s) => s.delete([meetingId, part, n]), undefined);
    },
    async pieces(meetingId) {
      const all = await run<StoredPiece[]>("pieces", "readonly", (s) => s.getAll(), []);
      return all.filter((p) => !meetingId || p.meetingId === meetingId).sort(order);
    },
    async putJob(job) {
      await run("jobs", "readwrite", (s) => s.put(job), undefined);
    },
    async jobs() {
      return run<StoredJob[]>("jobs", "readonly", (s) => s.getAll(), []);
    },
    async removeJob(meetingId) {
      await run("jobs", "readwrite", (s) => s.delete(meetingId), undefined);
    },
    async forget(meetingId) {
      for (const piece of await this.pieces(meetingId))
        await this.removePiece(meetingId, piece.part, piece.n);
      await this.removeJob(meetingId);
    },
  };
}

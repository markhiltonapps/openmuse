import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MuseApi } from "./api";
import {
  type BoxSummary,
  photoRefusedForGood,
  type Receipt,
  type SnapAnswer,
} from "./receipt-box-logic";
import { sendReceiptPhoto } from "./receipt-box-photo";
import { queuedFile, queuedPhotos, removeQueued } from "./receipt-box-queue";

/**
 * The Receipt box's data, shared by Home's card, the box and the chat's card so they agree: one
 * summary (GET /api/receipt-box) kept here, loaded when something asks and again after every change.
 */

interface Store {
  api?: MuseApi;
  summary?: BoxSummary;
  /** The last load failed (and nothing was loaded before). */
  failed: boolean;
  /** Photos waiting on this device for a connection. */
  waiting: number;
  /** What the waiting photos turned into when they were read, to say once in the box. */
  notes: string[];
}
let store: Store = { failed: false, waiting: 0, notes: [] };
const listeners = new Set<() => void>();
const emit = () => {
  store = { ...store };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A different sign-in means a different person: nothing carries over. */
function forApi(api: MuseApi) {
  if (store.api !== api) store = { api, failed: false, waiting: 0, notes: [] };
}

let loading: Promise<BoxSummary | undefined> | undefined;
/** Loads the summary. Failing quietly leaves what was there (and says so with `failed` when nothing was). */
export function loadBox(api: MuseApi): Promise<BoxSummary | undefined> {
  forApi(api);
  loading ??= api
    .request<BoxSummary>("/api/receipt-box")
    .then(
      (summary) => {
        store.summary = summary;
        store.failed = false;
        return summary;
      },
      () => {
        if (!store.summary) store.failed = true;
        return store.summary;
      },
    )
    .finally(() => {
      loading = undefined;
      emit();
    });
  return loading;
}

/** Counts the photos waiting on the device. */
export async function countWaiting(api: MuseApi) {
  forApi(api);
  const waiting = (await queuedPhotos()).length;
  if (waiting !== store.waiting) {
    store.waiting = waiting;
    emit();
  }
  return waiting;
}

let draining = false;
/**
 * Reads the photos that waited for a connection, oldest first, one at a time. A photo the server
 * refuses for good (4xx) is removed and said so, and the rest go on. A network failure, a busy or
 * restarting server (5xx, a limit) stops the run and leaves the rest for the next try. Returns how
 * many were read.
 */
export async function drainWaiting(api: MuseApi): Promise<number> {
  forApi(api);
  if (draining) return 0;
  draining = true;
  let read = 0;
  let good = 0;
  let removed = 0;
  const odd: string[] = [];
  try {
    for (const photo of await queuedPhotos()) {
      try {
        const answer = await sendReceiptPhoto(api, queuedFile(photo), photo.name);
        await removeQueued(photo.id);
        read += 1;
        if (answer.outcome === "not-a-receipt")
          odd.push("A photo that was waiting didn’t look like a receipt, so I didn’t file it.");
        else if (answer.outcome === "several")
          odd.push(
            "A photo that was waiting had more than one receipt in it, so I didn’t file it.",
          );
        else if (answer.outcome === "unreadable")
          odd.push("I couldn’t read one of the photos that was waiting.");
        else good += 1;
      } catch (error) {
        if (photoRefusedForGood(error)) {
          await removeQueued(photo.id);
          removed += 1;
          continue;
        }
        // Offline, a server restart (which can look like a dropped connection), a busy server or a
        // limit: not the photo's fault. It stays, and the next try picks it up.
        break;
      }
    }
  } finally {
    draining = false;
  }
  if (removed)
    odd.push(
      removed === 1
        ? "I couldn’t read one of your saved photos, so I removed it. If it was a receipt, take the photo again."
        : `I couldn’t read ${removed} of your saved photos, so I removed them.`,
    );
  if (read || removed) {
    store.notes = [
      ...store.notes,
      ...(good > 0
        ? [
            `Read ${good === 1 ? "the receipt" : `${good} receipts`} that ${good === 1 ? "was" : "were"} waiting. ${good === 1 ? "It’s" : "They’re"} in To check.`,
          ]
        : []),
      ...odd,
    ];
    emit();
    if (read) await loadBox(api);
  }
  await countWaiting(api);
  return read;
}

export function dismissNotes() {
  store.notes = [];
  emit();
}

/** The summary and a way to refresh it. Loads once when first used. */
export function useBox(api: MuseApi, load = true) {
  forApi(api);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => store,
    () => store,
  );
  useEffect(() => {
    if (!load) return;
    void loadBox(api);
    void countWaiting(api);
  }, [api, load]);
  const refresh = useCallback(() => loadBox(api), [api]);
  return {
    summary: snapshot.summary,
    failed: snapshot.failed,
    waiting: snapshot.waiting,
    notes: snapshot.notes,
    refresh,
  };
}

// ---- the changes (each returns the receipt the server answers with, and refreshes the summary)

const base = "/api/receipt-box";
const id = (value: string) => encodeURIComponent(value);

export interface ReceiptChange {
  merchant?: string;
  date?: string;
  total?: number;
  category?: string;
  keepFor?: string[];
  returnBy?: string | null;
  note?: string;
}

export const boxApi = {
  /** One receipt with a fresh link to its photo (links expire, so one is asked for each time). */
  one: (api: MuseApi, receiptId: string) =>
    api.request<{ receipt: Receipt; photoUrl: string | null }>(`${base}/${id(receiptId)}`),
  update: async (api: MuseApi, receiptId: string, change: ReceiptChange) => {
    const receipt = await api.request<Receipt>(`${base}/${id(receiptId)}`, change);
    void loadBox(api);
    return receipt;
  },
  file: async (api: MuseApi, receiptId: string) => {
    const receipt = await api.request<Receipt>(`${base}/${id(receiptId)}/file`, {});
    void loadBox(api);
    return receipt;
  },
  unfile: async (api: MuseApi, receiptId: string) => {
    const receipt = await api.request<Receipt>(`${base}/${id(receiptId)}/unfile`, {});
    void loadBox(api);
    return receipt;
  },
  setReturn: async (api: MuseApi, receiptId: string, state: "returned" | "keeping" | "snooze") => {
    const receipt = await api.request<Receipt>(`${base}/${id(receiptId)}/return`, { state });
    void loadBox(api);
    return receipt;
  },
  remove: async (api: MuseApi, receiptId: string) => {
    await api.request(`${base}/${id(receiptId)}/delete`, { confirm: true });
    void loadBox(api);
    return true as const;
  },
  autoFile: async (api: MuseApi, on: boolean) => {
    await api.request(`${base}/auto-file`, { on });
    void loadBox(api);
    return true as const;
  },
};

/** After a snap: the box has a new receipt (or a deleted photo), so the summary is stale. */
export function boxChanged(api: MuseApi) {
  void loadBox(api);
}

/** True while a promise-returning action runs (to disable its button), with its failure in words. */
export function useAction() {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const run = useCallback(
    async <T>(name: string, work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(name);
      setError("");
      try {
        return await work();
      } catch (problem) {
        setError(
          problem instanceof Error && problem.message
            ? problem.message
            : "That didn’t work. Try again.",
        );
        return undefined;
      } finally {
        setBusy("");
      }
    },
    [],
  );
  return { busy, error, run, clear: () => setError("") };
}

export type { SnapAnswer };

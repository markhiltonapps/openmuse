import type { MuseApi } from "./api";
import type { FinishPayload, PieceStore, StoredJob, StoredPiece } from "./meeting-store";

/**
 * Sends a recording's pieces to the server, in order, and never gives one up on its own: each
 * piece is kept on the device (see meeting-store.ts) until the server has it, tried again after a
 * wait (and at once when the phone is back online or the app comes back), and picked up again
 * after a reload. When Stop couldn't wait for the last pieces, the call that closes the recording
 * is kept too and made as soon as they have all arrived.
 */

/** What the server says when it will never take a piece (so trying again is no use). */
const WILL_NOT_TAKE = /already finished|run past its time|not found|couldn’t be found/i;
const GONE = /not found|couldn’t be found/i;
/** While audio is waiting on the device, the server is told every few minutes so it doesn't close the recording as left open. */
const ALIVE_EVERY = 5 * 60_000;
/** Audio older than this, with nobody recording, belongs to a recording that was left open. */
const LEFT_OPEN_AFTER = 90_000;
/** Pieces nobody could send are cleared after this long. */
const KEEP_MS = 14 * 86_400_000;

/** What the screens say about one recording's unsent audio. */
export interface Unsent {
  meetingId: string;
  /** Pieces still on this device. */
  pieces: number;
  /** Their size, for "about N minutes". Each piece is thirty seconds. */
  seconds: number;
  /** The last tries failed: the server (or the connection) isn't taking them right now. */
  trouble: boolean;
  /** The server's own words for the last failure. */
  error?: string;
  /** The server closed the recording first: these pieces can't join it, but they're kept. */
  stuck?: string;
  /** Stop has been pressed: the recording is finished on this side and waiting to be sent. */
  stopped: boolean;
  /** The device wouldn't keep the audio (storage full or blocked): it is held in this tab only. */
  onlyHere: boolean;
}

interface Queue {
  pieces: StoredPiece[];
  tries: number;
  running: boolean;
  error?: string;
  stuck?: string;
  job?: StoredJob;
  wake?: () => void;
  /** When the server was last told the device still holds audio for this recording. */
  aliveAt: number;
  /** Pieces being written to the device right now (not in `pieces` yet). */
  adding: number;
  /** A piece the device refused to keep: it lives in memory only. */
  onlyHere?: boolean;
}

export interface UploaderOptions {
  /** Waits between tries; shortened in tests. */
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
}

const PIECE_SECONDS = 30;
const wait = (tries: number) => Math.min(30_000, 2000 * 2 ** Math.min(tries, 4));
/** Failures in a row before it's called trouble: a blip on a phone shouldn't alarm anyone. */
export const TROUBLE_AFTER = 3;

export class MeetingUploader {
  private readonly queues = new Map<string, Queue>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly now: () => number;
  constructor(
    private readonly api: Pick<MuseApi, "upload" | "request">,
    private readonly store: PieceStore,
    private readonly options: UploaderOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** Changes every time anything does, for useSyncExternalStore. */
  getVersion = () => this.version;
  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
  private queue(meetingId: string) {
    let queue = this.queues.get(meetingId);
    if (!queue) {
      queue = { pieces: [], tries: 0, running: false, aliveAt: 0, adding: 0 };
      this.queues.set(meetingId, queue);
    }
    return queue;
  }
  private enqueue(queue: Queue, piece: StoredPiece) {
    if (queue.pieces.some((p) => p.part === piece.part && p.n === piece.n)) return;
    queue.pieces.push(piece);
    queue.pieces.sort((a, b) => a.part - b.part || a.n - b.n);
  }

  /** What's unsent for a recording, or nothing when everything has arrived. */
  snapshot(meetingId: string): Unsent | undefined {
    const queue = this.queues.get(meetingId);
    if (!queue || (!queue.pieces.length && !queue.stuck && !queue.job)) return undefined;
    return {
      meetingId,
      pieces: queue.pieces.length,
      seconds: queue.pieces.length * PIECE_SECONDS,
      trouble: queue.tries >= TROUBLE_AFTER && !queue.stuck,
      ...(queue.error ? { error: queue.error } : {}),
      ...(queue.stuck ? { stuck: queue.stuck } : {}),
      stopped: Boolean(queue.job?.finish),
      onlyHere: Boolean(queue.onlyHere),
    };
  }
  /** Every recording with audio still on this device, for the bar that says so. */
  all(): Unsent[] {
    return [...this.queues.keys()].flatMap((id) => this.snapshot(id) ?? []);
  }
  /** Pieces not yet at the server, counting any still being written to the device. */
  pending(meetingId: string) {
    const queue = this.queues.get(meetingId);
    return (queue?.pieces.length ?? 0) + (queue?.adding ?? 0);
  }

  /** A piece just recorded: kept on the device first, then sent. */
  async add(meetingId: string, type: string, part: number, n: number, blob: Blob) {
    // Counted from the first moment, so Stop waits for a piece still being written (the last one
    // arrives with the recorder's stop) instead of closing the recording without it.
    const queue = this.queue(meetingId);
    queue.adding++;
    try {
      const piece: StoredPiece = {
        meetingId,
        part,
        n,
        type,
        bytes: await blob.arrayBuffer(),
        at: this.now(),
      };
      if (!(await this.store.putPiece(piece))) queue.onlyHere = true;
      this.enqueue(queue, piece);
    } finally {
      queue.adding--;
    }
    this.changed();
    this.kick(meetingId);
  }

  /** Waits until everything for this recording has been sent, up to `ms`. */
  drained(meetingId: string, ms: number) {
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        off();
        resolve(ok);
      };
      const check = () => {
        const queue = this.queues.get(meetingId);
        if (!this.pending(meetingId)) done(true);
        else if (queue?.stuck) done(false);
      };
      const off = this.subscribe(check);
      const timer = setTimeout(() => done(false), ms);
      check();
    });
  }

  /** Stop couldn't wait: the server is told the recording is over once the last piece is there. */
  async finishWhenSent(meetingId: string, finish: FinishPayload) {
    const job: StoredJob = { meetingId, finish };
    await this.store.putJob(job);
    this.queue(meetingId).job = job;
    this.changed();
    this.kick(meetingId);
  }

  /** Thrown away on purpose: nothing is kept. */
  async discard(meetingId: string) {
    const queue = this.queues.get(meetingId);
    if (queue) {
      queue.pieces = [];
      queue.job = undefined;
      queue.stuck = undefined;
      queue.wake?.();
    }
    this.queues.delete(meetingId);
    await this.store.forget(meetingId);
    this.changed();
  }

  /**
   * At the start of the app, and when the phone is back online: sends whatever is still kept.
   * `leftOver` is for the app's start only: audio found for a recording nobody is recording any more
   * (the tab was closed mid-recording) is sent and the recording closed once it has all arrived.
   */
  async resume(leftOver = false) {
    const cutoff = this.now() - KEEP_MS;
    for (const piece of await this.store.pieces()) {
      if (piece.at < cutoff) {
        await this.store.removePiece(piece.meetingId, piece.part, piece.n);
        continue;
      }
      this.enqueue(this.queue(piece.meetingId), piece);
    }
    for (const job of await this.store.jobs()) this.queue(job.meetingId).job = job;
    if (leftOver)
      for (const [meetingId, queue] of this.queues) {
        if (queue.job || !queue.pieces.length) continue;
        // A piece this fresh may belong to a recording running in another tab: leave that one alone.
        const newest = Math.max(...queue.pieces.map((p) => p.at));
        if (this.now() - newest < LEFT_OPEN_AFTER) continue;
        const seconds = new Map<number, number>();
        for (const piece of queue.pieces)
          seconds.set(piece.part, (seconds.get(piece.part) ?? 0) + PIECE_SECONDS);
        const finish: FinishPayload = {
          // The server caps this at the time the recording has really been open.
          seconds: 86_400,
          parts: [...seconds].map(([index, secs]) => ({ index, seconds: secs })),
        };
        queue.job = { meetingId, finish };
        await this.store.putJob(queue.job);
      }
    this.changed();
    for (const id of this.queues.keys()) this.kick(id);
  }
  /** Ends any wait now (the phone is back online or the app came back to the front). */
  poke() {
    for (const queue of this.queues.values()) queue.wake?.();
  }

  /** The pieces still kept, joined per part, to save as files on this device. */
  async copies(meetingId: string) {
    // What the device kept, plus what is only held in memory (a device that wouldn't keep it).
    const kept = new Map<string, StoredPiece>();
    for (const piece of await this.store.pieces(meetingId))
      kept.set(`${piece.part}/${piece.n}`, piece);
    for (const piece of this.queues.get(meetingId)?.pieces ?? [])
      kept.set(`${piece.part}/${piece.n}`, piece);
    const pieces = [...kept.values()].sort((a, b) => a.part - b.part || a.n - b.n);
    const byPart = new Map<number, StoredPiece[]>();
    for (const piece of pieces) byPart.set(piece.part, [...(byPart.get(piece.part) ?? []), piece]);
    return [...byPart.entries()].map(([part, list]) => ({
      part,
      type: list[0]?.type ?? "audio/webm",
      blob: new Blob(
        list.map((p) => p.bytes),
        { type: list[0]?.type ?? "audio/webm" },
      ),
    }));
  }

  private kick(meetingId: string) {
    const queue = this.queue(meetingId);
    if (queue.running) return;
    void this.run(meetingId, queue);
  }
  private async pause(queue: Queue) {
    const ms = wait(queue.tries);
    if (this.options.delay) return this.options.delay(ms);
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        queue.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      queue.wake = done;
    });
  }
  private async run(meetingId: string, queue: Queue) {
    queue.running = true;
    try {
      while (!queue.stuck && this.queues.get(meetingId) === queue) {
        const piece = queue.pieces[0];
        if (piece) {
          if (await this.sendPiece(meetingId, queue, piece)) continue;
        } else if (queue.job?.finish) {
          if (await this.sendFinish(meetingId, queue, queue.job.finish)) continue;
        } else break;
        // Closed on the server's side, or the meeting is gone: nothing more to try.
        if (queue.stuck || (!queue.pieces.length && !queue.job)) break;
        await this.tellAlive(meetingId, queue);
        await this.pause(queue);
      }
    } finally {
      queue.running = false;
      this.changed();
    }
  }
  /** Audio is waiting here: the server keeps the recording open (it closes one left silent for 45 minutes). */
  private async tellAlive(meetingId: string, queue: Queue) {
    if (this.now() - queue.aliveAt < ALIVE_EVERY) return;
    queue.aliveAt = this.now();
    await this.api.request(`/api/meetings/${meetingId}/alive`, {}).catch(() => undefined);
  }
  private async sendPiece(meetingId: string, queue: Queue, piece: StoredPiece) {
    try {
      await this.api.upload(
        `/api/meetings/${meetingId}/chunks/${piece.part}/${piece.n}`,
        new Blob([piece.bytes], { type: piece.type }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      queue.tries++;
      queue.error = message || "Couldn’t reach the server.";
      if (WILL_NOT_TAKE.test(message)) {
        // Gone from the server: nothing to keep. Closed first: kept, so it can be saved as a file.
        if (GONE.test(message)) {
          queue.pieces = [];
          queue.job = undefined;
          await this.store.forget(meetingId);
        } else queue.stuck = message;
      }
      this.changed();
      return false;
    }
    queue.pieces.shift();
    queue.tries = 0;
    queue.error = undefined;
    await this.store.removePiece(meetingId, piece.part, piece.n);
    this.changed();
    return true;
  }
  private async sendFinish(meetingId: string, queue: Queue, finish: FinishPayload) {
    try {
      await this.api.request(`/api/meetings/${meetingId}/finish`, finish);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      queue.tries++;
      queue.error = message || "Couldn’t reach the server.";
      if (GONE.test(message)) queue.job = undefined;
      this.changed();
      return GONE.test(message);
    }
    queue.job = undefined;
    queue.tries = 0;
    queue.error = undefined;
    await this.store.removeJob(meetingId);
    this.changed();
    return true;
  }
}

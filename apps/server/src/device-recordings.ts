import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Blobs } from "./blobs.ts";
import type { Store } from "./db.ts";
import type { Device } from "./devices.ts";
import { AppError } from "./errors.ts";

/**
 * Recordings the watch makes on its own and sends afterwards. The watch stores speech as IMA ADPCM (4 bits a sample, 8 kHz) in
 * 512-byte slots (see firmware/neddy_device/neddy_rec.h): 8 bytes of header (0xA7 0x5C, the recording's id, the sample the slot starts
 * at) and one 504-byte block of 1,001 samples. Quiet stretches aren't stored; the sample positions let the silence be put back.
 * The watch sends the slots in pieces (any size that is a whole number of slots), each at its byte offset, then says it's final.
 * Only when every byte has arrived is it turned into an MP3 and handed to the meetings recorder (which writes it up); the watch
 * clears its own copy only when this answers `done`.
 */
export const SLOT = 512;
const SLOT_HEAD = 8;
export const SLOT_SAMPLES = 1001;
export const RATE = 8000;
const MAX_PIECE = 2 * 1024 * 1024;
/** A recording can't be longer than the watch's whole partition (about 24 MB). */
const MAX_BYTES = 40 * 1024 * 1024;

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_CHANGE = [-1, -1, -1, -1, 2, 4, 6, 8];

/** One slot's 1,001 samples. */
export function decodeSlot(slot: Uint8Array): Int16Array {
  const out = new Int16Array(SLOT_SAMPLES);
  const b = slot.subarray(SLOT_HEAD);
  let predictor = (b[0] as number) | ((b[1] as number) << 8);
  if (predictor > 32767) predictor -= 65536;
  let index = Math.min(88, b[2] as number);
  out[0] = predictor;
  for (let i = 0; i < 1000; i++) {
    const byte = b[4 + (i >> 1)] as number;
    const code = i & 1 ? byte >> 4 : byte & 15;
    const step = STEPS[index] as number;
    const diff = ((2 * (code & 7) + 1) * step) >> 3;
    predictor += code & 8 ? -diff : diff;
    if (predictor > 32767) predictor = 32767;
    if (predictor < -32768) predictor = -32768;
    index += INDEX_CHANGE[code & 7] as number;
    if (index < 0) index = 0;
    if (index > 88) index = 88;
    out[1 + i] = predictor;
  }
  return out;
}

export interface SlotInfo {
  /** The recording's id (low 16 bits) as stored in the slot. */
  id: number;
  /** The sample (at 8 kHz) the slot starts at. */
  at: number;
}
export function slotInfo(slot: Uint8Array): SlotInfo | undefined {
  if (slot.length < SLOT || slot[0] !== 0xa7 || slot[1] !== 0x5c) return undefined;
  const at =
    (slot[4] as number) +
    (slot[5] as number) * 256 +
    (slot[6] as number) * 65536 +
    (slot[7] as number) * 16777216;
  return { id: (slot[2] as number) | ((slot[3] as number) << 8), at };
}

/**
 * The recording as 16-bit mono 8 kHz sound in order, with silence put back where slots were left out. Yields pieces of about a
 * second; `samples` is how many samples there are in all (for the length).
 */
export function* decodeRecording(bytes: Uint8Array, id?: number): Generator<Buffer, number, void> {
  let next = 0;
  const pending: Buffer[] = [];
  const silence = (count: number) => {
    let left = count;
    while (left > 0) {
      const n = Math.min(left, RATE);
      pending.push(Buffer.alloc(n * 2));
      left -= n;
    }
  };
  for (let offset = 0; offset + SLOT <= bytes.length; offset += SLOT) {
    const slot = bytes.subarray(offset, offset + SLOT);
    const info = slotInfo(slot);
    if (!info) throw new AppError("This recording has a damaged piece.", 422);
    if (id !== undefined && info.id !== (id & 0xffff))
      throw new AppError("This recording mixes two recordings.", 422);
    if (info.at > next) {
      silence(info.at - next);
      next = info.at;
    }
    if (info.at < next) throw new AppError("This recording's pieces are out of order.", 422);
    const pcm = decodeSlot(slot);
    pending.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    next += SLOT_SAMPLES;
    while (pending.length) yield pending.shift() as Buffer;
  }
  return next;
}

/** Turns 8 kHz mono sound into an MP3 (16 kHz, 32 kbps: speech) with ffmpeg. */
export type Mp3FromPcm = (pcm: Iterable<Buffer>) => Promise<Uint8Array>;
export const ffmpegFromPcm: Mp3FromPcm = (pcm) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        String(RATE),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "32k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const out: Buffer[] = [];
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-800);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    timer.unref();
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.length) resolve(new Uint8Array(Buffer.concat(out)));
      else {
        console.warn(`[OpenMuse] Watch recording conversion failed (${code}): ${error.trim()}`);
        reject(new Error("The recording couldn’t be turned into an MP3"));
      }
    });
    child.stdin.on("error", () => undefined);
    void (async () => {
      try {
        for (const piece of pcm) {
          if (!child.stdin.write(piece)) await new Promise((r) => child.stdin.once("drain", r));
        }
      } catch (cause) {
        child.kill("SIGKILL");
        reject(cause);
        return;
      }
      child.stdin.end();
    })();
  });

interface RecordingState {
  id: string;
  deviceId: string;
  /** The recording's id on the watch (8 hex digits). */
  rid: string;
  /** Bytes of slots received so far, in a row from 0. */
  received: number;
  status: "receiving" | "done" | "failed";
  meetingId?: string;
  error?: string;
  updatedAt: string;
}

export interface MeetingImport {
  importRecording(
    owner: string,
    input: { startedAt: number; seconds: number; chunks: Uint8Array[] },
  ): Promise<{ id: string }>;
}

const RID = /^[0-9a-f]{8}$/;
const MP3_CHUNK = 4 * 1024 * 1024;

export class DeviceRecordings {
  private readonly working = new Map<string, Promise<unknown>>();
  constructor(
    private readonly db: Store,
    private readonly blobs: Blobs,
    private readonly meetings: MeetingImport,
    private readonly options: { toMp3?: Mp3FromPcm; now?: () => number } = {},
  ) {}

  private key(device: Device, rid: string) {
    return `${device.id}-${rid}`;
  }
  private check(rid: string) {
    if (!RID.test(rid)) throw new AppError("That isn’t a recording.", 404);
  }
  private blobKey(device: Device, rid: string, offset: number) {
    return `device-recordings/${device.id}/${rid}/p-${String(offset).padStart(10, "0")}`;
  }

  /** How much of a recording the server has (so the watch carries on from there), and whether it is finished. */
  async status(owner: string, device: Device, rid: string) {
    this.check(rid);
    const state = await this.db.get<RecordingState>(
      owner,
      "device-recordings",
      this.key(device, rid),
    );
    return {
      received: state?.received ?? 0,
      done: state?.status === "done",
      ...(state?.meetingId ? { meetingId: state.meetingId } : {}),
      ...(state?.status === "failed" && state.error ? { error: state.error } : {}),
    };
  }

  /**
   * A piece of the recording at its byte offset. The piece must begin where the last one ended (sending the same piece again is
   * fine). `final` says it is the last: then the whole recording is written up. `startedAt` is when it began (UTC seconds).
   */
  async receive(
    owner: string,
    device: Device,
    rid: string,
    offset: number,
    bytes: Uint8Array,
    options: { final: boolean; startedAt: number },
  ) {
    this.check(rid);
    const id = this.key(device, rid);
    // One piece at a time per recording: two arriving together would race on the byte count.
    const running = this.working.get(id) ?? Promise.resolve();
    const run = running
      .catch(() => undefined)
      .then(() => this.receiveNow(owner, device, rid, offset, bytes, options));
    this.working.set(id, run);
    try {
      return await run;
    } finally {
      if (this.working.get(id) === run) this.working.delete(id);
    }
  }

  private async receiveNow(
    owner: string,
    device: Device,
    rid: string,
    offset: number,
    bytes: Uint8Array,
    options: { final: boolean; startedAt: number },
  ) {
    const id = this.key(device, rid);
    let state = await this.db.get<RecordingState>(owner, "device-recordings", id);
    if (state?.status === "done")
      return { received: state.received, done: true, meetingId: state.meetingId };
    if (!Number.isInteger(offset) || offset < 0 || offset % SLOT !== 0)
      throw new AppError("That piece doesn’t line up.", 422);
    if (bytes.length % SLOT !== 0 || bytes.length > MAX_PIECE)
      throw new AppError("That piece isn’t a whole number of slots.", 422);
    if (offset + bytes.length > MAX_BYTES) throw new AppError("This recording is too large.", 413);
    state ??= {
      id,
      deviceId: device.id,
      rid,
      received: 0,
      status: "receiving",
      updatedAt: new Date(this.options.now?.() ?? Date.now()).toISOString(),
    };
    if (offset > state.received)
      return { received: state.received, done: false, needFrom: state.received };
    if (bytes.length) {
      for (let at = 0; at < bytes.length; at += SLOT) {
        if (!slotInfo(bytes.subarray(at, at + SLOT)))
          throw new AppError("This piece is damaged.", 422);
      }
      try {
        await this.blobs.put(this.blobKey(device, rid, offset), bytes, "application/octet-stream");
      } catch (error) {
        console.warn(
          `[OpenMuse] A watch recording piece couldn't be saved: ${error instanceof Error ? error.message : error}`,
        );
        throw new AppError("The server can’t save this recording right now. Try again soon.", 503);
      }
      state.received = Math.max(state.received, offset + bytes.length);
    }
    state.updatedAt = new Date(this.options.now?.() ?? Date.now()).toISOString();
    await this.db.put(owner, "device-recordings", state);
    if (!options.final) return { received: state.received, done: false };
    return this.finish(owner, device, state, options.startedAt);
  }

  /** Every piece is here: decode, make the MP3, hand it to the recorder. */
  private async finish(owner: string, device: Device, state: RecordingState, startedAt: number) {
    const keys = (await this.blobs.list(`device-recordings/${device.id}/${state.rid}/`)).sort();
    const parts: Uint8Array[] = [];
    let expected = 0;
    for (const key of keys) {
      const bytes = await this.blobs.get(key);
      const at = Number(key.slice(key.lastIndexOf("-") + 1));
      if (!bytes || at !== expected) break;
      parts.push(bytes);
      expected += bytes.length;
    }
    if (expected !== state.received || !expected)
      throw new AppError("Some of the recording hasn’t arrived yet.", 409);
    const all = new Uint8Array(expected);
    let at = 0;
    for (const piece of parts) {
      all.set(piece, at);
      at += piece.length;
    }
    const first = slotInfo(all.subarray(0, SLOT));
    // Checked before any converting starts, so a damaged recording is turned away at once.
    try {
      let previous = -1;
      for (let o = 0; o < all.length; o += SLOT) {
        const info = slotInfo(all.subarray(o, o + SLOT));
        if (!info || info.id !== first?.id || info.at <= previous)
          throw new AppError("This recording is damaged.", 422);
        previous = info.at;
      }
    } catch (error) {
      state.status = "failed";
      state.error = error instanceof AppError ? error.message : "This recording is damaged.";
      await this.db.put(owner, "device-recordings", state);
      throw error;
    }
    // The sound is made as it is wanted (an hour of it is more than 100 MB), and its length is counted on the way.
    let samples = 0;
    const sound = (function* () {
      samples = yield* decodeRecording(all, first?.id);
    })();
    const toMp3 = this.options.toMp3 ?? ffmpegFromPcm;
    let mp3: Uint8Array;
    try {
      mp3 = await toMp3({ [Symbol.iterator]: () => sound });
    } catch {
      throw new AppError(
        "The recording couldn’t be turned into an MP3 right now. Try again soon.",
        503,
      );
    }
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < mp3.length; i += MP3_CHUNK) chunks.push(mp3.subarray(i, i + MP3_CHUNK));
    const seconds = samples / RATE;
    const meeting = await this.meetings.importRecording(owner, {
      startedAt:
        startedAt > 0 ? startedAt * 1000 : (this.options.now?.() ?? Date.now()) - seconds * 1000,
      seconds,
      chunks,
    });
    state.status = "done";
    state.meetingId = meeting.id;
    state.updatedAt = new Date(this.options.now?.() ?? Date.now()).toISOString();
    await this.db.put(owner, "device-recordings", state);
    for (const key of keys) await this.blobs.remove(key).catch(() => undefined);
    return {
      received: state.received,
      done: true,
      meetingId: meeting.id,
      seconds: Math.round(seconds),
    };
  }
}

/** A short id for tests and the watch's recordings. */
export const newRecordingId = () => randomUUID().replace(/-/g, "").slice(0, 8);

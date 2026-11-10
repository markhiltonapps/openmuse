import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";
import {
  DeviceRecordings,
  decodeRecording,
  decodeSlot,
  RATE,
  SLOT,
  SLOT_SAMPLES,
  slotInfo,
} from "../apps/server/src/device-recordings.ts";
import type { Device } from "../apps/server/src/devices.ts";
import { ffmpegAvailable } from "../apps/server/src/mp3.ts";

let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-watch-rec-"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

// What the watch's recorder (firmware/neddy_device/neddy_rec.h, run by firmware/tools/rec_test.cpp) stored for a 10-second test:
// 3 s of speech, 4 s of quiet (left out), 3 s of speech. A 4,096-byte header, then 512-byte slots.
const fixture = async () => new Uint8Array(await readFile("tests/fixtures/watch-recording.bin"));
const slotsOf = (file: Uint8Array) => file.subarray(4096);

test("the slots are what the watch's own recorder wrote: header, ids and sample positions", async () => {
  const file = await fixture();
  assert.equal(file[0], 0x4e); // "NRC1"
  assert.equal(file[1], 0x52);
  const slots = slotsOf(file);
  assert.equal(slots.length % SLOT, 0);
  const first = slotInfo(slots.subarray(0, SLOT));
  assert.ok(first);
  assert.equal(first.id, 0x1234); // low 16 bits of the recording id 0xBEEF1234
  assert.equal(first.at, 0);
  // The quiet stretch left a gap: somewhere a slot starts well after the one before ended.
  let gaps = 0;
  let previous = -SLOT_SAMPLES;
  for (let o = 0; o < slots.length; o += SLOT) {
    const info = slotInfo(slots.subarray(o, o + SLOT));
    assert.ok(info);
    if (info.at - previous > SLOT_SAMPLES * 2) gaps++;
    previous = info.at;
  }
  assert.equal(gaps, 1);
});

test("the decoder gives the same sound as ffmpeg's own IMA ADPCM decoder, and silence is put back", async (t) => {
  const file = await fixture();
  const slots = slotsOf(file);
  const mine: number[] = [];
  const sound = decodeRecording(slots, 0x1234);
  let step = sound.next();
  let total = 0;
  const all: Buffer[] = [];
  while (!step.done) {
    all.push(step.value);
    step = sound.next();
  }
  total = step.value;
  const pcm = Buffer.concat(all);
  assert.equal(pcm.length, total * 2);
  // About ten seconds: the speech and the silence that was left out.
  assert.ok(total > 9.9 * RATE && total < 10.2 * RATE, `${total} samples`);
  for (let i = 0; i < pcm.length; i += 2) mine.push(pcm.readInt16LE(i));
  // The quiet stretch (4 to 6 s) is exactly zero.
  assert.ok(mine.slice(4.3 * RATE, 6.7 * RATE).every((v) => v === 0));

  if (!(await ffmpegAvailable())) return t.skip("ffmpeg isn't installed here");
  // The same blocks wrapped as a WAV file (IMA ADPCM, 504-byte blocks): ffmpeg's decoder is the reference.
  const blocks = Buffer.concat(
    Array.from({ length: slots.length / SLOT }, (_, i) =>
      slots.subarray(i * SLOT + 8, (i + 1) * SLOT),
    ),
  );
  const fmt = Buffer.alloc(20);
  fmt.writeUInt16LE(0x11, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(RATE, 4);
  fmt.writeUInt32LE(Math.round((RATE * 504) / SLOT_SAMPLES), 8);
  fmt.writeUInt16LE(504, 12);
  fmt.writeUInt16LE(4, 14);
  fmt.writeUInt16LE(2, 16);
  fmt.writeUInt16LE(SLOT_SAMPLES, 18);
  const head = Buffer.alloc(12 + 8 + 20 + 8);
  head.write("RIFF", 0);
  head.writeUInt32LE(4 + 8 + 20 + 8 + blocks.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(20, 16);
  fmt.copy(head, 20);
  head.write("data", 40);
  head.writeUInt32LE(blocks.length, 44);
  const wav = join(directory, "slots.wav");
  await writeFile(wav, Buffer.concat([head, blocks]));
  const raw = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-"],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const reference: number[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) reference.push(raw.readInt16LE(i));
  // Compare slot by slot (ffmpeg has no silence to put back between them).
  let compared = 0;
  for (let s = 0; s < slots.length / SLOT; s++) {
    const decoded = decodeSlot(slots.subarray(s * SLOT, (s + 1) * SLOT));
    for (let i = 0; i < SLOT_SAMPLES; i++) {
      assert.equal(decoded[i], reference[s * SLOT_SAMPLES + i], `slot ${s}, sample ${i}`);
      compared++;
    }
  }
  assert.ok(compared > 40_000);
});

function deviceOf(id = "dev-1"): Device {
  return { id, name: "Watch" } as Device;
}

async function setup() {
  const db = await createStore();
  const blobs = new DiskBlobs(await mkdtemp(join(directory, "blobs-")));
  const imports: {
    owner: string;
    startedAt: number;
    seconds: number;
    bytes: number;
    chunks: number;
  }[] = [];
  const meetings = {
    importRecording: async (
      owner: string,
      input: { startedAt: number; seconds: number; chunks: Uint8Array[] },
    ) => {
      imports.push({
        owner,
        startedAt: input.startedAt,
        seconds: input.seconds,
        bytes: input.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
        chunks: input.chunks.length,
      });
      return { id: "meeting-1" };
    },
  };
  let converted = 0;
  const recordings = new DeviceRecordings(db, blobs, meetings, {
    toMp3: async (pcm) => {
      for (const piece of pcm) converted += piece.length;
      return new Uint8Array(1000);
    },
  });
  return { db, blobs, recordings, imports, converted: () => converted };
}

test("pieces arrive in order, a repeat is harmless, a gap is refused, and the last one writes it up", async () => {
  const { db, blobs, recordings, imports, converted } = await setup();
  const slots = slotsOf(await fixture());
  const device = deviceOf();
  const at = (n: number) => n * SLOT * 20;
  const rid = "beef1234";
  const cut = [slots.subarray(0, at(1)), slots.subarray(at(1), at(2)), slots.subarray(at(2))];

  assert.deepEqual(await recordings.status("o", device, rid), { received: 0, done: false });
  const one = await recordings.receive("o", device, rid, 0, cut[0] as Uint8Array, {
    final: false,
    startedAt: 0,
  });
  assert.equal(one.received, at(1));
  // The same piece again changes nothing.
  const again = await recordings.receive("o", device, rid, 0, cut[0] as Uint8Array, {
    final: false,
    startedAt: 0,
  });
  assert.equal(again.received, at(1));
  // A piece that skips ahead is turned back with where to carry on from.
  const skipped = (await recordings.receive("o", device, rid, at(2), cut[2] as Uint8Array, {
    final: false,
    startedAt: 0,
  })) as { received: number; needFrom?: number };
  assert.equal(skipped.needFrom, at(1));
  await recordings.receive("o", device, rid, at(1), cut[1] as Uint8Array, {
    final: false,
    startedAt: 0,
  });
  assert.equal((await recordings.status("o", device, rid)).received, at(2));

  // The last piece, marked final: written up as a meeting started when the watch says it started.
  const last = (await recordings.receive("o", device, rid, at(2), cut[2] as Uint8Array, {
    final: true,
    startedAt: 1794262500,
  })) as { done: boolean; meetingId?: string; seconds?: number };
  assert.equal(last.done, true);
  assert.equal(last.meetingId, "meeting-1");
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.owner, "o");
  assert.equal(imports[0]?.startedAt, 1794262500 * 1000);
  assert.ok((imports[0]?.seconds ?? 0) > 9.9 && (imports[0]?.seconds ?? 0) < 10.2);
  assert.equal(imports[0]?.bytes, 1000);
  assert.ok(converted() > 9.9 * RATE * 2); // the whole ten seconds, quiet stretch included, went to the encoder
  // Done once: asking again, or sending the last piece again, doesn't make a second meeting.
  assert.deepEqual(await recordings.status("o", device, rid), {
    received: slots.length,
    done: true,
    meetingId: "meeting-1",
  });
  await recordings.receive("o", device, rid, at(2), cut[2] as Uint8Array, {
    final: true,
    startedAt: 1794262500,
  });
  assert.equal(imports.length, 1);
  // The pieces are cleared from the server's storage once it is written up.
  assert.deepEqual(await blobs.list("device-recordings/"), []);
  await db.close();
});

test("a final piece with something missing is not written up, and damaged audio is turned away", async () => {
  const { db, recordings, imports } = await setup();
  const slots = slotsOf(await fixture());
  const device = deviceOf("dev-2");
  // Final, but the first half never came: it says where to start.
  await assert.rejects(
    recordings.receive("o", device, "00000001", 0, new Uint8Array(0), {
      final: true,
      startedAt: 1,
    }),
    /hasn’t arrived|no audio|isn’t a whole/,
  );
  const damaged = new Uint8Array(slots.subarray(0, SLOT * 4));
  damaged[0] = 0; // the slot's mark is gone
  await assert.rejects(
    recordings.receive("o", device, "00000002", 0, damaged, { final: true, startedAt: 1 }),
    /damaged/,
  );
  // Not a whole number of slots.
  await assert.rejects(
    recordings.receive("o", device, "00000003", 0, slots.subarray(0, SLOT + 5), {
      final: false,
      startedAt: 1,
    }),
    /whole number of slots/,
  );
  // A made-up recording id.
  await assert.rejects(recordings.status("o", device, "../../etc"), /isn’t a recording/);
  assert.equal(imports.length, 0);
  await db.close();
});

test("the routes: a watch signs in with its own token, nothing else is let in", async () => {
  const db = await createStore();
  const config: Config = {
    mode: "sample",
    port: 8787,
    host: "127.0.0.1",
    publicUrl: "http://localhost:8787",
    dataDir: await mkdtemp(join(directory, "api-")),
    agentBackend: "sample",
    intelligenceApiKey: "test-project-key-never-sent",
    googleRedirectUri: "http://localhost:8787/api/google/callback",
    allowedOrigins: [],
  };
  const server = await createApp(db, config);
  try {
    const noToken = await server.app.request("/api/device/recording/beef1234");
    assert.equal(noToken.status, 401);
    const wrong = await server.app.request("/api/device/recording/beef1234", {
      headers: { Authorization: "Bearer dev_notatoken" },
    });
    assert.equal(wrong.status, 401);
    const put = await server.app.request("/api/device/recording/beef1234?offset=0&final=0", {
      method: "PUT",
      body: new Uint8Array(SLOT),
    });
    assert.equal(put.status, 401);
  } finally {
    server.deviceBridge.stop();
    await db.close();
  }
});

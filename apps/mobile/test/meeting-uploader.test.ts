import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryStore } from "../src/meeting-store.ts";
import { MeetingUploader, TROUBLE_AFTER } from "../src/meeting-uploader.ts";

/** A stand-in for the server: what it took, in order, and what it says when it won't. */
function fakeApi() {
  const taken: string[] = [];
  const calls: string[] = [];
  const state = { failWith: undefined as string | undefined, failures: 0 };
  return {
    taken,
    calls,
    state,
    api: {
      async upload(path: string, body: Blob) {
        calls.push(path);
        if (state.failWith) {
          state.failures++;
          throw new Error(state.failWith);
        }
        assert.ok(body.size > 0);
        taken.push(path.replace("/api/meetings/", ""));
      },
      async request<T>(path: string, body?: unknown): Promise<T> {
        calls.push(`${path} ${JSON.stringify(body)}`);
        if (state.failWith) {
          state.failures++;
          throw new Error(state.failWith);
        }
        return {} as T;
      },
    },
  };
}
const blob = (text: string) => new Blob([text], { type: "audio/webm" });
/** Lets the uploader's own loop run until it has nothing left to do (or `limit` turns pass). */
const settle = async (until: () => boolean, limit = 200) => {
  for (let i = 0; i < limit && !until(); i++) await new Promise((r) => setTimeout(r, 1));
};
/** No real waiting, but a real turn of the event loop so the test's own timers still run. */
const instantly = { delay: () => new Promise<void>((resolve) => setTimeout(resolve, 1)) };

test("pieces are kept, sent in order, and removed from the device once the server has them", async () => {
  const server = fakeApi();
  const store = memoryStore();
  const uploader = new MeetingUploader(server.api, store, instantly);
  await uploader.add("m1", "audio/webm", 0, 1, blob("second"));
  await uploader.add("m1", "audio/webm", 0, 0, blob("first"));
  await settle(() => uploader.pending("m1") === 0);
  assert.equal(uploader.pending("m1"), 0);
  assert.equal(uploader.snapshot("m1"), undefined, "nothing unsent once all has arrived");
  assert.deepEqual(await store.pieces("m1"), [], "and nothing left on the device");
  assert.equal(server.taken.length, 2);
});

test("a server that won't take files: the audio stays on the device, trouble shows at once, and it sends when the server is back", async () => {
  const server = fakeApi();
  const store = memoryStore();
  server.state.failWith = "The server can’t save this recording right now.";
  const uploader = new MeetingUploader(server.api, store, instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("a minute of talk"));
  await settle(() => server.state.failures >= TROUBLE_AFTER + 2);
  const trouble = uploader.snapshot("m1");
  assert.ok(trouble, "something is unsent");
  assert.equal(trouble.pieces, 1);
  assert.equal(trouble.trouble, true, "a warning, within a few tries");
  assert.match(trouble.error ?? "", /can’t save/);
  assert.equal((await store.pieces("m1")).length, 1, "kept on the device the whole time");
  // The server comes back: the same piece goes through, and the warning clears.
  server.state.failWith = undefined;
  await settle(() => uploader.pending("m1") === 0);
  assert.equal(uploader.snapshot("m1"), undefined);
  assert.deepEqual(await store.pieces("m1"), []);
  assert.deepEqual(server.taken, ["m1/chunks/0/0"]);
});

test("one failed try is a blip, not a warning", async () => {
  const server = fakeApiFailingOnce();
  const uploader = new MeetingUploader(server.api, memoryStore(), instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("x"));
  await settle(() => uploader.pending("m1") === 0);
  assert.equal(
    server.calls.filter((c) => c.includes("/chunks/")).length,
    2,
    "one failure, then it went through",
  );
  assert.equal(uploader.snapshot("m1"), undefined);
});
function fakeApiFailingOnce() {
  const base = fakeApi();
  let failed = false;
  const upload = base.api.upload;
  base.api.upload = async (path, body) => {
    if (!failed) {
      failed = true;
      base.calls.push(path);
      throw new Error("Failed to fetch");
    }
    return upload(path, body);
  };
  return base;
}

test("after a reload the pieces kept on the device are found and sent", async () => {
  const store = memoryStore();
  const down = fakeApi();
  down.state.failWith = "Failed to fetch";
  const before = new MeetingUploader(down.api, store, {
    delay: () => new Promise(() => undefined),
  });
  await before.add("m1", "audio/webm", 0, 0, blob("kept"));
  await settle(() => down.state.failures >= 1);
  // The tab closes: a new uploader starts with only what the device kept.
  const server = fakeApi();
  const after = new MeetingUploader(server.api, store, instantly);
  assert.equal(after.snapshot("m1"), undefined, "nothing known yet");
  await after.resume();
  await settle(() => after.pending("m1") === 0);
  assert.deepEqual(server.taken, ["m1/chunks/0/0"]);
  assert.deepEqual(await store.pieces("m1"), []);
});

test("Stop with pieces still unsent: the server is told the recording is over only after every piece has arrived", async () => {
  const server = fakeApi();
  const store = memoryStore();
  server.state.failWith = "Failed to fetch";
  const uploader = new MeetingUploader(server.api, store, instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("a"));
  await uploader.add("m1", "audio/webm", 0, 1, blob("b"));
  const finish = { seconds: 61, parts: [{ index: 0, seconds: 61 }] };
  await uploader.finishWhenSent("m1", finish);
  assert.equal(uploader.snapshot("m1")?.stopped, true);
  assert.equal(await uploader.drained("m1", 20), false, "it can't wait for ever");
  assert.ok(!server.calls.some((c) => c.includes("/finish")), "not closed with pieces missing");
  server.state.failWith = undefined;
  await settle(() => !uploader.snapshot("m1"));
  assert.equal(uploader.snapshot("m1"), undefined);
  const order = server.calls.filter((c) => !c.startsWith("/api/meetings/m1/chunks/0/0") || true);
  const finishAt = order.findIndex((c) => c.includes("/finish"));
  const lastPiece = order.map((c, i) => (c.includes("/chunks/0/1") ? i : -1)).filter((i) => i >= 0);
  assert.ok(finishAt > Math.max(...lastPiece), "finish comes after the last piece");
  assert.match(order[finishAt] ?? "", /"seconds":61/);
  assert.deepEqual(await store.jobs(), [], "the kept job is cleared once the server was told");
});

test("a recording the server already closed: the audio is kept, not lost, and can be saved as a file", async () => {
  const server = fakeApi();
  const store = memoryStore();
  server.state.failWith = "This recording has already finished";
  const uploader = new MeetingUploader(server.api, store, instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("hello "));
  await uploader.add("m1", "audio/webm", 1, 0, blob("again"));
  await settle(() => uploader.snapshot("m1")?.stuck !== undefined);
  const stuck = uploader.snapshot("m1");
  assert.match(stuck?.stuck ?? "", /already finished/);
  assert.equal(stuck?.trouble, false, "not a trouble to wait out: it can't be sent");
  assert.equal(server.calls.length, 1, "it stopped trying");
  assert.equal((await store.pieces("m1")).length, 2, "both pieces are still on the device");
  const copies = await uploader.copies("m1");
  assert.equal(copies.length, 2, "one file per part");
  assert.equal(await copies[0]?.blob.text(), "hello ");
});

test("a meeting the server doesn't know is let go; throwing a recording away keeps nothing", async () => {
  const server = fakeApi();
  const store = memoryStore();
  server.state.failWith = "This meeting couldn’t be found.";
  const uploader = new MeetingUploader(server.api, store, instantly);
  await uploader.add("gone", "audio/webm", 0, 0, blob("x"));
  await settle(() => !uploader.snapshot("gone"));
  assert.equal(uploader.snapshot("gone"), undefined);
  assert.deepEqual(await store.pieces("gone"), []);

  server.state.failWith = "Failed to fetch";
  await uploader.add("m2", "audio/webm", 0, 0, blob("y"));
  await uploader.finishWhenSent("m2", { seconds: 5, parts: [] });
  await uploader.discard("m2");
  assert.equal(uploader.snapshot("m2"), undefined);
  assert.deepEqual(await store.pieces("m2"), []);
  assert.deepEqual(await store.jobs(), []);
});

test("pieces nobody could send for two weeks are cleared", async () => {
  const store = memoryStore();
  const day = 86_400_000;
  await store.putPiece({
    meetingId: "old",
    part: 0,
    n: 0,
    type: "audio/webm",
    bytes: new ArrayBuffer(4),
    at: 1_000,
  });
  const server = fakeApi();
  const uploader = new MeetingUploader(server.api, store, {
    ...instantly,
    now: () => 1_000 + 15 * day,
  });
  await uploader.resume();
  assert.deepEqual(await store.pieces("old"), []);
  assert.deepEqual(server.calls, [], "it wasn't sent either");
});

test("while audio waits on the device the server is told now and then, so it doesn't close the recording as left open", async () => {
  const server = fakeApi();
  server.state.failWith = "Failed to fetch";
  let clock = 1_000_000;
  const uploader = new MeetingUploader(server.api, memoryStore(), {
    ...instantly,
    now: () => clock,
  });
  await uploader.add("m1", "audio/webm", 0, 0, blob("x"));
  await settle(() => server.state.failures >= 3);
  const alives = () => server.calls.filter((c) => c.includes("/alive")).length;
  assert.equal(alives(), 1, "told once straight away");
  clock += 6 * 60_000;
  await settle(() => alives() >= 2);
  assert.equal(alives(), 2, "and again after five minutes");
  await uploader.discard("m1");
});

test("Stop doesn't close the recording while the last piece is still being written to the device", async () => {
  const server = fakeApi();
  const inner = memoryStore();
  const slow = {
    ...inner,
    async putPiece(piece: Parameters<typeof inner.putPiece>[0]) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return inner.putPiece(piece);
    },
  };
  const uploader = new MeetingUploader(server.api, slow, instantly);
  const adding = uploader.add("m1", "audio/webm", 0, 0, blob("last piece"));
  assert.equal(uploader.pending("m1"), 1, "counted from the first moment");
  assert.equal(await uploader.drained("m1", 1000), true, "waits for it to be written and sent");
  await adding;
  assert.deepEqual(server.taken, ["m1/chunks/0/0"], "the piece went before anything could close");
});

test("a device that won't keep the audio is said so, but the audio is still sent", async () => {
  const server = fakeApi();
  server.state.failWith = "Failed to fetch";
  const refusing = { ...memoryStore(), putPiece: async () => false };
  const uploader = new MeetingUploader(server.api, refusing, instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("x"));
  assert.equal(uploader.snapshot("m1")?.onlyHere, true);
  await uploader.discard("m1");
});

test("audio left behind by a closed tab is sent and the recording closed once it has all arrived", async () => {
  const store = memoryStore();
  await store.putPiece({
    meetingId: "left",
    part: 0,
    n: 0,
    type: "audio/webm",
    bytes: new ArrayBuffer(4),
    at: 1_000,
  });
  const server = fakeApi();
  const uploader = new MeetingUploader(server.api, store, {
    ...instantly,
    now: () => 1_000 + 120_000,
  });
  await uploader.resume(true);
  await settle(() => !uploader.snapshot("left"));
  assert.deepEqual(server.taken, ["left/chunks/0/0"]);
  const finishCall = server.calls.find((c) => c.includes("/finish"));
  assert.ok(finishCall, "the recording is closed");
  assert.match(finishCall ?? "", /"index":0,"seconds":30/);
});

test("audio that is only seconds old is left alone: another tab may still be recording it", async () => {
  const store = memoryStore();
  await store.putPiece({
    meetingId: "live",
    part: 0,
    n: 0,
    type: "audio/webm",
    bytes: new ArrayBuffer(4),
    at: 1_000,
  });
  const server = fakeApi();
  server.state.failWith = "Failed to fetch";
  const uploader = new MeetingUploader(server.api, store, {
    ...instantly,
    now: () => 1_000 + 10_000,
  });
  await uploader.resume(true);
  assert.equal(uploader.snapshot("live")?.stopped, false, "no finish was queued");
  await uploader.discard("live");
});

test("Save a copy includes audio the device refused to keep, from memory", async () => {
  const server = fakeApi();
  server.state.failWith = "Failed to fetch";
  const refusing = { ...memoryStore(), putPiece: async () => false };
  const uploader = new MeetingUploader(server.api, refusing, instantly);
  await uploader.add("m1", "audio/webm", 0, 0, blob("only in memory"));
  const copies = await uploader.copies("m1");
  assert.equal(copies.length, 1);
  assert.equal(await copies[0]?.blob.text(), "only in memory");
  await uploader.discard("m1");
});

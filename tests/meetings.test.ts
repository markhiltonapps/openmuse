import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  type DumpItem,
  type Meeting,
  Meetings,
  parseDump,
  parseNotes,
  type SonioxToken,
  SonioxTranscriber,
  segmentsOf,
} from "../apps/server/src/meetings.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";

let directory: string;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "openmuse-meetings-"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const words = (speaker: string, text: string, start: number): SonioxToken[] =>
  text.split(" ").map((word, i) => ({
    text: i ? ` ${word}` : word,
    speaker,
    start_ms: start + i * 300,
    end_ms: start + i * 300 + 250,
  }));

/** A stand-in for Soniox's file transcription: what's sent, and words for each file. */
function fakeSoniox(script: SonioxToken[][], options: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const uploads: number[] = [];
  const created: Record<string, unknown>[] = [];
  let files = 0;
  let checks = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = url.replace("https://api.soniox.com", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    assert.equal(
      (init?.headers as Record<string, string> | undefined)?.Authorization,
      "Bearer soniox-test-key",
    );
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/v1/files" && method === "POST") {
      const form = init?.body as FormData;
      uploads.push((form.get("file") as Blob).size);
      return Response.json({ id: `file-${files++}` });
    }
    if (path === "/v1/transcriptions" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      created.push(body);
      return Response.json({ id: `tr-${String(body.file_id).slice(5)}` });
    }
    const status = /^\/v1\/transcriptions\/tr-(\d+)$/.exec(path);
    if (status) {
      if (options.fail) return Response.json({ status: "error", error_message: "bad audio" });
      // The first look finds it still working.
      return Response.json({ status: checks++ === 0 ? "processing" : "completed" });
    }
    const transcript = /^\/v1\/transcriptions\/tr-(\d+)\/transcript$/.exec(path);
    if (transcript) return Response.json({ text: "", tokens: script[Number(transcript[1])] ?? [] });
    return new Response(JSON.stringify({ message: "not here" }), { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    uploads,
    created,
    soniox: new SonioxTranscriber("soniox-test-key", fetcher),
  };
}

async function setup(
  script: SonioxToken[][],
  options: {
    fail?: boolean;
    hours?: number;
    notes?: boolean;
    dump?: boolean;
    dumpOff?: boolean;
    dumpBad?: { on: boolean };
  } = {},
) {
  const db = await createStore();
  const blobs = new DiskBlobs(await mkdtemp(join(directory, "blobs-")));
  const clock = { now: Date.parse("2026-10-17T15:00:00Z") };
  const usage = new UsageMeter(db, undefined, () => new Date(clock.now));
  const fake = fakeSoniox(script, options);
  const told: Meeting[] = [];
  const sentToNotes: string[] = [];
  const added: string[] = [];
  const meetings = new Meetings(
    db,
    blobs,
    { sign: (owner, path) => `http://api${path}?owner=${owner}&signature=x` },
    {
      soniox: fake.soniox,
      usage,
      monthlyHours: options.hours ?? 10,
      now: () => clock.now,
      pollMs: 1,
      timeZone: async () => "America/New_York",
      writeNotes:
        options.notes === false
          ? undefined
          : async (_owner, transcript) => {
              sentToNotes.push(transcript);
              return parseNotes(
                `Here you go: ${JSON.stringify({
                  title: "Q4 launch plan",
                  summary: "They agreed the launch date and who does what.",
                  decisions: ["Launch on November 3"],
                  actionItems: [
                    { text: "Send the press kit", who: "Dana", due: "Friday" },
                    { text: "Book the venue", who: "Speaker 2" },
                  ],
                  speakers: { "1": "Sarah" },
                })}`,
              );
            },
      ...(options.dump
        ? {
            dumpAvailable: () => !options.dumpOff,
            sortDump: async (_owner: string, transcript: string) => {
              sentToNotes.push(transcript);
              if (options.dumpBad?.on) return undefined;
              return parseDump(
                JSON.stringify({
                  title: "Weekend plans",
                  summary: "Things for the weekend.",
                  items: [
                    { kind: "reminder", text: "Call the plumber", at: "2026-10-18T09:00" },
                    { kind: "reminder", text: "Buy a gift", at: "tomorrow" },
                    { kind: "task", text: "Find three hotels in Austin" },
                    {
                      kind: "fact",
                      text: "Works weekdays 7 to 3",
                      key: "work.hours",
                      value: "Weekdays 7 to 3",
                    },
                    { kind: "fact", text: "Likes tea", key: "not.a.key", value: "tea" },
                    { kind: "note", text: "Try the new bakery" },
                  ],
                }),
              );
            },
            addDumpItem: async (_owner: string, _meeting: Meeting, item: DumpItem) => {
              if (item.text.includes("hotels")) throw new Error("no jobs today");
              added.push(item.id);
              return "Done";
            },
          }
        : {}),
      notify: async (_owner, meeting) => {
        told.push(meeting);
      },
    },
  );
  return { db, blobs, clock, usage, meetings, fake, told, sentToNotes, added };
}

test("Soniox's tokens become turns, one per speaker change", () => {
  const segments = segmentsOf(
    [
      ...words("1", "Hi everyone, let's start.", 0),
      ...words("2", "Sounds good.", 2000),
      ...words("1", "First item.", 4000),
    ],
    1000,
  );
  assert.deepEqual(
    segments.map((s) => [s.speaker, s.text, s.start]),
    [
      ["1", "Hi everyone, let's start.", 1000],
      ["2", "Sounds good.", 3000],
      ["1", "First item.", 5000],
    ],
  );
  assert.deepEqual(segmentsOf([], 0), []);
});

test("notes are read from the model's JSON, and junk gives none", () => {
  assert.deepEqual(
    parseNotes('```json\n{"title":"Budget","summary":"Short.","decisions":[]}\n```'),
    {
      title: "Budget",
      summary: "Short.",
      decisions: [],
    },
  );
  assert.equal(parseNotes("I couldn't do that."), undefined);
  const odd = parseNotes('{"title": 5, "decisions": "none", "actionItems": [{"text": "Call Bo"}]}');
  assert.equal(odd?.title, undefined, "a wrong field is dropped, not the whole note");
  assert.deepEqual(odd?.actionItems, [{ text: "Call Bo" }]);
});

test("a meeting in two parts is joined, written up, timed and noted; Soniox keeps nothing", async () => {
  const { db, blobs, clock, usage, meetings, fake, told, sentToNotes } = await setup([
    [...words("1", "I'm Sarah. Let's plan the launch.", 0), ...words("2", "November works.", 3000)],
    [...words("1", "Dana sends the press kit.", 500)],
  ]);
  const { meeting, maxSeconds } = await meetings.start("p1", { mime: "audio/webm;codecs=opus" });
  assert.equal(meeting.status, "recording");
  assert.equal(maxSeconds, 4 * 3600, "four hours at most, within the 10 hours a month");
  assert.equal(meeting.title, "Meeting at 11:00 AM", "in their time zone; the date is under it");
  // Part 0 in two pieces, then the phone locked and part 1 began.
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1, 2, 3]));
  await meetings.chunk("p1", meeting.id, 0, 1, new Uint8Array([4, 5]));
  await meetings.chunk("p1", meeting.id, 0, 1, new Uint8Array([4, 5])); // sent again: replaced
  await meetings.chunk("p1", meeting.id, 1, 0, new Uint8Array([9, 9, 9, 9]));
  clock.now += 20 * 60_000;
  const finished = await meetings.finish("p1", meeting.id, {
    seconds: 1200,
    parts: [
      { index: 0, seconds: 600 },
      // The phone was locked for three minutes before part 1.
      { index: 1, seconds: 600, missedBefore: 180 },
    ],
  });
  assert.equal(finished.status, "transcribing");
  await meetings.process("p1", meeting.id);

  const read = await meetings.read("p1", meeting.id);
  assert.equal(read.status, "done");
  assert.equal(read.title, "Q4 launch plan", "the notes name an unnamed meeting");
  assert.deepEqual(read.decisions, ["Launch on November 3"]);
  assert.deepEqual(read.actionItems, [
    { text: "Send the press kit", who: "Dana", due: "Friday" },
    { text: "Book the venue", who: "Speaker 2" },
  ]);
  assert.deepEqual(read.speakers, { "1": "Sarah" });
  assert.deepEqual(
    read.segments.map((s) => [s.speaker, s.text, s.start]),
    [
      ["1", "I'm Sarah. Let's plan the launch.", 0],
      ["2", "November works.", 3000],
      ["2:1", "Dana sends the press kit.", 600_500],
    ],
    "the second part's words come after the first part's ten minutes",
  );
  assert.match(sentToNotes[0] ?? "", /^Speaker 1: I'm Sarah/);
  // The pause is marked where it was, for the page and for the notes.
  assert.deepEqual(read.gaps, [{ at: 600_000, seconds: 180 }]);
  assert.equal(read.missedSeconds, 180);
  assert.match(
    sentToNotes[0] ?? "",
    /November works\.\n\[Recording paused here: nothing was recorded for about 3 minutes\]\nSpeaker 1 \(after pause\): Dana/,
  );
  assert.deepEqual(fake.uploads, [5, 4], "each part's pieces joined into one file");
  assert.equal(fake.created[0]?.model, "stt-async-v5");
  assert.equal(fake.created[0]?.enable_speaker_diarization, true);
  assert.ok(fake.calls.includes("DELETE /v1/files/file-0"), "the audio is removed from Soniox");
  assert.ok(fake.calls.includes("DELETE /v1/transcriptions/tr-1"));
  assert.equal(told.length, 1, "one notification when the notes are ready");
  assert.equal(read.audio, true);
  assert.equal(read.audioParts.length, 2);
  assert.match(read.audioParts[0]?.url ?? "", /\/api\/meetings\/.+\/audio\/0\?/);
  assert.deepEqual([...(await meetings.audio("p1", meeting.id, 0)).bytes], [1, 2, 3, 4, 5]);
  assert.deepEqual(await blobs.list(`meetings/${meeting.id}/c-`), [], "the pieces are tidied");

  // 20 minutes of transcription at $0.10 an hour.
  const month = await usage.month("p1");
  const line = month.lines.find((l) => l.kind === "meetings");
  assert.equal(line?.seconds, 1200);
  assert.ok(Math.abs((line?.cost ?? 0) - 0.0333) < 0.001);
  assert.equal(month.voiceMinutes, 0, "recordings aren't counted as live talk");
  assert.equal((await meetings.allowance("p1")).usedMinutes, 20);

  // Search finds words that were said and words in the notes.
  const found = await meetings.search("p1", "press kit");
  assert.equal(found[0]?.id, meeting.id);
  assert.ok(found[0]?.found.some((line) => line.includes("Dana sends the press kit")));
  assert.equal((await meetings.search("p1", "launch date"))[0]?.id, meeting.id);
  assert.deepEqual(await meetings.search("p1", "giraffes"), []);
  assert.match(await meetings.context("p1"), /Q4 launch plan \(2026-10-17, 20 min, done; id /);

  // Naming a speaker changes the words people search and the agent reads.
  await meetings.update("p1", meeting.id, { speakers: { "2": "Dana" }, title: "Launch" });
  const renamed = await meetings.read("p1", meeting.id);
  assert.equal(renamed.title, "Launch");
  assert.equal(
    renamed.actionItems[1]?.who,
    "Dana",
    "an action item says the speaker's name once it's known",
  );
  assert.equal((await meetings.search("p1", "dana november"))[0]?.id, meeting.id);

  // After 30 days the audio goes; the words stay.
  clock.now += 31 * 86_400_000;
  await meetings.maintain();
  const later = await meetings.read("p1", meeting.id);
  assert.equal(later.audio, false);
  assert.deepEqual(later.audioParts, []);
  assert.equal(later.segments.length, 3);
  await assert.rejects(meetings.audio("p1", meeting.id, 0), /no longer kept/);
  assert.equal((await db.list("p1", "meetings")).length, 1);

  await meetings.remove("p1", meeting.id);
  assert.deepEqual(await meetings.list("p1"), []);
  assert.deepEqual(await blobs.list(`meetings/${meeting.id}/`), []);
  assert.equal(await db.get("p1", "meeting-transcripts", meeting.id), null);
});

test("the month's hours are a limit, pieces stop after the end, and discarding keeps nothing", async () => {
  const { meetings, clock, blobs } = await setup([[]], { hours: 1 });
  const first = (await meetings.start("p1", {})).meeting;
  assert.equal((await meetings.start("p1", {})).maxSeconds, 3600, "time only counts once used");
  clock.now += 61 * 60_000;
  await assert.rejects(meetings.start("p1", {}), /used this month’s 1 hour of/);
  await assert.rejects(meetings.start("p1", { mime: "video/quicktime" }), /can’t record meetings/);
  // A piece too long after the time allowed is turned away.
  clock.now += 20 * 60_000;
  await assert.rejects(
    meetings.chunk("p1", first.id, 0, 0, new Uint8Array([1])),
    /run past its time/,
  );
  await meetings.discard("p1", first.id);
  assert.equal((await meetings.list("p1")).length, 1, "only the other one is left");
  assert.deepEqual(await blobs.list(`meetings/${first.id}/`), []);
  await assert.rejects(meetings.read("p2", first.id), /couldn’t be found/, "one person's alone");
  await assert.rejects(meetings.read("p1", "../../etc"), /couldn’t be found/);
});

test("a recording doesn't start into storage that refuses files, and a refused piece says so", async () => {
  const { meetings, blobs } = await setup([[]]);
  const real = blobs.put.bind(blobs);
  // Healthy storage: it starts, and the test file it used is gone.
  const started = (await meetings.start("p1", {})).meeting;
  assert.deepEqual(await blobs.list("meetings/check-"), []);
  // The bucket starts refusing (a reset key): no new recording begins, and the person is told.
  blobs.put = async () => {
    throw new Error("The file bucket refused to save a file (403 InvalidAccessKeyId)");
  };
  await assert.rejects(
    meetings.start("p1", {}),
    (error: Error & { status?: number }) =>
      /can’t save recordings right now, so nothing was recorded/.test(error.message) &&
      error.status === 503,
  );
  assert.equal((await meetings.list("p1")).length, 1, "no empty recording was made");
  // A recording already going gets a clear 503 for each piece, so the app keeps it and retries.
  await assert.rejects(
    meetings.chunk("p1", started.id, 0, 0, new Uint8Array([1, 2, 3])),
    (error: Error & { status?: number }) =>
      /kept on this device and sent again when it can/.test(error.message) && error.status === 503,
  );
  blobs.put = real;
  await meetings.chunk("p1", started.id, 0, 0, new Uint8Array([1, 2, 3]));
  assert.equal((await blobs.list(`meetings/${started.id}/`)).length, 1, "it works again");
});

test("a recording whose app still holds unsent audio isn't left open, until the time allowed runs out", async () => {
  const { meetings, clock, db } = await setup([[]]);
  const first = (await meetings.start("p1", {})).meeting;
  await meetings.chunk("p1", first.id, 0, 0, new Uint8Array([1, 2]));
  clock.now += 40 * 60_000;
  assert.deepEqual(await meetings.alive("p1", first.id), { ok: true });
  clock.now += 30 * 60_000;
  await meetings.maintain();
  const still = await db.get<Meeting>("p1", "meetings", first.id);
  assert.equal(
    still?.status,
    "recording",
    "70 minutes after the piece, but 30 after the last word from the app",
  );
  clock.now += 20 * 3600_000;
  assert.deepEqual(
    await meetings.alive("p1", first.id),
    { ok: false },
    "never past the time allowed",
  );
  await assert.rejects(meetings.alive("p2", first.id), /couldn’t be found/, "one person's alone");
});

test("a recording left open is written up from what arrived; a failure can be tried again", async () => {
  const soniox = { fail: true };
  // Trying again sends the audio again: Soniox sees a second file.
  const said = words("1", "Short one.", 0);
  const { meetings, clock, told } = await setup([said, said], soniox);
  const { meeting } = await meetings.start("p1", {});
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([7, 7]));
  clock.now += 5 * 60_000;
  await meetings.chunk("p1", meeting.id, 0, 1, new Uint8Array([8]));
  // The app closed: nothing new for 45 minutes.
  clock.now += 30 * 60_000;
  await meetings.maintain();
  assert.equal(
    (await meetings.read("p1", meeting.id)).status,
    "recording",
    "a pause isn't the end",
  );
  clock.now += 16 * 60_000;
  await meetings.maintain();
  // The write-up runs in the background; under a full test run it can take a moment.
  let read = await meetings.read("p1", meeting.id);
  for (let waited = 0; read.status !== "failed" && waited < 5000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    read = await meetings.read("p1", meeting.id);
  }
  assert.equal(read.status, "failed");
  assert.equal(read.error, "The words couldn’t be written down this time. Try again in a minute.");
  assert.equal(read.seconds, 330, "the time up to the last piece, plus its length");
  assert.deepEqual(
    told.map((m) => m.status),
    ["failed"],
    "told it couldn't be written up",
  );
  await assert.rejects(
    meetings.chunk("p1", meeting.id, 0, 2, new Uint8Array([1])),
    /already finished/,
  );

  // Soniox works again: Try again picks up where it stopped.
  soniox.fail = false;
  const retried = await meetings.retry("p1", meeting.id);
  assert.equal(retried.status, "transcribing");
  await meetings.process("p1", meeting.id);
  read = await meetings.read("p1", meeting.id);
  assert.equal(read.status, "done");
  assert.equal(read.segments[0]?.text, "Short one.");
  assert.deepEqual(
    told.map((m) => m.status),
    ["failed", "done"],
  );
});

test("with no model for notes, the words still come and the recording is done", async () => {
  const { meetings, told } = await setup([words("1", "Just me talking.", 0)], { notes: false });
  const { meeting } = await meetings.start("p1", {});
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1]));
  await meetings.finish("p1", meeting.id, { seconds: 30 });
  await meetings.process("p1", meeting.id);
  const read = await meetings.read("p1", meeting.id);
  assert.equal(read.status, "done");
  assert.equal(read.summary, "");
  assert.equal(read.segments[0]?.text, "Just me talking.");
  assert.match(read.title, /^Meeting at /, "the time title stays");
  assert.equal(told.length, 1);
});

test("silence is done straight away, and nothing recorded is a clear failure", async () => {
  const { meetings } = await setup([[]]);
  const quiet = (await meetings.start("p1", {})).meeting;
  await meetings.chunk("p1", quiet.id, 0, 0, new Uint8Array([1]));
  await meetings.finish("p1", quiet.id, { seconds: 10 });
  await meetings.process("p1", quiet.id);
  assert.equal(
    (await meetings.read("p1", quiet.id)).summary,
    "No speech was heard in this recording.",
  );
  const empty = (await meetings.start("p1", {})).meeting;
  await meetings.finish("p1", empty.id, { seconds: 10 });
  await meetings.process("p1", empty.id);
  const failed = await meetings.read("p1", empty.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /No sound reached the server/);
});

let db: Store, server: Awaited<ReturnType<typeof createApp>>, token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
test("the recorder's routes: start, pieces, stop, the notes, and the audio by range", async () => {
  db = await createStore();
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
  const fake = fakeSoniox([words("1", "Hello from the room.", 0)]);
  server = await createApp(db, config, { soniox: fake.soniox });
  try {
    const session = await server.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    token = (await session.json()).token;
    const empty = await (await server.app.request("/api/meetings", { headers: auth() })).json();
    assert.equal(empty.available, true);
    assert.equal(empty.allowance.limitHours, 10);
    assert.deepEqual(empty.meetings, []);

    const started = await server.app.request("/api/meetings", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ mime: "audio/mp4" }),
    });
    assert.equal(started.status, 201);
    const { meeting } = await started.json();
    const audio = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
    const put = await server.app.request(`/api/meetings/${meeting.id}/chunks/0/0`, {
      method: "PUT",
      headers: { ...auth(), "Content-Type": "audio/mp4" },
      body: audio,
    });
    assert.equal(put.status, 200);
    const done = await server.app.request(`/api/meetings/${meeting.id}/finish`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: 12 }),
    });
    assert.equal((await done.json()).status, "transcribing");
    // Written up in the background; the read shows it once it's done.
    let read: { status: string; segments: { text: string }[]; audioParts: { url: string }[] };
    for (let i = 0; ; i++) {
      read = await (
        await server.app.request(`/api/meetings/${meeting.id}`, { headers: auth() })
      ).json();
      if (read.status === "done" || i > 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(read.status, "done");
    assert.equal(read.segments[0]?.text, "Hello from the room.");
    // The signed link plays without a session, and in ranges for a phone's player.
    const link = new URL(read.audioParts[0]?.url ?? "");
    const whole = await server.app.request(`${link.pathname}${link.search}`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("content-type"), "audio/mp4");
    assert.equal((await whole.arrayBuffer()).byteLength, 100);
    const part = await server.app.request(`${link.pathname}${link.search}`, {
      headers: { Range: "bytes=10-19" },
    });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 10-19/100");
    assert.deepEqual(
      [...new Uint8Array(await part.arrayBuffer())],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    );
    const unsigned = await server.app.request(link.pathname);
    assert.equal(unsigned.status, 401);

    const renamed = await server.app.request(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Kickoff", speakers: { "1": "Ana" } }),
    });
    assert.equal((await renamed.json()).title, "Kickoff");
    const gone = await server.app.request(`/api/meetings/${meeting.id}`, {
      method: "DELETE",
      headers: auth(),
    });
    assert.deepEqual(await gone.json(), { deleted: true });
  } finally {
    await server.agent.stop();
    await db.close();
  }
});

test("without a Soniox key the recorder isn't offered", async () => {
  const store = await createStore();
  const meetings = new Meetings(
    store,
    new DiskBlobs(directory),
    { sign: () => "" },
    { monthlyHours: 10 },
  );
  assert.equal(meetings.available, false);
  await assert.rejects(meetings.start("p1", {}), /isn’t set up on this server yet/);
  await store.close();
});

test("a brain dump is sorted into things to add, and nothing is added until chosen", async () => {
  const { meetings, told, added } = await setup(
    [[...words("1", "Call the plumber tomorrow.", 0)]],
    {
      dump: true,
    },
  );
  const { meeting, maxSeconds } = await meetings.start("p1", { mime: "audio/webm", kind: "dump" });
  assert.equal(maxSeconds, 30 * 60, "half an hour at most");
  assert.equal(meeting.kind, "dump");
  assert.match(meeting.title, /^Brain dump at /);
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1, 2, 3]));
  await meetings.finish("p1", meeting.id, { seconds: 60 });
  await meetings.process("p1", meeting.id);
  const read = await meetings.read("p1", meeting.id);
  assert.equal(read.status, "done");
  assert.equal(read.title, "Weekend plans");
  assert.deepEqual(
    read.dump?.map((item) => [item.id, item.kind]),
    [
      ["d1", "reminder"],
      ["d2", "note"], // no real time given: kept as a note
      ["d3", "task"],
      ["d4", "fact"],
      ["d5", "note"], // not a key About you keeps: kept as a note
      ["d6", "note"],
    ],
  );
  assert.deepEqual(added, [], "nothing is added by sorting");
  assert.match(told.at(-1)?.title ?? "", /Weekend plans/);

  const first = await meetings.addDump("p1", meeting.id, ["d1", "d3", "d4"]);
  assert.deepEqual(added, ["d1", "d4"]);
  const states = Object.fromEntries(
    (first.dump ?? []).filter((item) => item.state).map((item) => [item.id, item.state]),
  );
  assert.deepEqual(states, { d1: "added", d3: "failed", d4: "added" });
  assert.equal(first.dump?.find((item) => item.id === "d3")?.detail, "Couldn’t add this one.");
  // Again: the added ones are left alone; the failed one is tried again.
  await meetings.addDump("p1", meeting.id, "all");
  assert.deepEqual(added, ["d1", "d4", "d2", "d5", "d6"]);
  await assert.rejects(meetings.addDump("p1", meeting.id, ["d9"]), /isn’t in this brain dump/);
});

test("a brain dump asks for no more than half an hour, and a meeting still gets four hours", async () => {
  const { meetings } = await setup([], { dump: true });
  assert.equal((await meetings.start("p1", { mime: "audio/webm" })).maxSeconds, 4 * 3600);
});

test("a brain dump that can't be sorted keeps the words and says so", async () => {
  const { meetings } = await setup([[...words("1", "Remember the milk.", 0)]], { notes: false });
  const { meeting } = await meetings.start("p1", { mime: "audio/webm", kind: "dump" });
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1]));
  await meetings.finish("p1", meeting.id, { seconds: 30 });
  await meetings.process("p1", meeting.id);
  const read = await meetings.read("p1", meeting.id);
  assert.equal(read.status, "done");
  assert.equal(read.dump, undefined, "no list at all, so the page can say it couldn’t sort");
  assert.match(read.summary ?? "", /couldn’t sort this one/);
  await assert.rejects(meetings.addDump("p1", meeting.id, "all"), /isn’t sorted yet/);
});

test("a dump's items are cleaned and junk is dropped", () => {
  const result = parseDump(
    '{"items":[{"kind":"reminder","text":"Pay rent","at":"2026-11-01T09:00"},{"kind":"bad","text":"x"},{"kind":"task"},{"kind":"fact","text":"Rents","key":"household.home","value":"Rent"}]}',
  );
  assert.deepEqual(result?.items, [
    { kind: "reminder", text: "Pay rent", at: "2026-11-01T09:00" },
    { kind: "fact", text: "Rents", key: "household.home", value: "Rent" },
  ]);
  assert.equal(parseDump("nope"), undefined);
});

test("a brain dump isn't started when no model can sort it", async () => {
  const { meetings } = await setup([], { dump: true, dumpOff: true });
  await assert.rejects(
    meetings.start("p1", { mime: "audio/webm", kind: "dump" }),
    /needs the AI model/,
  );
  assert.equal(meetings.dumpAvailable, false);
  // A meeting still starts.
  assert.equal((await meetings.start("p1", { mime: "audio/webm" })).meeting.status, "recording");
});

test("a reply that can't be read fails the dump so Try again works", async () => {
  const bad = { on: true };
  const { meetings } = await setup([[...words("1", "Call the plumber.", 0)]], {
    dump: true,
    dumpBad: bad,
  });
  const { meeting } = await meetings.start("p1", { mime: "audio/webm", kind: "dump" });
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1]));
  await meetings.finish("p1", meeting.id, { seconds: 30 });
  await meetings.process("p1", meeting.id);
  const failed = await meetings.read("p1", meeting.id);
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /couldn’t sort this one\. Try again/);
  bad.on = false;
  await meetings.retry("p1", meeting.id);
  await meetings.process("p1", meeting.id);
  const again = await meetings.read("p1", meeting.id);
  assert.equal(again.status, "done");
  assert.equal(again.dump?.length, 6);
});

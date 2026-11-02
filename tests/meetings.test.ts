import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../apps/server/src/app.ts";
import { DiskBlobs } from "../apps/server/src/blobs.ts";
import type { Config } from "../apps/server/src/config.ts";
import { createStore, type Store } from "../apps/server/src/db.ts";
import {
  type DumpItem,
  fileSafe,
  type Meeting,
  Meetings,
  parseDump,
  parseNotes,
  type SonioxToken,
  SonioxTranscriber,
  segmentsOf,
} from "../apps/server/src/meetings.ts";
import {
  type AudioPart,
  ffmpegAvailable,
  ffmpegMp3,
  type Mp3Encoder,
} from "../apps/server/src/mp3.ts";
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
    mp3?: Mp3Encoder;
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
      mp3: options.mp3,
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
  await assert.rejects(meetings.audio("p1", meeting.id, 0), /isn’t kept any more/);
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

/** A short real recording, made with ffmpeg: a tone of this pitch, in this container. */
function tone(name: string, seconds: number, hz: number, extra: string[]) {
  const path = join(directory, name);
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${hz}:duration=${seconds}`,
    ...extra,
    path,
  ]);
  return path;
}

test("a meeting's file name drops what phones and computers refuse", () => {
  assert.equal(fileSafe("Q4 launch: plan/notes?"), "Q4 launch plannotes");
  assert.equal(fileSafe('  "Budget" <review> | 2026...  '), "Budget review 2026");
  assert.equal(fileSafe("Standup\u0000\u001f"), "Standup");
  assert.equal(fileSafe("???"), "");
  assert.equal(fileSafe("é".repeat(100)).length, 80);
});

test("ffmpeg joins parts made differently into one mono MP3 of the full length", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("ffmpeg isn't installed here");
  // Part 0 is WebM/Opus in stereo at 48 kHz; part 1 is M4A/AAC in mono at 16 kHz (a phone that
  // came back after a lock may record differently), and both must join.
  const first = await readFile(
    tone("p0.webm", 1, 440, ["-ac", "2", "-ar", "48000", "-c:a", "libopus"]),
  );
  const second = await readFile(
    tone("p1.m4a", 0.5, 880, ["-ac", "1", "-ar", "16000", "-c:a", "aac"]),
  );
  const parts: AudioPart[] = [
    { bytes: first, mime: "audio/webm;codecs=opus" },
    { bytes: second, mime: "audio/mp4" },
  ];
  const mp3 = await ffmpegMp3(parts, "Q4 launch plan");
  const out = join(directory, "joined.mp3");
  await import("node:fs/promises").then((fs) => fs.writeFile(out, mp3));
  const info = JSON.parse(
    execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:format_tags=title:stream=codec_name,channels,sample_rate",
      "-of",
      "json",
      out,
    ]).toString(),
  ) as {
    streams: { codec_name: string; channels: number; sample_rate: string }[];
    format: { duration: string; tags?: { title?: string } };
  };
  assert.equal(info.streams[0]?.codec_name, "mp3");
  assert.equal(info.streams[0]?.channels, 1);
  assert.equal(info.streams[0]?.sample_rate, "44100");
  assert.ok(Math.abs(Number(info.format.duration) - 1.5) < 0.2, `length ${info.format.duration}`);
  assert.equal(info.format.tags?.title, "Q4 launch plan");
  await assert.rejects(ffmpegMp3([]), /no audio/);
  await assert.rejects(
    ffmpegMp3([{ bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm" }]),
    /couldn’t be turned into an MP3/,
  );
});

test("the MP3 is made once from every part in order, kept with the audio, and goes with it", async () => {
  const made: AudioPart[][] = [];
  const encoder: Mp3Encoder = async (parts) => {
    made.push(parts);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Uint8Array([0x49, 0x44, 0x33, 7, 7, 7]);
  };
  const { db, blobs, clock, meetings } = await setup([[...words("1", "Hello there.", 0)]], {
    mp3: encoder,
  });
  const { meeting } = await meetings.start("p1", { mime: "audio/webm;codecs=opus" });
  await meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1, 2, 3]));
  await meetings.chunk("p1", meeting.id, 1, 0, new Uint8Array([4, 5]));
  // Still being recorded: no MP3 button, and asking says why.
  assert.equal((await meetings.read("p1", meeting.id)).mp3, false);
  await assert.rejects(meetings.mp3("p1", meeting.id), /still being recorded/);
  await meetings.finish("p1", meeting.id, {
    seconds: 60,
    parts: [
      { index: 0, seconds: 30 },
      { index: 1, seconds: 30 },
    ],
  });
  await meetings.process("p1", meeting.id);
  assert.equal((await meetings.read("p1", meeting.id)).mp3, true);

  // Two taps at once make one MP3, named for the meeting, with a signed link.
  const [a, b] = await Promise.all([
    meetings.mp3("p1", meeting.id),
    meetings.mp3("p1", meeting.id),
  ]);
  assert.equal(made.length, 1);
  assert.deepEqual(
    made[0]?.map((part) => [...part.bytes]),
    [
      [1, 2, 3],
      [4, 5],
    ],
    "part 0 then part 1",
  );
  assert.equal(
    a.name,
    "Q4 launch plan.mp3".replace("Q4 launch plan", (await meetings.read("p1", meeting.id)).title),
  );
  assert.equal(a.bytes, 6);
  assert.match(a.url, /\/api\/meetings\/.+\/mp3\/file\?owner=p1/);
  assert.equal(b.bytes, 6);
  // Asked again, it's the kept one.
  await meetings.mp3("p1", meeting.id);
  assert.equal(made.length, 1);
  assert.ok(await blobs.get(`meetings/${meeting.id}/audio.mp3`));
  // If the recording changed (another part), the old MP3 is out of date and is made again.
  const stored = await db.get<Meeting>("p1", "meetings", meeting.id);
  assert.ok(stored);
  await db.put("p1", "meetings", { ...stored, mp3: { signature: "old", bytes: 1 } });
  await meetings.mp3("p1", meeting.id);
  assert.equal(made.length, 2);
  // After the 30 days the audio is gone, and the MP3 with it.
  clock.now += 31 * 86_400_000;
  await meetings.maintain();
  assert.equal(await blobs.get(`meetings/${meeting.id}/audio.mp3`), null);
  assert.equal((await meetings.read("p1", meeting.id)).mp3, false);
  await assert.rejects(meetings.mp3("p1", meeting.id), /isn’t kept any more/);
});

test("deleting a meeting deletes its MP3, and a server without ffmpeg offers none", async () => {
  const withMp3 = await setup([[...words("1", "Hello.", 0)]], {
    mp3: async () => new Uint8Array([1, 2, 3]),
  });
  const { meeting } = await withMp3.meetings.start("p1", { mime: "audio/webm" });
  await withMp3.meetings.chunk("p1", meeting.id, 0, 0, new Uint8Array([1]));
  await withMp3.meetings.finish("p1", meeting.id, { seconds: 5 });
  await withMp3.meetings.process("p1", meeting.id);
  await withMp3.meetings.mp3("p1", meeting.id);
  assert.ok(await withMp3.blobs.get(`meetings/${meeting.id}/audio.mp3`));
  await withMp3.meetings.remove("p1", meeting.id);
  assert.equal(await withMp3.blobs.get(`meetings/${meeting.id}/audio.mp3`), null);

  const without = await setup([[...words("1", "Hello.", 0)]]);
  const started = await without.meetings.start("p1", { mime: "audio/webm" });
  await without.meetings.chunk("p1", started.meeting.id, 0, 0, new Uint8Array([1]));
  await without.meetings.finish("p1", started.meeting.id, { seconds: 5 });
  await without.meetings.process("p1", started.meeting.id);
  assert.equal((await without.meetings.read("p1", started.meeting.id)).mp3, false);
  assert.equal(without.meetings.mp3Available, false);
  await assert.rejects(
    without.meetings.mp3("p1", started.meeting.id),
    /aren’t available right now/,
  );
});

test("the MP3 routes: make it, then download it with the signed link", async (t) => {
  if (!(await ffmpegAvailable())) return t.skip("ffmpeg isn't installed here");
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
  server = await createApp(db, config, {
    soniox: fakeSoniox([words("1", "Hello from the room.", 0)]).soniox,
  });
  try {
    const session = await server.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    token = (await session.json()).token;
    const started = await server.app.request("/api/meetings", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ mime: "audio/webm" }),
    });
    const { meeting } = await started.json();
    const recording = await readFile(
      tone("route.webm", 1, 440, ["-ac", "1", "-ar", "48000", "-c:a", "libopus"]),
    );
    await server.app.request(`/api/meetings/${meeting.id}/chunks/0/0`, {
      method: "PUT",
      headers: { ...auth(), "Content-Type": "audio/webm" },
      body: recording,
    });
    await server.app.request(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Kickoff: Q4 / plan" }),
    });
    await server.app.request(`/api/meetings/${meeting.id}/finish`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ seconds: 1 }),
    });
    let read: { status: string; mp3: boolean };
    for (let i = 0; ; i++) {
      read = await (
        await server.app.request(`/api/meetings/${meeting.id}`, { headers: auth() })
      ).json();
      if (read.status === "done" || i > 200) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(read.status, "done");
    assert.equal(read.mp3, true);
    // Asking needs a session; the answer has a signed link, a file name and a size.
    const anonymous = await server.app.request(`/api/meetings/${meeting.id}/mp3`, {
      method: "POST",
    });
    assert.equal(anonymous.status, 401);
    const made = await server.app.request(`/api/meetings/${meeting.id}/mp3`, {
      method: "POST",
      headers: auth(),
    });
    assert.equal(made.status, 200);
    const { url, name, bytes } = (await made.json()) as {
      url: string;
      name: string;
      bytes: number;
    };
    assert.equal(name, "Kickoff Q4 plan.mp3");
    assert.ok(bytes > 1000);
    const link = new URL(url);
    const file = await server.app.request(`${link.pathname}${link.search}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "audio/mpeg");
    assert.match(
      file.headers.get("content-disposition") ?? "",
      /^attachment; filename="Kickoff Q4 plan\.mp3"/,
    );
    const body = new Uint8Array(await file.arrayBuffer());
    assert.equal(body.length, bytes);
    assert.ok(
      (body[0] === 0x49 && body[1] === 0x44 && body[2] === 0x33) || body[0] === 0xff,
      "starts like an MP3",
    );
    // The link alone is the key; without its signature the file isn't handed out.
    assert.equal((await server.app.request(link.pathname)).status, 401);
  } finally {
    await server.agent.stop();
    await db.close();
  }
});

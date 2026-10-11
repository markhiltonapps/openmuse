import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "../apps/server/src/db.ts";
import { UsageMeter } from "../apps/server/src/usage.ts";
import { LiveVoice, type SocketLike } from "../apps/server/src/voice-live.ts";
import { CallVoices } from "../apps/server/src/voice-pipecat.ts";

const OFFER = {
  voices: [
    { id: "Ashley", description: "Warm and natural" },
    { id: "Dennis", description: "Calm and friendly" },
    { id: "Theodore", description: "Deep and unhurried" },
  ],
  default: "Ashley",
};

const CATALOG = {
  voices: [
    ...OFFER.voices,
    { id: "Hades", description: "A man’s voice, gravelly and commanding" },
    { id: "Pixie", description: "A woman’s voice, high and playful" },
    { id: "Craig", description: "Older British male" },
    { id: "Wendy", description: "Posh British female, middle-aged" },
  ],
  default: "Ashley",
};

function voiceService(options: { down?: boolean } = {}) {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url.replace("http://voice", ""));
    if (options.down) throw new Error("connection refused");
    if (url.endsWith("/v1/voices")) return Response.json(OFFER);
    if (url.endsWith("/v1/voices/all")) return Response.json(CATALOG);
    const [, voice, kind] = /\/v1\/voices\/([^/]+)\/(sample|listening)$/.exec(url) ?? [];
    if (voice)
      return new Response(`${kind === "sample" ? "mp3" : "wav"} of ${voice}`, {
        headers: { "content-type": kind === "sample" ? "audio/mpeg" : "audio/wav" },
      });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { asked, fetcher };
}

test("people choose a voice by its name; anything else is turned down with the choices", async () => {
  const db = await createStore();
  const service = voiceService();
  const voices = new CallVoices(db, "http://voice", "token", "admin", service.fetcher);
  assert.equal(await voices.chosen("p1"), "Ashley", "the usual voice until they choose");
  assert.deepEqual(await voices.choose("p1", "dennis’s"), { voice: OFFER.voices[1] });
  assert.equal(await voices.chosen("p1"), "Dennis");
  assert.equal(await voices.chosen("p2"), "Ashley", "one person's choice is theirs alone");
  const wrong = await voices.choose("p1", "Gandalf");
  assert.ok("error" in wrong && wrong.error.includes("Ashley, Dennis, Theodore"));
  assert.equal(await voices.chosen("p1"), "Dennis", "a wrong name changes nothing");
  assert.deepEqual(
    await voices.choose("p1", null),
    { voice: OFFER.voices[0] },
    "back to the usual",
  );
  assert.equal(
    service.asked.filter((url) => url === "/v1/voices").length,
    1,
    "the list is asked for once and kept",
  );
  await db.close();
});

test("a chosen voice that's no longer offered falls back to the usual one", async () => {
  const db = await createStore();
  await db.put("p1", "agent-settings", { id: "call-voice", value: "Olivia" });
  const voices = new CallVoices(db, "http://voice", "token", "admin", voiceService().fetcher);
  assert.equal(await voices.chosen("p1"), "Ashley");
  await db.close();
});

test("samples are made once and kept; unknown voices have none", async () => {
  const db = await createStore();
  const service = voiceService();
  const voices = new CallVoices(db, "http://voice", "token", "admin", service.fetcher);
  const first = await voices.sample("theodore");
  const again = await voices.sample("Theodore");
  assert.equal(new TextDecoder().decode(first?.body), "mp3 of Theodore");
  assert.equal(first?.type, "audio/mpeg");
  assert.equal(again, first);
  assert.equal(service.asked.filter((url) => url.endsWith("/sample")).length, 1);
  assert.equal(await voices.sample("Gandalf"), undefined);
  await db.close();
});

test("with the voice service down, there's nothing to choose and saying so is clear", async () => {
  const db = await createStore();
  const voices = new CallVoices(
    db,
    "http://voice",
    "token",
    "admin",
    voiceService({ down: true }).fetcher,
  );
  assert.deepEqual((await voices.offered()).voices, []);
  assert.deepEqual(await voices.choose("p1", "Dennis"), {
    error: "Voices can’t be chosen just now.",
  });
  await db.close();
});

test("a voice chosen during a call is sent to that call straight away", async () => {
  const db = await createStore();
  const sockets: { sent: Record<string, unknown>[] }[] = [];
  const voice = new LiveVoice(
    db,
    async () => ({ instructions: "You are Neddy." }),
    async () => true,
    new UsageMeter(db),
    {
      apiKey: "secret",
      fetcher: (async () =>
        Response.json({
          session: { id: "pc_w0_abc" },
          transport: { type: "webrtc", sdp: "v=0 answer" },
        })) as unknown as typeof fetch,
      socket: () => {
        const socket = {
          sent: [] as Record<string, unknown>[],
          send(data: string) {
            socket.sent.push(JSON.parse(data));
          },
          close() {},
          addEventListener() {},
        } satisfies SocketLike & { sent: Record<string, unknown>[] };
        sockets.push(socket);
        return socket;
      },
    },
  );
  assert.equal(voice.update("owner", { audio: { output: { voice: "Dennis" } } }), false);
  await voice.start("owner", "v=0 offer");
  assert.equal(voice.update("someone else", { audio: { output: { voice: "Dennis" } } }), false);
  assert.equal(voice.update("owner", { audio: { output: { voice: "Dennis" } } }), true);
  assert.deepEqual(sockets[0]?.sent.at(-1), {
    type: "session.update",
    session: { audio: { output: { voice: "Dennis" } } },
  });
  await voice.end("owner", "pc_w0_abc");
  await db.close();
});

test("the admin adds and removes Inworld's voices; everyone then chooses from that list", async () => {
  const db = await createStore();
  const service = voiceService();
  const voices = new CallVoices(db, "http://voice", "token", "admin", service.fetcher);
  const added = await voices.add("hades");
  assert.ok("voice" in added && added.voice.id === "Hades");
  assert.deepEqual(
    (await voices.offered()).voices.map((v) => v.id),
    ["Ashley", "Dennis", "Theodore", "Hades"],
  );
  assert.deepEqual(await voices.choose("p1", "Hades"), {
    voice: CATALOG.voices[3],
  });
  assert.ok("error" in (await voices.add("Gandalf")), "only Inworld's voices");
  const removed = await voices.remove("Dennis");
  assert.ok("voices" in removed && !removed.voices.some((v) => v.id === "Dennis"));
  const usual = await voices.remove("Ashley");
  assert.ok("error" in usual && usual.error.includes("usual voice"));
  await db.close();
});

test("browsing finds voices by words, and a man's voice isn't a woman's", async () => {
  const db = await createStore();
  const voices = new CallVoices(db, "http://voice", "token", "admin", voiceService().fetcher);
  const men = await voices.browse("a man's voice");
  assert.deepEqual(
    men.voices.map((v) => v.id),
    ["Hades", "Craig"],
  );
  assert.deepEqual(
    (await voices.browse("british male")).voices.map((v) => v.id),
    ["Craig"],
  );
  assert.deepEqual(
    (await voices.browse("a british woman's voice")).voices.map((v) => v.id),
    ["Wendy"],
    "“woman” finds Inworld’s “female”",
  );
  assert.deepEqual(
    (await voices.browse("female")).voices.map((v) => v.id),
    ["Pixie", "Wendy"],
    "and “female” finds ours",
  );
  assert.equal((await voices.browse("")).voices.length, 7);
  assert.equal((await voices.browse("ashley")).voices[0]?.onList, true);
  assert.equal((await voices.browse("pixie")).voices[0]?.onList, false);
  await db.close();
});

test("people hear samples of listed voices; the admin, any of Inworld's and the murmurs", async () => {
  const db = await createStore();
  const voices = new CallVoices(db, "http://voice", "token", "admin", voiceService().fetcher);
  assert.equal(await voices.sample("Pixie"), undefined, "not on the list");
  const pixie = await voices.sample("Pixie", true);
  assert.equal(new TextDecoder().decode(pixie?.body), "mp3 of Pixie");
  const murmurs = await voices.listening("dennis");
  assert.equal(murmurs?.type, "audio/wav");
  await db.close();
});
